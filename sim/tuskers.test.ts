// PART A — Tusker compounding containment, reworked for the PURCHASED doubler (decision #39).
// The exponential line is uncapped by DESIGN; the cap is the COST: every ×2 step is bought with
// spendable gems at a shared escalating per-game price (doubleBaseCost + doubleCostStep × doubles
// already purchased), so the doubler competes with the gem SINKS (Facetguard/Oreseeker/Gemwright)
// for the same wallet. Verified end-to-end through the real shop reducer paths (`assembleGrown`
// buys doubles via `activateAbility`; nothing is stat-tuned).

import { describe, it, expect } from 'vitest';
import {
  resolveCombat,
  engines,
  createShopSession,
  makeInstance,
  activateAbility,
  activatedCost,
  endOfTurnPhase,
  resolveTargetChoice,
  getCard,
  type CombatBoard,
  type CombatEvent,
  type ShopSession,
} from '@cardgame/shared';
import { assembleGrown, buildBoard } from './boards';
import { runMatchup } from './web';

const T = engines.tuskers;
const GENS = ['tuskers_gemsnout', 'tuskers_tuskhoarder', 'tuskers_grubtusk'];
const ALL_IN = ['tuskers_gemtitan', ...GENS, 'tuskers_warhoard']; // 4 gems/turn feeding a T6 carry

function find(board: CombatBoard, cardId: string) {
  return board.units.find((u) => u.cardId === cardId)!;
}

function freshSession(seed: string, cardIds: string[]): ShopSession {
  const s = createShopSession(0, { seed });
  s.round = 1;
  for (const id of cardIds) s.board.push(makeInstance(id, { uid: `t${s.uidSeq++}`, bornTurn: 0 }));
  return s;
}

/** One simulated shop turn: reset the per-turn gates, run `shopPhase(s)`, then end-of-turn gems. */
function turn(s: ShopSession, shopPhase: (s: ShopSession) => void): void {
  s.gemsThisTurn = 0;
  s.abilityUsedThisTurn = [];
  shopPhase(s);
  endOfTurnPhase(s);
}

