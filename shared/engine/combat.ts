// Pure combat resolver (spec §7). resolveCombat(a, b, seed) → CombatEvent[].
//
// Pinned to the DECIDED intent (D1–D3), NOT to any legacy behavior:
//  • D1 simultaneous deaths — collect+register the whole batch, THEN resolve deathrattles.
//  • D2 cross-side order — the attacker's side resolves first (side A first at start of combat),
//        left→right within a side.
//  • D3 (i) a unit dead to its own onAttack does NOT swing; (ii) cleave recomputes neighbors
//        after an onShieldBreak insert (never a stale index).
//  • D11 destroy = remove + deaths++ + fire deathrattle, bypassing divine shield (no damage).
//
// Combat NEVER mutates its inputs (EV-CMB-01): it builds its own Fighter copies. All randomness
// flows through the seeded Rng in a fixed draw order (intra-impl determinism, D4).

import type {
  ActionSpec,
  AuraSpec,
  BoardSnapshot,
  CombatBoard,
  CombatEvent,
  CombatUnit,
  Effect,
  Keyword,
  TribeId,
} from '../types';
import { combat as combatCfg, economy, engines, match as matchCfg, triples } from '../config';
import { getCard, UNIT_BY_ID } from '../content';
import { Rng } from './rng';
import {
  applyBuff,
  applyMultiply,
  evaluateCondition,
  selectTargets,
  type ConditionCounts,
} from './effects';
import { damageMultiplier } from './auras';
import { runHandler } from './handlers';

// ── Live combat unit (Fighter) ─────────────────────────────────────────────────

interface Fighter {
  uid: string;
  cardId: string;
  name: string;
  tribe: TribeId;
  tier: number;
  atk: number;
  hp: number;
  keywords: Keyword[];
  golden: boolean;
  isToken: boolean;
  effects: Effect[];
  auras: AuraSpec[];
  bornTurn?: number;
  // runtime state:
  baseCardAtk: number; // printed base attack (for reborn)
  shield: boolean; // live divine shield
  poisoned: boolean; // flagged to die after the step
  rebornAvailable: boolean;
  avengeFired: Map<Effect, number>; // per-effect fire count (avenge everyN / once)
  tokenFloorAtk: number; // accumulated token-death-floor attack (capped)
}

interface Side {
  id: 'a' | 'b';
  units: Fighter[];
  playerTier: number;
  pointer: number;
  deaths: number;
  revenantDeaths: number;
  tokenDeaths: number;
  primedDouble: boolean; // Pallbearer: next friendly dier's deathrattle fires twice
}

interface Ctx {
  a: Side;
  b: Side;
  rng: Rng;
  events: CombatEvent[];
  summonSeq: number;
  steps: number;
  startCount: { a: number; b: number }; // minions at start of combat (alliesAtStart)
}

function makeFighter(cu: CombatUnit): Fighter {
  const card = UNIT_BY_ID[cu.cardId];
  const baseCardAtk = card ? card.atk : Math.round(cu.atk / (cu.golden ? triples.goldenStatMultiplier : 1));
  return {
    uid: cu.uid,
    cardId: cu.cardId,
    name: cu.name,
    tribe: cu.tribe,
    tier: cu.tier,
    atk: cu.atk,
    hp: cu.hp,
    keywords: [...cu.keywords],
    golden: cu.golden,
    isToken: cu.isToken,
    effects: cu.effects,
    auras: cu.auras,
    baseCardAtk,
    shield: cu.keywords.includes('divineShield'),
    poisoned: false,
    rebornAvailable: cu.keywords.includes('reborn'),
    avengeFired: new Map(),
    tokenFloorAtk: 0,
  };
}

function fighterFromCard(cardId: string, uid: string): Fighter {
  const card = getCard(cardId);
  return makeFighter({
    uid,
    cardId,
    name: card.name,
    tribe: card.tribe,
    tier: card.tier,
    atk: card.atk,
    hp: card.hp,
    keywords: [...card.keywords],
    golden: false,
    isToken: card.isToken ?? false,
    effects: [...card.effects],
    auras: card.auras ? [...card.auras] : [],
  });
}

