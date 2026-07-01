// EV-BAL-A / -B / -D / -G — the macro-sim balance metrics (spec §11.3). One shared, seeded macro
// run feeds all four. The STRUCTURAL gate here is EV-BAL-B (reachability); EV-BAL-A/-D/-G are
// statistical and reported with their measured value (this regen has the corrected D1–D3 combat
// ordering, so the thresholds — tuned against the legacy engine — are asserted honestly, not forced).

import { describe, it, expect } from 'vitest';
import { runMacro } from './macro';
import { singleAxisMargin, reachability, nonLinearity, staleCombat } from './metrics';

// Fixed seed + a sample size large enough that Monte-Carlo washes out targeting variance while the
// test still finishes in a few seconds. Reachability clears 50% comfortably here across seeds.
const MATCHES = 150;
const SEED = 'gate';
const { results } = runMacro({ matches: MATCHES, seedBase: SEED });

describe('EV-BAL-B — reachability GATE (§11.3b, THE gate)', () => {
  const r = reachability(results);
  it(`≥ ${(r.target * 100).toFixed(0)}% of developed 2-tribe splashes hit ≥2 distinct breakpoints`, () => {
    console.log(`EV-BAL-B reachability: ${(r.fraction * 100).toFixed(1)}% (target ${(r.target * 100).toFixed(0)}%, n=${r.developedSplashCount})`);
    expect(r.developedSplashCount).toBeGreaterThan(50); // enough developed splashes to be meaningful
    expect(r.fraction).toBeGreaterThanOrEqual(r.target);
  });
});

describe('EV-BAL-A — single-axis margin (§11.3a)', () => {
  const a = singleAxisMargin(results);
  it(`single-axis win-rate lead ≤ ${(a.threshold * 100).toFixed(0)}pp over the multi-axis cohort`, () => {
    console.log(`EV-BAL-A margin: ${(a.margin * 100).toFixed(1)}pp (limit ${(a.threshold * 100).toFixed(0)}pp) [single ${(a.singleWinRate * 100).toFixed(1)}% n=${a.singleN} | multi ${(a.multiWinRate * 100).toFixed(1)}% n=${a.multiN}]`);
    expect(a.margin).toBeLessThanOrEqual(a.threshold);
  });
});

describe('EV-BAL-D — non-linearity (§11.3d, controlled step-not-line experiment)', () => {
  const d = nonLinearity(results);
  it(`crossing a marquee threshold beats the sub-threshold slope by ≥ ${d.threshold}×`, () => {
    console.log(`EV-BAL-D mean step ratio: ${d.meanRatio.toFixed(2)} (min ${d.threshold}) over ${d.measuredCards} marquee cards`);
    for (const c of d.perCard) console.log(`  ${c.card}: cross ${(c.crossStep * 100).toFixed(0)}pp / belowSlope ${(c.belowSlope * 100).toFixed(0)}pp = ${c.ratio.toFixed(1)}×`);
    expect(d.measuredCards).toBeGreaterThan(0);
    expect(d.pass).toBe(true);
  });
});

describe('EV-BAL-G — stale-combat fraction (§11.3 outputs)', () => {
  const g = staleCombat(results);
  it(`fraction of combats hitting maxCombatSteps is below the flag (${(g.flag * 100).toFixed(0)}%)`, () => {
    console.log(`EV-BAL-G stale-combat: ${(g.fraction * 100).toFixed(2)}% of ${g.combats} combats (flag ${(g.flag * 100).toFixed(0)}%)`);
    expect(g.fraction).toBeLessThanOrEqual(g.flag);
  });
});
