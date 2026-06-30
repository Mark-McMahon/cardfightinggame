import { describe, it, expect } from 'vitest';
import { Pool } from './pool';
import { RNG } from './rng';
import { createPlayerState } from './state';
import {
  buyUnit,
  endOfTurnPhase,
  playUnit,
  resolveTargetChoice,
  startShopPhase,
  tierUp,
} from './shop';
import { resetUidCounter } from './instances';
import { Match } from './match';
import { economy } from '../config/economy';
import { engines } from '../config/engines';
import { getBreakpoint } from '../config/breakpoints';

function freshPlayer() {
  resetUidCounter();
  return { p: createPlayerState(0, 'P', false, 'medium', 30), pool: new Pool(), rng: new RNG('t') };
}

describe('shop economy', () => {
  it('income scales by round and caps', () => {
    const { p, pool, rng } = freshPlayer();
    startShopPhase(p, 1, pool, rng);
    expect(p.gold).toBe(economy.goldStart);
    startShopPhase(p, 5, pool, rng);
    expect(p.gold).toBe(Math.min(economy.goldCap, economy.goldStart + 4));
    startShopPhase(p, 20, pool, rng);
    expect(p.gold).toBe(economy.goldCap);
  });

  it('tier-up costs gold and raises tier', () => {
    const { p } = freshPlayer();
    p.gold = 20;
    const before = p.tier;
    const r = tierUp(p);
    expect(r.ok).toBe(true);
    expect(p.tier).toBe(before + 1);
    expect(p.gold).toBe(20 - economy.tierUpBaseCost[before]);
  });
});

describe('triples → golden + discover (spec §4.2)', () => {
  it('collecting three copies merges into a golden and grants a Discover', () => {
    const { p, pool, rng } = freshPlayer();
    p.gold = 99;
    p.shop = ['reefkin_spinefish', 'reefkin_spinefish', 'reefkin_spinefish'];
    buyUnit(p, 0, pool, rng, 1);
    buyUnit(p, 0, pool, rng, 1);
    const last = buyUnit(p, 0, pool, rng, 1);
    expect(last.triples).toContain('reefkin_spinefish');
    const all = [...p.bench, ...p.board];
    const golden = all.find((u) => u.cardId === 'reefkin_spinefish' && u.golden);
    expect(golden).toBeTruthy();
    expect(golden?.atk).toBe(4); // Round-6 Spinefish base atk 2 × goldenStatMultiplier 2
    expect(p.discover).not.toBeNull();
    expect(p.discover?.options.length).toBeGreaterThan(0);
  });
});

describe('battlecry targeting resolves in the shop (spec §7.4)', () => {
  it('chosenAlly battlecry sets a pending target, then applies on choice', () => {
    const { p, pool, rng } = freshPlayer();
    // put a reefkin on the board and a Tidecaller on the bench
    p.gold = 99;
    p.shop = ['reefkin_spinefish', 'reefkin_tidecaller'];
    buyUnit(p, 0, pool, rng, 1); // spinefish → bench
    buyUnit(p, 0, pool, rng, 1); // tidecaller → bench
    const spine = p.bench.find((u) => u.cardId === 'reefkin_spinefish')!;
    const tide = p.bench.find((u) => u.cardId === 'reefkin_tidecaller')!;
    playUnit(p, spine.uid, undefined, pool, rng, 1); // board: [spine]
    playUnit(p, tide.uid, undefined, pool, rng, 1); // battlecry → pending target
    expect(p.pendingTarget).not.toBeNull();
    expect(p.pendingTarget?.legalTargets).toContain(spine.uid);
    const atkBefore = spine.atk;
    resolveTargetChoice(p, spine.uid, 1);
    expect(p.pendingTarget).toBeNull();
    expect(spine.atk).toBe(atkBefore + 1); // battlecryChainAtk
  });
});