function makeSide(id: 'a' | 'b', board: CombatBoard): Side {
  return {
    id,
    units: board.units.map(makeFighter),
    playerTier: board.playerTier,
    pointer: 0,
    deaths: 0,
    revenantDeaths: 0,
    tokenDeaths: 0,
    primedDouble: false,
  };
}

function snapshot(side: Side): BoardSnapshot {
  return {
    playerTier: side.playerTier,
    units: side.units.map((u) => ({
      uid: u.uid,
      cardId: u.cardId,
      name: u.name,
      tribe: u.tribe,
      tier: u.tier,
      atk: u.atk,
      hp: u.hp,
      keywords: [...u.keywords],
      golden: u.golden,
    })),
  };
}

// ── small helpers ───────────────────────────────────────────────────────────────

function hasKw(u: Fighter, kw: Keyword): boolean {
  return u.keywords.includes(kw);
}
function removeKw(u: Fighter, kw: Keyword): void {
  u.keywords = u.keywords.filter((k) => k !== kw);
}
function living(units: Fighter[]): Fighter[] {
  return units.filter((u) => u.hp > 0 && !u.poisoned);
}
function other(ctx: Ctx, side: Side): Side {
  return side.id === 'a' ? ctx.b : ctx.a;
}
function sideOf(ctx: Ctx, u: Fighter): Side {
  return ctx.a.units.includes(u) ? ctx.a : ctx.b;
}

/** Remove a unit, keeping the side's attack pointer pointing at the same logical next unit. */
function removeAt(side: Side, i: number): void {
  side.units.splice(i, 1);
  if (i < side.pointer) side.pointer--;
}
/** Insert a unit, shifting the pointer if the insertion is at/before it. */
function insertAt(side: Side, i: number, u: Fighter): void {
  side.units.splice(i, 0, u);
  if (i <= side.pointer) side.pointer++;
}
function clampIndex(i: number, len: number): number {
  if (i < 0) return 0;
  if (i > len) return len;
  return i;
}

// ── loss damage (D6: WINNER's tier) ──────────────────────────────────────────────

export function lossDamage(winnerTier: number, survivorTierSum: number): number {
  const raw = winnerTier * matchCfg.lossBaseTierWeight + survivorTierSum * matchCfg.survivorTierWeight;
  return Math.max(0, Math.min(matchCfg.lossDamageCap, Math.round(raw)));
}

// ── entry point ──────────────────────────────────────────────────────────────────

export function resolveCombat(boardA: CombatBoard, boardB: CombatBoard, seed: string): CombatEvent[] {
  const ctx: Ctx = {
    a: makeSide('a', boardA),
    b: makeSide('b', boardB),
    rng: new Rng(seed),
    events: [],
    summonSeq: 0,
    steps: 0,
    startCount: { a: boardA.units.length, b: boardB.units.length },
  };

  ctx.events.push({ t: 'combatStart', seed, a: snapshot(ctx.a), b: snapshot(ctx.b) });

  // §7.1.2 start-of-combat effects: A then B, left→right.
  fireStartOfCombat(ctx);
  // §7.1.3 resolve deaths (start-of-combat kills). No attacker yet → side A first (D2 fallback).
  resolveDeaths(ctx, 'a');

  // §7.1.4 first attacker = more minions; tie → seeded coin. Count taken AFTER step-3 deaths.
  let turn: 'a' | 'b';
  if (ctx.a.units.length > ctx.b.units.length) turn = 'a';
  else if (ctx.b.units.length > ctx.a.units.length) turn = 'b';
  else turn = ctx.rng.bool() ? 'a' : 'b';

  // §7.2 attack loop.
  while (ctx.steps < combatCfg.maxCombatSteps && ctx.a.units.length > 0 && ctx.b.units.length > 0) {
    ctx.steps++;
    attackStep(ctx, turn);
    turn = turn === 'a' ? 'b' : 'a';
  }

  finalize(ctx);
  return ctx.events;
}

