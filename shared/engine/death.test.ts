// EVALS.md Group C — Death / deathrattle / summon / avenge (interface: COMBAT).
// Written to the DECIDED intent: D1 (simultaneous deaths / batch-before-deathrattle), D2
// (attacker-side-first cross-side order), D3 (no swing on self-kill), D11 (destroy = friendly
// death + deathrattle, bypasses shield). Design-spec §7.2–7.3, §6.8, §6.9. These are RED against
// the legacy engine by design; a CORRECT (decided-intent) engine makes them GREEN.
import { describe, it, expect } from 'vitest';
import {
  resolveCombat,
  getCard,
  engines,
  economy,
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
function idxOf(evs: CombatEvent[], pred: (e: CombatEvent) => boolean) {
  return evs.findIndex(pred);
}
const SEED = 'seed-dth';
const vanilla = (atk: number, hp: number, o: Partial<CombatUnit> = {}) =>
  cu('corsairs_ironclad', { keywords: [], effects: [], atk, hp, ...o });
const passiveB = () => board([vanilla(0, 100000)]);

// A deterministic "sacrifice cluster": n start-of-combat destroyers each destroy one 0-atk chaff
// (destroy targets lowestStatAlly by atk; ties → earliest slot). Yields exactly n friendly deaths
// during start-of-combat resolution, with no RNG.
const DESTROYERS = ['infernals_hollowpriest', 'infernals_pyrewalker', 'infernals_dreadmaw', 'sirens_maelstromcantor'];
function sacrificeCluster(n: number) {
  const chaff = Array.from({ length: n }, () => cu('wildkin_thornpup', { atk: 0, hp: 1 }));
  const destroyers = DESTROYERS.slice(0, n).map((id) => cu(id, { hp: 100 }));
  return { chaff, destroyers };
}

describe('EV-DTH — death / deathrattle / summon / avenge', () => {
  it('EV-DTH-01: a lethal hit emits death and removes the unit from the line', () => {
    const a = board([vanilla(50, 50)]);
    const b = board([vanilla(1, 1)]);
    const evs = resolveCombat(a, b, SEED);
    expect(byType(evs, 'death').some((e) => e.unitId === b.units[0].uid)).toBe(true);
    const end = byType(evs, 'combatEnd')[0];
    expect(end.survivors).not.toContain(b.units[0].uid);
  });

  it('EV-DTH-02: death counters increment BEFORE avenge reads them; destroy counts as a friendly death (D11)', () => {
    // Two start-of-combat destroys → deaths reach 2 → Pack Mother avenge (everyN 2) fires, so the
    // surviving witness board gains +2/+3. Firing at all proves the counter saw both destroyed bodies.
    const packmother = cu('wildkin_packmother', { atk: 9, hp: 100 });
    const witness = vanilla(9, 100); // receives only the avenge buff → a clean probe
    const { chaff, destroyers } = sacrificeCluster(2);
    const a = board([packmother, witness, ...chaff, ...destroyers]);
    const evs = resolveCombat(a, passiveB(), SEED);
    const buffed = byType(evs, 'stats').find(
      (e) => e.unitId === witness.uid && e.atk === witness.atk + engines.wildkin.avengePayoffAtk && e.hp === witness.hp + engines.wildkin.avengePayoffHp,
    );
    expect(buffed).toBeTruthy();
  });

  it('EV-DTH-03: Pallbearer primes the next dier to fire its deathrattle twice, then the flag clears', () => {
    // pallbearer(slot0), tombspawn1(slot1, taunt→cleave center), tombspawn2(slot2) all die in ONE
    // batch to B's cleaver. D1+D2: deathrattles resolve left→right → pallbearer primes, tombspawn1
    // (primed) fires twice, tombspawn2 fires once (flag cleared).
    const pall = cu('revenants_pallbearer', { atk: 0, hp: 3 });
    const tomb1 = cu('revenants_tombspawn', { keywords: ['taunt'], atk: 0, hp: 3 });
    const tomb2 = cu('revenants_tombspawn', { atk: 0, hp: 3 });
    const a = board([pall, tomb1, tomb2]);
    // B attacks first (4 > 3) and its front unit is the cleaver.
    const cleaver = cu('primordials_gustling', { keywords: ['cleave'], effects: [], atk: 5, hp: 100000 });
    const b = board([cleaver, vanilla(0, 100000), vanilla(0, 100000), vanilla(0, 100000)]);
    const evs = resolveCombat(a, b, SEED);
    const drCount = (uid: string) => byType(evs, 'deathrattle').filter((e) => e.unitId === uid).length;
    expect(drCount(pall.uid)).toBe(1);
    expect(drCount(tomb1.uid)).toBe(2); // primed → fires twice
    expect(drCount(tomb2.uid)).toBe(1); // flag cleared → once
  });

  it('EV-DTH-04a: avenge everyN gates at the threshold boundary (Pack Mother N=2)', () => {
    const run = (deaths: number) => {
      const witness = vanilla(9, 100);
      const { chaff, destroyers } = sacrificeCluster(deaths);
      const evs = resolveCombat(board([cu('wildkin_packmother', { atk: 9, hp: 100 }), witness, ...chaff, ...destroyers]), passiveB(), SEED);
      return byType(evs, 'stats').filter((e) => e.unitId === witness.uid).length;
    };
    expect(run(1)).toBe(0); // below threshold → does not fire
    expect(run(2)).toBeGreaterThanOrEqual(1); // at threshold multiple → fires
  });

  it('EV-DTH-04b: avenge once fires exactly once past the threshold (Mortarch N=3)', () => {
    const witness = vanilla(9, 100);
    const { chaff, destroyers } = sacrificeCluster(4); // 4 deaths > threshold 3
    const evs = resolveCombat(board([cu('revenants_mortarch', { atk: 9, hp: 100 }), witness, ...chaff, ...destroyers]), passiveB(), SEED);
    // Mortarch payoff = bp atk/hp; it targets allAllies → witness receives it exactly once (never again)
    expect(byType(evs, 'stats').filter((e) => e.unitId === witness.uid).length).toBe(1);
  });

  it('EV-DTH-05: the token-death floor is clamped to tokenDeathFloorCapAtk (Gorehide, cap 6)', () => {
    // 8 start-of-combat destroys kill 8 tokens → +1 atk each, capped at the config cap.
    const gorehide = cu('wildkin_gorehide', { hp: 100 }); // base atk from card
    const base = getCard('wildkin_gorehide').atk;
    const tokens = Array.from({ length: 8 }, () => cu('wildkin_thornpup', { atk: 0, hp: 1 }));
    const priests = Array.from({ length: 8 }, () => cu('infernals_hollowpriest', { hp: 100, atk: 3 }));
    const evs = resolveCombat(board([gorehide, ...tokens, ...priests]), passiveB(), SEED);
    const cap = engines.wildkin.tokenDeathFloorCapAtk; // 6
    const gorehideAtks = byType(evs, 'stats').filter((e) => e.unitId === gorehide.uid).map((e) => e.atk);
    // never exceeds the clamped ceiling, and it does reach it (8 token deaths > cap)
    for (const atk of gorehideAtks) expect(atk).toBeLessThanOrEqual(base + cap);
    expect(Math.max(...gorehideAtks, base)).toBe(base + cap);
  });

  it('EV-DTH-06: a deathrattle summon into a full board respects boardCap; alive count never exceeds the cap', () => {
    // A full 7-wide board where the only killable body is a Reclaimer (deathrattle: summon 2). Killing
    // it would push 6+2=8 > 7 → the overflow summon is dropped.
    const reclaimer = cu('constructs_reclaimer', { atk: 0, hp: 1 });
    const wall = Array.from({ length: economy.boardCap - 1 }, () => vanilla(0, 100000)); // 6 unkillable bodies
    const a = board([reclaimer, ...wall]);
    const b = board([vanilla(1, 100000)]); // slowly picks off the 1-hp Reclaimer
    const evs = resolveCombat(a, b, SEED);
    expect(byType(evs, 'death').some((e) => e.unitId === reclaimer.uid)).toBe(true);
    expect(byType(evs, 'summon').some((e) => e.unitIds.length > 0)).toBe(true);

    // reconstruct side membership over the stream and assert |A| never exceeds boardCap
    const aSet = new Set(byType(evs, 'combatStart')[0].a.units.map((u) => u.uid));
    let maxA = aSet.size;
    for (const e of evs) {
      if (e.t === 'summon' && aSet.has(e.ownerId)) for (const id of e.unitIds) aSet.add(id);
      if (e.t === 'death') aSet.delete(e.unitId);
      maxA = Math.max(maxA, aSet.size);
    }
    expect(maxA).toBeLessThanOrEqual(economy.boardCap);
  });

  it('EV-DTH-07: a pathological deathrattle→summon→death churn terminates under the guard (no crash / no runaway)', () => {
    const summoners = Array.from({ length: economy.boardCap }, () => cu('constructs_reclaimer', { hp: 1 }));
    const poisonCleaver = cu('sirens_lurefish', { keywords: ['poison', 'cleave'], effects: [], atk: 5, hp: 100000 });
    let evs: CombatEvent[] = [];
    expect(() => {
      evs = resolveCombat(board(summoners), board([poisonCleaver]), SEED);
    }).not.toThrow();
    expect(byType(evs, 'combatEnd').length).toBe(1); // it terminates
    expect(evs.length).toBeLessThan(200000); // and does not run away
  });

  it('EV-DTH-08 (D1): a same-pass death batch is registered before any deathrattle; the second dier is not a target of the first', () => {
    // g1(taunt, slot0) + g2(slot1) die in ONE cleave batch; survivor(slot2, revenant) is untouched.
    // Gravewing deathrattle buffs the highest-HP OTHER revenant. Under D1 both gravewings are removed
    // before either deathrattle → the only living revenant is the survivor → it receives BOTH buffs
    // (+2·deathPayoffHp). A sequential engine would land at most one on the survivor.
    const g1 = cu('revenants_gravewing', { keywords: ['taunt', 'reborn'], atk: 0, hp: 3 });
    const g2 = cu('revenants_gravewing', { keywords: ['reborn'], atk: 0, hp: 3 });
    const survivor = cu('revenants_wisp', { hp: 5 }); // revenant witness
    const a = board([g1, g2, survivor]);
    const cleaver = cu('primordials_gustling', { keywords: ['cleave'], effects: [], atk: 5, hp: 100000 });
    const b = board([cleaver, vanilla(0, 100000), vanilla(0, 100000), vanilla(0, 100000)]); // B attacks first
    const evs = resolveCombat(a, b, SEED);
    const target = survivor.hp + 2 * engines.revenants.deathPayoffHp; // 5 + 2*2 = 9
    expect(byType(evs, 'stats').some((e) => e.unitId === survivor.uid && e.hp === target)).toBe(true);
  });

  it('EV-DTH-09a (D2): on a cross-side mutual kill the attacker-side deathrattle resolves first', () => {
    // A attacks first (2 > 1); tombspawnA mutually kills tombspawnB. Both deathrattles fire; the
    // attacker's side (A) resolves before the defender's (B).
    const tombA = cu('revenants_tombspawn', { atk: 5, hp: 1 });
    const tombB = cu('revenants_tombspawn', { atk: 5, hp: 1 });
    const a = board([tombA, vanilla(0, 100000)]);
    const b = board([tombB]);
    const evs = resolveCombat(a, b, SEED);
    const iA = idxOf(evs, (e) => e.t === 'deathrattle' && (e as any).unitId === tombA.uid);
    const iB = idxOf(evs, (e) => e.t === 'deathrattle' && (e as any).unitId === tombB.uid);
    expect(iA).toBeGreaterThanOrEqual(0);
    expect(iB).toBeGreaterThanOrEqual(0);
    expect(iA).toBeLessThan(iB); // attacker side first
  });

  it('EV-DTH-09b (D2): with no attacker (start of combat), side A resolves before side B', () => {
    // Each side sacrifices a tombspawn at start of combat (A then B). A's deathrattle precedes B's.
    const tombA = cu('revenants_tombspawn', { atk: 0, hp: 1 });
    const tombB = cu('revenants_tombspawn', { atk: 0, hp: 1 });
    const a = board([cu('infernals_hollowpriest', { hp: 100, atk: 3 }), tombA]);
    const b = board([cu('infernals_hollowpriest', { hp: 100, atk: 3 }), tombB]);
    const evs = resolveCombat(a, b, SEED);
    const iA = idxOf(evs, (e) => e.t === 'deathrattle' && (e as any).unitId === tombA.uid);
    const iB = idxOf(evs, (e) => e.t === 'deathrattle' && (e as any).unitId === tombB.uid);
    expect(iA).toBeGreaterThanOrEqual(0);
    expect(iB).toBeGreaterThanOrEqual(0);
    expect(iA).toBeLessThan(iB);
  });

  it('EV-DTH-10 (D3i): an attacker that dies to its own onAttack does NOT complete the swing', () => {
    // Synthesized onAttack self-kill (live primitives: onAttack + dealDamage + self).
    const selfKiller = cu('corsairs_ironclad', {
      keywords: [],
      atk: 9,
      hp: 5,
      effects: [{ trigger: { type: 'onAttack' }, target: { selector: 'self' }, actions: [{ type: 'dealDamage', amount: 999 }] }],
    });
    const defender = vanilla(0, 100000);
    const a = board([selfKiller, vanilla(0, 100000)]); // A attacks first (2 > 1)
    const b = board([defender]);
    const evs = resolveCombat(a, b, SEED);
    // no attack declared and no damage dealt TO the defender by the self-killer
    expect(byType(evs, 'attack').some((e) => e.attackerId === selfKiller.uid)).toBe(false);
    expect(byType(evs, 'damage').some((e) => e.sourceId === selfKiller.uid && e.targetId === defender.uid)).toBe(false);
    // it dies at the death step
    expect(byType(evs, 'death').some((e) => e.unitId === selfKiller.uid)).toBe(true);
  });
});
