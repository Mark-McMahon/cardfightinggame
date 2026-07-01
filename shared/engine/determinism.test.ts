// EVALS.md Group K + determinism invariants (interface: COMBAT).
// D4: determinism is a PROPERTY — same (boards, seed) → byte-identical log WITHIN this
// implementation; cross-impl byte-identity is NOT required. EV-GLD-* are intra-impl regression
// goldens: run resolveCombat twice on a fixed (boards, seed) and assert deep-equality.
//
// TODO (post-engine, per D4): once the corrected engine exists, capture each scenario's reference
// CombatEvent[] as a committed snapshot to also lock byte drift. These live tests already pin
// intra-run determinism; the snapshots would additionally freeze the exact draw order.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
const vanilla = (atk: number, hp: number, o: Partial<CombatUnit> = {}) =>
  cu('corsairs_ironclad', { keywords: [], effects: [], atk, hp, ...o });

// Each golden builds its boards ONCE and resolves twice on the SAME inputs (purity is asserted by
// EV-CMB-01) → identical seeds + identical uids → the two logs must be byte-identical.
const goldens: Record<string, () => { a: CombatBoard; b: CombatBoard; seed: string }> = {
  'EV-GLD-01 swarm mirror': () => ({
    a: board([cu('wildkin_gorehide'), ...Array.from({ length: 4 }, () => cu('wildkin_thornpup'))]),
    b: board([cu('wildkin_gorehide'), ...Array.from({ length: 4 }, () => cu('wildkin_thornpup'))]),
    seed: 'gld-01',
  }),
  'EV-GLD-02 poison vs shield': () => ({
    a: board([cu('sirens_lurefish'), cu('sirens_tempestsinger'), cu('sirens_venomsong')]),
    b: board([cu('corsairs_ironclad'), cu('reefkin_pearlguard'), cu('constructs_bulwark')]),
    seed: 'gld-02',
  }),
  'EV-GLD-03 reborn chain': () => ({
    a: board([cu('revenants_cryptling'), cu('corsairs_swab'), cu('revenants_gravewing'), cu('revenants_dirgecaller')]),
    b: board([vanilla(4, 3), vanilla(3, 4), vanilla(5, 2)]),
    seed: 'gld-03',
  }),
  'EV-GLD-04 pale lich amp crossing': () => ({
    a: board([cu('revenants_wisp'), cu('revenants_wisp'), cu('revenants_wisp'), cu('revenants_graverobber', { atk: 4 }), cu('revenants_palelich')]),
    b: board([cu('primordials_gustling', { atk: 5, hp: 40, keywords: ['cleave'] })]),
    seed: 'gld-04',
  }),
  'EV-GLD-05 tusker doubler carry': () => ({
    a: board([cu('tuskers_gemtitan', { atk: 64, hp: 64 }), cu('tuskers_grubtusk')]),
    b: board([cu('sirens_lurefish'), cu('sirens_tempestsinger'), vanilla(3, 6)]),
    seed: 'gld-05',
  }),
  'EV-GLD-06 cleave with neighbors': () => ({
    a: board([cu('primordials_cinderwing', { keywords: ['cleave'] })]),
    b: board([vanilla(1, 8), cu('corsairs_ironclad', { keywords: ['taunt'], effects: [] }), vanilla(1, 8)]),
    seed: 'gld-06',
  }),
  'EV-GLD-07 bonepiper replay': () => ({
    a: board([cu('revenants_tombspawn'), cu('wildkin_bonepiper'), cu('revenants_graverobber')]),
    b: board([vanilla(2, 6), vanilla(3, 5)]),
    seed: 'gld-07',
  }),
  'EV-GLD-08 pallbearer double': () => ({
    a: board([cu('revenants_pallbearer', { hp: 3 }), cu('revenants_tombspawn', { keywords: ['taunt'], hp: 3 }), cu('revenants_tombspawn', { hp: 3 })]),
    b: board([cu('primordials_gustling', { atk: 5, hp: 100, keywords: ['cleave'] }), vanilla(0, 100), vanilla(0, 100), vanilla(0, 100)]),
    seed: 'gld-08',
  }),
};

describe('EV-GLD — intra-impl determinism goldens (D4)', () => {
  for (const [id, mk] of Object.entries(goldens)) {
    it(`${id}: two runs on the fixed (boards, seed) are byte-identical`, () => {
      const { a, b, seed } = mk();
      const run1 = resolveCombat(a, b, seed);
      const run2 = resolveCombat(a, b, seed);
      expect(run2).toEqual(run1);
      expect(byType(run1, 'combatEnd').length).toBe(1); // and it is a complete, real fight
    });
  }
});

describe('EV-INV-DET / EV-INV-DET-SEED — determinism invariants', () => {
  it('EV-INV-DET: same (boards, seed) across N runs → identical CombatEvent[] every time', () => {
    const mk = () =>
      [
        board([cu('revenants_cryptling'), cu('wildkin_bonepiper'), cu('revenants_tombspawn'), cu('sirens_lurefish')]),
        board([vanilla(3, 5), cu('corsairs_ironclad'), vanilla(4, 4), cu('reefkin_pearlguard')]),
      ] as const;
    const [a, b] = mk();
    const first = resolveCombat(a, b, 'inv-det');
    for (let i = 0; i < 5; i++) expect(resolveCombat(a, b, 'inv-det')).toEqual(first);
  });

  it('EV-INV-DET-SEED: different seeds may diverge, and no combat randomness uses Math.random', () => {
    // (a) property: RNG-dependent choices are seed-driven → across seeds the outcome varies
    const mk = () => [board([vanilla(3, 3)]), board([vanilla(3, 3)])] as const;
    const firstSide = (seed: string) => {
      const [a, b] = mk();
      return byType(resolveCombat(a, b, seed), 'attack')[0]?.side;
    };
    const sides = new Set(Array.from({ length: 24 }, (_, i) => firstSide(`seed-${i}`)));
    expect(sides.size).toBeGreaterThan(1); // seed-dependent (a real seeded coin, not fixed)

    // (b) source lint: the engine draws only from the seeded PRNG — never Math.random
    const dir = fileURLToPath(new URL('.', import.meta.url)); // shared/engine
    if (existsSync(dir)) {
      const srcs = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
      for (const f of srcs) {
        const text = readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');
        expect(text.includes('Math.random')).toBe(false);
      }
    }
  });
});