// ── start of combat ────────────────────────────────────────────────────────────

function fireStartOfCombat(ctx: Ctx): void {
  const order: Array<{ side: Side; unit: Fighter }> = [
    ...ctx.a.units.map((unit) => ({ side: ctx.a, unit })),
    ...ctx.b.units.map((unit) => ({ side: ctx.b, unit })),
  ];
  for (const { side, unit } of order) {
    if (unit.hp <= 0) continue; // destroyed by an earlier start-of-combat effect
    for (const e of unit.effects) {
      if (e.trigger.type !== 'startOfCombat') continue;
      const anchor = side.units.indexOf(unit) + 1;
      resolveCombatEffect(ctx, side, unit, e, anchor, undefined);
    }
  }
}

// ── attack step (§7.2) ───────────────────────────────────────────────────────────

function attackStep(ctx: Ctx, sideId: 'a' | 'b'): void {
  const side = sideId === 'a' ? ctx.a : ctx.b;
  const enemy = other(ctx, side);
  if (side.units.length === 0 || enemy.units.length === 0) return;
  if (side.pointer >= side.units.length) side.pointer = 0;

  const attacker = side.units[side.pointer];
  const attackerUid = attacker.uid;

  // onAttack (Bonepiper etc.), then resolve its deaths now (D3i).
  fireTrigger(ctx, side, attacker, 'onAttack');
  resolveDeaths(ctx, sideId);
  if (!side.units.some((u) => u.uid === attackerUid)) {
    // Attacker died to its own onAttack → it does NOT swing (D3i). Pointer already adjusted.
    return;
  }

  const defender = pickDefender(ctx, enemy, attacker);
  if (!defender) return;
  ctx.events.push({ t: 'attack', side: sideId, attackerId: attacker.uid, defenderId: defender.uid });

  // advance pointer past the attacker.
  side.pointer = side.pointer + 1;

  const attackerPoison = hasKw(attacker, 'poison');
  // main hit — may break the defender's shield and (via onShieldBreak) insert a unit.
  dealDamageInstance(ctx, side, attacker, enemy, defender, attacker.atk, attackerPoison);

  // cleave: recompute neighbor positions against the CURRENT enemy line (D3ii).
  if (hasKw(attacker, 'cleave')) {
    const cleaveRaw = attacker.atk * combatCfg.cleaveDefault;
    const di = enemy.units.indexOf(defender);
    if (di >= 0) {
      const left = enemy.units[di - 1];
      if (left) dealDamageInstance(ctx, side, attacker, enemy, left, cleaveRaw, attackerPoison);
      // re-find the defender: a left-neighbor shield break could have inserted a unit.
      const di2 = enemy.units.indexOf(defender);
      const right = di2 >= 0 ? enemy.units[di2 + 1] : undefined;
      if (right) dealDamageInstance(ctx, side, attacker, enemy, right, cleaveRaw, attackerPoison);
    }
  }

  // retaliation — the defender (still in the line) hits back.
  if (enemy.units.some((u) => u.uid === defender.uid)) {
    dealDamageInstance(ctx, enemy, defender, side, attacker, defender.atk, hasKw(defender, 'poison'));
  }

  resolveDeaths(ctx, sideId);
}

function pickDefender(ctx: Ctx, enemy: Side, _attacker: Fighter): Fighter | undefined {
  if (enemy.units.length === 0) return undefined;
  let candidates = enemy.units;
  if (combatCfg.tauntOverride) {
    const taunts = enemy.units.filter((u) => hasKw(u, 'taunt'));
    if (taunts.length > 0) candidates = taunts;
  }
  if (combatCfg.targetingMode === 'deterministic') return candidates[0];
  return ctx.rng.pick(candidates);
}

// ── damage instance ──────────────────────────────────────────────────────────────

