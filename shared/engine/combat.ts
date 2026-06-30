import type {
  ActionSpec,
  BoardSnapshot,
  CombatBoard,
  CombatEvent,
  CombatOutcome,
  CombatUnit,
  CombatWinner,
  Effect,
  Keyword,
  TribeId,
  TriggerType,
} from '../types';
import { RNG } from './rng';
import { evalCondition, selectTargets, type SelTarget } from './effects';
import { damageMultiplierForTribe, type AuraBearer, type CombatCounters } from './auras';
import { getCombatHandler, type HandlerCombatCtx } from './handlers';
import { getCard } from '../content/units';
import { combat as combatCfg } from '../config/combat';
import { match as matchCfg } from '../config/match';
import { engines } from '../config/engines';

// ─────────────────────────────────────────────────────────────────────────────
// Internal mutable combat model
// ─────────────────────────────────────────────────────────────────────────────

interface CUnit {
  uid: string;
  cardId: string;
  name: string;
  tribe: TribeId;
  tier: number;
  atk: number;
  hp: number;
  keywords: Keyword[];
  divineShield: boolean;
  poisonPending: boolean;
  rebornUsed: boolean;
  golden: boolean;
  isToken: boolean;
  effects: Effect[];
  auras: CombatUnit['auras'];
  bornOrder: number;
  alive: boolean;
  floorAtkGained: number; // Round-6 token-death floor: total atk granted (cap enforcement)
}

interface SideState {
  id: 'a' | 'b';
  units: CUnit[]; // living units, board order
  attackPtr: number; // index of next attacker
  deathCount: number; // friendly deaths so far (avenge)
  tokenDeathCount: number; // friendly token deaths (Gorehide/Thornbeast floor, §16.5)
  revenantDeathCount: number; // friendly Revenant deaths (Pale Lich breakpoint, §16.2)
  doubleNextDeathrattle: boolean; // armed by Pallbearer (§16.5)
  playerTier: number;
}

let combatBornCounter = 0;

function toCUnit(u: CombatUnit): CUnit {
  return {
    uid: u.uid,
    cardId: u.cardId,
    name: u.name,
    tribe: u.tribe,
    tier: u.tier,
    atk: u.atk,
    hp: u.hp,
    keywords: [...u.keywords],
    divineShield: u.keywords.includes('divineShield'),
    poisonPending: false,
    rebornUsed: false,
    golden: u.golden,
    isToken: u.isToken,
    effects: u.effects,
    auras: u.auras,
    bornOrder: combatBornCounter++,
    alive: true,
    floorAtkGained: 0,
  };
}

function view(u: CUnit, slot: number): SelTarget {
  return {
    uid: u.uid,
    tribe: u.tribe,
    keywords: u.keywords,
    atk: u.atk,
    hp: u.hp,
    slot,
    bornTurn: u.bornOrder,
    golden: u.golden,
    isToken: u.isToken,
  };
}

function sideViews(side: SideState): SelTarget[] {
  return side.units.map((u, i) => view(u, i));
}

function bearers(side: SideState): AuraBearer[] {
  return side.units.map((u) => ({ tribe: u.tribe, auras: u.auras }));
}

