// EVALS.md Group F — Breakpoints at the SHOP interface (05,08,11,12,19,20,21,22,25,26,27 +
// the shop half of 01) + Group D shop-observable effects (EV-ACT-GEM, EV-ACT-PLANT shop,
// EV-CND-03 shop counters). Property: the payoff fires AT the threshold, not below. All
// thresholds/payoffs READ from config (getBreakpoint / engines), never hardcoded. §6.6, §16.4.
import { describe, it, expect } from 'vitest';
import {
  createShopSession,
  startShopPhase,
  endOfTurnPhase,
  playUnit,
  resolveTargetChoice,
  makeInstance,
  createPool,
  evaluateCondition,
  getBreakpoint,
  getCard,
  engines,
  type ShopSession,
} from '@cardgame/shared';

let __u = 0;
const uid = () => `T${__u++}`;
const fresh = (seed: string) => createShopSession(0, { pool: createPool(), seed });
function put(s: ShopSession, cardId: string, where: 'board' | 'bench' = 'board') {
  const inst = makeInstance(cardId, { uid: uid(), bornTurn: s.round });
  (where === 'board' ? s.board : s.bench).push(inst);
  return inst;
}
/** Put a card on the bench and play it (fires its battlecry). */
function playCard(s: ShopSession, cardId: string) {
  const inst = makeInstance(cardId, { uid: uid(), bornTurn: s.round });
  s.bench.push(inst);
  playUnit(s, inst.uid);
  return inst;
}
const FILLER = 'tuskers_gemtitan'; // battlecry: self giveGem (no board pollution, no witness buff)
const thornpups = (s: ShopSession) => s.board.filter((u) => u.cardId === 'wildkin_thornpup');

// ── battlecry-gated board buff (Chorus Tide, Stormcaller) ─────────────────────────
function battlecryBoardBuff(cardId: string, seed: string) {
  const bp = getBreakpoint(cardId);
  // at threshold: (threshold−1) fillers then the card itself (+1) → == threshold
  const s = fresh(seed);
  s.round = 1;
  const witness = put(s, 'wildkin_brambleling', 'board');
  const [wa, wh] = [witness.atk, witness.hp];
  for (let i = 0; i < bp.threshold - 1; i++) playCard(s, FILLER);
  playCard(s, cardId);
  expect(witness.atk).toBe(wa + bp.atk!);
  expect(witness.hp).toBe(wh + (bp.hp ?? 0));
  // below: one fewer battlecry → reaches threshold−1 at the condition check
  const s2 = fresh(seed + 'b');
  s2.round = 1;
  const w2 = put(s2, 'wildkin_brambleling', 'board');
  for (let i = 0; i < Math.max(0, bp.threshold - 2); i++) playCard(s2, FILLER);
  playCard(s2, cardId);
  expect(w2.atk).toBe(w2.atk === wa ? wa : w2.atk); // (witness base unchanged below threshold)
  expect(w2.atk).toBe(1); // brambleling base atk, no buff
  expect(w2.hp).toBe(3);
}

