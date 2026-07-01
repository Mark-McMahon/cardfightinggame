// EVALS.md Group H — Match loop & outcome (interfaces: MATCH / STATE) + EV-INV-SRV (INTENT
// invariant: a rejected intent mutates nothing). Written to intent (design-spec §4.3–4.6, D6/D8/D9,
// §9.7). Numbers imported from config, never hardcoded.
import { describe, it, expect } from 'vitest';
import {
  Match,
  computeTimer,
  lossDamage,
  makeInstance,
  match as matchCfg,
  type SeatConfig,
  type Intent,
} from '@cardgame/shared';

const seats = (n: number): SeatConfig[] =>
  Array.from({ length: n }, (_, i) => ({ name: `P${i}`, isBot: true }));
const inst = (cardId: string, uid: string) => makeInstance(cardId, { uid });
const H = matchCfg.startingHealth;

describe('EV-MTC — match outcome / state', () => {
  it('EV-MTC-01 (D6): loss damage = clamp(winnerTier·w1 + Σ survivor tiers·w2, 0, cap), winner tier', () => {
    // pure formula (winner tier is the base term)
    const f = (wt: number, st: number) =>
      Math.max(0, Math.min(matchCfg.lossDamageCap, Math.round(wt * matchCfg.lossBaseTierWeight + st * matchCfg.survivorTierWeight)));
    expect(lossDamage(3, 6)).toBe(f(3, 6));
    expect(lossDamage(1, 0)).toBe(f(1, 0));
    expect(lossDamage(6, 60)).toBe(matchCfg.lossDamageCap); // clamped to the cap

    // integration through Match: seat with the surviving board deals winner-tier-based damage to the loser
    const m = new Match('mtc01', seats(2));
    m.sessions[0].tier = 4; // WINNER tier
    m.sessions[0].board = [inst('corsairs_ironclad', 'a0')]; // card tier 2 (only survivor)
    m.sessions[1].board = []; // empty → loses instantly
    m.resolveCombatPhase();
    const expected = lossDamage(4, 2);
    expect(m.state.players[1].hp).toBe(H - expected);
    expect(m.state.players[0].hp).toBe(H); // winner takes none
    expect(expected).toBeGreaterThan(0);
  });

  it('EV-MTC-02: a tie deals zero hero damage to both', () => {
    const m = new Match('mtc02', seats(2));
    m.sessions[0].board = []; // both empty → tie
    m.sessions[1].board = [];
    m.resolveCombatPhase();
    expect(m.state.players[0].hp).toBe(H);
    expect(m.state.players[1].hp).toBe(H);
  });

  it('EV-MTC-03: HP≤0 → eliminated at the lowest open placement; last survivor = 1st', () => {
    const m = new Match('mtc03', seats(2));
    m.sessions[0].tier = 1;
    m.sessions[0].board = [inst('corsairs_ironclad', 'a0')]; // wins
    m.sessions[1].board = [];
    m.state.players[1].hp = 2; // lossDamage(1,2)=3 → lethal
    m.resolveCombatPhase();
    expect(m.state.players[1].alive).toBe(false);
    expect(m.state.players[1].placement).toBe(2); // lowest open placement
    expect(m.state.players[0].placement).toBe(1); // last survivor = 1st
    expect(m.state.winnerSeat).toBe(0);
    expect(m.isFinished()).toBe(true);
  });

  it('EV-MTC-04: simultaneous eliminations ordered by remaining HP (more-negative places lower)', () => {
    const m = new Match('mtc04', seats(4));
    // all boards empty → every combat ties → no new damage; isolate the elimination ordering.
    for (let i = 0; i < 4; i++) m.sessions[i].board = [];
    m.state.players[1].hp = -5; // more negative → worse placement
    m.state.players[3].hp = -2; // less negative → better placement
    m.resolveCombatPhase();
    expect(m.state.players[1].placement).toBe(4);
    expect(m.state.players[3].placement).toBe(3);
    expect(m.state.players[1].placement).toBeGreaterThan(m.state.players[3].placement);
  });

  it('EV-MTC-05 (D9): maxRounds → standings finalized by HP; HP ties broken by seat order', () => {
    const m = new Match('mtc05', seats(2));
    for (let r = 0; r < matchCfg.maxRounds; r++) {
      m.startRound();
      m.sessions[0].board = []; // keep both empty → perpetual ties, equal HP
      m.sessions[1].board = [];
      m.resolveCombatPhase();
      if (m.isFinished()) break;
    }
    expect(m.isFinished()).toBe(true);
    // HP tied (both 30) → lowest seat places higher (D9)
    expect(m.state.players[0].placement).toBe(1);
    expect(m.state.players[1].placement).toBe(2);
    expect(m.state.winnerSeat).toBe(0);
  });

  it('EV-MTC-06 (D8): odd live count → a ghost pairing (bSeat=−1) of the most-recently-eliminated, deterministic', () => {
    const buildToRound2 = () => {
      const m = new Match('mtc06', seats(4));
      m.startRound(); // round 1
      for (let i = 0; i < 4; i++) m.sessions[i].board = [];
      m.state.players[3].hp = -1; // eliminate seat 3 first → becomes the ghost source
      m.resolveCombatPhase();
      expect(m.state.players[3].alive).toBe(false);
      m.startRound(); // round 2 — now 3 alive (odd)
      for (let i = 0; i < 3; i++) m.sessions[i].board = [];
      m.resolveCombatPhase();
      return m;
    };
    const m = buildToRound2();
    const ghost = m.state.pairings.find((p) => p.ghost);
    expect(ghost).toBeTruthy();
    expect(ghost!.bSeat).toBe(-1);
    expect(ghost!.ghostName).toBe(m.state.players[3].name); // most-recently-eliminated
    // no hero damage flows TO the ghost: its source seat's HP is untouched by round-2 combat
    expect(m.state.players[3].hp).toBe(-1);
    // deterministic from the match seed: an identical run pairs the same solo seat vs the ghost
    const m2 = buildToRound2();
    const ghost2 = m2.state.pairings.find((p) => p.ghost)!;
    expect(ghost2.aSeat).toBe(ghost!.aSeat);
  });

  it('EV-MTC-07: public timer = min(cap, base + maxTier·perTier + maxGold·perGold)', () => {
    const f = (t: number, g: number) =>
      Math.min(matchCfg.shopTimerCap, matchCfg.shopTimerBase + t * matchCfg.shopTimerPerTier + g * matchCfg.shopTimerPerGold);
    expect(computeTimer(1, 3)).toBe(f(1, 3));
    expect(computeTimer(6, 10)).toBe(f(6, 10));
    expect(computeTimer(1000, 1000)).toBe(matchCfg.shopTimerCap); // clamped

    // integration: state.timer tracks the wealthiest living player after a successful intent
    const m = new Match('mtc07', seats(2));
    m.startRound();
    m.sessions[0].tier = 3;
    m.sessions[0].gold = 8;
    expect(m.applyIntent(0, { type: 'freeze' }).ok).toBe(true); // a successful intent refreshes the timer
    expect(m.state.timer).toBe(computeTimer(3, 8));
  });
});