function dealDamageInstance(
  ctx: Ctx,
  sourceSide: Side,
  source: Fighter,
  targetSide: Side,
  target: Fighter,
  rawAmount: number,
  sourceHasPoison: boolean,
): void {
  if (rawAmount <= 0) return;
  const mult = damageMultiplier(sourceSide.units, source, {
    deaths: sourceSide.deaths,
    revenantDeaths: sourceSide.revenantDeaths,
  });
  const amount = Math.round(rawAmount * mult);
  if (amount <= 0) return;

  if (target.shield) {
    // Divine shield negates this instance entirely and is consumed; onShieldBreak fires now.
    ctx.events.push({ t: 'damage', sourceId: source.uid, targetId: target.uid, amount: 0, shieldBroken: true });
    target.shield = false;
    removeKw(target, 'divineShield');
    // poison is blanked too, unless config says shields don't negate poison.
    if (sourceHasPoison && !combatCfg.divineShieldNegatesPoison) target.poisoned = true;
    fireTrigger(ctx, targetSide, target, 'onShieldBreak');
    return;
  }

  target.hp -= amount;
  ctx.events.push({ t: 'damage', sourceId: source.uid, targetId: target.uid, amount });
  if (sourceHasPoison && amount > 0) target.poisoned = true;
}

// ── deaths (§7.3, D1/D2) ─────────────────────────────────────────────────────────

function isDead(u: Fighter): boolean {
  return u.hp <= 0 || u.poisoned;
}

function resolveDeaths(ctx: Ctx, attackerSideId: 'a' | 'b'): void {
  let guard = 0;
  for (;;) {
    // safety bound against pathological deathrattle→summon→death chains (spec §7.3).
    if (++guard > 64) break;

    // D2 order: attacker's side first, left→right within a side.
    const orderSides = attackerSideId === 'b' ? [ctx.b, ctx.a] : [ctx.a, ctx.b];
    const batch: Array<{ side: Side; unit: Fighter; index: number }> = [];
    for (const s of orderSides) {
      s.units.forEach((unit, index) => {
        if (isDead(unit)) batch.push({ side: s, unit, index });
      });
    }
    if (batch.length === 0) break;

    // (1)+(2) register the WHOLE batch before any deathrattle: emit death, remove, count.
    for (const d of batch) {
      ctx.events.push({ t: 'death', unitId: d.unit.uid });
      const idx = d.side.units.indexOf(d.unit);
      if (idx >= 0) removeAt(d.side, idx);
      d.side.deaths++;
      if (d.unit.isToken) d.side.tokenDeaths++;
      if (d.unit.tribe === 'revenants') d.side.revenantDeaths++;
    }

    // (3) deathrattles into the settled board, D2 order (Pallbearer double honored).
    for (const d of batch) fireDeathrattle(ctx, d.side, d.unit, d.index);

    // (4) reborn — after the deathrattle.
    for (const d of batch) {
      if (d.unit.rebornAvailable) rebornReturn(d.side, d.unit, d.index, ctx);
    }

    // (5) avenge + token-death floor on the batch count.
    fireAvenge(ctx, ctx.a);
    fireAvenge(ctx, ctx.b);

    // (6) summons were folded into (3) (they occupy the dead slot). Loop to catch chained deaths.
  }
}

function fireDeathrattle(ctx: Ctx, side: Side, unit: Fighter, anchorIndex: number): void {
  const hasDR = unit.effects.some((e) => e.trigger.type === 'deathrattle');
  let repeats = 1;
  if (side.primedDouble && hasDR) {
    repeats = 2;
    side.primedDouble = false;
  }
  for (let r = 0; r < repeats; r++) {
    ctx.events.push({ t: 'deathrattle', unitId: unit.uid });
    for (const e of unit.effects) {
      if (e.trigger.type !== 'deathrattle') continue;
      resolveCombatEffect(ctx, side, unit, e, anchorIndex, undefined);
    }
  }
}

/** Re-fire a unit's deathrattle WITHOUT it dying (Bonepiper handler). */
function replayDeathrattle(ctx: Ctx, side: Side, unit: Fighter): void {
  ctx.events.push({ t: 'deathrattle', unitId: unit.uid });
  const anchor = side.units.indexOf(unit) + 1;
  for (const e of unit.effects) {
    if (e.trigger.type !== 'deathrattle') continue;
    resolveCombatEffect(ctx, side, unit, e, anchor, undefined);
  }
}