describe('Round-6 token breakpoint (Mother Thorn, §16.5)', () => {
  it('Mother Thorn pays off only once 3+ tokens are summoned this turn', () => {
    const { p, pool, rng } = freshPlayer();
    p.gold = 99;
    // Grovelord summons 3 Thornpups at end of turn → crosses the token breakpoint.
    p.shop = ['wildkin_grovelord', 'wildkin_motherthorn'];
    buyUnit(p, 0, pool, rng, 1);
    buyUnit(p, 0, pool, rng, 1);
    const grove = p.bench.find((u) => u.cardId === 'wildkin_grovelord')!;
    const mom = p.bench.find((u) => u.cardId === 'wildkin_motherthorn')!;
    playUnit(p, grove.uid, undefined, pool, rng, 1);
    playUnit(p, mom.uid, undefined, pool, rng, 1);
    const momAtkBefore = mom.atk;
    endOfTurnPhase(p, pool, rng, 1);

    const mt = getBreakpoint('wildkin_motherthorn');
    // End-of-turn board buff hit Mother Thorn (two-pass: summons resolve before the payoff).
    expect(mom.atk).toBe(momAtkBefore + (mt.atk ?? 0));
    const pups = p.board.filter((u) => u.cardId === 'wildkin_thornpup');
    // Grovelord summons tokensPerTurn*3, capped by the open board slots (grove + mom = 2 used).
    expect(pups.length).toBe(Math.min(economy.boardCap - 2, engines.wildkin.tokensPerTurn * 3));
    // The token summoned at/after the breakpoint also got the per-token buff (on top of board).
    const perTokenRecipient = pups.find((t) => t.atk >= 1 + (mt.tokenAtk ?? 0) + (mt.atk ?? 0));
    expect(perTokenRecipient).toBeTruthy();
  });

  it('Mother Thorn does nothing below the breakpoint (no tokens summoned)', () => {
    const { p, pool, rng } = freshPlayer();
    p.gold = 99;
    // Mother Thorn alone summons nothing → 0 tokens this turn, below the breakpoint.
    p.shop = ['wildkin_motherthorn'];
    buyUnit(p, 0, pool, rng, 1);
    const mom = p.bench.find((u) => u.cardId === 'wildkin_motherthorn')!;
    playUnit(p, mom.uid, undefined, pool, rng, 1);
    const momAtkBefore = mom.atk;
    endOfTurnPhase(p, pool, rng, 1);
    expect(p.tokensSummonedThisTurn).toBeLessThan(getBreakpoint('wildkin_motherthorn').threshold);
    expect(mom.atk).toBe(momAtkBefore); // no board buff below the breakpoint
  });
});

describe('Round-6 battlecry breakpoints (§16.5, §16.2)', () => {
  it('battlecriesThisTurn counts each cast; Chorus Tide fires on the 3rd', () => {
    const { p, pool, rng } = freshPlayer();
    p.gold = 99;
    p.shop = ['wildkin_brackentide', 'wildkin_brackentide', 'reefkin_chorustide'];
    buyUnit(p, 0, pool, rng, 1);
    buyUnit(p, 0, pool, rng, 1);
    buyUnit(p, 0, pool, rng, 1);
    const bks = p.bench.filter((u) => u.cardId === 'wildkin_brackentide');
    const chorus = p.bench.find((u) => u.cardId === 'reefkin_chorustide')!;
    playUnit(p, bks[0].uid, undefined, pool, rng, 1);
    expect(p.battlecriesThisTurn).toBe(1);
    playUnit(p, bks[1].uid, undefined, pool, rng, 1);
    expect(p.battlecriesThisTurn).toBe(2);
    playUnit(p, chorus.uid, undefined, pool, rng, 1); // 3rd battlecry → board buff fires
    expect(p.battlecriesThisTurn).toBe(3);
    const ct = getBreakpoint('reefkin_chorustide');
    const chorusInst = p.board.find((u) => u.uid === chorus.uid)!;
    expect(chorusInst.atk).toBe(2 + (ct.atk ?? 0)); // Chorus Tide base atk 2 + board buff
  });

  it('Echo Choir doubles battlecry breakpoint progress (§16.2 second-order)', () => {
    const { p, pool, rng } = freshPlayer();
    p.gold = 99;
    // Tide Prophet is a non-summoning battlecry filler — it advances the counter without
    // flooding the board (so Chorus Tide can still be played to demonstrate the doubling).
    p.shop = ['reefkin_echochoir', 'reefkin_tideprophet', 'reefkin_chorustide'];
    buyUnit(p, 0, pool, rng, 1);
    buyUnit(p, 0, pool, rng, 1);
    buyUnit(p, 0, pool, rng, 1);
    const echo = p.bench.find((u) => u.cardId === 'reefkin_echochoir')!;
    const prophet = p.bench.find((u) => u.cardId === 'reefkin_tideprophet')!;
    const chorus = p.bench.find((u) => u.cardId === 'reefkin_chorustide')!;
    playUnit(p, echo.uid, undefined, pool, rng, 1); // no battlecry
    expect(p.battlecriesThisTurn).toBe(0);
    playUnit(p, prophet.uid, undefined, pool, rng, 1); // doubled → +2
    expect(p.battlecriesThisTurn).toBe(2);
    playUnit(p, chorus.uid, undefined, pool, rng, 1); // doubled → +2 = 4, and fires (≥2)
    expect(p.battlecriesThisTurn).toBe(4);
    const ct = getBreakpoint('reefkin_chorustide');
    const chorusInst = p.board.find((u) => u.uid === chorus.uid)!;
    expect(chorusInst.atk).toBe(2 + 2 * (ct.atk ?? 0)); // board buff applied twice (Echo Choir)
  });
});