describe('EV-INV-SRV — a rejected intent returns {ok:false,error} and mutates nothing', () => {
  const snap = (m: Match) => JSON.parse(JSON.stringify({ pub: m.state, p0: m.privateState(0), p1: m.privateState(1) }));

  it('EV-INV-SRV: unaffordable buy / bad shop index / bad uid are rejected with no mutation', () => {
    const m = new Match('inv-srv', seats(2));
    m.startRound(); // phase shop, shop drawn
    m.sessions[0].gold = 0; // setup: make a buy unaffordable

    const illegal: Array<{ intent: Intent }> = [
      { intent: { type: 'buy', shopIndex: 0 } }, // unaffordable
      { intent: { type: 'buy', shopIndex: 999 } }, // invalid index
      { intent: { type: 'sell', unitUid: 'does-not-exist' } }, // bad uid
      { intent: { type: 'targetChoice', targetUid: 'nope' } }, // no pending target
      { intent: { type: 'discoverPick', optionIndex: 0 } }, // no discover pending
    ];
    for (const { intent } of illegal) {
      const before = snap(m);
      const res = m.applyIntent(0, intent);
      expect(res.ok).toBe(false);
      expect(res.error).toBeTruthy();
      expect(snap(m)).toEqual(before); // no mutation
    }
  });

  it('EV-INV-SRV: a wrong-phase intent (before shop) is rejected with no mutation', () => {
    const m = new Match('inv-srv2', seats(2)); // phase == 'lobby'
    const before = snap(m);
    const res = m.applyIntent(0, { type: 'buy', shopIndex: 0 });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('not shop phase');
    expect(snap(m)).toEqual(before);
  });
});
