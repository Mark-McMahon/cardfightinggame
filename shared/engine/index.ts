export { RNG, hashSeed } from './rng';
export { resolveCombat, summarizeCombat } from './combat';
export { Pool } from './pool';
export {
  createInstance,
  toCombatUnit,
  toClientUnit,
  cardOf,
  nextUid,
  resetUidCounter,
} from './instances';
export { selectTargets, legalChosenTargets, evalCondition, type SelTarget } from './effects';
export {
  battlecryTriggerCount,
  endOfTurnTriggerCount,
  damageMultiplierForTribe,
  costReductionForTribe,
  type AuraBearer,
} from './auras';
export { getCombatHandler, COMBAT_HANDLERS, type HandlerCombatCtx } from './handlers';
export {
  incomeForRound,
  currentTierUpCost,
  shopSlots,
  startShopPhase,
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
  autoResolvePending,
  endOfTurnPhase,
  boardToCombat,
  type OpResult,
} from './shop';
export {
  createPlayerState,
  logLine,
  type PlayerState,
  type PendingTargetState,
  type DiscoverPending,
} from './state';
export {
  Match,
  type MatchOptions,
  type PlayerSeed,
  type CombatReport,
  type RoundResolution,
} from './match';