function rebornReturn(side: Side, unit: Fighter, anchorIndex: number, ctx: Ctx): void {
  const card = getCard(unit.cardId);
  unit.atk = unit.baseCardAtk * (unit.golden ? triples.goldenStatMultiplier : 1);
  unit.hp = engines.revenants.rebornHp;
  unit.rebornAvailable = false;
  unit.keywords = card.keywords.filter((k) => k !== 'reborn');
  unit.shield = card.keywords.includes('divineShield');
  unit.poisoned = false;
  insertAt(side, clampIndex(anchorIndex, side.units.length), unit);
  ctx.events.push({ t: 'stats', unitId: unit.uid, atk: unit.atk, hp: unit.hp });
}

function fireAvenge(ctx: Ctx, side: Side): void {
  for (const u of side.units) {
    if (u.hp <= 0 || u.poisoned) continue;
    for (const e of u.effects) {
      if (e.trigger.type !== 'afterFriendlyDeaths') continue;
      const tokensOnly = e.trigger.tokensOnly === true;
      const count = tokensOnly ? side.tokenDeaths : side.deaths;
      const n = e.trigger.threshold ?? 1;
      const everyN = e.trigger.everyN === true;
      const firedSoFar = u.avengeFired.get(e) ?? 0;
      if (everyN) {
        const target = Math.floor(count / n);
        let fired = firedSoFar;
        while (fired < target) {
          fireAvengeEffect(ctx, side, u, e, tokensOnly);
          fired++;
        }
        u.avengeFired.set(e, fired);
      } else if (firedSoFar === 0 && count >= n) {
        fireAvengeEffect(ctx, side, u, e, tokensOnly);
        u.avengeFired.set(e, 1);
      }
    }
  }
}

function fireAvengeEffect(ctx: Ctx, side: Side, u: Fighter, e: Effect, tokensOnly: boolean): void {
  if (tokensOnly) {
    // Token-death floor: cap the cumulative attack this effect adds (engine-enforced, §6.8).
    const cap = engines.wildkin.tokenDeathFloorCapAtk;
    for (const action of e.actions) {
      if (action.type !== 'buffStats') continue;
      const wantAtk = action.atk ?? 0;
      const addable = Math.max(0, Math.min(wantAtk, cap - u.tokenFloorAtk));
      if (addable <= 0) continue;
      const prevAtk = u.atk;
      const prevHp = u.hp;
      const s = applyBuff({ atk: u.atk, hp: u.hp }, addable, action.hp ?? 0);
      u.atk = s.atk;
      u.hp = s.hp;
      u.tokenFloorAtk += addable;
      if (action.permanent === true) {
        // Data-driven via engines.wildkin.tokenBuffPermanent (false = this-combat, per card text).
        ctx.events.push({
          t: 'stats',
          unitId: u.uid,
          atk: u.atk,
          hp: u.hp,
          sourceId: u.uid,
          permanent: true,
          dAtk: u.atk - prevAtk,
          dHp: u.hp - prevHp,
        });
      } else {
        ctx.events.push({ t: 'stats', unitId: u.uid, atk: u.atk, hp: u.hp, sourceId: u.uid });
      }
    }
    return;
  }
  const anchor = side.units.indexOf(u) + 1;
  resolveCombatEffect(ctx, side, u, e, anchor, undefined);
}

// ── effect resolution (combat side) ───────────────────────────────────────────────

