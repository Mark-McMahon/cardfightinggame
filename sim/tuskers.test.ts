// PART A — Tusker compounding containment (spec §16, WEB-FRAMEWORK). The exponential doubler is
// uncapped by DESIGN; the cap is the COST of assembling it. Verified end-to-end through the real
// shop `endOfTurnPhase` path (`assembleGrown`) — nothing is stat-tuned.

import { describe, it, expect } from 'vitest';
import { resolveCombat, engines, type CombatBoard, type CombatEvent } from '@cardgame/shared';
import { assembleGrown, buildBoard } from './boards';
import { runMatchup } from './web';

const GENS = ['tuskers_gemsnout', 'tuskers_tuskhoarder', 'tuskers_grubtusk'];
function ivorytusk(board: CombatBoard) {
  return board.units.find((u) => u.cardId === 'tuskers_ivorytusk')!;
}

describe('Part A — Tusker doubler containment', () => {
  it('A1 assembly cost — the doubler ALONE never fires (no generators ⇒ never reaches gemsThisTurn ⇒ stays 3/4)', () => {
    const solo = assembleGrown(['tuskers_ivorytusk'], 9);
    const carry = ivorytusk(solo);
    expect(carry.atk).toBe(3);
    expect(carry.hp).toBe(4);
  });

  it('per-application factor is CAPPED at ×2, exponential reach only compounds across turns', () => {
    const t1 = ivorytusk(assembleGrown(['tuskers_ivorytusk', ...GENS], 1));
    const t2 = ivorytusk(assembleGrown(['tuskers_ivorytusk', ...GENS], 2));
    const t3 = ivorytusk(assembleGrown(['tuskers_ivorytusk', ...GENS], 3));
    expect([t1.atk, t1.hp]).toEqual([6, 8]); // 3/4 ×2
    expect([t2.atk, t2.hp]).toEqual([12, 16]); // ×2 again (compounds)
    expect([t3.atk, t3.hp]).toEqual([24, 32]);
    // never exceeds the cap in one application: each step is exactly ×multiplyFactorCap
    expect(t2.atk / t1.atk).toBe(engines.tuskers.multiplyFactorCap);
  });

  it('A3 the counter connects — a fully-doubled carry (thousands of stats) loses to saturated poison', () => {
    const doubled = assembleGrown(['tuskers_ivorytusk', ...GENS], 9);
    const carry = ivorytusk(doubled);
    expect(carry.atk).toBeGreaterThan(1000); // 3 · 2^9 = 1536 — the exponential ceiling, engine-computed
    const poison = buildBoard([
      { cardId: 'sirens_lurefish', count: 2 },
      { cardId: 'sirens_venomsong' },
      { cardId: 'sirens_tempestsinger' },
      { cardId: 'sirens_maelstromcantor' },
      { cardId: 'reefkin_spinefish' },
      { cardId: 'sirens_sirenling' },
    ]);
    const m = runMatchup(doubled, poison, 30, 'partA:poison');
    expect(m.aWinRate).toBeLessThan(0.5); // poison wins regardless of stat size (P1)
  });

  it('A6 engineering sanity — a 20-turn carry is finite (never Infinity/NaN) and combat terminates', () => {
    const doubled = assembleGrown(['tuskers_ivorytusk', ...GENS], 20);
    const carry = ivorytusk(doubled);
    expect(Number.isFinite(carry.atk)).toBe(true);
    expect(Number.isFinite(carry.hp)).toBe(true);
    expect(carry.atk).toBeLessThanOrEqual(engines.tuskers.statSanityBound);
    const log = resolveCombat(doubled, buildBoard([{ cardId: 'corsairs_deckhand', count: 3 }]), 'partA:sane');
    const end = log[log.length - 1] as Extract<CombatEvent, { t: 'combatEnd' }>;
    expect(end.t).toBe('combatEnd');
  });

  it('A7 gem economy determinism — same roster + turns → identical compounding, twice', () => {
    const a = ivorytusk(assembleGrown(['tuskers_ivorytusk', ...GENS], 8));
    const b = ivorytusk(assembleGrown(['tuskers_ivorytusk', ...GENS], 8));
    expect([a.atk, a.hp]).toEqual([b.atk, b.hp]);
  });
});
