import type { AuraCounter, AuraSpec, TribeId } from '../types';
import { engines } from '../config/engines';

// Passive-modifier queries (spec §6.3). Auras change how *other* effects resolve;
// the resolver queries these rather than them firing as triggers.

export interface AuraBearer {
  tribe: TribeId;
  auras: AuraSpec[];
}

/** Combat-side counters an aura's `activeWhen` gate can read (spec §16.2). */
export interface CombatCounters {
  deaths: number;
  revenantDeaths: number;
}

type ScopeKind = AuraSpec['scope'];
type ModKind = AuraSpec['modifier']['kind'];

function counterValue(counters: CombatCounters | undefined, c: AuraCounter): number {
  if (!counters) return 0;
  return c === 'deaths' ? counters.deaths : counters.revenantDeaths;
}

/** An aura is inert until its breakpoint (if any) is reached on the bearer's side. */
function auraActive(a: AuraSpec, counters: CombatCounters | undefined): boolean {
  if (!a.activeWhen) return true;
  return counterValue(counters, a.activeWhen.counter) >= a.activeWhen.threshold;
}

/** Combine matching auras: stacking ones multiply; non-stacking apply once (max value). */
function combineMultiplier(
  bearers: AuraBearer[],
  scope: ScopeKind,
  modKind: ModKind,
  tribeFilter?: TribeId,
  counters?: CombatCounters,
): number {
  let mult = 1;
  let nonStackVal = 1;
  let hasNonStack = false;
  for (const b of bearers) {
    for (const a of b.auras) {
      if (a.scope !== scope || a.modifier.kind !== modKind) continue;
      if (tribeFilter !== undefined && a.modifier.tribe !== tribeFilter) continue;
      if (!auraActive(a, counters)) continue; // Round-6: breakpoint gate (Pale Lich)
      if (a.stacks) {
        mult *= a.modifier.value;
      } else {
        hasNonStack = true;
        nonStackVal = Math.max(nonStackVal, a.modifier.value);
      }
    }
  }
  if (hasNonStack) mult *= nonStackVal;
  return mult;
}

/**
 * Damage multiplier applied to combat damage dealt by a unit of `sourceTribe`.
 * `counters` lets conditional amps (Pale Lich's DEATHS breakpoint) switch on. The amp
 * value is already clamped to `undeadDamageAmpCap` at content-build time (§16.2).
 */
export function damageMultiplierForTribe(
  bearers: AuraBearer[],
  sourceTribe: TribeId,
  counters?: CombatCounters,
): number {
  return combineMultiplier(bearers, 'selfTribeAllies', 'damageMultiplier', sourceTribe, counters);
}

/** How many times a battlecry should fire (≥1), capped (§16.2 Echo Choir). */
export function battlecryTriggerCount(bearers: AuraBearer[]): number {
  const raw = Math.round(combineMultiplier(bearers, 'yourBattlecries', 'triggerMultiplier'));
  return Math.max(1, Math.min(raw, engines.reefkin.battlecryTriggerMultiplierCap));
}

/** How many times an end-of-turn effect should fire (≥1), capped (§16.2 Grovecaller). */
export function endOfTurnTriggerCount(bearers: AuraBearer[]): number {
  const raw = Math.round(combineMultiplier(bearers, 'yourEndOfTurn', 'triggerMultiplier'));
  return Math.max(1, Math.min(raw, engines.wildkin.endOfTurnTriggerMultiplierCap));
}

/** Shop cost reduction for a given tribe (Corsairs, deferred-but-modeled). */
export function costReductionForTribe(bearers: AuraBearer[], tribe: TribeId): number {
  let total = 0;
  for (const b of bearers) {
    for (const a of b.auras) {
      if (a.scope === 'shopCostTribe' && a.modifier.kind === 'costReduction') {
        if (a.modifier.tribe === undefined || a.modifier.tribe === tribe) total += a.modifier.value;
      }
    }
  }
  return total;
}