function resolveCombatEffect(
  ctx: Ctx,
  side: Side,
  source: Fighter,
  effect: Effect,
  anchorIndex: number,
  triggerSource: Fighter | undefined,
): void {
  const enemy = other(ctx, side);
  const counts: ConditionCounts = {
    deathsThisCombat: side.deaths,
    countAllies: ctx.startCount[side.id], // "minions controlled at start of combat"
  };
  if (!evaluateCondition(effect.condition, counts)) return;

  const targets = selectTargets(effect.target, {
    source,
    triggerSource,
    allies: living(side.units),
    enemies: living(enemy.units),
    rng: ctx.rng,
  });

  for (const action of effect.actions) {
    applyCombatAction(ctx, side, source, action, targets, anchorIndex);
  }
}

function applyCombatAction(
  ctx: Ctx,
  side: Side,
  source: Fighter,
  action: ActionSpec,
  targets: Fighter[],
  anchorIndex: number,
): void {
  switch (action.type) {
    case 'buffStats': {
      for (const t of targets) {
        const prevAtk = t.atk;
        const prevHp = t.hp;
        const s = applyBuff({ atk: t.atk, hp: t.hp }, action.atk ?? 0, action.hp ?? 0);
        t.atk = s.atk;
        t.hp = s.hp;
        if (action.permanent === true) {
          // Decision #38 (§7.5): flag the event + carry the post-clamp DELTA so the
          // post-combat fold can replay exactly this contribution onto survivors.
          ctx.events.push({
            t: 'stats',
            unitId: t.uid,
            atk: t.atk,
            hp: t.hp,
            sourceId: source.uid,
            permanent: true,
            dAtk: t.atk - prevAtk,
            dHp: t.hp - prevHp,
          });
        } else {
          ctx.events.push({ t: 'stats', unitId: t.uid, atk: t.atk, hp: t.hp, sourceId: source.uid });
        }
      }
      break;
    }
    case 'setStats': {
      // NOTE (§7.5): in combat, `permanent` is honored ONLY on buffStats (a delta can be
      // folded back; an absolute set / multiply / reset cannot be disentangled from combat
      // damage). setStats/multiplyStats/resetToBase are always this-combat-only here.
      for (const t of targets) {
        const s = applyBuff({ atk: 0, hp: 0 }, action.atk ?? t.atk, action.hp ?? t.hp);
        t.atk = s.atk;
        t.hp = s.hp;
        ctx.events.push({ t: 'stats', unitId: t.uid, atk: t.atk, hp: t.hp, sourceId: source.uid });
      }
      break;
    }
    case 'multiplyStats': {
      for (const t of targets) {
        const s = applyMultiply({ atk: t.atk, hp: t.hp }, action.factor ?? 1);
        t.atk = s.atk;
        t.hp = s.hp;
        ctx.events.push({ t: 'stats', unitId: t.uid, atk: t.atk, hp: t.hp, sourceId: source.uid });
      }
      break;
    }
    case 'resetToBase': {
      for (const t of targets) {
        const card = getCard(t.cardId);
        const mult = t.golden ? triples.goldenStatMultiplier : 1;
        t.atk = card.atk * mult;
        t.hp = card.hp * mult;
        ctx.events.push({ t: 'stats', unitId: t.uid, atk: t.atk, hp: t.hp, sourceId: source.uid });
      }
      break;
    }
    case 'grantKeyword': {
      const kw = action.keyword;
      if (!kw) break;
      for (const t of targets) {
        if (!t.keywords.includes(kw)) t.keywords.push(kw);
        if (kw === 'divineShield') t.shield = true;
        if (kw === 'reborn') t.rebornAvailable = true;
        ctx.events.push({ t: 'keyword', unitId: t.uid, keyword: kw, gained: true, sourceId: source.uid });
      }
      break;
    }
    case 'dealDamage': {
      const amt = action.amount ?? 0;
      const srcPoison = hasKw(source, 'poison');
      for (const t of targets) {
        dealDamageInstance(ctx, side, source, sideOf(ctx, t), t, amt, srcPoison);
      }
      break;
    }
    case 'destroy': {
      // D11: remove target, deaths++ (via the death loop), fire its deathrattle, bypass shield,
      // NOT combat damage. Mark hp=0 so the next death pass collects it (shield untouched).
      for (const t of targets) {
        t.hp = 0;
      }
      break;
    }
    case 'summon': {
      resolveSummon(ctx, side, anchorIndex, action.summonUnitId, action.summonCount ?? 1, source);
      break;
    }
    case 'custom': {
      const idx = side.units.indexOf(source);
      const left = idx > 0 ? side.units[idx - 1] : undefined;
      const right = idx >= 0 && idx < side.units.length - 1 ? side.units[idx + 1] : undefined;
      const adjacent = [left, right].filter((u): u is Fighter => !!u).map((u) => u.uid);
      runHandler(action.handlerId ?? '', {
        replayDeathrattle: (uid) => {
          const u = side.units.find((x) => x.uid === uid);
          if (u) replayDeathrattle(ctx, side, u);
        },
        adjacentAllyUids: adjacent,
        allyUids: side.units.map((u) => u.uid),
        primeDoubleNextDeathrattle: () => {
          side.primedDouble = true;
        },
        params: action.params ?? {},
      });
      break;
    }
    // giveGem / plantDeathrattle / gainGold / makeSpell / discover: no combat effect.
    default:
      break;
  }
}

