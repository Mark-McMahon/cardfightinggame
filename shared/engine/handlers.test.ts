// EVALS.md Group E — Custom handlers (interface: COMBAT) + EV-ACT-CUST dispatch.
// The two shipped handlers: replayAdjacentDeathrattle (Bonepiper), primeNextDeathrattleDouble
// (Pallbearer). Design-spec §6.5, §6.9.
import { describe, it, expect } from 'vitest';
import {
  resolveCombat,
  getCard,
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
const SEED = 'seed-hnd';
const vanilla = (atk: number, hp: number, o: Partial<CombatUnit> = {}) =>
  cu('corsairs_ironclad', { keywords: [], effects: [], atk, hp, ...o });

describe('EV-HND / EV-ACT-CUST — custom handlers', () => {
  it('EV-HND-01: Bonepiper re-fires an ADJACENT friendly deathrattle each attack, without that unit dying', () => {
    const farDr = cu('revenants_graverobber', { atk: 0, hp: 100000 }); // slot0 — NOT adjacent to Bonepiper
    const adjDr = cu('revenants_tombspawn', { atk: 0, hp: 100000 }); // slot1 — adjacent
    const piper = cu('wildkin_bonepiper', { atk: 3, hp: 100000 }); // slot2
    const a = board([farDr, adjDr, piper]);
    const b = board([vanilla(0, 100000)]);
    const evs = resolveCombat(a, b, SEED);

    expect(byType(evs, 'deathrattle').some((e) => e.unitId === adjDr.uid)).toBe(true); // adjacent replayed
    expect(byType(evs, 'death').some((e) => e.unitId === adjDr.uid)).toBe(false); // without dying
    expect(byType(evs, 'summon').some((e) => e.ownerId === adjDr.uid && e.unitIds.length === 2)).toBe(true); // its payload ran
    expect(byType(evs, 'deathrattle').some((e) => e.unitId === farDr.uid)).toBe(false); // scope = adjacent only
  });

  it('EV-HND-02: Pallbearer arms a one-shot double honored by the very next dier (see EV-DTH-03)', () => {
    const pall = cu('revenants_pallbearer', { atk: 0, hp: 3 });
    const tomb1 = cu('revenants_tombspawn', { keywords: ['taunt'], atk: 0, hp: 3 }); // cleave center → dies with pall
    const tomb2 = cu('revenants_tombspawn', { atk: 0, hp: 3 });
    const cleaver = cu('primordials_gustling', { keywords: ['cleave'], effects: [], atk: 5, hp: 100000 });
    const b = board([cleaver, vanilla(0, 100000), vanilla(0, 100000), vanilla(0, 100000)]); // B attacks first
    const evs = resolveCombat(board([pall, tomb1, tomb2]), b, SEED);
    const drCount = (uid: string) => byType(evs, 'deathrattle').filter((e) => e.unitId === uid).length;
    expect(drCount(tomb1.uid)).toBe(2); // primed dier doubled
    expect(drCount(tomb2.uid)).toBe(1); // one-shot: flag cleared
  });

  it('EV-HND-03: both handlers on one board produce byte-identical CombatEvent[] across runs (fixed seed)', () => {
    const mk = () => {
      __uid = 0; // reset so both builds mint identical uids
      const piper = cu('wildkin_bonepiper', { atk: 3, hp: 100 });
      const tomb = cu('revenants_tombspawn', { atk: 2, hp: 3 });
      const pall = cu('revenants_pallbearer', { atk: 2, hp: 2 });
      const a = board([tomb, piper, pall]);
      const b = board([vanilla(3, 4), vanilla(2, 5), vanilla(4, 3)]); // RNG-driven defender picks
      return [a, b] as const;
    };
    const [a1, b1] = mk();
    const run1 = resolveCombat(a1, b1, 'hnd-fixed');
    const [a2, b2] = mk();
    const run2 = resolveCombat(a2, b2, 'hnd-fixed');
    expect(run2).toEqual(run1);
  });

  it('EV-ACT-CUST: a known custom handlerId dispatches; an unknown handlerId is a hard error', () => {
    // known dispatch is exercised by EV-HND-01 (Bonepiper) — assert the replay happened as dispatch proof
    const tomb = cu('revenants_tombspawn', { atk: 0, hp: 100000 });
    const piper = cu('wildkin_bonepiper', { atk: 3, hp: 100000 });
    const okEvs = resolveCombat(board([tomb, piper]), board([vanilla(0, 100000)]), SEED);
    expect(byType(okEvs, 'deathrattle').some((e) => e.unitId === tomb.uid)).toBe(true);

    // unknown handler → the engine must throw (no silent skip)
    const bad = cu('corsairs_ironclad', {
      keywords: [],
      atk: 3,
      hp: 10,
      effects: [{ trigger: { type: 'onAttack' }, target: { selector: 'self' }, actions: [{ type: 'custom', handlerId: 'doesNotExistHandler' }] }],
    });
    const a = board([bad, vanilla(0, 100000)]); // A attacks first (2 > 1) → bad swings → dispatch
    expect(() => resolveCombat(a, board([vanilla(0, 100000)]), SEED)).toThrow();
  });
});
