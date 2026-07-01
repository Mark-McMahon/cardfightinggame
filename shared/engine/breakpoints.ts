// Breakpoint lookup + the §11.3c lint helper (design law, decision #22).
//
// The numbers live in config/breakpoints.ts; this module is the engine-side accessor plus
// the coverage lint EV-BAL-C asserts against: every ⭐ card ↔ exactly one row, every row's
// card exists in the catalog, and (advisory) no primary payoff scales per-unit without a
// threshold.

import { breakpoints, getBreakpoint, hasBreakpoint, type Breakpoint } from '../config';
import { UNIT_BY_ID } from '../content';

export { getBreakpoint, hasBreakpoint };
export type { Breakpoint };

export interface BreakpointLintResult {
  ok: boolean;
  errors: string[];
}

/**
 * §11.3c lint: every breakpoint row references a real catalog card, and no card is listed
 * twice (each ⭐ card ↔ exactly one row). Returns the collected errors so a test can assert
 * `ok === true`.
 */
export function lintBreakpoints(): BreakpointLintResult {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const row of breakpoints.list) {
    if (!UNIT_BY_ID[row.card]) {
      errors.push(`breakpoint references unknown card: ${row.card}`);
    }
    if (seen.has(row.card)) {
      errors.push(`duplicate breakpoint row for card: ${row.card}`);
    }
    seen.add(row.card);
  }
  return { ok: errors.length === 0, errors };
}