function resolveSummon(
  ctx: Ctx,
  side: Side,
  anchorIndex: number,
  summonUnitId: string | undefined,
  count: number,
  source: Fighter,
): void {
  if (!summonUnitId) return;
  const summoned: Fighter[] = [];
  let at = clampIndex(anchorIndex, side.units.length);
  const slot = at;
  for (let k = 0; k < count; k++) {
    if (side.units.length >= economy.boardCap) break; // over-cap summons dropped (logged)
    const uid = `sum#${++ctx.summonSeq}`;
    const f = fighterFromCard(summonUnitId, uid);
    insertAt(side, at, f);
    summoned.push(f);
    at++;
  }
  if (summoned.length === 0) return;
  ctx.events.push({ t: 'summon', ownerId: source.uid, unitIds: summoned.map((u) => u.uid), slot });
  // onSummon fires for living friendlies (the summoned unit is the trigger source).
  for (const f of summoned) {
    for (const u of [...side.units]) {
      if (u.hp <= 0 || u.poisoned) continue;
      for (const e of u.effects) {
        if (e.trigger.type !== 'onSummon') continue;
        resolveCombatEffect(ctx, side, u, e, side.units.indexOf(u) + 1, f);
      }
    }
  }
}

function fireTrigger(ctx: Ctx, side: Side, unit: Fighter, type: 'onAttack' | 'onShieldBreak'): void {
  for (const e of unit.effects) {
    if (e.trigger.type !== type) continue;
    const anchor = side.units.indexOf(unit) + 1;
    resolveCombatEffect(ctx, side, unit, e, anchor, undefined);
  }
}

// ── finalize ──────────────────────────────────────────────────────────────────────

function finalize(ctx: Ctx): void {
  const aAlive = ctx.a.units.length > 0;
  const bAlive = ctx.b.units.length > 0;
  let winner: 'a' | 'b' | 'tie';
  if (aAlive && !bAlive) winner = 'a';
  else if (bAlive && !aAlive) winner = 'b';
  else winner = 'tie';

  const winSide = winner === 'a' ? ctx.a : winner === 'b' ? ctx.b : null;
  const survivors = winSide ? winSide.units.map((u) => u.uid) : [];
  let damageToLoser = 0;
  if (winSide) {
    const survivorTierSum = winSide.units.reduce((s, u) => s + u.tier, 0);
    damageToLoser = lossDamage(winSide.playerTier, survivorTierSum);
  }
  // Per-side survivor lists (decision #38, §7.5): needed by the writeback fold — `survivors`
  // is winner-only, so a step-cap tie (both sides alive) would otherwise report nobody.
  // Reborn-returned units are in `side.units` under their ORIGINAL uid, so they count.
  ctx.events.push({
    t: 'combatEnd',
    winner,
    survivors,
    damageToLoser,
    survivorsA: ctx.a.units.map((u) => u.uid),
    survivorsB: ctx.b.units.map((u) => u.uid),
  });
}
