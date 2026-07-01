// Public surface of the pure engine (spec §13). shared/index.ts does `export * from './engine'`,
// so everything server / sim / client needs is re-exported here. Only ENGINE-original symbols
// are exported — config/content/types are surfaced by their own `export *` in shared/index.ts
// (re-exporting them here would collide, e.g. getBreakpoint / Breakpoint).

// RNG (seeded PRNG)
export { Rng, makeRng, fnv1a } from './rng';

// Instance / combat-unit transforms
export { makeInstance, instanceToCombatUnit, toCombatBoard, goldenMultiplier } from './instances';
export type { MakeInstanceOpts } from './instances';

// State factories + privacy shape
export { makePublicPlayer, makePublicState, toClientUnit, toShopOffer, baseIncomeForRound } from './state';

// Shared pool
export { createPool, drawOne, draw, returnCopy, takeCopy, discoverOptions } from './pool';
export type { PoolState } from './pool';

// Breakpoint lint helper (getBreakpoint/hasBreakpoint/Breakpoint come from config)
export { lintBreakpoints } from './breakpoints';
export type { BreakpointLintResult } from './breakpoints';

// Declarative resolver primitives
export {
  selectTargets,
  chosenAllyCandidates,
  evaluateCondition,
  applyBuff,
  applyMultiply,
  cappedMultiplyFactor,
} from './effects';
export type { Targetable, SelectContext, ConditionCounts, Stats } from './effects';

// Passive-modifier queries
export { battlecryMultiplier, endOfTurnSummonMultiplier, damageMultiplier } from './auras';
export type { AuraBearer, SideCounters } from './auras';

// Custom handler registry
export { HANDLERS, runHandler } from './handlers';
export type { CustomHandler, CustomHandlerContext } from './handlers';

// Combat (pure)
export { resolveCombat, lossDamage } from './combat';

// Combat → persistent-board writeback fold (§7.5, decision #38; run by Match after combat)
export { foldPermanentBuffs } from './combatWriteback';
export type { WritebackResult, WritebackApplication } from './combatWriteback';

// Shop reducer ops + session
export {
  createShopSession,
  buyUnit,
  sellUnit,
  rollShop,
  freezeShop,
  unfreezeShop,
  tierUp,
  playUnit,
  moveUnit,
  resolveTargetChoice,
  resolveDiscoverPick,
  startShopPhase,
  endOfTurnPhase,
  boardToCombat,
  toPrivateState,
} from './shop';
export type { OpResult, ShopSession, SessionOpts } from './shop';

// Match orchestration
export { Match, computeTimer } from './match';
export type { SeatConfig } from './match';

// Combat replay pacing (pure) — the client animates these beats; the server sizes the combat
// phase window from combatWindowMs so no replay is ever cut off mid-fight (spec §10).
export {
  beats,
  totalWeight,
  combatReplayMs,
  combatWindowMs,
  COMBAT_SPEED,
  REPLAY_BASE_STEP_MS,
  REPLAY_WINDOW_MIN_MS,
  REPLAY_WINDOW_CAP_MS,
  REPLAY_TAIL_PAD_MS,
} from './combatReplay';
export type { Beat, BeatKind } from './combatReplay';
