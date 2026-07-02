import { economy, type EconomyConfig } from './economy';
import { match, type MatchConfig } from './match';
import { combat, type CombatConfig } from './combat';
import { triples, type TriplesConfig } from './triples';
import { engines, type EnginesConfig } from './engines';
import { systems, type SystemsConfig } from './systems';
import { bots, type BotsConfig } from './bots';
import { breakpoints, type BreakpointsConfig } from './breakpoints';
import { sim, type SimConfig } from './sim';

export interface GameConfig {
  economy: EconomyConfig;
  match: MatchConfig;
  combat: CombatConfig;
  triples: TriplesConfig;
  engines: EnginesConfig;
  systems: SystemsConfig;
  bots: BotsConfig;
  breakpoints: BreakpointsConfig;
  sim: SimConfig;
}

/** Single source of truth for all gameplay numbers (spec §11.1). */
export const config: GameConfig = {
  economy,
  match,
  combat,
  triples,
  engines,
  systems,
  bots,
  breakpoints,
  sim,
};

export {
  economy,
  match,
  combat,
  triples,
  engines,
  systems,
  bots,
  breakpoints,
  sim,
};
export { getBreakpoint, hasBreakpoint, spendGated, getSpendGated, hasSpendGated } from './breakpoints';
export type {
  EconomyConfig,
  MatchConfig,
  CombatConfig,
  TriplesConfig,
  EnginesConfig,
  SystemsConfig,
  BotsConfig,
  BreakpointsConfig,
  SimConfig,
};
export type { Breakpoint, BreakpointCounter, SpendGatedPayoff } from './breakpoints';
export type { Difficulty, BotWeights } from './bots';
