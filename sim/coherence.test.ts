// Coherence gate (spec §16 Part B) — static scans over the catalog modelling a developed board.
// Each scanner must be clean on the shipped catalog AND bite its synthetic control.

import { describe, it, expect } from 'vitest';
import type { UnitCard } from '@cardgame/shared';
import {
  coherenceReport,
  capTruncationViolations,
  boardCountFamily,
  boardCountFamilyViolations,
  shieldPoisonCensus,
} from './coherence';

describe('coherence (Part B) — shipped catalog is clean', () => {
  it('overall coherence report passes', () => {
    const r = coherenceReport();
    if (!r.ok) console.error('coherence issues:', r.capTruncation, r.boardCount, r.shieldPoison);
    expect(r.ok).toBe(true);
  });

  it('B1/B2 — no cap-truncation / losing-only summon payoffs', () => {
    expect(capTruncationViolations()).toEqual([]);
  });

  it('B1 scanner BITES the pre-rework Grovelord (summon 6) control', () => {
    const oldGrovelord: UnitCard = {
      id: 'synthetic_grovelord',
      name: 'Old Grovelord',
      tribe: 'wildkin',
      tier: 6,
      atk: 8,
      hp: 9,
      keywords: [],
      effects: [
        { trigger: { type: 'endOfTurn' }, target: { selector: 'self' }, actions: [{ type: 'summon', summonUnitId: 'wildkin_thornpup', summonCount: 6 }] },
      ],
    };
    expect(capTruncationViolations([oldGrovelord]).length).toBeGreaterThan(0);
  });

  it('B4 — every density (board-count) payoff is a real commitment (threshold ≥ 4)', () => {
    const fam = boardCountFamily();
    expect(fam.length).toBeGreaterThan(0); // the family exists and is enumerated
    for (const c of fam) expect(c.threshold).toBeGreaterThanOrEqual(4);
    expect(boardCountFamilyViolations()).toEqual([]);
  });

  it('B6 — poison stays viable in a shield-heavy meta (poison sources out-number a splash shield pile)', () => {
    const census = shieldPoisonCensus();
    expect(census.ok).toBe(true);
    expect(census.poisonSources.length).toBeGreaterThan(2);
  });
});
