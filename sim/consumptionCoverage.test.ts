// EV-SIM-CONS-01 — bot payoff-coverage regression guard (decision #47).
//
// A consumption card (Gorgemaw: a `destroyAlly` battlecry) is a 3/3 body, so before #47 the bot
// valued it as raw stats, dumped it as the weakest hold to free bench room, and it reached combat
// 0× in the macro sim — the Infernal balance number did NOT reflect the consumption rework at all.
// The fix teaches the bot to value consumption cards like other primary payoffs (buy/keep/play).
// This pins that behaviorally through the REAL bot + engine + macro harness: Gorgemaw must reach
// combat (players > 0) on a fixed seed. Deterministic (same seed/matches → identical report).

import { describe, it, expect } from 'vitest';
import { runMacro } from './macro';

describe('EV-SIM-CONS — bot exercises the consumption payoff (#47)', () => {
  it('EV-SIM-CONS-01 Gorgemaw reaches combat in the macro sim (not dumped as chaff)', () => {
    const { report } = runMacro({ matches: 60, seedBase: 'run' });
    const gorgemaw = report.units.find((u) => u.cardId === 'infernals_gorgemaw');
    // present in report.units (which lists only cards with ≥1 player) ⇒ it survived to combat.
    expect(gorgemaw, 'Gorgemaw never reached combat — consumption payoff is dead in the macro sim').toBeDefined();
    expect(gorgemaw!.players).toBeGreaterThan(0);
    // and it is neither auto-flagged overpowered nor dead: an honestly-measured mid card.
    expect(gorgemaw!.op).toBe(false);
    expect(gorgemaw!.dead).toBe(false);
  });
});
