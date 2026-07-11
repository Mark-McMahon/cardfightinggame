// EVALS Group M — EV-CGL: the Corsairs GOLD spend-gated lever (Phase 7, decision #73). Corsairs' pre-Phase-7
// ceiling was the low-stat TEMPO/reborn identity + a gold ECONOMY with no stat payoff. Prizemaster is the FIRST
// non-gem spend-gated payoff (§6.6a, §11.3c's second legal class): once/turn, spend GOLD to permanently +5/+5 a
// chosen Corsair. Proves: gold (not gems) is the wallet; a rejection mutates nothing; the chosen Corsair gains a
// PERMANENT buff that rides into combat; once-per-turn; filterTribe (Corsairs only); the buff COMPOUNDS across
// turns (the scaling line); the registry/lint is green + abilityStates projects currency 'gold'; and poison
// one-shots the pumped carry (stat-agnostic). Design-spec §6.6a, §8; #73.
import { describe, it, expect } from 'vitest';
import {
  createShopSession,
  createPool,
  makeInstance,
  activateAbility,
  activatedCost,
  resolveTargetChoice,
  boardToCombat,
  resolveCombat,
  toPrivateState,
  getCard,
  engines,
  hasSpendGated,
  getSpendGated,
  lintBreakpoints,
  type ShopSession,
  type CombatUnit,
  type CombatBoard,
  type CombatEvent,
} from '@cardgame/shared';

const C = engines.corsairs;
let __u = 0;
const uid = () => `CG${__u++}`;
function fresh(seed: string, gold = 20): ShopSession {
  const s = createShopSession(0, { pool: createPool(), seed });
  s.round = 6;
  s.tier = 6;
  s.gold = gold;
  return s;
}
function put(s: ShopSession, cardId: string): ReturnType<typeof makeInstance> {
  const inst = makeInstance(cardId, { uid: uid(), bornTurn: s.round });
  s.board.push(inst);
  return inst;
}
function cu(cardId: string, o: Partial<CombatUnit> = {}): CombatUnit {
  const c = getCard(cardId);
  return {
    uid: `${cardId}#${++__u}`, cardId, name: c.name, tribe: c.tribe, tier: c.tier,
    atk: o.atk ?? c.atk, hp: o.hp ?? c.hp, keywords: o.keywords ?? [...c.keywords],
    golden: false, isToken: !!c.isToken, effects: c.effects, auras: c.auras ?? [],
  };
}
const byType = <T extends CombatEvent['t']>(evs: CombatEvent[], t: T) =>
  evs.filter((e): e is Extract<CombatEvent, { t: T }> => e.t === t);

