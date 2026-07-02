// Shop-phase reducer (spec §4.2, §5, §9.7). Every op validates against authoritative state
// and returns an OpResult; a rejected op mutates nothing (invariant 1). Economy numbers all
// come from config (invariant 4). Targeted (`chosenAlly`) battlecries resolve here so combat
// stays a pure, input-free function (§7.4).

import type {
  ActionSpec,
  ActivatedAbilityState,
  CombatBoard,
  Effect,
  PendingTarget,
  PrivateState,
  TribeId,
  UnitCard,
  UnitInstance,
} from '../types';
import { economy, engines, systems, triples as triplesCfg } from '../config';
import { getCard } from '../content';
import { Rng } from './rng';
import {
  applyBuff,
  applyMultiply,
  chosenAllyCandidates,
  evaluateCondition,
  selectTargets,
  type ConditionCounts,
  type Targetable,
} from './effects';
import { battlecryMultiplier, endOfTurnSummonMultiplier, type AuraBearer } from './auras';
import { toCombatBoard, makeInstance } from './instances';
import { baseIncomeForRound, toClientUnit, toShopOffer } from './state';
import { createPool, draw, drawOneFrom, discoverOptions, returnCopy, takeCopy, type PoolState } from './pool';

/** Engine-level result shape for every shop op + Match.applyIntent (spec §9.7). Not a frozen type. */
export interface OpResult {
  ok: boolean;
  error?: string;
  triples?: string[];
}

interface PendingTargetInternal {
  actions: ActionSpec[]; // the chosenAlly payload (battlecry effect OR activated ability, #39)
  multiplier: number;
  sourceUid: string;
  sourceName: string;
  legalTargets: string[];
  description: string;
}

export interface ShopSession {
  seat: number;
  round: number;
  gold: number;
  baseIncome: number;
  tier: number;
  lastTierUpRound: number;
  frozen: boolean;
  shop: string[]; // offered cardIds (each a reserved pool copy)
  bench: UnitInstance[];
  board: UnitInstance[];
  gems: number; // the SPENDABLE gem wallet (decision #39, supersedes D10) — uncapped; hoarding is a sim diagnostic
  gemsThisTurn: number; // derived per-turn counter (feeds gemsThisTurnAtLeast conditions; resets each turn)
  doublesPurchased: number; // decision #39: doubles bought this GAME (shared escalator; never resets)
  abilityUsedThisTurn: string[]; // decision #39: board uids that activated this shop turn (once per turn per minion)
  abilityUses: Record<string, number>; // decision #39: per-GAME activation count by cardId (sim payoff tracking)
  battlecriesThisTurn: number;
  tokensThisTurn: number;
  lifetimeFriendlyDeaths: number; // Phase 3: PERSISTENT per-player friendly-death total (private). NEVER reset
  // between turns/rounds. Incremented by shop-phase destroys (Maw's destroyAlly) AND by friendly deaths
  // counted from each combat log (Match.resolveCombatPhase). Rides into combat on the CombatBoard scalar.
  discover: { reason: string; options: string[] } | null;
  pendingTarget: PendingTargetInternal | null;
  lastCombatLog: PrivateState['lastCombatLog'];
  log: string[];
  pool: PoolState;
  rng: Rng;
  uidSeq: number;
}

export interface SessionOpts {
  pool?: PoolState;
  rng?: Rng;
  seed?: string;
}

export function createShopSession(seat: number, opts: SessionOpts = {}): ShopSession {
  return {
    seat,
    round: 0,
    gold: 0,
    baseIncome: 0,
    tier: 1,
    lastTierUpRound: 1,
    frozen: false,
    shop: [],
    bench: [],
    board: [],
    gems: 0,
    gemsThisTurn: 0,
    doublesPurchased: 0,
    abilityUsedThisTurn: [],
    abilityUses: {},
    battlecriesThisTurn: 0,
    tokensThisTurn: 0,
    lifetimeFriendlyDeaths: 0,
    discover: null,
    pendingTarget: null,
    lastCombatLog: null,
    log: [],
    pool: opts.pool ?? createPool(),
    rng: opts.rng ?? new Rng(opts.seed ?? `shop:${seat}`),
    uidSeq: 0,
  };
}