describe('Round-6 multiplier cap + plant (§16.2, §16.3 #5)', () => {
  it('Grovecaller end-of-turn multiplier respects the config cap', () => {
    const { p, pool, rng } = freshPlayer();
    p.gold = 99;
    p.shop = ['wildkin_brambleling', 'wildkin_grovecaller'];
    buyUnit(p, 0, pool, rng, 1);
    buyUnit(p, 0, pool, rng, 1);
    const bram = p.bench.find((u) => u.cardId === 'wildkin_brambleling')!;
    const grove = p.bench.find((u) => u.cardId === 'wildkin_grovecaller')!;
    playUnit(p, bram.uid, undefined, pool, rng, 1);
    playUnit(p, grove.uid, undefined, pool, rng, 1);
    endOfTurnPhase(p, pool, rng, 1);
    const pups = p.board.filter((u) => u.cardId === 'wildkin_thornpup');
    expect(pups.length).toBe(engines.wildkin.tokensPerTurn * engines.wildkin.endOfTurnTriggerMultiplierCap);
  });

  it('Reefmourner plants a permanent deathrattle on a friendly minion', () => {
    const { p, pool, rng } = freshPlayer();
    p.gold = 99;
    p.shop = ['reefkin_spinefish', 'reefkin_reefmourner'];
    buyUnit(p, 0, pool, rng, 1);
    buyUnit(p, 0, pool, rng, 1);
    const spine = p.bench.find((u) => u.cardId === 'reefkin_spinefish')!;
    const mourner = p.bench.find((u) => u.cardId === 'reefkin_reefmourner')!;
    playUnit(p, spine.uid, undefined, pool, rng, 1);
    playUnit(p, mourner.uid, undefined, pool, rng, 1); // chosenAlly battlecry → pending target
    expect(p.pendingTarget).not.toBeNull();
    resolveTargetChoice(p, spine.uid, 1);
    const spineInst = p.board.find((u) => u.uid === spine.uid)!;
    expect(spineInst.grantedEffects?.length).toBeGreaterThanOrEqual(1);
    expect(spineInst.grantedEffects?.[0].trigger.type).toBe('deathrattle');
  });
});

describe('full match orchestration', () => {
  it('runs an 8-player round and produces pairings + combat reports', () => {
    const players = Array.from({ length: 8 }, (_, i) => ({
      seat: i,
      name: `P${i}`,
      isBot: true,
      difficulty: 'medium' as const,
    }));
    const m = new Match({ matchId: 'm1', roomCode: 'TEST', players, hostSeat: 0, botFill: true });
    m.start();
    expect(m.phase).toBe('shop');
    // everyone readies up with empty boards
    for (const p of m.alivePlayers) m.applyIntent(p.seat, { type: 'readyUp' });
    expect(m.allReady()).toBe(true);
    const res = m.resolveCombatPhase();
    expect(res.reports.length).toBe(4); // 8 players → 4 pairings
    // public state is well-formed
    const pub = m.getPublicState();
    expect(pub.players.length).toBe(8);
    expect(['shop', 'finished']).toContain(pub.phase);
  });

  it('plays a whole bot-free match to a single winner', () => {
    const players = Array.from({ length: 8 }, (_, i) => ({ seat: i, name: `P${i}`, isBot: true }));
    const m = new Match({ matchId: 'm2', roomCode: 'TEST2', players, hostSeat: 0, botFill: true });
    m.start();
    let guard = 0;
    while (m.phase !== 'finished' && guard < 100) {
      for (const p of m.alivePlayers) {
        // trivial play: buy first affordable, play everything, ready
        const priv = m.getPrivateState(p.seat)!;
        if (priv.shop.length && priv.gold >= economy.buyCost && p.bench.length < economy.benchCap) {
          m.applyIntent(p.seat, { type: 'buy', shopIndex: 0 });
        }
        for (const u of [...p.bench]) m.applyIntent(p.seat, { type: 'playUnit', unitUid: u.uid });
        m.applyIntent(p.seat, { type: 'readyUp' });
      }
      m.resolveCombatPhase();
      guard++;
    }
    expect(m.phase).toBe('finished');
    expect(m.winnerSeat).toBeGreaterThanOrEqual(0);
    const placed = m.players.filter((p) => p.placement > 0).length;
    expect(placed).toBe(8);
  });
});
