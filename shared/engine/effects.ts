import type {
  ConditionSpec,
  Keyword,
  TargetSpec,
  TribeId,
} from '../types';
import type { RNG } from './rng';

// Normalized view of a unit for selector resolution — both combat units and
// shop instances are projected onto this so target logic lives in one place.
export interface SelTarget {
  uid: string;
  tribe: TribeId;
  keywords: Keyword[];
  atk: number;
  hp: number;
  slot: number; // position within its own side (board order)
  bornTurn: number;
  golden: boolean;
  isToken: boolean;
}

export interface SelectContext {
  selfUid: string;
  triggerSourceUid?: string;
  allies: SelTarget[]; // ordered by slot
  enemies: SelTarget[]; // ordered by slot
  rng: RNG;
  chosenUid?: string; // for chosenAlly (resolved in shop)
}

function passesFilter(t: SelTarget, spec: TargetSpec, selfUid: string): boolean {
  if (spec.excludeSelf && t.uid === selfUid) return false;
  if (spec.filterTribe && t.tribe !== spec.filterTribe) return false;
  if (spec.filterKeyword && !t.keywords.includes(spec.filterKeyword)) return false;
  return true;
}

function byStat(list: SelTarget[], stat: 'atk' | 'hp', dir: 'max' | 'min'): SelTarget[] {
  if (list.length === 0) return [];
  let best = list[0];
  for (const t of list) {
    const v = stat === 'atk' ? t.atk : t.hp;
    const bv = stat === 'atk' ? best.atk : best.hp;
    if (dir === 'max' ? v > bv : v < bv) best = t;
    // tie → keep earliest slot (already first), deterministic
  }
  return [best];
}

/** Resolve a TargetSpec to a list of target uids. Deterministic given the rng. */
export function selectTargets(spec: TargetSpec, ctx: SelectContext): string[] {
  const self = ctx.allies.find((a) => a.uid === ctx.selfUid);
  const filteredAllies = ctx.allies.filter((a) => passesFilter(a, spec, ctx.selfUid));

  const pickRandom = (pool: SelTarget[], count = 1): string[] => {
    const shuffled = ctx.rng.shuffle(pool);
    return shuffled.slice(0, count).map((t) => t.uid);
  };

  switch (spec.selector) {
    case 'self':
      return [ctx.selfUid];
    case 'triggerSource':
      return ctx.triggerSourceUid ? [ctx.triggerSourceUid] : [];
    case 'leftNeighbor': {
      if (!self) return [];
      const left = ctx.allies.find((a) => a.slot === self.slot - 1);
      return left ? [left.uid] : [];
    }
    case 'rightNeighbor': {
      if (!self) return [];
      const right = ctx.allies.find((a) => a.slot === self.slot + 1);
      return right ? [right.uid] : [];
    }
    case 'adjacentAllies': {
      if (!self) return [];
      return ctx.allies
        .filter((a) => a.slot === self.slot - 1 || a.slot === self.slot + 1)
        .filter((a) => passesFilter(a, spec, ctx.selfUid))
        .map((a) => a.uid);
    }
    case 'allAllies':
      return filteredAllies.map((a) => a.uid);
    case 'randomAlly':
      return pickRandom(filteredAllies, spec.count ?? 1);
    case 'nAllies':
      return pickRandom(filteredAllies, spec.count ?? 1);
    case 'newestAlly': {
      const sorted = [...filteredAllies].sort((a, b) => b.bornTurn - a.bornTurn || b.slot - a.slot);
      return sorted.length ? [sorted[0].uid] : [];
    }
    case 'oldestAlly': {
      const sorted = [...filteredAllies].sort((a, b) => a.bornTurn - b.bornTurn || a.slot - b.slot);
      return sorted.length ? [sorted[0].uid] : [];
    }
    case 'highestStatAlly':
      return byStat(filteredAllies, spec.stat ?? 'hp', 'max').map((t) => t.uid);
    case 'lowestStatAlly':
      return byStat(filteredAllies, spec.stat ?? 'hp', 'min').map((t) => t.uid);
    case 'chosenAlly':
      // Resolved by the player in the shop. If a valid choice exists use it,
      // else fall back to nothing (battlecry fizzles).
      if (ctx.chosenUid && filteredAllies.some((a) => a.uid === ctx.chosenUid)) {
        return [ctx.chosenUid];
      }
      return [];
    case 'randomEnemy':
      return pickRandom(ctx.enemies, spec.count ?? 1);
    case 'frontEnemy':
      return ctx.enemies.length ? [ctx.enemies[0].uid] : [];
    case 'neighborsOfTarget':
      // Handled specially by cleave logic in combat; not used via selectTargets.
      return [];
    default:
      return [];
  }
}

/** Compute the legal target uids for a chosenAlly battlecry (for the UI/bot). */
export function legalChosenTargets(spec: TargetSpec, allies: SelTarget[], selfUid: string): string[] {
  return allies.filter((a) => passesFilter(a, spec, selfUid)).map((a) => a.uid);
}

export interface ConditionContext {
  self: SelTarget;
  allies: SelTarget[];
  gold?: number;
  tier?: number;
  gemsThisTurn?: number;
  // Round-6 manufactured-event counters (spec §16.3). Shop counters are 0 in combat
  // context and vice-versa, which keeps each breakpoint scoped to its phase.
  battlecriesThisTurn?: number;
  tokensSummonedThisTurn?: number;
  deathsThisCombat?: number;
}

export function evalCondition(cond: ConditionSpec | undefined, ctx: ConditionContext): boolean {
  if (!cond) return true;
  switch (cond.kind) {
    case 'hasTribe':
      return ctx.allies.some((a) => a.tribe === cond.tribe);
    case 'hasKeyword':
      return ctx.self.keywords.includes(cond.keyword as Keyword);
    case 'countAllies':
      return ctx.allies.length >= (cond.value ?? 0);
    case 'goldAtLeast':
      return (ctx.gold ?? 0) >= (cond.value ?? 0);
    case 'tierAtLeast':
      return (ctx.tier ?? 0) >= (cond.value ?? 0);
    case 'isGolden':
      return ctx.self.golden;
    case 'isToken':
      return ctx.self.isToken;
    case 'gemsThisTurnAtLeast':
      return (ctx.gemsThisTurn ?? 0) >= (cond.value ?? 0);
    case 'battlecriesThisTurnAtLeast':
      return (ctx.battlecriesThisTurn ?? 0) >= (cond.value ?? 0);
    case 'tokensSummonedThisTurnAtLeast':
      return (ctx.tokensSummonedThisTurn ?? 0) >= (cond.value ?? 0);
    case 'deathsThisCombatAtLeast':
      return (ctx.deathsThisCombat ?? 0) >= (cond.value ?? 0);
    default:
      return true;
  }
}
