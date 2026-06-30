import { describe, it, expect } from 'vitest';
import { breakpoints, getBreakpoint, hasBreakpoint, type BreakpointCounter } from '../config/breakpoints';
import { UNIT_BY_ID } from '../content/units';

// Static portion of the §16.7c breakpoint lint: every primary payoff must be expressible
// as a discrete config breakpoint. The win-rate-margin / reachability / non-linearity
// metrics that complete §16.7 live in the sim (Step 2).

const VALID_COUNTERS: BreakpointCounter[] = [
  'deaths',
  'revenantDeaths',
  'tokensThisTurn',
  'battlecries',
  'alliesAtStart',
  'shieldBreak',
];

// The ⭐ primary build-around payoffs in the §16.5 catalog.
const PRIMARY_PAYOFFS = [
  'wildkin_thornwarden',
  'wildkin_motherthorn',
  'wildkin_packmother',
  'wildkin_brackentide',
  'revenants_mortarch',
  'revenants_palelich',
  'revenants_tideclaimer',
  'revenants_boncolossus',
  'reefkin_pearlguard',
  'reefkin_chorustide',
  'reefkin_leviathan',
];

describe('breakpoint config lint (spec §16.4 / §16.7c)', () => {
  it('every breakpoint references a real catalog card, valid counter, positive threshold', () => {
    for (const b of breakpoints.list) {
      expect(UNIT_BY_ID[b.card], `breakpoint card ${b.card} missing from catalog`).toBeTruthy();
      expect(VALID_COUNTERS, `breakpoint ${b.card} has invalid counter`).toContain(b.counter);
      expect(b.threshold, `breakpoint ${b.card} needs a positive threshold`).toBeGreaterThan(0);
    }
  });

  it('every primary (⭐) payoff is expressed as a discrete breakpoint', () => {
    for (const id of PRIMARY_PAYOFFS) {
      expect(hasBreakpoint(id), `primary payoff ${id} has no config breakpoint`).toBe(true);
      expect(() => getBreakpoint(id)).not.toThrow();
    }
  });

  it('breakpoint card ids are unique', () => {
    const ids = breakpoints.list.map((b) => b.card);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
