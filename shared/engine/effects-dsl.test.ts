// EVALS.md Group D — Effect-DSL semantics: selectors, actions, conditions (interface: COMBAT).
// Written to intent (design-spec §6.3, §6.8, §6.9, §7). Aura evals live in auras.test.ts; the
// custom-handler action (EV-ACT-CUST) lives in handlers.test.ts.
import { describe, it, expect } from 'vitest';
import {
  resolveCombat,
  getCard,
  engines,
  type CombatUnit,
  type CombatBoard,
  type CombatEvent,
  type Effect,
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
const SEED = 'seed-dsl';
const vanilla = (atk: number, hp: number, o: Partial<CombatUnit> = {}) =>
  cu('corsairs_ironclad', { keywords: [], effects: [], atk, hp, ...o });
const passiveB = () => board([vanilla(0, 100000)]);
const priest = (o: Partial<CombatUnit> = {}) => cu('infernals_hollowpriest', { hp: 100, atk: 3, ...o });

describe('EV-SEL — selectors', () => {
  it('EV-SEL-01: highest/lowest tie → earliest board slot; omitted stat defaults to hp', () => {
    // (a) tie on atk → earliest slot destroyed (Hollow Priest: lowestStatAlly by atk)
    const tieA = vanilla(1, 5);
    const tieB = vanilla(1, 9);
    const evsA = resolveCombat(board([priest(), tieA, tieB]), passiveB(), SEED);
    const deadA = new Set(byType(evsA, 'death').map((e) => e.unitId));
    expect(deadA.has(tieA.uid)).toBe(true);
    expect(deadA.has(tieB.uid)).toBe(false);

    // (b) omitted `stat` on lowestStatAlly defaults to HP: destroys the low-HP unit even though its atk is high
    const destroyLowest: Effect = {
      trigger: { type: 'startOfCombat' },
      target: { selector: 'lowestStatAlly', excludeSelf: true }, // no stat → defaults to hp
      actions: [{ type: 'destroy' }],
    };
    const lowHp = vanilla(9, 1);
    const highHp = vanilla(1, 9);
    const src = vanilla(5, 100, { effects: [destroyLowest] });
    const evsB = resolveCombat(board([src, lowHp, highHp]), passiveB(), SEED);
    const deadB = new Set(byType(evsB, 'death').map((e) => e.unitId));
    expect(deadB.has(lowHp.uid)).toBe(true); // hp default picked the low-HP body
    expect(deadB.has(highHp.uid)).toBe(false);
  });

  it('EV-SEL-02: a chosenAlly-carrying unit requires no combat input — combat stays pure & completes', () => {
    const withChosen = cu('reefkin_tidecaller'); // battlecry: chosenAlly (shop-resolved only)
    const a = board([withChosen, vanilla(2, 10)]);
    const b = board([vanilla(2, 10)]);
    const evs = resolveCombat(a, b, SEED);
    expect(byType(evs, 'combatEnd').length).toBe(1); // no target prompt needed → it just resolves
    // pure: re-running the same (boards, seed) yields the identical stream (no hidden input)
    expect(resolveCombat(a, b, SEED)).toEqual(evs);
  });

  it('EV-SEL-03: filterTribe / filterKeyword / excludeSelf are honored exactly', () => {
    // filterTribe + excludeSelf: Graverobber deathrattle buffs revenant allies only, not self
    const grave = cu('revenants_graverobber', { atk: 0, hp: 1 });
    const rev = cu('revenants_wisp', { atk: 5, hp: 5 });
    const nonRev = vanilla(5, 5); // corsair
    const evs = resolveCombat(board([grave, rev, nonRev, priest()]), passiveB(), SEED);
    const stats = byType(evs, 'stats');
    expect(stats.some((e) => e.unitId === rev.uid && e.atk === 6 && e.hp === 6)).toBe(true); // revenant buffed
    expect(stats.some((e) => e.unitId === nonRev.uid && (e.atk > 5 || e.hp > 5))).toBe(false); // non-revenant untouched
    expect(stats.some((e) => e.unitId === grave.uid && (e.atk > 0 || e.hp > 1))).toBe(false); // self excluded

    // filterKeyword: buff only taunt allies
    const buffTaunts: Effect = {
      trigger: { type: 'startOfCombat' },
      target: { selector: 'allAllies', filterKeyword: 'taunt' },
      actions: [{ type: 'buffStats', atk: 1, hp: 1 }],
    };
    const src = vanilla(5, 100, { effects: [buffTaunts] });
    const tauntU = vanilla(2, 5, { keywords: ['taunt'] });
    const plain = vanilla(2, 5);
    const evs2 = resolveCombat(board([src, tauntU, plain]), passiveB(), SEED);
    const stats2 = byType(evs2, 'stats');
    expect(stats2.some((e) => e.unitId === tauntU.uid && e.atk === 3 && e.hp === 6)).toBe(true);
    expect(stats2.some((e) => e.unitId === plain.uid && (e.atk > 2 || e.hp > 5))).toBe(false);
  });

  it('EV-SEL-04: randomAlly draws deterministically per seed and varies across seeds', () => {
    // Spinefish deathrattle: grant a random OTHER ally Poison → observable `keyword` event target.
    const chosenFor = (seed: string) => {
      __uid = 0; // identical uids across builds → same seed picks the same uid; seeds differ by draw only
      const spine = cu('reefkin_spinefish', { atk: 0, hp: 1 });
      const a1 = vanilla(5, 5);
      const a2 = vanilla(5, 5);
      const a3 = vanilla(5, 5);
      const evs = resolveCombat(board([spine, a1, a2, a3, priest()]), passiveB(), seed);
      return byType(evs, 'keyword').find((e) => e.keyword === 'poison' && e.gained)?.unitId;
    };
    const seeds = Array.from({ length: 20 }, (_, i) => `sel4-${i}`);
    for (const s of seeds) expect(chosenFor(s)).toBe(chosenFor(s)); // deterministic per seed
    expect(new Set(seeds.map(chosenFor)).size).toBeGreaterThan(1); // seed-dependent (real rng.shuffle draw)
  });

  it('EV-SEL-05: highestStatEnemy picks the biggest enemy by stat=atk (Nullforge)', () => {
    const giant = cu('tuskers_gemtitan', { atk: 999, hp: 999 }); // base 8/8
    const b = board([vanilla(2, 5), giant, vanilla(3, 5)]);
    const evs = resolveCombat(board([cu('constructs_nullforge')]), b, SEED);
    const base = getCard('tuskers_gemtitan');
    // resetToBase strips the giant to its printed atk
    expect(byType(evs, 'stats').some((e) => e.unitId === giant.uid && e.atk === base.atk)).toBe(true);
  });

  it('EV-SEL-06: frontEnemy is the enemy at the front slot (Sirenling burst)', () => {
    const front = vanilla(0, 100);
    const b = board([front, vanilla(0, 100), vanilla(0, 100)]);
    const evs = resolveCombat(board([cu('sirens_sirenling')]), b, SEED);
    expect(byType(evs, 'damage').some((e) => e.targetId === front.uid && e.amount === engines.sirens.burstDamage)).toBe(true);
  });
});

describe('EV-ACT — actions', () => {
  it('EV-ACT-BUFF: buffStats floors atk at 0 and hp at 1, rounds; combat buffs are combat-only unless flagged permanent (then the event carries permanent:true + the fold delta, §7.5 / decision #38)', () => {
    // (a) clamps + the DEFAULT: an unflagged (or permanent:false) combat buff emits NO
    // permanence marker — it stays this-combat-only and the §7.5 writeback fold ignores it.
    // (This knowingly REWRITES the pre-#38 pin "combat-fired stat changes are never written
    // back": the writeback gap is closed; permanence is now opt-in per ActionSpec.)
    const bigDebuff: Effect = {
      trigger: { type: 'startOfCombat' },
      target: { selector: 'self' },
      actions: [{ type: 'buffStats', atk: -100, hp: -100 }],
    };
    const u = vanilla(5, 5, { effects: [bigDebuff] });
    const evs = resolveCombat(board([u]), passiveB(), SEED);
    const s = byType(evs, 'stats').find((e) => e.unitId === u.uid);
    expect(s).toBeTruthy();
    expect(s!.atk).toBe(0); // floored at 0
    expect(s!.hp).toBe(1); // floored at 1
    expect(s!.permanent).toBeUndefined(); // default: no permanence marker, nothing to fold
    expect(s!.dAtk).toBeUndefined();
    expect(s!.dHp).toBeUndefined();

    // (b) a combat-fired buffStats with permanent:true emits permanent:true plus the
    // POST-CLAMP delta (dAtk/dHp) — the exact contribution the writeback fold replays.
    const permBuff: Effect = {
      trigger: { type: 'startOfCombat' },
      target: { selector: 'self' },
      actions: [{ type: 'buffStats', atk: 3, hp: 2, permanent: true }],
    };
    const p = vanilla(5, 5, { effects: [permBuff] });
    const evs2 = resolveCombat(board([p]), passiveB(), SEED);
    const sp = byType(evs2, 'stats').find((e) => e.unitId === p.uid);
    expect(sp).toBeTruthy();
    expect(sp!.permanent).toBe(true);
    expect(sp!.dAtk).toBe(3);
    expect(sp!.dHp).toBe(2);
    expect(sp!.atk).toBe(8); // absolutes still post-buff (replay unchanged)
    expect(sp!.hp).toBe(7);
  });

  it('EV-ACT-MUL: a combat-fired multiplyStats clamps the factor to multiplyFactorCap (both phases)', () => {
    const cap = engines.tuskers.multiplyFactorCap; // 2
    const bigMul: Effect = {
      trigger: { type: 'startOfCombat' },
      target: { selector: 'self' },
      actions: [{ type: 'multiplyStats', factor: 100 }], // clamped down to the cap
    };
    const u = vanilla(5, 5, { effects: [bigMul] });
    const evs = resolveCombat(board([u]), passiveB(), SEED);
    const s = byType(evs, 'stats').find((e) => e.unitId === u.uid);
    expect(s!.atk).toBe(5 * cap); // not 5 * 100
    expect(s!.atk).toBeLessThan(engines.tuskers.statSanityBound); // seatbelt never reached
  });

  it('EV-ACT-RST: resetToBase strips buffs down to the printed base stats (Nullforge)', () => {
    const giant = cu('tuskers_gemtitan', { atk: 999, hp: 999 });
    const base = getCard('tuskers_gemtitan');
    const evs = resolveCombat(board([cu('constructs_nullforge')]), board([giant]), SEED);
    const s = byType(evs, 'stats').find((e) => e.unitId === giant.uid);
    expect(s!.atk).toBe(base.atk);
    expect(s!.hp).toBe(base.hp);
  });

  it('EV-ACT-GK: grantKeyword adds the keyword and emits keyword{gained:true, sourceId}', () => {
    const spine = cu('reefkin_spinefish', { atk: 0, hp: 1 });
    const ally = vanilla(5, 5);
    const evs = resolveCombat(board([spine, ally, priest()]), passiveB(), SEED);
    const gained = byType(evs, 'keyword').find((e) => e.keyword === 'poison' && e.gained === true);
    expect(gained).toBeTruthy();
    expect(typeof gained!.sourceId).toBe('string'); // carries WHO granted it
  });

  it('EV-ACT-SUM: summon inserts unit(s) at the owner slot (Tombspawn deathrattle → 2 Grave Wisps)', () => {
    const tomb = cu('revenants_tombspawn', { atk: 0, hp: 1 });
    const evs = resolveCombat(board([tomb, priest()]), passiveB(), SEED);
    const sum = byType(evs, 'summon').find((e) => e.ownerId === tomb.uid);
    expect(sum).toBeTruthy();
    expect(sum!.unitIds.length).toBe(2);
    expect(typeof sum!.slot).toBe('number');
  });

  it('EV-ACT-DMG: dealDamage applies the exact amount as combat damage and can kill (Sirenling burst)', () => {
    const front = vanilla(0, 3); // dies to the 3-damage burst
    const evs = resolveCombat(board([cu('sirens_sirenling')]), board([front, vanilla(0, 100)]), SEED);
    expect(byType(evs, 'damage').some((e) => e.targetId === front.uid && e.amount === engines.sirens.burstDamage)).toBe(true);
    expect(byType(evs, 'death').some((e) => e.unitId === front.uid)).toBe(true);
  });

  it('EV-ACT-DESTROY (D11): destroy = friendly death + deathrattle, no combat damage, bypasses divine shield', () => {
    // (a) counts as a death and fires the target deathrattle; NOT combat damage
    const gravebrand = cu('infernals_gravebrand', { atk: 0, hp: 5 }); // deathrattle: allies +2 atk
    const evsA = resolveCombat(board([priest(), gravebrand]), passiveB(), SEED);
    expect(byType(evsA, 'death').some((e) => e.unitId === gravebrand.uid)).toBe(true);
    expect(byType(evsA, 'deathrattle').some((e) => e.unitId === gravebrand.uid)).toBe(true);
    expect(byType(evsA, 'damage').some((e) => e.targetId === gravebrand.uid)).toBe(false); // no damage event

    // (b) bypasses divine shield — a shielded target is destroyed, shield untouched
    const shielded = vanilla(0, 5, { keywords: ['divineShield'] });
    const evsB = resolveCombat(board([priest(), shielded]), passiveB(), SEED);
    expect(byType(evsB, 'death').some((e) => e.unitId === shielded.uid)).toBe(true);
    expect(byType(evsB, 'damage').some((e) => e.targetId === shielded.uid)).toBe(false);
    expect(byType(evsB, 'keyword').some((e) => e.unitId === shielded.uid)).toBe(false); // no shield-break interaction
  });

  it('EV-ACT-PLANT: a planted deathrattle fires on the host death in combat', () => {
    const planted: Effect = {
      trigger: { type: 'deathrattle' },
      target: { selector: 'allAllies', excludeSelf: true },
      actions: [{ type: 'buffStats', atk: engines.reefkin.plantedDeathrattleAtk, hp: engines.reefkin.plantedDeathrattleHp }],
    };
    const host = vanilla(0, 1, { effects: [planted] }); // carries the planted deathrattle into combat
    const witness = vanilla(5, 5);
    const evs = resolveCombat(board([host, witness, priest()]), passiveB(), SEED);
    expect(
      byType(evs, 'stats').some(
        (e) => e.unitId === witness.uid && e.atk === 5 + engines.reefkin.plantedDeathrattleAtk && e.hp === 5 + engines.reefkin.plantedDeathrattleHp,
      ),
    ).toBe(true);
  });
});

describe('EV-CND — conditions (combat-phase aspects)', () => {
  it('EV-CND-01: a wrong-phase (shop) counter reads 0/false silently in combat', () => {
    const gatedOnShopCounter: Effect = {
      trigger: { type: 'startOfCombat' },
      condition: { kind: 'battlecriesThisTurnAtLeast', value: 1 }, // shop counter → 0 in combat
      target: { selector: 'self' },
      actions: [{ type: 'buffStats', atk: 5 }],
    };
    const u = vanilla(5, 100, { effects: [gatedOnShopCounter] });
    const evs = resolveCombat(board([u]), passiveB(), SEED);
    expect(byType(evs, 'stats').some((e) => e.unitId === u.uid && e.atk > 5)).toBe(false);
  });

  it('EV-CND-02: a missing condition — and an unknown kind — evaluate true', () => {
    const noCond: Effect = { trigger: { type: 'startOfCombat' }, target: { selector: 'self' }, actions: [{ type: 'buffStats', atk: 5 }] };
    const u1 = vanilla(5, 100, { effects: [noCond] });
    const evs1 = resolveCombat(board([u1]), passiveB(), SEED);
    expect(byType(evs1, 'stats').some((e) => e.unitId === u1.uid && e.atk === 10)).toBe(true);

    const unknownCond = {
      trigger: { type: 'startOfCombat' },
      condition: { kind: 'someUnknownKind', value: 3 } as any,
      target: { selector: 'self' },
      actions: [{ type: 'buffStats', atk: 5 }],
    } as Effect;
    const u2 = vanilla(5, 100, { effects: [unknownCond] });
    const evs2 = resolveCombat(board([u2]), passiveB(), SEED);
    expect(byType(evs2, 'stats').some((e) => e.unitId === u2.uid && e.atk === 10)).toBe(true);
  });

  it('EV-CND-03: countAllies gates exactly at the boundary (threshold−1 off, threshold/threshold+1 on)', () => {
    const gated: Effect = {
      trigger: { type: 'startOfCombat' },
      condition: { kind: 'countAllies', value: 3 },
      target: { selector: 'self' },
      actions: [{ type: 'buffStats', atk: 5 }],
    };
    const fired = (allies: number) => {
      const src = vanilla(5, 100, { effects: [gated] });
      const fillers = Array.from({ length: allies - 1 }, () => vanilla(1, 100));
      const evs = resolveCombat(board([src, ...fillers]), passiveB(), SEED);
      return byType(evs, 'stats').some((e) => e.unitId === src.uid && e.atk > 5);
    };
    expect(fired(2)).toBe(false); // below
    expect(fired(3)).toBe(true); // at threshold
    expect(fired(4)).toBe(true); // above
  });

  it('EV-CND-03 (deaths): deathsThisCombatAtLeast gates exactly at the boundary (counter includes the host death)', () => {
    // host deathrattle gated on deathsThisCombatAtLeast:2 → buffs the witness. `prior` deaths are
    // manufactured by start-of-combat destroys BEFORE the host is destroyed last.
    const DESTROYERS = ['infernals_hollowpriest', 'infernals_pyrewalker', 'infernals_dreadmaw', 'sirens_maelstromcantor'];
    const gatedDr: Effect = {
      trigger: { type: 'deathrattle' },
      condition: { kind: 'deathsThisCombatAtLeast', value: 2 },
      target: { selector: 'allAllies', excludeSelf: true },
      actions: [{ type: 'buffStats', atk: 5, hp: 5 }],
    };
    const fired = (prior: number) => {
      const witness = vanilla(9, 100);
      const chaff = Array.from({ length: prior }, () => cu('wildkin_thornpup', { atk: 0, hp: 1 }));
      const host = vanilla(0, 1, { effects: [gatedDr] });
      const destroyers = DESTROYERS.slice(0, prior + 1).map((id) => cu(id, { hp: 100 }));
      const a = board([witness, ...chaff, host, ...destroyers]);
      const evs = resolveCombat(a, passiveB(), SEED);
      return byType(evs, 'stats').some((e) => e.unitId === witness.uid && e.atk > 9);
    };
    expect(fired(0)).toBe(false); // host death → count 1 < 2
    expect(fired(1)).toBe(true); // host death → count 2 == 2
    expect(fired(2)).toBe(true); // host death → count 3 > 2
  });
});
