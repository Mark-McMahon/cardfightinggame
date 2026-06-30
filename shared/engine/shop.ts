import type { ActionSpec, CombatBoard, TriggerType, UnitInstance } from '../types';
import { economy } from '../config/economy';
import { triples } from '../config/triples';
import { getCard, PURCHASABLE_UNITS } from '../content/units';
import { createInstance, toCombatUnit } from './instances';
import { Pool } from './pool';
import type { RNG } from './rng';
import { evalCondition, legalChosenTargets, selectTargets, type SelTarget } from './effects';
import { battlecryTriggerCount, endOfTurnTriggerCount, type AuraBearer } from './auras';
import { logLine, type PlayerState } from './state';

export interface OpResult {
  ok: boolean;
  error?: string;
  triples?: string[]; // cardIds that became golden (for toasts)
}

const ok = (triples?: string[]): OpResult => ({ ok: true, triples });
const err = (error: string): OpResult => ({ ok: false, error });

// ── derived economy values ──────────────────────────────────────────────────
export function incomeForRound(round: number): number {
  return Math.min(economy.goldCap, economy.goldStart + (round - 1) * economy.goldPerTurn);
}

export function currentTierUpCost(p: PlayerState): number {
  if (p.tier >= economy.tierCount) return -1;
  const base = economy.tierUpBaseCost[p.tier] ?? 0;
  return Math.max(0, base - economy.tierUpDiscountPerTurn * p.roundsSinceTierUp);
}

export function shopSlots(p: PlayerState): number {
  return economy.shopSlotsByTier[p.tier - 1] ?? 3;
}

// ── selection views ───────────────────────────────────────────────────────────
function viewOf(list: UnitInstance[]): SelTarget[] {
  return list.map((inst, i) => {
    const card = getCard(inst.cardId);
    return {
      uid: inst.uid,
      tribe: card.tribe,
      keywords: inst.keywords,
      atk: inst.atk,
      hp: inst.hp,
      slot: i,
      bornTurn: inst.bornTurn,
      golden: inst.golden,
      isToken: card.isToken ?? false,
    };
  });
}

function boardBearers(p: PlayerState): AuraBearer[] {
  return p.board.map((inst) => {
    const card = getCard(inst.cardId);
    return { tribe: card.tribe, auras: card.auras ?? [] };
  });
}

function findInstance(p: PlayerState, uid: string): UnitInstance | undefined {
  return p.board.find((u) => u.uid === uid) ?? p.bench.find((u) => u.uid === uid);
}

/** Condition context for shop-phase effects — exposes the Round-6 shop counters (§16.3). */
function shopCondCtx(p: PlayerState, subject: SelTarget, allies: SelTarget[]) {
  return {
    self: subject,
    allies,
    gold: p.gold,
    tier: p.tier,
    gemsThisTurn: p.gemsThisTurn,
    battlecriesThisTurn: p.battlecriesThisTurn,
    tokensSummonedThisTurn: p.tokensSummonedThisTurn,
  };
}

// ── shop lifecycle ─────────────────────────────────────────────────────────────
export function startShopPhase(p: PlayerState, round: number, pool: Pool, rng: RNG): void {
  const income = incomeForRound(round);
  p.baseIncome = income;
  p.gold = income;
  if (round > 1) p.roundsSinceTierUp += 1;
  p.gemsThisTurn = 0;
  p.battlecriesThisTurn = 0;
  p.tokensSummonedThisTurn = 0;
  p.ready = false;
  p.pendingTarget = null;

  if (p.frozen) {
    p.frozen = false; // freeze persists this shop, then releases
  } else {
    for (const cardId of p.shop) pool.giveBack(cardId);
    p.shop = pool.draw(p.tier, shopSlots(p), rng);
  }
}

// ── intents ───────────────────────────────────────────────────────────────────
export function buyUnit(p: PlayerState, shopIndex: number, pool: Pool, rng: RNG, round: number): OpResult {
  if (shopIndex < 0 || shopIndex >= p.shop.length) return err('No such shop slot');
  if (p.gold < economy.buyCost) return err('Not enough gold');
  if (p.bench.length >= economy.benchCap) return err('Bench is full');
  const cardId = p.shop[shopIndex];
  p.gold -= economy.buyCost;
  p.shop.splice(shopIndex, 1);
  const inst = createInstance(cardId, { bornTurn: round });
  p.bench.push(inst);
  fireShopTrigger(p, inst, 'onPurchase', undefined, pool, rng, round);
  const made = checkTriples(p, pool, rng, round);
  logLine(p, `Bought ${getCard(cardId).name}`);
  return ok(made);
}