// ── small helpers ────────────────────────────────────────────────────────────────

function genUid(s: ShopSession): string {
  return `${s.seat}u${s.uidSeq++}`;
}
function findUnit(s: ShopSession, uid: string): { inst: UnitInstance; where: 'board' | 'bench'; index: number } | undefined {
  let i = s.board.findIndex((u) => u.uid === uid);
  if (i >= 0) return { inst: s.board[i], where: 'board', index: i };
  i = s.bench.findIndex((u) => u.uid === uid);
  if (i >= 0) return { inst: s.bench[i], where: 'bench', index: i };
  return undefined;
}
function enrich(inst: UnitInstance): Targetable {
  const card = getCard(inst.cardId);
  return {
    uid: inst.uid,
    cardId: inst.cardId,
    atk: inst.atk,
    hp: inst.hp,
    tribe: card.tribe,
    keywords: inst.keywords,
    bornTurn: inst.bornTurn,
  };
}
function auraBearers(s: ShopSession): AuraBearer[] {
  return s.board.map((inst) => {
    const card = getCard(inst.cardId);
    return { tribe: card.tribe as TribeId, auras: card.auras ?? [] };
  });
}
function tierUpCost(s: ShopSession): number {
  if (s.tier >= economy.tierCount) return -1;
  const base = economy.tierUpBaseCost[s.tier] ?? 0;
  const skips = Math.max(0, s.round - s.lastTierUpRound);
  return Math.max(0, base - economy.tierUpDiscountPerTurn * skips);
}

// ── effect resolution (shop side) ──────────────────────────────────────────────────

function shopCounts(s: ShopSession): ConditionCounts {
  return {
    battlecriesThisTurn: s.battlecriesThisTurn,
    tokensThisTurn: s.tokensThisTurn,
    gemsThisTurn: s.gemsThisTurn,
    countAllies: s.board.length,
    // deathsThisCombat intentionally absent → combat-scoped condition reads 0 in shop (§6.3).
  };
}

function applyTargetAction(s: ShopSession, action: ActionSpec, inst: UnitInstance): void {
  switch (action.type) {
    case 'buffStats': {
      const st = applyBuff({ atk: inst.atk, hp: inst.hp }, action.atk ?? 0, action.hp ?? 0);
      inst.atk = st.atk;
      inst.hp = st.hp;
      break;
    }
    case 'setStats': {
      const st = applyBuff({ atk: 0, hp: 0 }, action.atk ?? inst.atk, action.hp ?? inst.hp);
      inst.atk = st.atk;
      inst.hp = st.hp;
      break;
    }
    case 'multiplyStats': {
      const st = applyMultiply({ atk: inst.atk, hp: inst.hp }, action.factor ?? 1);
      inst.atk = st.atk;
      inst.hp = st.hp;
      break;
    }
    case 'resetToBase': {
      const card = getCard(inst.cardId);
      const mult = inst.golden ? triplesCfg.goldenStatMultiplier : 1;
      inst.atk = card.atk * mult;
      inst.hp = card.hp * mult;
      break;
    }
    case 'grantKeyword': {
      if (action.keyword && !inst.keywords.includes(action.keyword)) inst.keywords.push(action.keyword);
      break;
    }
    case 'plantDeathrattle': {
      if (action.planted) inst.grantedEffects = [...(inst.grantedEffects ?? []), action.planted];
      break;
    }
    default:
      break;
  }
}

function giveGemShop(s: ShopSession, amount: number): void {
  s.gems += amount;
  s.gemsThisTurn += amount;
}

function summonShop(s: ShopSession, source: UnitInstance, summonUnitId: string | undefined, count: number): void {
  if (!summonUnitId) return;
  const srcIdx = s.board.findIndex((u) => u.uid === source.uid);
  let at = srcIdx >= 0 ? srcIdx + 1 : s.board.length;
  for (let k = 0; k < count; k++) {
    if (s.board.length >= economy.boardCap) {
      s.log.push(`summon dropped (board full): ${summonUnitId}`);
      break;
    }
    const tok = makeInstance(summonUnitId, { uid: genUid(s), bornTurn: s.round });
    s.board.splice(Math.min(at, s.board.length), 0, tok);
    at++;
    s.tokensThisTurn++;
    fireOnSummon(s, tok);
  }
}