function snapshot(board: CombatBoard): BoardSnapshot {
  return {
    playerTier: board.playerTier,
    units: board.units.map((u) => ({
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

// ─────────────────────────────────────────────────────────────────────────────
// Combat resolution (spec §7) — pure function of (boardA, boardB, seed).
// ─────────────────────────────────────────────────────────────────────────────

export function resolveCombat(boardA: CombatBoard, boardB: CombatBoard, seed: string): CombatEvent[] {
  combatBornCounter = 0;
  const rng = new RNG(seed);
  const events: CombatEvent[] = [];

  const A: SideState = {
    id: 'a',
    units: boardA.units.map(toCUnit),
    attackPtr: 0,
    deathCount: 0,
    tokenDeathCount: 0,
    revenantDeathCount: 0,
    doubleNextDeathrattle: false,
    playerTier: boardA.playerTier,
  };
  const B: SideState = {
    id: 'b',
    units: boardB.units.map(toCUnit),
    attackPtr: 0,
    deathCount: 0,
    tokenDeathCount: 0,
    revenantDeathCount: 0,
    doubleNextDeathrattle: false,
    playerTier: boardB.playerTier,
  };

  events.push({ t: 'combatStart', seed, a: snapshot(boardA), b: snapshot(boardB) });

  const other = (s: SideState) => (s.id === 'a' ? B : A);

  // ── mutation helpers (keep both sides' attack pointers consistent) ──
  function removeAt(side: SideState, idx: number): void {
    side.units.splice(idx, 1);
    if (side.attackPtr > idx) side.attackPtr -= 1;
  }
  function insertAt(side: SideState, idx: number, newUnits: CUnit[]): void {
    side.units.splice(idx, 0, ...newUnits);
    if (side.attackPtr > idx) side.attackPtr += newUnits.length;
  }

  function countersOf(side: SideState): CombatCounters {
    return { deaths: side.deathCount, revenantDeaths: side.revenantDeathCount };
  }

  function dmgMult(side: SideState, tribe: TribeId): number {
    return damageMultiplierForTribe(bearers(side), tribe, countersOf(side));
  }

  /** Deal `amount` to a unit, honouring divine shield & poison. Returns nothing; mutates + logs. */
  function dealDamageTo(target: CUnit, amount: number, sourceId: string, sourceHasPoison: boolean): void {
    if (!target.alive) return;
    if (target.divineShield) {
      target.divineShield = false;
      target.keywords = target.keywords.filter((k) => k !== 'divineShield');
      events.push({ t: 'keyword', unitId: target.uid, keyword: 'divineShield' });
      events.push({ t: 'damage', sourceId, targetId: target.uid, amount: 0, shieldBroken: true });
      // onShieldBreak: the unit reacts to its own shield breaking (Pearlguard, §16.3 #4).
      const tSide = A.units.includes(target) ? A : B.units.includes(target) ? B : null;
      if (tSide) fireUnitEffects(target, tSide, other(tSide), 'onShieldBreak');
      return; // negates the instance entirely, including poison
    }
    if (amount <= 0) return;
    target.hp -= amount;
    events.push({ t: 'damage', sourceId, targetId: target.uid, amount });
    if (sourceHasPoison) {
      target.poisonPending = true;
      events.push({ t: 'keyword', unitId: target.uid, keyword: 'poison' });
    }
  }

  function makeSummon(cardId: string, ownerSide: SideState): CUnit {
    const card = getCard(cardId);
    const golden = false;
    const u: CUnit = {
      uid: `${cardId}#${combatBornCounter}@${ownerSide.id}`,
      cardId,
      name: card.name,
      tribe: card.tribe,
      tier: card.tier,
      atk: card.atk,
      hp: card.hp,
      keywords: [...card.keywords],
      divineShield: card.keywords.includes('divineShield'),
      poisonPending: false,
      rebornUsed: false,
      golden,
      isToken: card.isToken ?? false,
      effects: card.effects,
      auras: card.auras ?? [],
      bornOrder: combatBornCounter++,
      alive: true,
      floorAtkGained: 0,
    };
    return u;
  }

  /** Summon units at a slot, then fire onSummon triggers for living friendlies. */
  function summonUnits(side: SideState, slot: number, cardId: string, count: number): void {
    const created: CUnit[] = [];
    for (let i = 0; i < count; i++) {
      if (side.units.length >= 7) break; // boardCap; excess summons dropped (logged below)
      created.push(makeSummon(cardId, side));
    }
    if (created.length === 0) return;
    insertAt(side, Math.min(slot, side.units.length), created);
    events.push({ t: 'summon', ownerId: side.id, unitIds: created.map((c) => c.uid), slot });
    // onSummon triggers (e.g. Mother Thorn) — each new unit is the triggerSource.
    for (const newUnit of created) {
      for (const u of [...side.units]) {
        if (!u.alive) continue;
        fireUnitEffects(u, side, other(side), 'onSummon', newUnit.uid);
      }
    }
  }

  function applyActions(
    actions: ActionSpec[],
    sourceUnit: CUnit,
    side: SideState,
    enemy: SideState,
    targets: CUnit[],
    summonSlot: number,
  ): void {
    for (const action of actions) {
      switch (action.type) {
        case 'buffStats': {
          for (const t of targets) {
            t.atk = Math.max(0, t.atk + (action.atk ?? 0));
            t.hp += action.hp ?? 0;
            events.push({
              t: 'stats',
              unitId: t.uid,
              atk: t.atk,
              hp: t.hp,
              sourceId: sourceUnit.uid,
              permanent: action.permanent ?? false,
            });
          }
          break;
        }
        case 'setStats': {
          for (const t of targets) {
            if (action.atk !== undefined) t.atk = action.atk;
            if (action.hp !== undefined) t.hp = action.hp;
            events.push({
              t: 'stats',
              unitId: t.uid,
              atk: t.atk,
              hp: t.hp,
              sourceId: sourceUnit.uid,
              permanent: action.permanent ?? false,
            });
          }
          break;
        }
        case 'grantKeyword': {
          if (!action.keyword) break;
          for (const t of targets) {
            if (!t.keywords.includes(action.keyword)) {
              t.keywords.push(action.keyword);
              if (action.keyword === 'divineShield') t.divineShield = true;
              // `gained` + `sourceId` distinguish "this unit GAINED a keyword ability" (e.g.
              // Spinefish's deathrattle granting Poison) from an affliction/shield-break that
              // reuse the same event — so the replay can show WHICH card got the ability.
              events.push({
                t: 'keyword',
                unitId: t.uid,
                keyword: action.keyword,
                gained: true,
                sourceId: sourceUnit.uid,
              });
            }
          }
          break;
        }
        case 'summon': {
          if (action.summonUnitId) {
            summonUnits(side, summonSlot, action.summonUnitId, action.summonCount ?? 1);
          }
          break;
        }
        case 'dealDamage': {
          const mult = dmgMult(side, sourceUnit.tribe);
          const amount = Math.round((action.amount ?? 0) * mult);
          const poison = sourceUnit.keywords.includes('poison');
          for (const t of targets) dealDamageTo(t, amount, sourceUnit.uid, poison);
          break;
        }
        case 'custom': {
          if (action.handlerId) runHandler(action.handlerId, action.params ?? {}, sourceUnit, side, enemy);
          break;
        }
        // gold/gem/spell/discover/sacrifice are shop-phase actions; no-op in combat.
        default:
          break;
      }
    }
  }

  /** Fire a unit's effects matching a trigger (combat context). */
  function fireUnitEffects(
    sourceUnit: CUnit,
    side: SideState,
    enemy: SideState,
    triggerType: TriggerType,
    triggerSourceUid?: string,
    overrideSlot?: number,
  ): void {
    for (const effect of sourceUnit.effects) {
      if (effect.trigger.type !== triggerType) continue;

      const allies = sideViews(side);
      const enemies = sideViews(enemy);
      const selfSlot = overrideSlot ?? side.units.indexOf(sourceUnit);

      // Condition subject: for onSummon, gate on the summoned unit; else on self.
      let subject: SelTarget | undefined;
      if (triggerType === 'onSummon' && triggerSourceUid) {
        subject = allies.find((a) => a.uid === triggerSourceUid);
      } else {
        subject =
          allies.find((a) => a.uid === sourceUnit.uid) ??
          view(sourceUnit, selfSlot < 0 ? side.units.length : selfSlot);
      }
      if (
        subject &&
        !evalCondition(effect.condition, {
          self: subject,
          allies,
          tier: side.playerTier,
          deathsThisCombat: side.deathCount,
        })
      ) {
        continue;
      }

      const targetUids = selectTargets(effect.target, {
        selfUid: sourceUnit.uid,
        triggerSourceUid,
        allies,
        enemies,
        rng,
      });
      const targets = resolveTargetUnits(targetUids, side, enemy);
      const slot = selfSlot < 0 ? side.units.length : selfSlot;
      applyActions(effect.actions, sourceUnit, side, enemy, targets, slot);
    }
  }

  function resolveTargetUnits(uids: string[], side: SideState, enemy: SideState): CUnit[] {
    const out: CUnit[] = [];
    for (const uid of uids) {
      const a = side.units.find((u) => u.uid === uid);
      if (a) {
        out.push(a);
        continue;
      }
      const e = enemy.units.find((u) => u.uid === uid);
      if (e) out.push(e);
    }
    return out;
  }

  function runHandler(
    handlerId: string,
    params: Record<string, unknown>,
    sourceUnit: CUnit,
    side: SideState,
    enemy: SideState,
  ): void {
    const handler = getCombatHandler(handlerId);
    if (!handler) return;
    const ctx: HandlerCombatCtx = {
      sourceUid: sourceUnit.uid,
      rng,
      params,
      neighborsOf: (uid) => {
        const idx = side.units.findIndex((u) => u.uid === uid);
        if (idx < 0) return [];
        const res: string[] = [];
        if (side.units[idx - 1]) res.push(side.units[idx - 1].uid);
        if (side.units[idx + 1]) res.push(side.units[idx + 1].uid);
        return res;
      },
      otherAllies: () => side.units.filter((u) => u.uid !== sourceUnit.uid).map((u) => u.uid),
      hasDeathrattle: (uid) => {
        const u = side.units.find((x) => x.uid === uid);
        return !!u && u.effects.some((e) => e.trigger.type === 'deathrattle');
      },
      replayDeathrattle: (uid) => {
        const u = side.units.find((x) => x.uid === uid);
        if (!u) return;
        events.push({ t: 'deathrattle', unitId: u.uid });
        fireUnitEffects(u, side, enemy, 'deathrattle');
      },
      primeDoubleNextDeathrattle: () => {
        side.doubleNextDeathrattle = true;
      },
    };
    handler(ctx);
  }

  // ── avenge (afterFriendlyDeaths) ──
  function checkAvenge(side: SideState, enemy: SideState): void {
    for (const u of [...side.units]) {
      if (!u.alive) continue;
      for (const effect of u.effects) {
        if (effect.trigger.type !== 'afterFriendlyDeaths') continue;
        if (effect.trigger.tokensOnly) continue; // handled by applyTokenFloor (token deaths only)
        const threshold = effect.trigger.threshold ?? 1;
        if (threshold <= 0) continue;
        const everyN = effect.trigger.everyN ?? true;
        const hit = everyN ? side.deathCount % threshold === 0 : side.deathCount === threshold;
        if (side.deathCount > 0 && hit) {
          const allies = sideViews(side);
          const enemies = sideViews(enemy);
          const targetUids = selectTargets(effect.target, {
            selfUid: u.uid,
            allies,
            enemies,
            rng,
          });
          const targets = resolveTargetUnits(targetUids, side, enemy);
          applyActions(effect.actions, u, side, enemy, targets, side.units.indexOf(u));
        }
      }
    }
  }

  /**
   * Token-death floor (Gorehide / Thornbeast, §16.5): each friendly token death grants the
   * bearer +`tokenDeathFloorAtk`, capped at `tokenDeathFloorCapAtk` total. A thin continuous
   * floor (decision #22) — never the dominant scaling. Runs only when a token dies.
   */
  function applyTokenFloor(side: SideState): void {
    const cap = engines.wildkin.tokenDeathFloorCapAtk;
    for (const u of side.units) {
      if (!u.alive) continue;
      for (const effect of u.effects) {
        const tr = effect.trigger;
        if (tr.type !== 'afterFriendlyDeaths' || !tr.tokensOnly) continue;
        const threshold = tr.threshold ?? 1;
        if (threshold <= 0) continue;
        const everyN = tr.everyN ?? true;
        const hit = everyN ? side.tokenDeathCount % threshold === 0 : side.tokenDeathCount === threshold;
        if (side.tokenDeathCount <= 0 || !hit) continue;
        const add = effect.actions.find((a) => a.type === 'buffStats')?.atk ?? 0;
        if (add <= 0 || u.floorAtkGained >= cap) continue;
        const grant = Math.min(add, cap - u.floorAtkGained);
        u.atk = Math.max(0, u.atk + grant);
        u.floorAtkGained += grant;
        // Self-buff: the bearer grows off its own token deaths. Permanence is config-driven.
        events.push({
          t: 'stats',
          unitId: u.uid,
          atk: u.atk,
          hp: u.hp,
          sourceId: u.uid,
          permanent: engines.wildkin.tokenBuffPermanent,
        });
      }
    }
  }

  // ── death resolution (spec §7.3) ──
  function resolveDeaths(): void {
    // Loop until no further deaths (deathrattles could chain in theory).
    for (let guard = 0; guard < 64; guard++) {
      const dyingA = A.units.filter((u) => u.hp <= 0 || u.poisonPending);
      const dyingB = B.units.filter((u) => u.hp <= 0 || u.poisonPending);
      if (dyingA.length === 0 && dyingB.length === 0) return;

      const order: Array<{ unit: CUnit; side: SideState }> = [
        ...dyingA.map((unit) => ({ unit, side: A })),
        ...dyingB.map((unit) => ({ unit, side: B })),
      ];

      for (const { unit, side } of order) {
        if (!unit.alive) continue;
        const idx = side.units.indexOf(unit);
        if (idx < 0) continue;
        unit.alive = false;
        events.push({ t: 'death', unitId: unit.uid });
        removeAt(side, idx);

        // Counters first, so deathrattle conditions (Bone Colossus) and the Pale Lich
        // breakpoint see this death. Incrementing here (vs after) emits no event, so
        // existing logs stay byte-identical.
        side.deathCount += 1;
        if (unit.isToken) side.tokenDeathCount += 1;
        if (unit.tribe === 'revenants') side.revenantDeathCount += 1;

        // Deathrattle (+ Pallbearer double: next dier with a deathrattle fires it twice).
        if (unit.effects.some((e) => e.trigger.type === 'deathrattle')) {
          const willDouble = side.doubleNextDeathrattle;
          events.push({ t: 'deathrattle', unitId: unit.uid });
          fireUnitEffects(unit, side, other(side), 'deathrattle', undefined, idx);
          if (willDouble) {
            side.doubleNextDeathrattle = false;
            events.push({ t: 'deathrattle', unitId: unit.uid });
            fireUnitEffects(unit, side, other(side), 'deathrattle', undefined, idx);
          }
        }

        // Reborn: returns once, own slot, 1 HP, reborn removed (after deathrattle).
        if (unit.keywords.includes('reborn') && !unit.rebornUsed) {
          const card = getCard(unit.cardId);
          const reborn: CUnit = {
            uid: `${unit.uid}~r`,
            cardId: unit.cardId,
            name: unit.name,
            tribe: unit.tribe,
            tier: unit.tier,
            atk: card.atk * (unit.golden ? 2 : 1),
            hp: 1,
            keywords: unit.keywords.filter((k) => k !== 'reborn'),
            divineShield: card.keywords.includes('divineShield'),
            poisonPending: false,
            rebornUsed: true,
            golden: unit.golden,
            isToken: unit.isToken,
            effects: unit.effects,
            auras: unit.auras,
            bornOrder: combatBornCounter++,
            alive: true,
            floorAtkGained: 0,
          };
          insertAt(side, Math.min(idx, side.units.length), [reborn]);
          events.push({ t: 'keyword', unitId: unit.uid, keyword: 'reborn' });
          events.push({ t: 'summon', ownerId: side.id, unitIds: [reborn.uid], slot: idx });
        }

        // Avenge (Pack Mother, Mortarch); token-death floor only when a token died.
        checkAvenge(side, other(side));
        if (unit.isToken) applyTokenFloor(side);
      }
    }
  }

  // ── start of combat (spec §7.1): A then B, left→right ──
  for (const side of [A, B]) {
    for (const u of [...side.units]) {
      if (u.alive) fireUnitEffects(u, side, other(side), 'startOfCombat');
    }
  }
  resolveDeaths();

  // ── first attacker: more minions; tie → seeded coin flip ──
  let turn: 'a' | 'b';
  if (A.units.length > B.units.length) turn = 'a';
  else if (B.units.length > A.units.length) turn = 'b';
  else turn = rng.bool() ? 'a' : 'b';

  // ── attack loop (spec §7.2) ──
  let steps = 0;
  while (steps < combatCfg.maxCombatSteps) {
    if (A.units.length === 0 || B.units.length === 0) break;

    const side = turn === 'a' ? A : B;
    const enemy = other(side);

    if (side.units.length > 0) {
      if (side.attackPtr >= side.units.length) side.attackPtr = 0;
      const attacker = side.units[side.attackPtr];

      // onAttack effects (cleave handled below; custom handlers here)
      fireUnitEffects(attacker, side, enemy, 'onAttack');

      if (enemy.units.length > 0 && attacker.alive) {
        // choose defender: taunt override, else random
        const taunts = enemy.units.filter((u) => u.keywords.includes('taunt'));
        const pool = combatCfg.tauntOverride && taunts.length > 0 ? taunts : enemy.units;
        const defender =
          combatCfg.targetingMode === 'deterministic' ? pool[0] : (rng.pick(pool) as CUnit);
        const defenderIdx = enemy.units.indexOf(defender);

        events.push({ t: 'attack', side: side.id, attackerId: attacker.uid, defenderId: defender.uid });

        // advance pointer past the attacker before death resolution
        const ai = side.units.indexOf(attacker);
        side.attackPtr = ai + 1;

        const atkDamage = Math.round(attacker.atk * dmgMult(side, attacker.tribe));
        const defDamage = Math.round(defender.atk * dmgMult(enemy, defender.tribe));
        const attackerPoison = attacker.keywords.includes('poison');
        const defenderPoison = defender.keywords.includes('poison');

        // main hit
        dealDamageTo(defender, atkDamage, attacker.uid, attackerPoison);
        // cleave neighbours of the defender
        if (attacker.keywords.includes('cleave')) {
          const cleaveAmt = Math.round(atkDamage * combatCfg.cleaveDefault);
          const left = enemy.units[defenderIdx - 1];
          const right = enemy.units[defenderIdx + 1];
          events.push({ t: 'keyword', unitId: attacker.uid, keyword: 'cleave' });
          if (left) dealDamageTo(left, cleaveAmt, attacker.uid, attackerPoison);
          if (right) dealDamageTo(right, cleaveAmt, attacker.uid, attackerPoison);
        }
        // retaliation
        dealDamageTo(attacker, defDamage, defender.uid, defenderPoison);

        resolveDeaths();
      } else {
        // no enemy to hit; still advance the pointer
        const ai = side.units.indexOf(attacker);
        if (ai >= 0) side.attackPtr = ai + 1;
      }
    }

    if (A.units.length === 0 || B.units.length === 0) break;
    turn = turn === 'a' ? 'b' : 'a';
    steps += 1;
  }

  // ── outcome ──
  const winner: CombatWinner =
    A.units.length > 0 && B.units.length === 0
      ? 'a'
      : B.units.length > 0 && A.units.length === 0
        ? 'b'
        : 'tie';

  const winSide = winner === 'a' ? A : winner === 'b' ? B : null;
  const survivors = winSide ? winSide.units.map((u) => u.uid) : [];
  const survivorTierSum = winSide ? winSide.units.reduce((s, u) => s + u.tier, 0) : 0;
  const damageToLoser = winSide
    ? clampDamage(winSide.playerTier, survivorTierSum)
    : 0;

  events.push({ t: 'combatEnd', winner, survivors, damageToLoser });
  return events;
}

function clampDamage(winnerTier: number, survivorTierSum: number): number {
  const raw =
    winnerTier * matchCfg.lossBaseTierWeight + survivorTierSum * matchCfg.survivorTierWeight;
  return Math.max(0, Math.min(raw, matchCfg.lossDamageCap));
}

// ─────────────────────────────────────────────────────────────────────────────
// Outcome helper — read the final event without re-running combat.
// ─────────────────────────────────────────────────────────────────────────────

export function summarizeCombat(events: CombatEvent[]): CombatOutcome {
  const end = events[events.length - 1];
  if (!end || end.t !== 'combatEnd') {
    return { winner: 'tie', survivors: [], survivorTierSum: 0, damageToLoser: 0, steps: 0 };
  }
  const steps = events.filter((e) => e.t === 'attack').length;
  // survivorTierSum is reconstructable from combatStart + survivors, but we keep
  // the authoritative damage from the event.
  return {
    winner: end.winner,
    survivors: end.survivors,
    survivorTierSum: 0,
    damageToLoser: end.damageToLoser,
    steps,
  };
}
