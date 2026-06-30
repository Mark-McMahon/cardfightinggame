import type { RNG } from '../rng';

// Custom escape-hatch registry (spec §6, §8). Deliberately rare: any handler
// here needs a determinism test and a note on why it can't be declarative.

/** Context the combat engine hands to a custom combat handler. Kept minimal so
 *  handlers stay isolated and the engine owns all mutation. */
export interface HandlerCombatCtx {
  sourceUid: string;
  rng: RNG;
  params: Record<string, unknown>;
  /** Adjacent friendly uids (board neighbours of the source). */
  neighborsOf(uid: string): string[];
  /** All friendly uids except the source. */
  otherAllies(): string[];
  /** True if that unit has at least one deathrattle effect. */
  hasDeathrattle(uid: string): boolean;
  /** Re-fire that ally's deathrattle effects now, without it dying. */
  replayDeathrattle(uid: string): void;
  /** Arm "the next friendly to die triggers its deathrattle twice" (Pallbearer, §16.5). */
  primeDoubleNextDeathrattle(): void;
}

export type CombatHandler = (ctx: HandlerCombatCtx) => void;

/**
 * Engine 4 (Wildkin): re-fire an adjacent friendly deathrattle on attack.
 * Why a handler, not data: it must invoke another unit's full deathrattle
 * resolution (summons, buffs, reborn-counting) mid-combat without that unit
 * dying — there is no declarative action for "run another unit's trigger".
 */
const replayAdjacentDeathrattle: CombatHandler = (ctx) => {
  const scope = (ctx.params.scope as string) ?? 'adjacent';
  const candidates = scope === 'wholeBoard' ? ctx.otherAllies() : ctx.neighborsOf(ctx.sourceUid);
  for (const uid of candidates) {
    if (ctx.hasDeathrattle(uid)) ctx.replayDeathrattle(uid);
  }
};

/**
 * Pallbearer (Revenants): on death, prime "the next friendly to die triggers its
 * deathrattle twice". Why a handler, not data: it must arm a one-shot, cross-unit combat
 * flag that the death-resolution loop honours — there is no declarative action for
 * "modify how a future unrelated unit's deathrattle resolves".
 */
const primeNextDeathrattleDouble: CombatHandler = (ctx) => {
  ctx.primeDoubleNextDeathrattle();
};

export const COMBAT_HANDLERS: Record<string, CombatHandler> = {
  replayAdjacentDeathrattle,
  primeNextDeathrattleDouble,
};

export function getCombatHandler(id: string): CombatHandler | undefined {
  return COMBAT_HANDLERS[id];
}