function fireOnSummon(s: ShopSession, summoned: UnitInstance): void {
  for (const u of [...s.board]) {
    const card = getCard(u.cardId);
    for (const e of card.effects) {
      if (e.trigger.type !== 'onSummon') continue;
      resolveShopEffect(s, u, e, summoned);
    }
  }
}

/** Resolve a shop-side effect once (condition-gated). Summon actions may be end-of-turn-scaled. */
function resolveShopEffect(
  s: ShopSession,
  source: UnitInstance,
  effect: Effect,
  triggerSource?: UnitInstance,
  summonMult = 1,
): void {
  if (!evaluateCondition(effect.condition, shopCounts(s))) return;
  const allies = s.board.map(enrich);
  const targets = selectTargets(effect.target, {
    source: enrich(source),
    triggerSource: triggerSource ? enrich(triggerSource) : undefined,
    allies,
    enemies: [],
    rng: s.rng,
  });
  for (const action of effect.actions) {
    if (action.type === 'summon') {
      summonShop(s, source, action.summonUnitId, (action.summonCount ?? 1) * summonMult);
    } else if (action.type === 'giveGem') {
      giveGemShop(s, action.amount ?? 0);
    } else {
      for (const t of targets) {
        const found = findUnit(s, t.uid);
        if (found) applyTargetAction(s, action, found.inst);
      }
    }
  }
}

// ── triples / golden / discover (spec §4.2, EV-ECO-10) ──────────────────────────────

function detectTriples(s: ShopSession): string[] {
  const triples: string[] = [];
  for (;;) {
    // count non-golden, non-token copies of each cardId across bench+board.
    const counts = new Map<string, UnitInstance[]>();
    for (const u of [...s.bench, ...s.board]) {
      if (u.golden) continue;
      if (getCard(u.cardId).isToken) continue;
      const arr = counts.get(u.cardId) ?? [];
      arr.push(u);
      counts.set(u.cardId, arr);
    }
    let mergeCard: string | undefined;
    for (const [cardId, arr] of counts) {
      if (arr.length >= triplesCfg.copiesForTriple) {
        mergeCard = cardId;
        break;
      }
    }
    if (!mergeCard) break;

    // remove copiesForTriple copies (from bench first, then board).
    const toRemove = triplesCfg.copiesForTriple;
    let removed = 0;
    for (let i = s.bench.length - 1; i >= 0 && removed < toRemove; i--) {
      if (s.bench[i].cardId === mergeCard && !s.bench[i].golden) {
        s.bench.splice(i, 1);
        removed++;
      }
    }
    for (let i = s.board.length - 1; i >= 0 && removed < toRemove; i--) {
      if (s.board[i].cardId === mergeCard && !s.board[i].golden) {
        s.board.splice(i, 1);
        removed++;
      }
    }

    // create the golden (base stats × goldenStatMultiplier) on the bench.
    const golden = makeInstance(mergeCard, { uid: genUid(s), golden: true, bornTurn: s.round });
    s.bench.push(golden);
    triples.push(mergeCard);

    // grant a Discover (tier + offset); bench-full → lost (logged).
    grantDiscover(s);
  }
  return triples;
}

function grantDiscover(s: ShopSession): void {
  if (s.bench.length >= economy.benchCap) {
    s.log.push('Discover lost (bench full)');
    return;
  }
  const options = discoverOptions(s.pool, s.tier + triplesCfg.tripleDiscoverTierOffset, 3, s.rng);
  if (options.length === 0) {
    s.log.push('Discover skipped (no pool)');
    return;
  }
  s.discover = { reason: 'triple reward', options };
}

// ── battlecry / onSell / afterFriendlyBattlecry (spec §4.7 D5) ──────────────────────

function hasBattlecry(cardId: string): boolean {
  return getCard(cardId).effects.some((e) => e.trigger.type === 'battlecry');
}