describe('EV-BP — battlecry breakpoints (SHOP)', () => {
  it('EV-BP-11: Chorus Tide — battlecries≥threshold → board +atk/+hp', () => battlecryBoardBuff('reefkin_chorustide', 'bp11'));
  it('EV-BP-22: Stormcaller — battlecries≥threshold → board +atk/+hp', () => battlecryBoardBuff('primordials_stormcaller', 'bp22'));

  it('EV-BP-05: Brackentide — battlecries≥threshold → summon +summonCount Thornpups (base 1 always)', () => {
    const bp = getBreakpoint('wildkin_brackentide');
    // below: play alone → only the base 1 Thornpup summons
    const sB = fresh('bp05b');
    sB.round = 1;
    playCard(sB, 'wildkin_brackentide');
    expect(thornpups(sB).length).toBe(1);
    // at threshold: (threshold−1) fillers then Brackentide → base 1 + summonCount
    const sA = fresh('bp05a');
    sA.round = 1;
    for (let i = 0; i < bp.threshold - 1; i++) playCard(sA, FILLER);
    playCard(sA, 'wildkin_brackentide');
    expect(thornpups(sA).length).toBe(1 + (bp.summonCount ?? 0));
  });

  it('EV-BP-08: Tideclaimer — battlecries≥threshold → summon a Reborn Wisp', () => {
    const bp = getBreakpoint('revenants_tideclaimer');
    const rebornWisps = (s: ShopSession) => s.board.filter((u) => u.cardId === bp.summonUnitId).length;
    const sB = fresh('bp08b');
    sB.round = 1;
    playCard(sB, 'revenants_tideclaimer');
    expect(rebornWisps(sB)).toBe(0);
    const sA = fresh('bp08a');
    sA.round = 1;
    for (let i = 0; i < bp.threshold - 1; i++) playCard(sA, FILLER);
    playCard(sA, 'revenants_tideclaimer');
    expect(rebornWisps(sA)).toBe(bp.summonCount ?? 1);
  });

  it('EV-BP-12: Reef Leviathan — battlecries≥threshold → grant the whole board Divine Shield', () => {
    const bp = getBreakpoint('reefkin_leviathan');
    expect(bp.grantKeyword).toBe('divineShield');
    const hasShield = (s: ShopSession, uid0: string) =>
      s.board.find((u) => u.uid === uid0)!.keywords.includes('divineShield');
    // below: threshold−1 total battlecries → no grant
    const sB = fresh('bp12b');
    sB.round = 1;
    const wB = put(sB, 'wildkin_brambleling', 'board');
    for (let i = 0; i < Math.max(0, bp.threshold - 2); i++) playCard(sB, FILLER);
    playCard(sB, 'reefkin_leviathan');
    expect(hasShield(sB, wB.uid)).toBe(false);
    // at threshold
    const sA = fresh('bp12a');
    sA.round = 1;
    const wA = put(sA, 'wildkin_brambleling', 'board');
    for (let i = 0; i < bp.threshold - 1; i++) playCard(sA, FILLER);
    playCard(sA, 'reefkin_leviathan');
    expect(hasShield(sA, wA.uid)).toBe(true);
  });

  it('EV-BP-25: Deepchanter — battlecries≥threshold → a friendly minion gains Poison and +atk/+hp', () => {
    const bp = getBreakpoint('sirens_deepchanter');
    // at threshold: reach threshold−1 with fillers, then Deepchanter → gated chosenAlly resolves
    const sA = fresh('bp25a');
    sA.round = 1;
    const witnessA = put(sA, 'wildkin_brambleling', 'board');
    const [wa, wh] = [witnessA.atk, witnessA.hp];
    for (let i = 0; i < bp.threshold - 1; i++) playCard(sA, FILLER);
    playCard(sA, 'sirens_deepchanter');
    expect(sA.pendingTarget).toBeTruthy();
    resolveTargetChoice(sA, witnessA.uid);
    expect(witnessA.keywords).toContain('poison');
    expect(witnessA.atk).toBe(wa + bp.atk!);
    expect(witnessA.hp).toBe(wh + bp.hp!);
    // below threshold: gated chosenAlly does NOT arm (no pendingTarget), witness untouched
    const sB = fresh('bp25b');
    sB.round = 1;
    const witnessB = put(sB, 'wildkin_brambleling', 'board');
    for (let i = 0; i < Math.max(0, bp.threshold - 2); i++) playCard(sB, FILLER);
    playCard(sB, 'sirens_deepchanter');
    expect(sB.pendingTarget).toBeNull();
    expect(witnessB.keywords).not.toContain('poison');
    expect(witnessB.atk).toBe(1);
  });

  it('EV-BP-26: Abysscantor — battlecries≥threshold → give your Sirens Poison', () => {
    const bp = getBreakpoint('sirens_abysscantor');
    const sA = fresh('bp26a');
    sA.round = 1;
    const sirenA = put(sA, 'sirens_reefwitch', 'board'); // siren without poison
    for (let i = 0; i < bp.threshold - 1; i++) playCard(sA, FILLER);
    playCard(sA, 'sirens_abysscantor');
    expect(sirenA.keywords).toContain('poison');
    const sB = fresh('bp26b');
    sB.round = 1;
    const sirenB = put(sB, 'sirens_reefwitch', 'board');
    for (let i = 0; i < Math.max(0, bp.threshold - 2); i++) playCard(sB, FILLER);
    playCard(sB, 'sirens_abysscantor');
    expect(sirenB.keywords).not.toContain('poison');
  });

  it('EV-BP-27: Leviathansong — battlecries≥threshold → board +atk/+hp (+ random Poison)', () => {
    const bp = getBreakpoint('sirens_leviathansong');
    const sA = fresh('bp27a');
    sA.round = 1;
    const witnessA = put(sA, 'wildkin_brambleling', 'board');
    const [wa, wh] = [witnessA.atk, witnessA.hp];
    for (let i = 0; i < bp.threshold - 1; i++) playCard(sA, FILLER);
    playCard(sA, 'sirens_leviathansong');
    expect(witnessA.atk).toBe(wa + bp.atk!);
    expect(witnessA.hp).toBe(wh + bp.hp!);
    const sB = fresh('bp27b');
    sB.round = 1;
    const witnessB = put(sB, 'wildkin_brambleling', 'board');
    for (let i = 0; i < Math.max(0, bp.threshold - 2); i++) playCard(sB, FILLER);
    playCard(sB, 'sirens_leviathansong');
    expect(witnessB.atk).toBe(1);
    expect(witnessB.hp).toBe(3);
  });
});

