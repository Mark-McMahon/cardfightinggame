// EVALS.md Group N — EV-CON: Infernal CONSUMPTION vocabulary + cards (Phase 3).
// Property targets: the new engine primitives (destroyAlly / absorbStats / alliesAtMost / leftmostAlly)
// resolve exactly as §6.3/§6.4 specify, and the two Infernal bodies (Gorgemaw / Cindermarshal) read
// their numbers from config. Combat-visible pieces are additionally locked as determinism goldens.
// Design-spec §6.3, §6.4, §6.9; requirements #44.
import { describe, it, expect } from 'vitest';
import {
  resolveCombat,
  getCard,
  engines,
  createShopSession,
  makeInstance,
  playUnit,
  resolveTargetChoice,
  type CombatUnit,
  type CombatBoard,
  type CombatEvent,
} from '@cardgame/shared';

const I = engines.infernals;
let __uid = 0;
function cu(cardId: string, o: Partial<CombatUnit> = {}): CombatUnit {
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
    ...o,
  };
}
const board = (units: CombatUnit[], playerTier = 1): CombatBoard => ({ units, playerTier });
const vanilla = (atk: number, hp: number, o: Partial<CombatUnit> = {}) =>
  cu('corsairs_ironclad', { keywords: [], effects: [], atk, hp, ...o });
const fillers = (n: number) => Array.from({ length: n }, () => vanilla(0, 100000));
function statsFor(log: CombatEvent[], id: string) {
  return log.filter((e): e is Extract<CombatEvent, { t: 'stats' }> => e.t === 'stats' && e.unitId === id);
}
function kwFor(log: CombatEvent[], id: string) {
  return log.filter((e): e is Extract<CombatEvent, { t: 'keyword' }> => e.t === 'keyword' && e.unitId === id);
}

// ── leftmostAlly selector (positional) + alliesAtMost gate, exercised via Cindermarshal ───────────
describe('EV-CON — leftmostAlly selector & alliesAtMost gate (Cindermarshal)', () => {
  it('EV-CON-01: leftmostAlly is board-index-0 — Cindermarshal buffs the front unit, not itself', () => {
    // witness at index 0, Cindermarshal at index 1 (board of 3 ≤ threshold). Only the witness is buffed.
    const witness = vanilla(0, 100000);
    const march = cu('infernals_cindermarshal', { hp: 100000 });
    const log = resolveCombat(board([witness, march, vanilla(0, 100000)]), board([vanilla(0, 100000)]), 'con01');
    const w = statsFor(log, witness.uid).find((e) => e.atk === I.loneVanguardBuffAtk);
    expect(w).toBeTruthy(); // leftmost (index 0) got +atk
    expect(statsFor(log, march.uid).some((e) => e.atk > getCard('infernals_cindermarshal').atk)).toBe(false); // self did not
  });

  it('EV-CON-02: alliesAtMost fires AT/below the threshold and NOT above it (a go-tall gate)', () => {
    const run = (allies: number) => {
      const witness = vanilla(0, 100000);
      const march = cu('infernals_cindermarshal', { hp: 100000 });
      const log = resolveCombat(board([witness, march, ...fillers(allies - 2)]), board([vanilla(0, 100000)]), `con02:${allies}`);
      return statsFor(log, witness.uid).some((e) => e.atk === I.loneVanguardBuffAtk);
    };
    expect(run(I.loneVanguardAllyThreshold)).toBe(true); // exactly at the cap → fires
    expect(run(I.loneVanguardAllyThreshold + 1)).toBe(false); // one over → suppressed
  });

  it('EV-CON-03: Cindermarshal grants +atk/+hp AND Taunt, THIS COMBAT ONLY (never a permanent writeback)', () => {
    const witness = vanilla(1, 100000);
    const march = cu('infernals_cindermarshal', { hp: 100000 });
    const log = resolveCombat(board([witness, march]), board([vanilla(0, 100000)]), 'con03');
    const buff = statsFor(log, witness.uid).find((e) => e.atk === 1 + I.loneVanguardBuffAtk && e.hp === 100000 + I.loneVanguardBuffHp);
    expect(buff).toBeTruthy();
    expect(buff!.permanent).toBeUndefined(); // permanent:false → no permanent payload → the fold ignores it
    expect(kwFor(log, witness.uid).some((e) => e.keyword === 'taunt' && e.gained === true)).toBe(true);
  });
});

// ── destroyAlly + absorbStats (shop-phase), exercised via Gorgemaw's battlecry ────────────────────
describe('EV-CON — Gorgemaw consumption (destroyAlly + absorbStats)', () => {
  function eat(victimCard: string, golden = false) {
    const s = createShopSession(0, { seed: 'con-eat' });
    s.round = 1;
    const victim = makeInstance(victimCard, { uid: 'v', golden, bornTurn: 1 });
    s.board = [victim];
    const maw = makeInstance('infernals_gorgemaw', { uid: 'm', bornTurn: 1 });
    s.bench = [maw];
    const play = playUnit(s, 'm');
    return { s, victim, maw, play };
  }

  it('EV-CON-04: destroy a chosen friendly and permanently ABSORB its stats; keywords NOT transferred; lifetime++', () => {
    // Pearlguard is a 2/3 with divineShield+taunt — a live keyword carrier.
    const { s, victim, maw } = eat('reefkin_pearlguard');
    expect(s.pendingTarget?.legalTargets).toEqual(['v']); // armed on the chosen ally
    const before = { atk: maw.atk, hp: maw.hp };
    resolveTargetChoice(s, 'v');
    expect(maw.atk).toBe(before.atk + victim.atk); // absorbed the victim's live atk/hp
    expect(maw.hp).toBe(before.hp + victim.hp);
    expect(maw.keywords).toEqual([]); // Gorgemaw is keyword-less — divineShield/taunt did NOT transfer
    expect(s.board.map((u) => u.uid)).toEqual(['m']); // the victim was destroyed
    expect(s.lifetimeFriendlyDeaths).toBe(1); // a shop-phase destroy is a lifetime friendly death
  });

  it('EV-CON-05: a GOLDEN target is absorbed at its DOUBLED current stats (absorb reads live stats)', () => {
    const goldMult = getCard('reefkin_pearlguard'); // 2/3 base
    const { s, victim, maw } = eat('reefkin_pearlguard', true);
    expect(victim.atk).toBe(goldMult.atk * 2); // golden = ×2
    expect(victim.hp).toBe(goldMult.hp * 2);
    const before = { atk: maw.atk, hp: maw.hp };
    resolveTargetChoice(s, 'v');
    expect(maw.atk).toBe(before.atk + goldMult.atk * 2);
    expect(maw.hp).toBe(before.hp + goldMult.hp * 2);
  });

  it('EV-CON-06: no legal target (Gorgemaw alone on board) → the battlecry FIZZLES (D5), no crash, no lifetime change', () => {
    const s = createShopSession(0, { seed: 'con-fizzle' });
    s.round = 1;
    s.bench = [makeInstance('infernals_gorgemaw', { uid: 'm', bornTurn: 1 })];
    const play = playUnit(s, 'm');
    expect(play.ok).toBe(true);
    expect(s.pendingTarget).toBeNull(); // nothing to eat → never armed
    expect(s.lifetimeFriendlyDeaths).toBe(0);
    expect(s.board.map((u) => u.uid)).toEqual(['m']);
  });
});
