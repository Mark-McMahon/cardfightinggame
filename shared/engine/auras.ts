// Passive-modifier queries (spec §6.4, §6.8). The reference's hardest patterns — the
// battlecry doubler, the end-of-turn trigger multiplier, and the tribe-wide damage amp —
// are NOT triggers; they are auras that change how *other* effects resolve. Combination
// rule (§6.8): stacking auras multiply, non-stacking take the max; then round, Math.max(1,·),
// then HARD-cap from engines.ts. `activeWhen` gates an aura on a combat-side breakpoint.

import type { AuraCounter, AuraSpec, TribeId } from '../types';
import { engines } from '../config';

/** Anything that can carry auras (combat fighters; shop board built from cards). */
export interface AuraBearer {
  tribe: TribeId;
  auras: AuraSpec[];
}

function combine(values: Array<{ value: number; stacks: boolean }>, cap: number): number {
  if (values.length === 0) return 1;
  let stackingProduct = 1;
  let nonStackMax = 1;
  let sawNonStack = false;
  for (const v of values) {
    if (v.stacks) stackingProduct *= v.value;
    else {
      nonStackMax = Math.max(nonStackMax, v.value);
      sawNonStack = true;
    }
  }
  let combined = stackingProduct * (sawNonStack ? nonStackMax : 1);
  combined = Math.round(combined);
  combined = Math.max(1, combined);
  return Math.min(combined, cap);
}

/** Echo Choir: `yourBattlecries` trigger multiplier, capped at battlecryTriggerMultiplierCap. */
export function battlecryMultiplier(board: AuraBearer[]): number {
  const vals = board.flatMap((b) =>
    b.auras
      .filter((a) => a.scope === 'yourBattlecries' && a.modifier.kind === 'triggerMultiplier')
      .map((a) => ({ value: a.modifier.value, stacks: a.stacks ?? false })),
  );
  return combine(vals, engines.reefkin.battlecryTriggerMultiplierCap);
}

/** Grovecaller: `yourEndOfTurn` trigger multiplier — SUMMON-scoped in the engine (§6.8). The
 *  aura scope is `yourEndOfTurn`, but the multiplier applies ONLY to end-of-turn `summon`
 *  actions (not giveGem / multiplyStats). Capped at endOfTurnTriggerMultiplierCap. */
export function endOfTurnSummonMultiplier(board: AuraBearer[]): number {
  const vals = board.flatMap((b) =>
    b.auras
      .filter((a) => a.scope === 'yourEndOfTurn' && a.modifier.kind === 'triggerMultiplier')
      .map((a) => ({ value: a.modifier.value, stacks: a.stacks ?? false })),
  );
  return combine(vals, engines.wildkin.endOfTurnTriggerMultiplierCap);
}

/**
 * Vanguard Pennant (Phase 4, §6.4): the total flat +ATTACK the LEFTMOST friendly (board index 0)
 * receives from `leftmost` positional auras on its side. The query returns the side-wide bonus; the
 * CALLER (combat) decides whether a given fighter is currently the leftmost, so a reposition/death
 * moves the bonus for free (query-at-read-time). Stacked pennants sum, capped at leftmostAttackBuffCap.
 */
export function leftmostAttackBonus(side: AuraBearer[]): number {
  let sum = 0;
  for (const b of side) {
    for (const a of b.auras) {
      if (a.scope !== 'leftmost') continue;
      if (a.modifier.kind !== 'attackBuff') continue;
      sum += a.modifier.value;
    }
  }
  return Math.min(sum, engines.corsairs.leftmostAttackBuffCap);
}

export interface SideCounters {
  deaths: number;
  revenantDeaths: number;
}

function counterValue(counters: SideCounters, c: AuraCounter): number {
  return c === 'revenantDeaths' ? counters.revenantDeaths : counters.deaths;
}

/**
 * Pale Lich: the tribe damage multiplier applied to `unit`'s outgoing damage. Scope
 * `selfTribeAllies` → the aura (on a bearer) amps side-allies sharing the bearer's tribe;
 * `activeWhen` gates it on the side's live death counter (read at strike time, §7.5). Capped
 * at undeadDamageAmpCap.
 */
export function damageMultiplier(side: AuraBearer[], unit: AuraBearer, counters: SideCounters): number {
  const vals: Array<{ value: number; stacks: boolean }> = [];
  for (const bearer of side) {
    for (const a of bearer.auras) {
      if (a.modifier.kind !== 'damageMultiplier') continue;
      if (a.scope !== 'selfTribeAllies' && a.scope !== 'allAllies') continue;
      if (a.activeWhen && counterValue(counters, a.activeWhen.counter) < a.activeWhen.threshold) continue;
      const affectsTribe = a.modifier.tribe ?? (a.scope === 'selfTribeAllies' ? bearer.tribe : undefined);
      if (affectsTribe !== undefined && unit.tribe !== affectsTribe) continue;
      vals.push({ value: a.modifier.value, stacks: a.stacks ?? false });
    }
  }
  return combine(vals, engines.revenants.undeadDamageAmpCap);
}
