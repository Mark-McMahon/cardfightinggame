import { describe, it, expect } from 'vitest';
import { makeInstance, toCombatBoard } from './instances';
import { resolveCombat } from './combat';
import type { CombatBoard, UnitInstance } from '../types';
import {
  combatReplayMs,
  combatWindowMs,
  REPLAY_WINDOW_MIN_MS,
  REPLAY_WINDOW_CAP_MS,
} from './combatReplay';

// Guards the fix for the §10 "combat ends unexpectedly" bug: the server sizes the 'combat' phase
// from these helpers, so they must (a) grow with fight length, (b) never fall below the floor or
// exceed the cap, (c) always cover the fight up to the cap, and (d) take the max across pairings.

function board(ids: string[]): CombatBoard {
  const insts: UnitInstance[] = ids.map((id, i) => makeInstance(id, { uid: `u${i}`, bornTurn: 0 }));
  return toCombatBoard(insts, 6);
}

const tinyLog = resolveCombat(board(['infernals_cinderling']), board(['reefkin_spinefish']), 'r:1');
const bigLog = resolveCombat(
  board(['wildkin_motherthorn', 'wildkin_packmother', 'wildkin_thornpup', 'wildkin_gorehide', 'revenants_pallbearer', 'revenants_gravewing', 'reefkin_coralwarden']),
  board(['revenants_mortarch', 'revenants_tombspawn', 'reefkin_deepsinger', 'reefkin_pearlguard', 'wildkin_thornwarden', 'infernals_cinderling', 'reefkin_spinefish']),
  'r:2',
);

describe('combatReplay pacing', () => {
  it('a bigger fight has a longer natural playback', () => {
    expect(combatReplayMs(bigLog)).toBeGreaterThan(combatReplayMs(tinyLog));
  });

  it('window covers the whole fight (up to the cap) and stays within [MIN, CAP]', () => {
    const tiny = combatWindowMs([tinyLog]);
    expect(tiny).toBeGreaterThanOrEqual(REPLAY_WINDOW_MIN_MS);
    expect(tiny).toBeLessThanOrEqual(REPLAY_WINDOW_CAP_MS);
    // covers the fight itself
    expect(tiny).toBeGreaterThanOrEqual(Math.min(REPLAY_WINDOW_CAP_MS, combatReplayMs(tinyLog)));
  });

  it('a fight longer than the cap is clamped to the cap (client compresses to fit)', () => {
    expect(combatReplayMs(bigLog)).toBeGreaterThan(REPLAY_WINDOW_CAP_MS); // sanity: this fight overruns
    expect(combatWindowMs([bigLog])).toBe(REPLAY_WINDOW_CAP_MS);
  });

  it('no logs → the floor (nobody is watching)', () => {
    expect(combatWindowMs([])).toBe(REPLAY_WINDOW_MIN_MS);
  });

  it('takes the longest replay across all watched pairings', () => {
    expect(combatWindowMs([tinyLog, bigLog])).toBe(Math.max(combatWindowMs([tinyLog]), combatWindowMs([bigLog])));
  });
});
