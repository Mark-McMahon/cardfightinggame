import type { ActionSpec, CombatEvent, UnitInstance } from '../types';
import type { Difficulty } from '../config/bots';

// Authoritative per-player state (server & sim share this; the server projects
// it onto the public schema + private push channel, spec §9.3).

export interface PendingTargetState {
  sourceUid: string;
  sourceName: string;
  actions: ActionSpec[];
  multiplier: number;
  legalTargets: string[];
  description: string;
}

export interface DiscoverPending {
  reason: string;
  options: string[]; // candidate cardIds
}

export interface PlayerState {
  seat: number;
  name: string;
  isBot: boolean;
  difficulty: Difficulty;
  connected: boolean;

  hp: number;
  alive: boolean;
  placement: number; // 0 = unplaced

  // economy
  gold: number;
  baseIncome: number;
  tier: number;
  roundsSinceTierUp: number;

  // shop
  shop: string[]; // offered cardIds
  frozen: boolean;

  // units
  bench: UnitInstance[];
  board: UnitInstance[];
  gems: number;
  gemsThisTurn: number;

  // Round-6 manufactured-event counters (per shop turn; spec §16.3)
  battlecriesThisTurn: number; // resolved battlecry triggers (Echo Choir doubles this)
  tokensSummonedThisTurn: number; // tokens summoned this shop turn (SWARM)

  // pending interactions
  discover: DiscoverPending | null;
  pendingTarget: PendingTargetState | null;

  ready: boolean;

  // combat feedback
  lastCombatLog: CombatEvent[] | null;
  lastResult: 'win' | 'loss' | 'tie' | null;
  lastDamage: number;

  log: string[];
}

export function createPlayerState(
  seat: number,
  name: string,
  isBot: boolean,
  difficulty: Difficulty,
  startingHealth: number,
): PlayerState {
  return {
    seat,
    name,
    isBot,
    difficulty,
    connected: true,
    hp: startingHealth,
    alive: true,
    placement: 0,
    gold: 0,
    baseIncome: 0,
    tier: 1,
    roundsSinceTierUp: 0,
    shop: [],
    frozen: false,
    bench: [],
    board: [],
    gems: 0,
    gemsThisTurn: 0,
    battlecriesThisTurn: 0,
    tokensSummonedThisTurn: 0,
    discover: null,
    pendingTarget: null,
    ready: false,
    lastCombatLog: null,
    lastResult: null,
    lastDamage: 0,
    log: [],
  };
}

export function logLine(p: PlayerState, msg: string): void {
  p.log.push(msg);
  if (p.log.length > 40) p.log.shift();
}