export function sellUnit(p: PlayerState, uid: string, pool: Pool): OpResult {
  const inB = p.bench.findIndex((u) => u.uid === uid);
  const inP = p.board.findIndex((u) => u.uid === uid);
  let inst: UnitInstance | undefined;
  if (inB >= 0) inst = p.bench.splice(inB, 1)[0];
  else if (inP >= 0) inst = p.board.splice(inP, 1)[0];
  if (!inst) return err('No such unit to sell');
  p.gold += economy.sellRefund;
  if (!inst.golden) pool.giveBack(inst.cardId); // golden/token are pool-exempt
  logLine(p, `Sold ${getCard(inst.cardId).name}`);
  return ok();
}

export function rollShop(p: PlayerState, pool: Pool, rng: RNG): OpResult {
  if (p.gold < economy.rerollCost) return err('Not enough gold');
  p.gold -= economy.rerollCost;
  p.frozen = false;
  for (const cardId of p.shop) pool.giveBack(cardId);
  p.shop = pool.draw(p.tier, shopSlots(p), rng);
  return ok();
}

export function freezeShop(p: PlayerState): OpResult {
  p.frozen = true;
  return ok();
}
export function unfreezeShop(p: PlayerState): OpResult {
  p.frozen = false;
  return ok();
}

export function tierUp(p: PlayerState): OpResult {
  const cost = currentTierUpCost(p);
  if (cost < 0) return err('Already at max tier');
  if (p.gold < cost) return err('Not enough gold');
  p.gold -= cost;
  p.tier += 1;
  p.roundsSinceTierUp = 0;
  logLine(p, `Tiered up to ${p.tier}`);
  return ok();
}

export function playUnit(
  p: PlayerState,
  uid: string,
  toSlot: number | undefined,
  pool: Pool,
  rng: RNG,
  round: number,
): OpResult {
  if (p.pendingTarget) return err('Resolve your battlecry target first');
  const idx = p.bench.findIndex((u) => u.uid === uid);
  if (idx < 0) return err('No such bench unit');
  if (p.board.length >= economy.boardCap) return err('Board is full');
  const inst = p.bench.splice(idx, 1)[0];
  inst.bornTurn = round;
  const slot = toSlot === undefined ? p.board.length : Math.max(0, Math.min(toSlot, p.board.length));
  p.board.splice(slot, 0, inst);
  fireBattlecry(p, inst, pool, rng, round);
  logLine(p, `Played ${getCard(inst.cardId).name}`);
  return ok();
}

export function moveUnit(p: PlayerState, uid: string, toSlot: number): OpResult {
  const idx = p.board.findIndex((u) => u.uid === uid);
  if (idx < 0) return err('No such board unit');
  const [inst] = p.board.splice(idx, 1);
  const slot = Math.max(0, Math.min(toSlot, p.board.length));
  p.board.splice(slot, 0, inst);
  return ok();
}

export function resolveTargetChoice(p: PlayerState, targetUid: string, round: number): OpResult {
  const pt = p.pendingTarget;
  if (!pt) return err('No pending target');
  if (!pt.legalTargets.includes(targetUid)) return err('Illegal target');
  const target = findInstance(p, targetUid);
  const source = findInstance(p, pt.sourceUid);
  if (!target) {
    p.pendingTarget = null;
    return err('Target gone');
  }
  for (let m = 0; m < pt.multiplier; m++) {
    applyShopActions(pt.actions, source, p, [target], null, round);
  }
  p.pendingTarget = null;
  return ok();
}

export function resolveDiscoverPick(p: PlayerState, optionIndex: number, pool: Pool, rng: RNG, round: number): OpResult {
  const d = p.discover;
  if (!d) return err('No discover to resolve');
  if (p.bench.length >= economy.benchCap) {
    p.discover = null;
    return err('Bench full — discover lost');
  }
  const idx = Math.max(0, Math.min(optionIndex, d.options.length - 1));
  const cardId = d.options[idx];
  p.discover = null;
  const inst = createInstance(cardId, { bornTurn: round }); // discover bonus is pool-exempt
  p.bench.push(inst);
  logLine(p, `Discovered ${getCard(cardId).name}`);
  const made = checkTriples(p, pool, rng, round);
  return ok(made);
}

/** Auto-resolve any pending interaction so a phase can end without human input. */
export function autoResolvePending(p: PlayerState, pool: Pool, rng: RNG, round: number): void {
  if (p.pendingTarget) {
    resolveTargetChoice(p, p.pendingTarget.legalTargets[0], round);
  }
  if (p.discover) {
    resolveDiscoverPick(p, 0, pool, rng, round);
  }
}

