// EVALS.md — Phase 4 POSITIONAL mechanics (interface: COMBAT). Two first-class additions:
//   • EV-AUR-06 — the `leftmost` positional aura (Vanguard Pennant, §6.4): the LEFTMOST friendly
//     gets +attack, read LIVE at strike time, so it recomputes on the leftmost's death for free.
//   • EV-ADJ-01 — the `adjacentAllies` selector (Last Rites Drummer, §6.3/§7.3): a deathrattle
//     grants Reborn to EXACTLY the board-index ±1 neighbors, against the SETTLED board (D1 batch).
// Byte-stable determinism for both is pinned by EV-GLD-13/14 (determinism.test.ts).
import { describe, it, expect } from 'vitest';
import {
  resolveCombat,
  getCard,
  engines,
  leftmostAttackBonus,
  type CombatUnit,
  type CombatBoard,
  type CombatEvent,
} from '@cardgame/shared';

let __uid = 0;
function cu(cardId: string, overrides: Partial<CombatUnit> = {}): CombatUnit {
  const c = getCard(cardId);
  return {
    uid: `${cardId}#${++__uid}`,
    cardId,
    name: c.name,
    tribe: c.tribe,
    tier: c.tier,
    atk: c.atk,
    hp: c.hp,
    keywords: [...c.keywords],
    golden: false,
    isToken: !!c.isToken,
    effects: c.effects,
    auras: c.auras ?? [],
    ...overrides,
  };
}
function board(units: CombatUnit[], playerTier = 1): CombatBoard {
  return { units, playerTier };
}
function byType<T extends CombatEvent['t']>(evs: CombatEvent[], t: T) {
  return evs.filter((e): e is Extract<CombatEvent, { t: T }> => e.t === t);
}
const vanilla = (atk: number, hp: number, o: Partial<CombatUnit> = {}) =>
  cu('corsairs_ironclad', { keywords: [], effects: [], atk, hp, ...o });
const SEED = 'seed-pos';
const BUFF = engines.corsairs.leftmostAttackBuff; // 2

describe('EV-AUR-06 — Vanguard Pennant positional `leftmost` aura (COMBAT)', () => {
  it('the aura query returns the side-wide bonus, capped', () => {
    const pennant = cu('corsairs_pennant');
    expect(leftmostAttackBonus([{ tribe: pennant.tribe, auras: pennant.auras }])).toBe(BUFF);
    // stacked pennants sum, capped at leftmostAttackBuffCap
    const two = [pennant, pennant].map((p) => ({ tribe: p.tribe, auras: p.auras }));
    expect(leftmostAttackBonus(two)).toBe(Math.min(BUFF * 2, engines.corsairs.leftmostAttackBuffCap));
    expect(leftmostAttackBonus([])).toBe(0);
  });

  it('EV-AUR-06: the LEFTMOST friendly strikes for +buff attack; a non-leftmost does not', () => {
    const front = vanilla(3, 100000);
    const pennant = cu('corsairs_pennant');
    const wall = vanilla(0, 100000);
    const evs = resolveCombat(board([front, pennant]), board([wall]), SEED);
    const fromFront = byType(evs, 'damage').filter((e) => e.sourceId === front.uid).map((e) => e.amount);
    expect(fromFront).toContain(3 + BUFF); // leftmost bonus folded into the strike
    expect(fromFront).not.toContain(3); // never strikes for the un-buffed base while leftmost

    // contrast: WITHOUT a pennant on board, the same front strikes for its printed atk
    const front2 = vanilla(3, 100000);
    const evs2 = resolveCombat(board([front2, vanilla(1, 100000)]), board([vanilla(0, 100000)]), SEED);
    const fromFront2 = byType(evs2, 'damage').filter((e) => e.sourceId === front2.uid).map((e) => e.amount);
    expect(fromFront2).toContain(3);
    expect(fromFront2).not.toContain(3 + BUFF);
  });

  it('EV-AUR-06: the bonus RECOMPUTES on the leftmost’s death — it moves to the new front unit', () => {
    const front = vanilla(3, 1); // dies to the enemy’s retaliation after it strikes
    const second = vanilla(4, 100000); // becomes leftmost once `front` dies
    const pennant = cu('corsairs_pennant', { hp: 100000 }); // survives so the aura persists all fight
    const killer = vanilla(5, 100000); // one big body: single-candidate targeting → deterministic
    const evs = resolveCombat(board([front, second, pennant]), board([killer]), SEED);
    const amounts = (uid: string) => byType(evs, 'damage').filter((e) => e.sourceId === uid).map((e) => e.amount);
    expect(amounts(front.uid)).toContain(3 + BUFF); // front was leftmost → +buff
    expect(byType(evs, 'death').some((e) => e.unitId === front.uid)).toBe(true); // and it died
    expect(amounts(second.uid)).toContain(4 + BUFF); // the bonus MOVED to the new leftmost
  });
});

describe('EV-ADJ-01 — Last Rites Drummer `adjacentAllies` deathrattle (COMBAT)', () => {
  it('EV-ADJ-01: exactly the board-index ±1 neighbors gain Reborn (settled board, D1); a non-neighbor does not', () => {
    const left = vanilla(0, 100000);
    const drummer = cu('revenants_lastrites', { keywords: ['taunt'], atk: 0, hp: 1 }); // taunt → killer targets it; dies
    const right = vanilla(0, 100000);
    const far = vanilla(0, 100000);
    const killer = vanilla(50, 100000);
    const evs = resolveCombat(board([left, drummer, right, far]), board([killer]), SEED);
    expect(byType(evs, 'death').some((e) => e.unitId === drummer.uid)).toBe(true);
    const gainedReborn = (uid: string) =>
      byType(evs, 'keyword').some((e) => e.unitId === uid && e.keyword === 'reborn' && e.gained === true);
    expect(gainedReborn(left.uid)).toBe(true); // index-1 neighbor
    expect(gainedReborn(right.uid)).toBe(true); // index+1 neighbor
    expect(gainedReborn(far.uid)).toBe(false); // two slots away → NOT adjacent
  });
});
