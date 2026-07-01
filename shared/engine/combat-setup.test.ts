// EVALS.md Group A — Combat setup & attack loop (interface: COMBAT).
// Property tests written to the DECIDED intent (design-spec §7.1–7.2, §7.5). Black-box over
// the CombatEvent[] stream. The engine is regenerated in parallel; these run in integration.
import { describe, it, expect } from 'vitest';
import {
  resolveCombat,
  getCard,
  combat as combatCfg,
  engines,
  type CombatUnit,
  type CombatBoard,
  type CombatEvent,
} from '@cardgame/shared';

// ── LOCAL fixture helpers (kept in-file per the eval-authoring contract) ──────────
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
const SEED = 'seed-alpha';

describe('EV-CMB — combat setup & attack loop', () => {
  it('EV-CMB-01: first event is combatStart with both snapshots; inputs are not mutated (purity)', () => {
    const a = board([cu('reefkin_coralwarden')]); // battlecry-only body: inert in combat
    const b = board([cu('corsairs_ironclad')]);
    const aBefore = structuredClone(a);
    const bBefore = structuredClone(b);

    const evs = resolveCombat(a, b, SEED);

    expect(evs[0].t).toBe('combatStart');
    const start = evs[0] as Extract<CombatEvent, { t: 'combatStart' }>;
    expect(start.a.units.length).toBe(1);
    expect(start.b.units.length).toBe(1);
    expect(start.a.units[0].uid).toBe(a.units[0].uid);
    // snapshot isolation: the input CombatBoards are untouched after the pure call
    expect(a).toEqual(aBefore);
    expect(b).toEqual(bBefore);
  });

  it('EV-CMB-02: startOfCombat effects fire A-then-B, left→right (event order)', () => {
    // Cinderling (startOfCombat: take 1 self-damage, then +atk) emits a self-targeted
    // `damage` event, giving each startOfCombat body a legible ordered marker.
    const a0 = cu('infernals_cinderling');
    const a1 = cu('infernals_cinderling');
    const b0 = cu('infernals_cinderling');
    const evs = resolveCombat(board([a0, a1]), board([b0]), SEED);

    // Only look before the attack loop begins.
    const firstAttackIdx = evs.findIndex((e) => e.t === 'attack');
    const pre = firstAttackIdx === -1 ? evs : evs.slice(0, firstAttackIdx);
    const selfHits = byType(pre, 'damage').filter((e) => e.sourceId === e.targetId);
    expect(selfHits.map((e) => e.sourceId)).toEqual([a0.uid, a1.uid, b0.uid]);
  });

  it('EV-CMB-03a: the side with more minions attacks first', () => {
    const a = board([cu('corsairs_ironclad', { keywords: [], effects: [] }), cu('corsairs_ironclad', { keywords: [], effects: [] })]);
    const b = board([cu('corsairs_ironclad', { keywords: [], effects: [] })]);
    const evs = resolveCombat(a, b, SEED);
    expect(byType(evs, 'attack')[0].side).toBe('a');
  });

  it('EV-CMB-03b: on an equal-count tie the first attacker is a seeded coin flip (seed-dependent, stable per seed)', () => {
    const mk = () =>
      [board([cu('corsairs_ironclad', { keywords: [], effects: [] })]), board([cu('corsairs_ironclad', { keywords: [], effects: [] })])] as const;
    const firstSide = (seed: string) => {
      const [a, b] = mk();
      return byType(resolveCombat(a, b, seed), 'attack')[0].side;
    };
    const seeds = Array.from({ length: 24 }, (_, i) => `tie-${i}`);
    const sides = seeds.map(firstSide);
    // stable per seed
    for (const s of seeds) expect(firstSide(s)).toBe(firstSide(s));
    // seed-dependent: across seeds BOTH outcomes occur (it is a real rng.bool coin, not fixed)
    expect(sides).toContain('a');
    expect(sides).toContain('b');
  });

  it('EV-CMB-04: first-attacker count is taken AFTER step-3 start-of-combat deaths (outcome-affecting)', () => {
    // A starts with 2 (== B). Hollow Priest destroys its 1/1 ally at start of combat, so A
    // drops to 1 < B's 2. Pre-death rule would tie (coin); post-death rule gives B first.
    const a = board([cu('infernals_hollowpriest'), cu('wildkin_thornpup')]);
    const b = board([
      cu('corsairs_ironclad', { keywords: [], effects: [] }),
      cu('corsairs_ironclad', { keywords: [], effects: [] }),
    ]);
    const evs = resolveCombat(a, b, SEED);
    expect(byType(evs, 'attack')[0].side).toBe('b');
  });

  it('EV-CMB-05: the attack pointer advances left→right and wraps; each unit acts in order', () => {
    // atk 1 / hp huge so nobody dies: the pointer sequence is observable cleanly.
    const A = ['x', 'y', 'z'].map(() => cu('corsairs_ironclad', { keywords: [], effects: [], atk: 1, hp: 100000 }));
    const B = ['x', 'y', 'z'].map(() => cu('corsairs_ironclad', { keywords: [], effects: [], atk: 1, hp: 100000 }));
    const evs = resolveCombat(board(A), board(B), SEED);
    const aAttackers = byType(evs, 'attack')
      .filter((e) => e.side === 'a')
      .map((e) => e.attackerId);
    expect(aAttackers.slice(0, 3)).toEqual([A[0].uid, A[1].uid, A[2].uid]);
    expect(aAttackers[3]).toBe(A[0].uid); // wraps to the front
  });

  it('EV-CMB-06a: a decisive board yields a winner when the other side is emptied', () => {
    const a = board([cu('corsairs_ironclad', { keywords: [], effects: [], atk: 100, hp: 100 })]);
    const b = board([cu('corsairs_ironclad', { keywords: [], effects: [], atk: 1, hp: 1 })]);
    const end = byType(resolveCombat(a, b, SEED), 'combatEnd')[0];
    expect(end.winner).toBe('a');
  });

  it('EV-CMB-06b: mutual clear (both sides emptied) is a tie', () => {
    const a = board([cu('corsairs_ironclad', { keywords: [], effects: [], atk: 5, hp: 1 })]);
    const b = board([cu('corsairs_ironclad', { keywords: [], effects: [], atk: 5, hp: 1 })]);
    const end = byType(resolveCombat(a, b, SEED), 'combatEnd')[0];
    expect(end.winner).toBe('tie');
  });

  it('EV-CMB-06c: two unkillable boards tie at the maxCombatSteps cap (400)', () => {
    expect(combatCfg.maxCombatSteps).toBe(400); // pin the config number the eval names
    const a = board([cu('corsairs_ironclad', { keywords: [], effects: [], atk: 0, hp: 100000 })]);
    const b = board([cu('corsairs_ironclad', { keywords: [], effects: [], atk: 0, hp: 100000 })]);
    const end = byType(resolveCombat(a, b, SEED), 'combatEnd')[0];
    expect(end.winner).toBe('tie');
  });

  it('EV-CMB-07: 1v1 no keywords — attacker deals atk, defender retaliates atk, both damage events emitted', () => {
    const a = board([cu('corsairs_ironclad', { keywords: [], effects: [], atk: 3, hp: 20 })]);
    const b = board([cu('corsairs_ironclad', { keywords: [], effects: [], atk: 2, hp: 20 })]);
    const evs = resolveCombat(a, b, SEED);
    const atk0 = byType(evs, 'attack')[0];
    const attacker = atk0.side === 'a' ? a.units[0] : b.units[0];
    const defender = atk0.side === 'a' ? b.units[0] : a.units[0];
    const dmgs = byType(evs, 'damage');
    expect(dmgs.some((d) => d.sourceId === attacker.uid && d.targetId === defender.uid && d.amount === attacker.atk)).toBe(true);
    expect(dmgs.some((d) => d.sourceId === defender.uid && d.targetId === attacker.uid && d.amount === defender.atk)).toBe(true);
  });

  it('EV-CMB-08: revenant damage is scaled by the tribe damageMultiplier read from the live counter at strike (Pale Lich)', () => {
    const amp = engines.revenants.undeadDamageAmp; // 2 (== min(amp, ampCap))
    const lich = cu('revenants_palelich'); // 4/6 revenant, damageMultiplier aura activeWhen revenantDeaths>=3
    // 3 non-reborn revenant chaff to feed revenantDeaths, plus a single durable enemy body.
    const chaff = [cu('revenants_wisp'), cu('revenants_wisp'), cu('revenants_wisp')];
    const a = board([chaff[0], chaff[1], chaff[2], lich]);
    const b = board([cu('corsairs_ironclad', { keywords: [], effects: [], atk: 6, hp: 9999 })]);
    const evs = resolveCombat(a, b, SEED);

    const revUids = new Set(
      byType(evs, 'combatStart')[0].a.units.filter((u) => u.tribe === 'revenants' && u.uid !== lich.uid).map((u) => u.uid),
    );
    // index at which the 3rd revenant death has occurred (amp becomes active)
    let seen = 0;
    let ampActiveIdx = -1;
    evs.forEach((e, i) => {
      if (e.t === 'death' && revUids.has(e.unitId)) {
        seen += 1;
        if (seen === engines.revenants.undeadDamageThreshold) ampActiveIdx = i;
      }
    });
    expect(ampActiveIdx).toBeGreaterThanOrEqual(0); // the fixture does reach the breakpoint

    const lichHits = evs
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => e.t === 'damage' && (e as Extract<CombatEvent, { t: 'damage' }>).sourceId === lich.uid);
    for (const { e, i } of lichHits) {
      const amount = (e as Extract<CombatEvent, { t: 'damage' }>).amount;
      if (i > ampActiveIdx) expect(amount).toBe(lich.atk * amp); // doubled once active
      else expect(amount).toBe(lich.atk); // unscaled before the breakpoint
    }
  });

  it('EV-CMB-09: combatEnd winner/survivors/damageToLoser agree with the final event-stream board state', () => {
    const a = board(
      [cu('corsairs_ironclad', { keywords: [], effects: [], atk: 50, hp: 50 }), cu('corsairs_ironclad', { keywords: [], effects: [], atk: 50, hp: 50 })],
      2,
    );
    const b = board([cu('corsairs_ironclad', { keywords: [], effects: [], atk: 1, hp: 1 })]);
    const evs = resolveCombat(a, b, SEED);
    const end = byType(evs, 'combatEnd')[0];
    const deaths = new Set(byType(evs, 'death').map((e) => e.unitId));

    expect(end.winner).toBe('a');
    // every loser (side b) unit died; the winner's survivors are exactly the still-living side-a uids
    for (const u of b.units) expect(deaths.has(u.uid)).toBe(true);
    const aliveA = a.units.filter((u) => !deaths.has(u.uid)).map((u) => u.uid);
    expect([...end.survivors].sort()).toEqual([...aliveA].sort());
    expect(typeof end.damageToLoser).toBe('number');
    expect(end.damageToLoser).toBeGreaterThanOrEqual(0);
  });
});