describe('Part A — Tusker purchased-doubler containment (#39)', () => {
  it('A1 assembly cost — the doubler ALONE never fires (no generators ⇒ empty wallet ⇒ stays 3/4)', () => {
    const solo = assembleGrown(['tuskers_ivorytusk'], 20);
    const carry = find(solo, 'tuskers_ivorytusk');
    expect(carry.atk).toBe(3);
    expect(carry.hp).toBe(4);
  });

  it('A2 escalating shared cost — each double is ≤ ×multiplyFactorCap and raises the NEXT double\'s price for EVERY doubler', () => {
    const s = freshSession('a2', ['tuskers_ivorytusk', 'tuskers_ivorylord']);
    const tusk = s.board[0];
    const lord = s.board[1];
    s.gems = 100; // fund the wallet directly; prices are what we're pinning
    const c0 = activatedCost(s, getCard('tuskers_ivorytusk'));
    expect(c0).toBe(T.doubleBaseCost);
    expect(activateAbility(s, tusk.uid).ok).toBe(true);
    expect(s.gems).toBe(100 - c0);
    expect([tusk.atk, tusk.hp]).toEqual([3 * T.doublerFactor, 4 * T.doublerFactor]); // one capped application
    expect(tusk.atk / 3).toBeLessThanOrEqual(T.multiplyFactorCap);
    // buying doubler A's step raised doubler B's price (the escalator is per-GAME, shared):
    const c1 = activatedCost(s, getCard('tuskers_ivorylord'));
    expect(c1).toBe(T.doubleBaseCost + T.doubleCostStep);
    expect(activateAbility(s, lord.uid).ok).toBe(true);
    expect(activatedCost(s, getCard('tuskers_ivorytusk'))).toBe(T.doubleBaseCost + 2 * T.doubleCostStep);
    // and the exponential reach compounds only across PURCHASES, never in one application:
    expect([lord.atk, lord.hp]).toEqual([5 * T.doublerFactor, 7 * T.doublerFactor]);
  });

  it('A3 the all-in line is REAL — greedy doubles on a T6 carry still reach thousands of stats by late game', () => {
    const grown = assembleGrown(ALL_IN, 24); // ~4 gems/turn, greedy purchased doubles (real reducer)
    const carry = find(grown, 'tuskers_gemtitan');
    expect(carry.atk).toBeGreaterThan(1000); // 8 · 2^k with k ≥ 7 — engine-computed, nothing tuned
    expect(carry.hp).toBeGreaterThan(1000);
  });

  it('A4 the TRADEOFF is real — a split line (wallet also feeding Facetguard) lands materially lower', () => {
    // All-in control: same income, every gem into doubles.
    const allIn = freshSession('a4-allin', ALL_IN);
    for (let t = 0; t < 24; t++) {
      turn(allIn, (s) => {
        const titan = s.board[0];
        while (s.gems >= activatedCost(s, getCard('tuskers_gemtitan')) && !s.abilityUsedThisTurn.includes(titan.uid)) {
          if (!activateAbility(s, titan.uid).ok) break;
        }
      });
    }
    // Split line: Facetguard (a real slot + 2 gems/turn of the SAME wallet buys shields/buffs
    // instead of doubles) — the defensive spoils build.
    const split = freshSession('a4-split', ['tuskers_gemtitan', 'tuskers_facetguard', ...GENS, 'tuskers_warhoard']);
    for (let t = 0; t < 24; t++) {
      turn(split, (s) => {
        const titan = s.board[0];
        const facet = s.board[1];
        if (s.gems >= activatedCost(s, getCard('tuskers_facetguard'))) {
          if (activateAbility(s, facet.uid).ok) resolveTargetChoice(s, titan.uid);
        }
        while (s.gems >= activatedCost(s, getCard('tuskers_gemtitan')) && !s.abilityUsedThisTurn.includes(titan.uid)) {
          if (!activateAbility(s, titan.uid).ok) break;
        }
      });
    }
    const allInTitan = allIn.board[0];
    const splitTitan = split.board[0];
    expect(allInTitan.atk).toBeGreaterThan(1000); // the all-in ceiling
    expect(split.doublesPurchased).toBeLessThan(allIn.doublesPurchased); // the sink ATE doubles
    expect(splitTitan.atk).toBeLessThan(allInTitan.atk / 2); // and the carry lands materially lower
    expect(splitTitan.atk).toBeGreaterThan(getCard('tuskers_gemtitan').atk); // but still scaled some
    // and the split actually BOUGHT something: the carry holds Facetguard's purchased shield.
    expect(splitTitan.keywords).toContain('divineShield');
  });

  it('A5 the counter connects — a fully-doubled carry (thousands of stats) loses to saturated poison', () => {
    const doubled = assembleGrown(ALL_IN, 24);
    expect(find(doubled, 'tuskers_gemtitan').atk).toBeGreaterThan(1000);
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

  it('A6 engineering sanity — a 40-turn all-in carry is finite (never Infinity/NaN) and combat terminates', () => {
    const doubled = assembleGrown(ALL_IN, 40);
    const carry = find(doubled, 'tuskers_gemtitan');
    expect(Number.isFinite(carry.atk)).toBe(true);
    expect(Number.isFinite(carry.hp)).toBe(true);
    expect(carry.atk).toBeLessThanOrEqual(T.statSanityBound);
    const log = resolveCombat(doubled, buildBoard([{ cardId: 'corsairs_deckhand', count: 3 }]), 'partA:sane');
    const end = log[log.length - 1] as Extract<CombatEvent, { t: 'combatEnd' }>;
    expect(end.t).toBe('combatEnd');
  });

  it('A7 gem economy determinism — same roster + turns → identical purchased compounding, twice', () => {
    const a = find(assembleGrown(ALL_IN, 20), 'tuskers_gemtitan');
    const b = find(assembleGrown(ALL_IN, 20), 'tuskers_gemtitan');
    expect([a.atk, a.hp]).toEqual([b.atk, b.hp]);
  });
});

// The sinks' place in the web: the ONLY gem→gold bridge is Gemwright and it is one-way — asserted
// at the engine interface in shared/engine/activated.test.ts (EV-ABL); this file pins the LINE.