describe('EV-CGL — Corsairs GOLD spend-gated lever (#73)', () => {
  it('EV-CGL-01: activation pays GOLD (not gems); the chosen Corsair permanently gains +5/+5', () => {
    const s = fresh('cgl01', 10);
    const boss = put(s, 'corsairs_prizemaster');
    const carry = put(s, 'corsairs_ironclad');
    const gold0 = s.gold, gems0 = s.gems;
    const [a0, h0] = [carry.atk, carry.hp];
    const cost = activatedCost(s, getCard('corsairs_prizemaster'));
    expect(cost).toBe(C.prizemasterCost);
    expect(activateAbility(s, boss.uid).ok).toBe(true); // chosenAlly → arms pendingTarget
    expect(resolveTargetChoice(s, carry.uid).ok).toBe(true);
    expect(s.gold).toBe(gold0 - cost); // GOLD spent
    expect(s.gems).toBe(gems0); // gems untouched
    expect([carry.atk, carry.hp]).toEqual([a0 + C.prizemasterBuffAtk, h0 + C.prizemasterBuffHp]);
  });

  it('EV-CGL-02: too little GOLD → rejected, and the rejection mutates NOTHING (server-authoritative)', () => {
    const s = fresh('cgl02', C.prizemasterCost - 1); // one gold short
    const boss = put(s, 'corsairs_prizemaster');
    const carry = put(s, 'corsairs_ironclad');
    const snap = JSON.stringify({ gold: s.gold, board: s.board, pending: s.pendingTarget });
    const res = activateAbility(s, boss.uid);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/gold/);
    expect(JSON.stringify({ gold: s.gold, board: s.board, pending: s.pendingTarget })).toBe(snap);
  });

  it('EV-CGL-03: once-per-turn gate — a second activation the same turn is refused (no double spend)', () => {
    const s = fresh('cgl03', 20);
    const boss = put(s, 'corsairs_prizemaster');
    const carry = put(s, 'corsairs_ironclad');
    expect(activateAbility(s, boss.uid).ok).toBe(true);
    resolveTargetChoice(s, carry.uid);
    const goldAfter = s.gold;
    expect(activateAbility(s, boss.uid).ok).toBe(false); // already activated this turn
    expect(s.gold).toBe(goldAfter); // no second spend
  });

  it('EV-CGL-04: filterTribe — only Corsairs are legal targets (a splashed non-Corsair is not offered)', () => {
    const s = fresh('cgl04', 20);
    const boss = put(s, 'corsairs_prizemaster');
    const carry = put(s, 'corsairs_ironclad');
    const splash = put(s, 'primordials_gustling'); // a non-Corsair ally
    expect(activateAbility(s, boss.uid).ok).toBe(true);
    const legal = s.pendingTarget!.legalTargets;
    expect(legal).toContain(carry.uid); // a Corsair is a legal reward target
    expect(legal).toContain(boss.uid); // self (also a Corsair) is legal
    expect(legal).not.toContain(splash.uid); // the non-Corsair is filtered out
  });

  it('EV-CGL-05: the buff COMPOUNDS across turns and rides into combat (the scaling line)', () => {
    const s = fresh('cgl05', 4);
    const boss = put(s, 'corsairs_prizemaster');
    const carry = put(s, 'corsairs_ironclad');
    const [a0, h0] = [carry.atk, carry.hp];
    const N = 8;
    for (let t = 0; t < N; t++) {
      s.gold = C.prizemasterCost; // fresh income each turn covers exactly one activation
      s.abilityUsedThisTurn = []; // new turn: the once-per-turn gate resets
      expect(activateAbility(s, boss.uid).ok).toBe(true);
      resolveTargetChoice(s, carry.uid);
    }
    expect([carry.atk, carry.hp]).toEqual([a0 + N * C.prizemasterBuffAtk, h0 + N * C.prizemasterBuffHp]);
    // the pumped stats are PERMANENT on the instance → they ride into combat unchanged
    const board = boardToCombat(s);
    const combatCarry = board.units.find((u) => u.uid === carry.uid)!;
    expect([combatCarry.atk, combatCarry.hp]).toEqual([a0 + N * C.prizemasterBuffAtk, h0 + N * C.prizemasterBuffHp]);
  });

  it('EV-CGL-06: registry/lint — Prizemaster is spend-gated (gold), abilityStates projects currency, lint green', () => {
    expect(hasSpendGated('corsairs_prizemaster')).toBe(true);
    expect(getSpendGated('corsairs_prizemaster').currency).toBe('gold');
    const s = fresh('cgl06', 10);
    const boss = put(s, 'corsairs_prizemaster');
    const ab = toPrivateState(s).abilities.find((a) => a.uid === boss.uid)!;
    expect(ab.currency).toBe('gold');
    expect(ab.cost).toBe(C.prizemasterCost);
    const lint = lintBreakpoints();
    expect(lint.errors).toEqual([]);
    expect(lint.ok).toBe(true);
  });

  it('EV-CGL-07: poison one-shots the pumped carry regardless of its size (stat-agnostic counter)', () => {
    // a heavily-pumped Corsair (stand-in for many activations) still dies to a single poison touch.
    const carry = cu('corsairs_ironclad', { atk: 60, hp: 60, keywords: [] }); // huge from Prizemaster pumps
    const a: CombatBoard = { units: [carry], playerTier: 6 };
    const b: CombatBoard = { units: [cu('sirens_lurefish', { atk: 2, hp: 2 })], playerTier: 1 }; // poison
    const evs = resolveCombat(a, b, 'cgl-psn');
    expect(byType(evs, 'death').some((e) => e.unitId === carry.uid)).toBe(true);
  });
});