function fireBattlecry(s: ShopSession, source: UnitInstance): void {
  const card = getCard(source.cardId);
  if (!hasBattlecry(card.id)) return;
  const multiplier = battlecryMultiplier(auraBearers(s));
  // Phase 4 Echo Choir rebalance (decision #50): a played battlecry counts as EXACTLY ONE toward
  // `battlecriesThisTurn`, regardless of the Echo Choir doubler. The doubler still amplifies OUTPUT
  // (each battlecry EFFECT and afterFriendlyBattlecry resolves `multiplier` times, below), but the
  // ECHOED copy no longer inflates the counter that GATES other battlecry breakpoints — closing the
  // double-dip where a single play could reach a ≥2 gate from the echo alone (EV-AUR-05).
  s.battlecriesThisTurn += 1;

  for (const e of card.effects) {
    if (e.trigger.type !== 'battlecry') continue;
    if (e.target.selector === 'chosenAlly') {
      // A gated chosenAlly battlecry (Deepchanter, battlecries≥2) must honor its condition just like
      // any other effect (spec §6.3 conditions gate; EVALS Group F — payoff fires AT the threshold, not
      // below). Below the gate it does not arm a target; the battlecry itself already counted (D5).
      if (!evaluateCondition(e.condition, shopCounts(s))) continue;
      const candidates = chosenAllyCandidates(e.target, enrich(source), s.board.map(enrich));
      if (candidates.length === 0) {
        // D5 fizzle: resolves to nothing but STILL counts as a battlecry (already counted).
        continue;
      }
      s.pendingTarget = {
        actions: e.actions,
        multiplier,
        sourceUid: source.uid,
        sourceName: card.name,
        legalTargets: candidates.map((c) => c.uid),
        description: `${card.name}: choose a target`,
      };
      break; // defer; remaining battlecry effects wait for the choice
    } else {
      for (let k = 0; k < multiplier; k++) resolveShopEffect(s, source, e);
    }
  }

  // afterFriendlyBattlecry: fires for OTHER friendlies, once per (doubled) battlecry (D5).
  for (const u of [...s.board]) {
    if (u.uid === source.uid) continue;
    for (const e of getCard(u.cardId).effects) {
      if (e.trigger.type !== 'afterFriendlyBattlecry') continue;
      for (let k = 0; k < multiplier; k++) resolveShopEffect(s, u, e);
    }
  }
}

function fireOnSell(s: ShopSession): void {
  for (const u of [...s.board, ...s.bench]) {
    for (const e of getCard(u.cardId).effects) {
      if (e.trigger.type !== 'onSell') continue;
      resolveShopEffect(s, u, e);
    }
  }
}

// ── tech-pool injection guarantee (spec §5, decision #49) ───────────────────────────

/**
 * After a FRESH roll is drawn, guarantee the shop offers at least one interaction-tech card from
 * `systems.techInjection.cardIds` — from `fromRound` onward. If the roll already contains a tech
 * card (or the round is too early), it is a no-op. Otherwise ONE slot is replaced by a copy-weighted
 * pool draw restricted to the tech ids AT OR BELOW the shop tier; the replaced slot is chosen
 * DETERMINISTICALLY from the shop RNG. Pool accounting mirrors any other offer: the injected copy is
 * TAKEN from the pool (drawOneFrom) and the replaced offer RETURNED to it — net-zero, no phantom
 * copies. If no tech copy is available at/below tier, the roll is left as-is and logged (never a crash).
 *
 * Draw order is fixed (tech draw, THEN the slot pick) so the session RNG stays deterministic:
 * same seed + state → same injection.
 */
function maybeInjectTech(s: ShopSession): void {
  const cfg = systems.techInjection;
  if (s.round < cfg.fromRound) return;
  if (s.shop.length === 0) return;
  if (s.shop.some((id) => cfg.cardIds.includes(id))) return; // already has a tech card
  const techId = drawOneFrom(s.pool, s.tier, s.rng, cfg.cardIds);
  if (!techId) {
    s.log.push('tech injection skipped (no tech copy at/below tier)');
    return;
  }
  const slot = s.rng.int(s.shop.length);
  const replaced = s.shop[slot];
  returnCopy(s.pool, replaced);
  s.shop[slot] = techId;
  s.log.push(`tech injected: ${replaced} → ${techId} (slot ${slot})`);
}