// ── battlecry / triggers / actions ──────────────────────────────────────────────
function fireBattlecry(p: PlayerState, unit: UnitInstance, pool: Pool, rng: RNG, round: number): void {
  const card = getCard(unit.cardId);
  const battlecries = card.effects.filter((e) => e.trigger.type === 'battlecry');
  if (battlecries.length === 0) return;
  const multiplier = battlecryTriggerCount(boardBearers(p));

  // One cast = `multiplier` resolved battlecry triggers. Increment up front so this unit's
  // own "Nth battlecry" thresholds read the inclusive count, and so Echo Choir's doubling
  // advances every BATTLECRY breakpoint (§16.2). Deferred chosenAlly casts still count here.
  p.battlecriesThisTurn += multiplier;

  for (const effect of battlecries) {
    if (effect.condition) {
      const allies0 = viewOf(p.board);
      const subject = allies0.find((a) => a.uid === unit.uid);
      if (!subject || !evalCondition(effect.condition, shopCondCtx(p, subject, allies0))) {
        continue; // breakpoint not reached (e.g. Chorus Tide below its 3rd battlecry)
      }
    }
    if (effect.target.selector === 'chosenAlly') {
      const legal = legalChosenTargets(effect.target, viewOf(p.board), unit.uid);
      if (legal.length === 0) continue; // fizzle
      p.pendingTarget = {
        sourceUid: unit.uid,
        sourceName: card.name,
        actions: effect.actions,
        multiplier,
        legalTargets: legal,
        description: card.text ?? `${card.name} battlecry`,
      };
      return; // defer until the player (or bot) picks
    }
    for (let m = 0; m < multiplier; m++) {
      const targetUids = selectTargets(effect.target, {
        selfUid: unit.uid,
        allies: viewOf(p.board),
        enemies: [],
        rng,
      });
      const targets = targetUids
        .map((uid) => p.board.find((u) => u.uid === uid))
        .filter((u): u is UnitInstance => !!u);
      applyShopActions(effect.actions, unit, p, targets, { pool, rng }, round);
    }
  }
}

/** Generic shop-side trigger (onPurchase, onSummon, onPlayTribe, endOfTurn). */
function fireShopTrigger(
  p: PlayerState,
  source: UnitInstance,
  triggerType: TriggerType,
  triggerSourceUid: string | undefined,
  pool: Pool,
  rng: RNG,
  round: number,
): void {
  const card = getCard(source.cardId);
  for (const effect of card.effects) {
    if (effect.trigger.type !== triggerType) continue;
    const allies = viewOf(p.board);
    let subject: SelTarget | undefined;
    if (triggerType === 'onSummon' && triggerSourceUid) {
      subject = allies.find((a) => a.uid === triggerSourceUid);
    } else {
      subject = allies.find((a) => a.uid === source.uid);
    }
    if (subject && !evalCondition(effect.condition, shopCondCtx(p, subject, allies))) {
      continue;
    }
    const targetUids = selectTargets(effect.target, {
      selfUid: source.uid,
      triggerSourceUid,
      allies,
      enemies: [],
      rng,
    });
    const targets = targetUids
      .map((uid) => p.board.find((u) => u.uid === uid))
      .filter((u): u is UnitInstance => !!u);
    applyShopActions(effect.actions, source, p, targets, { pool, rng }, round);
  }
}

function applyShopActions(
  actions: ActionSpec[],
  source: UnitInstance | undefined,
  p: PlayerState,
  targets: UnitInstance[],
  ctx: { pool: Pool; rng: RNG } | null,
  round: number,
): void {
  for (const action of actions) {
    switch (action.type) {
      case 'buffStats':
        for (const t of targets) {
          t.atk = Math.max(0, t.atk + (action.atk ?? 0));
          t.hp += action.hp ?? 0;
        }
        break;
      case 'setStats':
        for (const t of targets) {
          if (action.atk !== undefined) t.atk = action.atk;
          if (action.hp !== undefined) t.hp = action.hp;
        }
        break;
      case 'grantKeyword':
        if (action.keyword) {
          for (const t of targets) if (!t.keywords.includes(action.keyword)) t.keywords.push(action.keyword);
        }
        break;
      case 'summon':
        if (action.summonUnitId && ctx && source) {
          summonToBoard(p, action.summonUnitId, action.summonCount ?? 1, ctx.pool, ctx.rng, round);
        }
        break;
      case 'plantDeathrattle':
        // Reefmourner (§16.3 #5): attach a deathrattle Effect to the target, permanently
        // (stored on the instance, carried into combat by toCombatUnit). See memory.
        if (action.planted) {
          for (const t of targets) {
            t.grantedEffects = [...(t.grantedEffects ?? []), action.planted];
          }
        }
        break;
      case 'gainGold':
        p.gold += action.amount ?? 0;
        break;
      case 'giveGem':
        p.gems += action.amount ?? 0;
        p.gemsThisTurn += action.amount ?? 0;
        break;
      case 'discover':
        if (ctx) grantDiscover(p, action.discoverFromTierOffset ?? triples.tripleDiscoverTierOffset, ctx.rng, 'effect');
        break;
      default:
        break; // dealDamage/makeSpell/sacrifice/custom: reserved (post-slice)
    }
  }
}

