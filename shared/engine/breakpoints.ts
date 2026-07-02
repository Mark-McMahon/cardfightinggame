// Breakpoint lookup + the §11.3c lint helper (design law, decisions #22, #39/#40).
//
// The numbers live in config/breakpoints.ts; this module is the engine-side accessor plus
// the coverage lint EV-BAL-C asserts against: every ⭐ card ↔ exactly one row, every row's
// card exists in the catalog, and (advisory) no primary payoff scales per-unit without a
// threshold. Since decision #39 the lint vocabulary has a SECOND legal primary-payoff class:
// SPEND-GATED payoffs (activated abilities bought with gems) — legal because each step is
// PURCHASED, provided the card is registered in `spendGated` and its cost knobs are real
// positive config numbers.

import { breakpoints, engines, getBreakpoint, hasBreakpoint, spendGated, getSpendGated, hasSpendGated, contestedCondition, getContestedCondition, hasContestedCondition, type Breakpoint } from '../config';
import { UNIT_BY_ID } from '../content';

export { getBreakpoint, hasBreakpoint, getSpendGated, hasSpendGated, getContestedCondition, hasContestedCondition };
export type { Breakpoint };

export interface BreakpointLintResult {
  ok: boolean;
  errors: string[];
}

/**
 * §11.3c lint: every breakpoint row references a real catalog card, and no card is listed
 * twice (each ⭐ card ↔ exactly one row). Since #39 also: every spend-gated registry row
 * references a real card WITH an `activated` ability, every card with an `activated`
 * ability is registered spend-gated, and each registered cost knob resolves to a positive
 * finite number in the card's tribe block of `engines`. Returns the collected errors so a
 * test can assert `ok === true`.
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

  // spend-gated registry (decision #39, §6.6a): registry ↔ catalog `activated` is 1:1.
  const seenSpend = new Set<string>();
  for (const row of spendGated) {
    const card = UNIT_BY_ID[row.card];
    if (!card) {
      errors.push(`spend-gated row references unknown card: ${row.card}`);
      continue;
    }
    if (seenSpend.has(row.card)) errors.push(`duplicate spend-gated row for card: ${row.card}`);
    seenSpend.add(row.card);
    if (!card.activated) errors.push(`spend-gated row for a card with no activated ability: ${row.card}`);
    const tribeKnobs = (engines as unknown as Record<string, Record<string, unknown>>)[card.tribe] ?? {};
    for (const knob of row.costKnobs) {
      const v = tribeKnobs[knob];
      if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
        errors.push(`spend-gated cost knob engines.${card.tribe}.${knob} for ${row.card} is not a positive number`);
      }
    }
  }
  for (const card of Object.values(UNIT_BY_ID)) {
    if (card.activated && !hasSpendGated(card.id)) {
      errors.push(`activated ability not registered in the spend-gated registry: ${card.id}`);
    }
  }

  // contested-condition registry (decision #40 corollary, §6.6b/§11.3c): registry → real card, no
  // dupes, and every threshold knob resolves to a positive finite number in the card's tribe block.
  const seenContested = new Set<string>();
  for (const row of contestedCondition) {
    const card = UNIT_BY_ID[row.card];
    if (!card) {
      errors.push(`contested-condition row references unknown card: ${row.card}`);
      continue;
    }
    if (seenContested.has(row.card)) errors.push(`duplicate contested-condition row for card: ${row.card}`);
    seenContested.add(row.card);
    const tribeKnobs = (engines as unknown as Record<string, Record<string, unknown>>)[card.tribe] ?? {};
    for (const knob of row.thresholdKnobs) {
      const v = tribeKnobs[knob];
      if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
        errors.push(`contested-condition knob engines.${card.tribe}.${knob} for ${row.card} is not a positive number`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}
