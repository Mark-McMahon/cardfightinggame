// EV-BAL-C (breakpoint / anti-linear lint) + EV-BAL-E (caps lint) — STRUCTURAL gates over config +
// content (robust to combat ordering). Each scanner is also shown to BITE a synthetic control.

import { describe, it, expect } from 'vitest';
import { lintBreakpoints, engines, type UnitCard } from '@cardgame/shared';
import {
  capsAudit,
  breakpointAudit,
  wouldFlagUngatedGrowth,
  wouldFlagOverCapMultiplier,
} from './audit';

describe('EV-BAL-C — breakpoint lint (every ⭐ payoff ↔ exactly one discrete row)', () => {
  it('engine lintBreakpoints is clean (every row → real card, no dupes)', () => {
    const lint = lintBreakpoints();
    expect(lint.errors).toEqual([]);
    expect(lint.ok).toBe(true);
  });

  it('every primary breakpoint payoff is registered; no ungated per-turn stat growth', () => {
    const audit = breakpointAudit();
    if (!audit.ok) console.error('breakpoint audit violations:', audit.violations);
    expect(audit.violations).toEqual([]);
    expect(audit.ok).toBe(true);
  });

  it('the anti-linear scanner BITES a synthetic ungated per-turn doubler (not vacuous)', () => {
    const synthetic: UnitCard = {
      id: 'synthetic_linear',
      name: 'Synthetic Linear',
      tribe: 'wildkin',
      tier: 3,
      atk: 3,
      hp: 3,
      keywords: [],
      effects: [
        // repeatable board-state trigger, ungated stat growth — the §6.6 redline.
        { trigger: { type: 'endOfTurn' }, target: { selector: 'self' }, actions: [{ type: 'buffStats', atk: 2, hp: 2 }] },
      ],
    };
    expect(wouldFlagUngatedGrowth(synthetic)).toBe(true);
  });
});

describe('EV-BAL-E — caps lint (no multiplier exceeds its engines.ts cap)', () => {
  it('all configured multipliers, aura values, and breakpoint factors/amps are ≤ their caps', () => {
    const audit = capsAudit();
    if (!audit.ok) console.error('caps audit violations:', audit.violations);
    expect(audit.violations).toEqual([]);
    expect(audit.ok).toBe(true);
  });

  it('every cap is finite and positive', () => {
    expect(engines.wildkin.endOfTurnTriggerMultiplierCap).toBeGreaterThan(0);
    expect(engines.reefkin.battlecryTriggerMultiplierCap).toBeGreaterThan(0);
    expect(engines.revenants.undeadDamageAmpCap).toBeGreaterThan(0);
    expect(engines.tuskers.multiplyFactorCap).toBeGreaterThan(0);
    expect(Number.isFinite(engines.tuskers.multiplyFactorCap)).toBe(true);
  });

  it('the caps scanner BITES a synthetic over-cap multiplier (not vacuous)', () => {
    expect(wouldFlagOverCapMultiplier(99, engines.tuskers.multiplyFactorCap)).toBe(true);
    expect(wouldFlagOverCapMultiplier(engines.tuskers.multiplyFactorCap, engines.tuskers.multiplyFactorCap)).toBe(false);
  });
});