/** Draw a fresh shop into `s.shop` (all prior offers already returned by the caller) and apply the
 *  Phase 4 tech-injection guarantee. The single fresh-roll path shared by startShopPhase / rollShop /
 *  Oreseeker refresh, so all three stay byte-identical for the same seed+state (EV-ABL-08). */
function drawFreshShop(s: ShopSession): void {
  s.shop = draw(s.pool, s.tier, economy.shopSlotsByTier[s.tier - 1] ?? 0, s.rng);
  maybeInjectTech(s);
}

// ── ops ──────────────────────────────────────────────────────────────────────────

export function startShopPhase(s: ShopSession): OpResult {
  s.round += 1;
  s.baseIncome = baseIncomeForRound(s.round);
  s.gold = s.baseIncome;
  s.gemsThisTurn = 0;
  s.abilityUsedThisTurn = []; // once-per-turn activation gates reset (#39); the WALLET (s.gems) persists
  s.battlecriesThisTurn = 0;
  s.tokensThisTurn = 0;
  s.pendingTarget = null;
  s.discover = null;
  if (s.frozen) {
    // frozen offers persist into this shop; the freeze then clears (EV-ECO-05). A frozen shop is NOT
    // re-rolled, so the tech-injection guarantee does not apply to it (decision #49).
    s.frozen = false;
  } else {
    for (const id of s.shop) returnCopy(s.pool, id);
    drawFreshShop(s);
  }
  return { ok: true };
}

export function endOfTurnPhase(s: ShopSession): OpResult {
  // Pass 1: gem generators (giveGem) resolve before any other endOfTurn effect so gems are credited
  // to the wallet first. (Pre-#39 this fed the auto-doubler's gemsThisTurn gate; the doubler is now a
  // shop-phase PURCHASED activation, but generators-first keeps end-of-turn ordering deterministic.)
  for (const u of [...s.board]) {
    for (const e of getCard(u.cardId).effects) {
      if (e.trigger.type !== 'endOfTurn') continue;
      if (!e.actions.every((a) => a.type === 'giveGem')) continue;
      resolveShopEffect(s, u, e);
    }
  }
  // Pass 2: the rest (summons ×Grovecaller summon-scoped; multiplyStats doublers).
  const summonMult = endOfTurnSummonMultiplier(auraBearers(s));
  for (const u of [...s.board]) {
    for (const e of getCard(u.cardId).effects) {
      if (e.trigger.type !== 'endOfTurn') continue;
      if (e.actions.every((a) => a.type === 'giveGem')) continue;
      resolveShopEffect(s, u, e, undefined, summonMult);
    }
  }
  return { ok: true };
}

export function buyUnit(s: ShopSession, shopIndex: number): OpResult {
  if (shopIndex < 0 || shopIndex >= s.shop.length) return { ok: false, error: 'invalid shop index' };
  if (s.bench.length >= economy.benchCap) return { ok: false, error: 'bench full' };
  if (s.gold < economy.buyCost) return { ok: false, error: 'not enough gold' };
  s.gold -= economy.buyCost;
  const cardId = s.shop.splice(shopIndex, 1)[0];
  const inst = makeInstance(cardId, { uid: genUid(s), bornTurn: s.round });
  s.bench.push(inst);
  const triples = detectTriples(s);
  return { ok: true, triples };
}

export function sellUnit(s: ShopSession, uid: string): OpResult {
  const found = findUnit(s, uid);
  if (!found) return { ok: false, error: 'unit not found' };
  const card = getCard(found.inst.cardId);
  if (found.where === 'board') s.board.splice(found.index, 1);
  else s.bench.splice(found.index, 1);
  s.gold += economy.sellRefund;
  if (!card.isToken && !found.inst.golden) returnCopy(s.pool, found.inst.cardId);
  // D5: onSell fires only when selling a purchasable BODY (not a token).
  if (!card.isToken) fireOnSell(s);
  return { ok: true };
}

