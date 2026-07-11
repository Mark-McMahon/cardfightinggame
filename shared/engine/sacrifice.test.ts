// EVALS Group P — EV-SAC: the Infernals SACRIFICE PERSISTENT ceiling (Phase 7, decision #75). Infernals'
// pre-Phase-7 payoffs were ALL this-combat or one-time, so the "few+tall" carry could never reach a very-high
// TOTAL. Soulglutton is the first PERMANENT death payoff: the FIRST time 3+ friendlies die in a combat, the
// carry PERMANENTLY gains +6/+6 (permanent:true → §7.5 writeback folds it onto the SURVIVING instance).
// Proves: silent below the death gate; fires once at the gate with a PERMANENT (folding) buff; the buff
// COMPOUNDS across combats (the scaling line); and poison one-shots the grown carry regardless of size.
// Design-spec §6.6, §7.5, §8; #75.
import { describe, it, expect } from 'vitest';
import {
  resolveCombat, foldPermanentBuffs, getCard, getBreakpoint, makeInstance, instanceToCombatUnit,
  type CombatUnit, type CombatBoard, type CombatEvent, type UnitInstance,
} from '@cardgame/shared';

let __uid = 0;
function cu(cardId: string, o: Partial<CombatUnit> = {}): CombatUnit {
  const c = getCard(cardId);
  return {
    uid: o.uid ?? `${cardId}#${++__uid}`, cardId, name: c.name, tribe: c.tribe, tier: c.tier,
    atk: o.atk ?? c.atk, hp: o.hp ?? c.hp, keywords: o.keywords ?? [...c.keywords],
    golden: false, isToken: !!c.isToken, effects: c.effects, auras: c.auras ?? [],
  };
}
const byType = <T extends CombatEvent['t']>(evs: CombatEvent[], t: T) =>
  evs.filter((e): e is Extract<CombatEvent, { t: T }> => e.t === t);

// a board that manufactures `deaths` friendly deaths this combat: the Soulglutton (immortal here) plus
// `deaths` fragile 1/1 chaff that die to the enemy, plus an enemy strong enough to kill them.
function sacrificeBoard(gluttonUid: string, deaths: number): CombatBoard {
  const units: CombatUnit[] = [cu('infernals_soulglutton', { uid: gluttonUid, hp: 100000, keywords: [] })];
  for (let i = 0; i < deaths; i++) units.push(cu('infernals_cinderling', { atk: 0, hp: 1, keywords: [] }));
  return { units, playerTier: 6 };
}
const enemy = (): CombatBoard => ({ units: [cu('corsairs_ironclad', { atk: 50, hp: 100000, keywords: ['cleave'] })], playerTier: 6 });

describe('EV-SAC — Soulglutton permanent sacrifice carry (#75)', () => {
  const bpS = getBreakpoint('infernals_soulglutton');
  const pAtk = bpS.atk!, pHp = bpS.hp!; // the row defines both (asserted for the type)

  it('EV-SAC-01: below the death gate → NO permanent buff fires', () => {
    const evs = resolveCombat(sacrificeBoard('G', bpS.threshold - 1), enemy(), 'sac-below');
    expect(byType(evs, 'stats').some((e) => e.unitId === 'G' && e.permanent)).toBe(false);
  });

  it('EV-SAC-02: at the gate it fires ONCE with a PERMANENT (folding) self-buff of the configured size', () => {
    const evs = resolveCombat(sacrificeBoard('G', bpS.threshold), enemy(), 'sac-at');
    const perm = byType(evs, 'stats').filter((e) => e.unitId === 'G' && e.permanent === true);
    expect(perm.length).toBe(1); // once (not per-death)
    expect([perm[0].dAtk, perm[0].dHp]).toEqual([pAtk, pHp]); // the permanent DELTA = configured payoff
  });

  it('EV-SAC-03: the permanent buff COMPOUNDS across combats via the §7.5 writeback (the scaling line)', () => {
    // a persistent instance that survives N combats, each manufacturing 3+ deaths, grows by N×(payoff).
    const inst: UnitInstance = makeInstance('infernals_soulglutton', { uid: 'G', bornTurn: 1 });
    const [a0, h0] = [inst.atk, inst.hp];
    const N = 6;
    for (let t = 0; t < N; t++) {
      const board: CombatBoard = { units: [instanceToCombatUnit(inst), ...Array.from({ length: bpS.threshold }, () => cu('infernals_cinderling', { atk: 0, hp: 1, keywords: [] }))], playerTier: 6 };
      // give the glutton huge hp so it always survives to fold the permanent buff
      board.units[0].hp = 100000; board.units[0].keywords = [];
      const evs = resolveCombat(board, enemy(), `sac-fold:${t}`);
      foldPermanentBuffs(evs, [inst], ['G'], 'a'); // §7.5 writeback: the surviving glutton ('G') keeps its permanent buff
    }
    expect(inst.atk).toBe(a0 + N * pAtk); // grew by N chunks, permanently
    expect(inst.hp).toBe(h0 + N * pHp);
  });

  it('EV-SAC-04: poison one-shots the grown carry regardless of its size (stat-agnostic — the few+tall counter)', () => {
    const carry = cu('infernals_soulglutton', { atk: 120, hp: 120, keywords: ['taunt'] }); // a whole-game grown giant
    const a: CombatBoard = { units: [carry], playerTier: 6 };
    const b: CombatBoard = { units: [cu('sirens_lurefish', { atk: 2, hp: 2 })], playerTier: 1 }; // poison
    const evs = resolveCombat(a, b, 'sac-psn');
    expect(byType(evs, 'death').some((e) => e.unitId === carry.uid)).toBe(true);
  });
});
