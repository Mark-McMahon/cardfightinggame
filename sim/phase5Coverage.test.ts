// EV-SIM-P5 — Phase 5 bot payoff-coverage guards (#54/#55/#56). Like EV-SIM-CONS (#47), these pin
// through the REAL bot + engine + macro harness that the new lines are NOT dead in the sim:
//  • EV-SIM-MAG-01: the bot's deterministic merge policy emits a `merge` intent for a committed
//    Construct build with a magnetic bench unit + a tower (the go-tall consolidation line fires).
//  • EV-SIM-P5-02: across a macro run, the magnetic-merge tower is assembled at a healthy RATE
//    (credited toward reachability, matching the #39 spend-gated precedent) — a minimum-RATE guard,
//    not mere existence (the Phase-3 Gorgemaw lesson: a single fragile occurrence must not
//    green-light a payoff). NOTE: the Forgemaster Sentinel-stack is intentionally NOT guarded here —
//    it fires ~1/1600 macro player-games and is a DOCUMENTED macro-sim coverage gap (#58, §11.2); its
//    combat scalar is pinned by the EV-FRG-01..03 + EV-GLD-16 determinism/property evals instead.

import { describe, it, expect } from 'vitest';
import { BotAgent } from '@cardgame/server/bots';
import { bots, Rng, makeInstance, toClientUnit, type ClientUnit, type PrivateState, type PublicState, type PublicPlayer } from '@cardgame/shared';
import { runMacro } from './macro';

function client(cardId: string, uid: string): ClientUnit {
  return toClientUnit(makeInstance(cardId, { uid, bornTurn: 1 }));
}
function player(seat: number): PublicPlayer {
  return { seat, name: `P${seat}`, hp: 30, tier: 5, alive: true, placement: 0, isBot: true, connected: true, ready: false };
}

describe('EV-SIM-P5 — Phase 5 bot coverage (#54–56)', () => {
  it('EV-SIM-MAG-01: the bot MERGES a magnetic bench unit onto its biggest Construct tower', () => {
    const priv: PrivateState = {
      seat: 0,
      gold: 0, // no gold → no buy/tier/roll can distract; the merge is the only move
      baseIncome: 3,
      tier: 5,
      tierUpCost: -1,
      rerollCost: 1,
      shop: [],
      frozen: false,
      bench: [client('constructs_boltfitter', 'm1')], // a magnetic bench unit
      board: [client('constructs_cogling', 't1'), client('constructs_bulwark', 't2'), client('constructs_reclaimer', 't3')], // ≥3 Constructs (committed) — biggest is Reclaimer (3/4)
      gems: 0,
      abilities: [],
      discover: null,
      pendingTarget: null,
      lastCombatLog: null,
      log: [],
    };
    const pub: PublicState = {
      roomCode: 'SIM', phase: 'shop', round: 5, timer: 0,
      players: [player(0), player(1)], pairings: [], hostSeat: 0, botFill: false, winnerSeat: -1,
    };
    const agent = new BotAgent(bots.difficultyPresets.hard, new Rng('mag-bot'));
    const intent = agent.step(priv, pub);
    expect(intent).toEqual({ type: 'merge', unitUid: 'm1', targetUid: 't3' }); // biggest under-cap tower
  });

  it('EV-SIM-P5-02: the magnetic-merge tower is assembled at a healthy RATE in the macro sim', () => {
    const { results } = runMacro({ matches: 80, seedBase: 'run' });
    let players = 0;
    let mergeGames = 0;
    for (const r of results) {
      for (const p of r.players) {
        players++;
        if (p.breakpointsHit.has('constructs_magnetic_merge')) mergeGames++;
      }
    }
    // Assert a minimum firing RATE, not mere existence. Observed ~40/640 (~6%) on the fixed `run`
    // seed; the floor of 20 is a comfortable half-margin below that, so a genuinely dead merge line
    // (a regression that stops the bot consolidating) turns this red while incidental seed jitter
    // does not. (Contrast the retired existence guard, which would have passed on a single event.)
    expect(
      mergeGames,
      `magnetic merge tower fired in only ${mergeGames}/${players} player-games — the merge line is effectively dead`,
    ).toBeGreaterThanOrEqual(20);
  });
});