export function rollShop(s: ShopSession): OpResult {
  if (s.gold < economy.rerollCost) return { ok: false, error: 'not enough gold' };
  s.gold -= economy.rerollCost;
  for (const id of s.shop) returnCopy(s.pool, id);
  s.frozen = false;
  drawFreshShop(s);
  return { ok: true };
}

export function freezeShop(s: ShopSession): OpResult {
  s.frozen = true;
  return { ok: true };
}

export function unfreezeShop(s: ShopSession): OpResult {
  s.frozen = false;
  return { ok: true };
}

export function tierUp(s: ShopSession): OpResult {
  if (s.tier >= economy.tierCount) return { ok: false, error: 'max tier' };
  const cost = tierUpCost(s);
  if (s.gold < cost) return { ok: false, error: 'not enough gold' };
  s.gold -= cost;
  s.tier += 1;
  s.lastTierUpRound = s.round;
  return { ok: true };
}

export function playUnit(s: ShopSession, uid: string, toSlot?: number): OpResult {
  // An outstanding chosenAlly target must be resolved first: a battlecry here would overwrite
  // s.pendingTarget and silently void an already-PAID activation (Facetguard's gems), breaking the
  // "an activation is a purchase, never fizzled" invariant (#39, §6.6a). Same guard as activateAbility.
  if (s.pendingTarget) return { ok: false, error: 'resolve pending target first' };
  const idx = s.bench.findIndex((u) => u.uid === uid);
  if (idx < 0) return { ok: false, error: 'unit not on bench' };
  if (s.board.length >= economy.boardCap) return { ok: false, error: 'board full' };
  const inst = s.bench.splice(idx, 1)[0];
  const slot = toSlot != null ? Math.max(0, Math.min(toSlot, s.board.length)) : s.board.length;
  s.board.splice(slot, 0, inst);
  fireBattlecry(s, inst);
  return { ok: true };
}

export function moveUnit(s: ShopSession, uid: string, toSlot: number): OpResult {
  const idx = s.board.findIndex((u) => u.uid === uid);
  if (idx < 0) return { ok: false, error: 'unit not on board' };
  const [inst] = s.board.splice(idx, 1);
  s.board.splice(Math.max(0, Math.min(toSlot, s.board.length)), 0, inst);
  return { ok: true };
}

export function resolveTargetChoice(s: ShopSession, targetUid: string): OpResult {
  const pt = s.pendingTarget;
  if (!pt) return { ok: false, error: 'no pending target' };
  if (!pt.legalTargets.includes(targetUid)) return { ok: false, error: 'illegal target' };
  const target = findUnit(s, targetUid);
  const source = findUnit(s, pt.sourceUid);
  if (!target || !source) {
    s.pendingTarget = null;
    return { ok: false, error: 'target/source missing' };
  }
  for (let k = 0; k < pt.multiplier; k++) {
    for (const action of pt.actions) {
      if (action.type === 'summon') summonShop(s, source.inst, action.summonUnitId, action.summonCount ?? 1);
      else if (action.type === 'giveGem') giveGemShop(s, action.amount ?? 0);
      else if (action.type === 'absorbStats') absorbStatsShop(s, source.inst, target.inst);
      else if (action.type === 'destroyAlly') destroyAllyShop(s, target.inst);
      else applyTargetAction(s, action, target.inst);
    }
  }
  s.pendingTarget = null;
  return { ok: true };
}

/** Phase 3 (shop): the SOURCE permanently gains the TARGET's CURRENT atk/hp (reads live instance stats —
 *  a golden target contributes its DOUBLED stats). Keywords are NOT transferred. Presence-gated so an
 *  Echo-Choir-doubled resolution can't double-consume a body already destroyed this resolution. */
function absorbStatsShop(s: ShopSession, source: UnitInstance, target: UnitInstance): void {
  if (!findUnit(s, target.uid)) return; // already consumed (multiplier re-entry) → no-op
  const st = applyBuff({ atk: source.atk, hp: source.hp }, target.atk, target.hp);
  source.atk = st.atk;
  source.hp = st.hp;
}