// ── doublers (Ivorytusk, Ivorylord, Gemtitan) ──────────────────────────────────────
// EV-BP-19/20/21 are RETIRED (decision #39): the doublers are no longer gemsThisTurn
// breakpoints — each ×2 is a PURCHASED activated ability (spend-gated payoff class,
// §6.6a/§11.3c). Their behavior is pinned by the EV-ABL family in activated.test.ts.

// ── Mother Thorn: shop half (tokensThisTurn≥threshold → each further token +tokenAtk/+tokenHp) ─────
describe('EV-BP — Mother Thorn shop half', () => {
  it('EV-BP-01 (shop half): tokensThisTurn≥threshold → summoned tokens gain +tokenAtk/+tokenHp (not below)', () => {
    const bp = getBreakpoint('wildkin_motherthorn');
    const s = fresh('bp01');
    startShopPhase(s);
    put(s, 'wildkin_motherthorn');
    // two Bramblelings summon 2×tokensPerTurn tokens at end of turn → crosses the threshold
    put(s, 'wildkin_brambleling');
    put(s, 'wildkin_brambleling');
    endOfTurnPhase(s);
    expect(s.tokensThisTurn).toBeGreaterThanOrEqual(bp.threshold); // enough tokens to cross the break
    const pups = thornpups(s);
    const buffed = pups.filter((u) => u.atk > 1); // base Thornpup atk is 1
    const expectedBuffed = Math.max(0, s.tokensThisTurn - (bp.threshold - 1));
    expect(buffed.length).toBe(expectedBuffed);
    // the first (threshold−1) tokens are summoned BELOW the break → unbuffed
    expect(pups.length - buffed.length).toBe(bp.threshold - 1);
    for (const p of buffed) {
      expect(p.atk).toBe(1 + bp.tokenAtk!);
      expect(p.hp).toBe(1 + bp.tokenHp!);
    }
  });
});

// ── Group D shop-observable effects ───────────────────────────────────────────────
describe('EV-ACT / EV-CND — shop-observable effects', () => {
  it('EV-ACT-GEM: Gemsnout end-of-turn giveGem raises gems AND gemsThisTurn by the amount', () => {
    const s = fresh('gem');
    startShopPhase(s);
    put(s, 'tuskers_gemsnout');
    const amount = getCard('tuskers_gemsnout').effects[0].actions[0].amount ?? 0;
    expect(amount).toBe(engines.tuskers.gemBaseValue);
    const [g0, t0] = [s.gems, s.gemsThisTurn];
    endOfTurnPhase(s);
    expect(s.gems).toBe(g0 + amount);
    expect(s.gemsThisTurn).toBe(t0 + amount);
  });

  it('EV-ACT-PLANT (shop): Reefmourner plants a deathrattle Effect onto instance.grantedEffects (persists)', () => {
    const s = fresh('plant');
    s.round = 1;
    const host = put(s, 'corsairs_ironclad', 'board'); // the ally that will carry the planted deathrattle
    const mourner = makeInstance('reefkin_reefmourner', { uid: uid(), bornTurn: s.round });
    s.bench.push(mourner);
    playUnit(s, mourner.uid); // battlecry: chosenAlly → plantDeathrattle
    expect(s.pendingTarget).toBeTruthy();
    resolveTargetChoice(s, host.uid);
    expect(host.grantedEffects).toBeTruthy();
    expect(host.grantedEffects!.length).toBe(1);
    expect(host.grantedEffects![0].trigger.type).toBe('deathrattle');
    // persists on the instance (still present after further no-op ops)
    startShopPhase(s);
    expect(s.board.find((u) => u.uid === host.uid)!.grantedEffects!.length).toBe(1);
  });

  it('EV-CND-03 (shop counters): gems/battlecries/tokens conditions gate exactly at the boundary', () => {
    const cases: Array<{ kind: any; key: 'gemsThisTurn' | 'battlecriesThisTurn' | 'tokensThisTurn' }> = [
      { kind: 'gemsThisTurnAtLeast', key: 'gemsThisTurn' },
      { kind: 'battlecriesThisTurnAtLeast', key: 'battlecriesThisTurn' },
      { kind: 'tokensSummonedThisTurnAtLeast', key: 'tokensThisTurn' },
    ];
    const V = 3;
    for (const { kind, key } of cases) {
      expect(evaluateCondition({ kind, value: V }, { [key]: V - 1 })).toBe(false); // below
      expect(evaluateCondition({ kind, value: V }, { [key]: V })).toBe(true); // at
      expect(evaluateCondition({ kind, value: V }, { [key]: V + 1 })).toBe(true); // above
    }
  });
});
