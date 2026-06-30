import { describe, it, expect } from 'vitest';
import type { CombatEvent } from '@cardgame/shared';
import {
  classifyBuild,
  deriveCombatCounters,
  emptyPeaks,
  lintBreakpoints,
  maxPeaks,
  reachedBreakpoints,
  PRIMARY_PAYOFFS,
} from './metrics';

// Unit tests for the pure §16.7 metric helpers (the macro orchestration just feeds these).

function unit(uid: string, cardId: string, tribe: string, keywords: string[] = []) {
  return { uid, cardId, name: cardId, tribe: tribe as any, tier: 1, atk: 1, hp: 1, keywords: keywords as any, golden: false };
}

describe('deriveCombatCounters (combat-scoped reach from the event log)', () => {
  const events: CombatEvent[] = [
    {
      t: 'combatStart',
      seed: 'x',
      a: { playerTier: 1, units: [unit('a1', 'revenants_cryptling', 'revenants'), unit('a2', 'reefkin_pearlguard', 'reefkin', ['divineShield'])] },
      b: { playerTier: 1, units: [unit('b1', 'wildkin_thornpup', 'wildkin')] },
    },
    { t: 'summon', ownerId: 'a', unitIds: ['revenants_wisp#5@a'], slot: 0 }, // combat-summoned revenant token
    { t: 'damage', sourceId: 'b1', targetId: 'a2', amount: 0, shieldBroken: true }, // a2's shield breaks
    { t: 'death', unitId: 'a1' }, // revenant dies
    { t: 'death', unitId: 'revenants_wisp#5@a' }, // summoned revenant token dies
    { t: 'death', unitId: 'b1' },
    { t: 'combatEnd', winner: 'a', survivors: ['a2'], damageToLoser: 1 },
  ];

  it('counts side A: deaths, revenant deaths (incl. summoned token), allies-at-start, shield breaks', () => {
    const a = deriveCombatCounters(events, 'a');
    expect(a.deaths).toBe(2);
    expect(a.revenantDeaths).toBe(2); // cryptling + the summoned revenants_wisp
    expect(a.alliesAtStart).toBe(2);
    expect(a.shieldBreak).toBe(1);
  });

  it('counts side B independently and does not attribute A’s events to B', () => {
    const b = deriveCombatCounters(events, 'b');
    expect(b.deaths).toBe(1);
    expect(b.revenantDeaths).toBe(0);
    expect(b.alliesAtStart).toBe(1);
    expect(b.shieldBreak).toBe(0);
  });
});

describe('classifyBuild (axis tags → single-axis vs multi-axis, splash detection)', () => {
  it('a mono one-axis board is single-axis and not a splash', () => {
    const p = classifyBuild(['revenants_mortarch', 'revenants_graverobber', 'revenants_cryptling']);
    expect(p.klass).toBe('single-axis');
    expect(p.isSplash).toBe(false);
    expect(p.dominantAxis).toBe('deaths');
  });

  it('a balanced two-tribe board is a splash and multi-axis', () => {
    // reefkin ×2 + wildkin ×2 → second tribe ≥ 2 = splash; axis feeds spread = multi-axis.
    const p = classifyBuild(['reefkin_pearlguard', 'reefkin_chorustide', 'wildkin_packmother', 'wildkin_thornwarden']);
    expect(p.isSplash).toBe(true);
    expect(p.klass).toBe('multi-axis');
  });

  it('tokens do not count toward classification', () => {
    const p = classifyBuild(['revenants_mortarch', 'revenants_wisp', 'revenants_wisp']);
    expect(p.unitCount).toBe(1); // only Mortarch; wisps are tokens
  });
});

describe('reachedBreakpoints (owned + threshold met)', () => {
  it('triggers only when owned and the counter clears the threshold', () => {
    const peak = emptyPeaks();
    peak.deaths = 3;
    const hit = reachedBreakpoints(['revenants_mortarch'], peak); // deaths ≥ 3
    expect(hit.reachedCards).toContain('revenants_mortarch');
    expect(hit.reachedAxes).toContain('deaths');

    const below = emptyPeaks();
    below.deaths = 2;
    expect(reachedBreakpoints(['revenants_mortarch'], below).reachedCards).toHaveLength(0);
  });

  it('does not credit a breakpoint you do not own', () => {
    const peak = emptyPeaks();
    peak.deaths = 9;
    expect(reachedBreakpoints(['reefkin_pearlguard'], peak).reachedCards).not.toContain('revenants_mortarch');
  });
});

describe('maxPeaks', () => {
  it('takes the per-key maximum and ignores absent keys', () => {
    const into = emptyPeaks();
    maxPeaks(into, { deaths: 2, battlecries: 1 });
    maxPeaks(into, { deaths: 1, tokensThisTurn: 4 });
    expect(into.deaths).toBe(2);
    expect(into.battlecries).toBe(1);
    expect(into.tokensThisTurn).toBe(4);
  });
});

describe('lintBreakpoints (§16.7c, sim port of the structural lint)', () => {
  it('passes for the shipped catalog and covers every primary payoff', () => {
    const res = lintBreakpoints();
    expect(res.issues).toEqual([]);
    expect(res.pass).toBe(true);
    expect(PRIMARY_PAYOFFS.length).toBeGreaterThan(0);
  });
});