/** Phase 3 (shop): destroy a CHOSEN friendly — remove it from the board/bench, return its pool copy
 *  (non-token, non-golden — like a sell), and increment the PERSISTENT lifetimeFriendlyDeaths. Fires no
 *  combat and no deathrattle (there is no shop-phase combat). D5-safe: an empty legal set never arms this. */
function destroyAllyShop(s: ShopSession, target: UnitInstance): void {
  const found = findUnit(s, target.uid);
  if (!found) return; // already consumed (multiplier re-entry) → no double increment
  if (found.where === 'board') s.board.splice(found.index, 1);
  else s.bench.splice(found.index, 1);
  const card = getCard(found.inst.cardId);
  if (!card.isToken && !found.inst.golden) returnCopy(s.pool, found.inst.cardId);
  s.lifetimeFriendlyDeaths += 1;
  s.log.push(`sacrificed ${card.name} (lifetime deaths → ${s.lifetimeFriendlyDeaths})`);
}

// ── activated abilities (spend-gated, decision #39; spec §6.6a) ─────────────────────

/** Current gem price of a card's activated ability. Flat costs are config numbers on the card
 *  row; the doublers share the per-GAME escalating formula (spec §6.6a). */
export function activatedCost(s: ShopSession, card: UnitCard): number {
  const spec = card.activated;
  if (!spec) return Infinity;
  if (spec.cost === 'doublerEscalating') {
    return engines.tuskers.doubleBaseCost + engines.tuskers.doubleCostStep * s.doublesPurchased;
  }
  return spec.cost;
}

/**
 * Buy a board unit's activated ability with gems (intent `activate`, decision #39).
 * Validation (server-authoritative; a rejection mutates NOTHING): shop phase is enforced by the
 * caller (Match/room); here — unit owned + ON BOARD, card has an ability, not already used this
 * turn (once per turn per minion), wallet ≥ current cost, and a chosenAlly ability must have a
 * legal target BEFORE the spend (an activation is a purchase — it is rejected, never fizzled;
 * contrast the D5 battlecry fizzle rule). chosenAlly abilities arm the same pendingTarget
 * machinery as targeted battlecries; `targetChoice` resolves them (§7.4).
 * Non-refresh abilities draw NOTHING from the session RNG (the roll stream is unperturbed);
 * `refreshShop` uses the same seeded draw path as a paid roll (and clears a freeze like one).
 */
export function activateAbility(s: ShopSession, uid: string): OpResult {
  const found = findUnit(s, uid);
  if (!found) return { ok: false, error: 'unit not found' };
  if (found.where !== 'board') return { ok: false, error: 'unit not on board' };
  const card = getCard(found.inst.cardId);
  const spec = card.activated;
  if (!spec) return { ok: false, error: 'no activated ability' };
  if (s.abilityUsedThisTurn.includes(uid)) return { ok: false, error: 'already activated this turn' };
  if (s.pendingTarget) return { ok: false, error: 'resolve pending target first' };
  const cost = activatedCost(s, card);
  if (s.gems < cost) return { ok: false, error: 'not enough gems' };

  // chosenAlly: verify a legal target exists BEFORE spending.
  let candidates: Targetable[] = [];
  if (spec.target.selector === 'chosenAlly') {
    candidates = chosenAllyCandidates(spec.target, enrich(found.inst), s.board.map(enrich));
    if (candidates.length === 0) return { ok: false, error: 'no legal target' };
  }

  // spend + gates (all validation passed — from here the op commits).
  s.gems -= cost;
  s.abilityUsedThisTurn.push(uid);
  s.abilityUses[card.id] = (s.abilityUses[card.id] ?? 0) + 1;
  if (spec.cost === 'doublerEscalating') s.doublesPurchased += 1;
  s.log.push(`${card.name} activated (−${cost} gems)`);

  if (spec.target.selector === 'chosenAlly') {
    s.pendingTarget = {
      actions: spec.actions,
      multiplier: 1,
      sourceUid: uid,
      sourceName: card.name,
      legalTargets: candidates.map((c) => c.uid),
      description: `${card.name}: ${spec.prompt ?? 'choose a target'}`,
    };
    return { ok: true };
  }

  const targets = selectTargets(spec.target, {
    source: enrich(found.inst),
    allies: s.board.map(enrich),
    enemies: [],
    rng: s.rng,
  });
  for (const action of spec.actions) {
    switch (action.type) {
      case 'gainGold':
        // the ONE gem→gold bridge (one-way; never above goldCap — spec §5).
        s.gold = Math.min(economy.goldCap, s.gold + (action.amount ?? 0));
        break;
      case 'refreshShop': {
        // free reroll: identical draw path to rollShop (same seeded session Rng + tech injection),
        // no gold charge; clears a freeze exactly like a paid roll does (spec §6.6a).
        for (const id of s.shop) returnCopy(s.pool, id);
        s.frozen = false;
        drawFreshShop(s);
        break;
      }
      case 'giveGem':
        giveGemShop(s, action.amount ?? 0);
        break;
      case 'summon':
        summonShop(s, found.inst, action.summonUnitId, action.summonCount ?? 1);
        break;
      default:
        for (const t of targets) {
          const f = findUnit(s, t.uid);
          if (f) applyTargetAction(s, action, f.inst);
        }
        break;
    }
  }
  return { ok: true };
}