function summonToBoard(p: PlayerState, cardId: string, count: number, pool: Pool, rng: RNG, round: number): void {
  for (let i = 0; i < count; i++) {
    if (p.board.length >= economy.boardCap) break;
    const token = createInstance(cardId, { bornTurn: round });
    p.board.push(token);
    // SWARM counter (§16.3 #1): count token summons before firing onSummon, so Mother
    // Thorn's breakpoint sees the token that just arrived.
    if (getCard(cardId).isToken) p.tokensSummonedThisTurn += 1;
    // onSummon triggers (e.g. Mother Thorn) — each board unit reacts.
    for (const u of [...p.board]) {
      if (u.uid === token.uid) continue;
      fireShopTrigger(p, u, 'onSummon', token.uid, pool, rng, round);
    }
  }
}

// ── triples → golden + discover (spec §4.2) ──────────────────────────────────────
function checkTriples(p: PlayerState, pool: Pool, rng: RNG, round: number): string[] {
  const made: string[] = [];
  for (let guard = 0; guard < 8; guard++) {
    const groups = new Map<string, UnitInstance[]>();
    for (const u of [...p.bench, ...p.board]) {
      const card = getCard(u.cardId);
      if (card.isToken || u.golden) continue;
      const arr = groups.get(u.cardId) ?? [];
      arr.push(u);
      groups.set(u.cardId, arr);
    }
    let merged = false;
    for (const [cardId, arr] of groups) {
      if (arr.length < triples.copiesForTriple) continue;
      const consumed = arr.slice(0, triples.copiesForTriple);
      const wasOnBoard = consumed.some((u) => p.board.includes(u));
      const consumedUids = new Set(consumed.map((u) => u.uid));
      p.bench = p.bench.filter((u) => !consumedUids.has(u.uid));
      p.board = p.board.filter((u) => !consumedUids.has(u.uid));
      const golden = createInstance(cardId, { golden: true, bornTurn: round });
      if (wasOnBoard && p.board.length < economy.boardCap) p.board.push(golden);
      else if (p.bench.length < economy.benchCap) p.bench.push(golden);
      else p.board.push(golden);
      grantDiscover(p, triples.tripleDiscoverTierOffset, rng, 'triple');
      made.push(cardId);
      logLine(p, `Tripled ${getCard(cardId).name} — golden!`);
      merged = true;
      break; // re-scan from scratch (a discover/merge may enable another)
    }
    if (!merged) break;
  }
  return made;
}

function grantDiscover(p: PlayerState, tierOffset: number, rng: RNG, reason: string): void {
  const targetTier = Math.max(1, Math.min(economy.tierCount, p.tier + tierOffset));
  let candidates = PURCHASABLE_UNITS.filter((c) => c.tier === targetTier);
  if (candidates.length < 3) {
    candidates = PURCHASABLE_UNITS.filter((c) => c.tier <= targetTier);
  }
  const options = rng.shuffle(candidates).slice(0, 3).map((c) => c.id);
  p.discover = { reason, options };
}

// ── end-of-turn (shop → combat); compounding tokens persist on the board ──────────
export function endOfTurnPhase(p: PlayerState, pool: Pool, rng: RNG, round: number): void {
  const multiplier = endOfTurnTriggerCount(boardBearers(p));
  // Snapshot board units that have end-of-turn effects (new tokens shouldn't loop).
  const sources = p.board.filter((u) => getCard(u.cardId).effects.some((e) => e.trigger.type === 'endOfTurn'));
  // Two passes (§16.3 #1): fire token-summoners first so `tokensSummonedThisTurn` is current,
  // then payoff effects (Mother Thorn's board buff reads that count).
  const isSummoner = (u: UnitInstance) =>
    getCard(u.cardId).effects.some((e) => e.trigger.type === 'endOfTurn' && e.actions.some((a) => a.type === 'summon'));
  const ordered = [...sources.filter(isSummoner), ...sources.filter((u) => !isSummoner(u))];
  for (const source of ordered) {
    for (let m = 0; m < multiplier; m++) {
      fireShopTrigger(p, source, 'endOfTurn', undefined, pool, rng, round);
    }
  }
}

// ── combat board projection ──────────────────────────────────────────────────────
export function boardToCombat(p: PlayerState): CombatBoard {
  return {
    units: p.board.map(toCombatUnit),
    playerTier: p.tier,
  };
}