export function resolveDiscoverPick(s: ShopSession, optionIndex: number): OpResult {
  if (!s.discover) return { ok: false, error: 'no discover pending' };
  if (optionIndex < 0 || optionIndex >= s.discover.options.length) return { ok: false, error: 'invalid option' };
  if (s.bench.length >= economy.benchCap) {
    s.discover = null;
    return { ok: false, error: 'bench full' };
  }
  const cardId = s.discover.options[optionIndex];
  takeCopy(s.pool, cardId); // best-effort: pull a real copy if available
  const inst = makeInstance(cardId, { uid: genUid(s), bornTurn: s.round });
  s.bench.push(inst);
  s.discover = null;
  const triples = detectTriples(s);
  return { ok: true, triples };
}

/** Convert the current board into a CombatBoard for resolveCombat (spec §9.7). The persistent
 *  lifetimeFriendlyDeaths rides in as the CombatBoard scalar (Phase 3, Ossuary Titan). */
export function boardToCombat(s: ShopSession): CombatBoard {
  return toCombatBoard(s.board, s.tier, s.lifetimeFriendlyDeaths);
}

// ── projection to the private channel (owner-only) ──────────────────────────────────

/** Owner-only activated-ability view (decision #39): board units only, with the CURRENT cost. */
function abilityStates(s: ShopSession): ActivatedAbilityState[] {
  const out: ActivatedAbilityState[] = [];
  for (const u of s.board) {
    const card = getCard(u.cardId);
    if (!card.activated) continue;
    out.push({
      uid: u.uid,
      cardId: u.cardId,
      cost: activatedCost(s, card),
      used: s.abilityUsedThisTurn.includes(u.uid),
    });
  }
  return out;
}

export function toPrivateState(s: ShopSession): PrivateState {
  const pending: PendingTarget | null = s.pendingTarget
    ? {
        sourceUid: s.pendingTarget.sourceUid,
        sourceName: s.pendingTarget.sourceName,
        legalTargets: [...s.pendingTarget.legalTargets],
        description: s.pendingTarget.description,
      }
    : null;
  return {
    seat: s.seat,
    gold: s.gold,
    baseIncome: s.baseIncome,
    tier: s.tier,
    tierUpCost: tierUpCost(s),
    rerollCost: economy.rerollCost,
    shop: s.shop.map(toShopOffer),
    frozen: s.frozen,
    bench: s.bench.map(toClientUnit),
    board: s.board.map(toClientUnit),
    gems: s.gems,
    abilities: abilityStates(s),
    discover: s.discover ? { reason: s.discover.reason, options: s.discover.options.map(toShopOffer) } : null,
    pendingTarget: pending,
    lastCombatLog: s.lastCombatLog,
    log: s.log,
  };
}
