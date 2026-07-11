// EVALS Group P — EV-ELM: the ELEMENTS scaling axis (Phase 7, decision #72). Primordials' pre-Phase-7
// ceiling was the WEAKEST of the nine (only shop-turn / go-wide one-shots, no persistent axis). Elderstorm
// turns every element CHANNELLED over the game into a WHOLE-BOARD payoff: a TIERED breakpoint on the
// persistent `elementsPlayed` counter (incremented in shop.playUnit per Primordial played — a lifetime PLAY
// counter like forgemastersPlayed, NOT a board-state read), firing one cumulative this-combat buff to your
// Primordials per crossed milestone (8/16/24) — a step, not a line, mirroring Ossuary Titan/Magnaforge but
// board-wide. Proves: play increments (persistent, tribe-gated, survives sale) + rides into combat; below
// tier → silent; N crossed tiers → N cumulative buffs on a *witness* Primordial ally (board-wide, not
// self-only); escalating payoffs; this-combat only; and the counters still bite. Design-spec §6.3, §8; #72.
import { describe, it, expect } from 'vitest';
import {
  createShopSession,
  playUnit,
  sellUnit,
  makeInstance,
  boardToCombat,
  resolveCombat,
  getCard,
  getBreakpoint,
  type ShopSession,
  type CombatUnit,
  type CombatBoard,
  type CombatEvent,
  type UnitInstance,
} from '@cardgame/shared';

function session(): ShopSession {
  const s = createShopSession(0, { seed: 'elm' });
  s.round = 3;
  s.tier = 5;
  return s;
}
function onBench(s: ShopSession, cardId: string): UnitInstance {
  const inst = makeInstance(cardId, { uid: `bn${s.uidSeq++}`, bornTurn: s.round });
  s.bench.push(inst);
  return inst;
}
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
function byType<T extends CombatEvent['t']>(evs: CombatEvent[], t: T) {
  return evs.filter((e): e is Extract<CombatEvent, { t: T }> => e.t === t);
}

describe('EV-ELM — elementsPlayed persistent counter (#72)', () => {
  it('EV-ELM-01: playing a Primordial increments elementsPlayed; a non-Primordial does not; it survives a sale and rides into combat', () => {
    const s = session();
    expect(s.elementsPlayed).toBe(0);
    const g1 = onBench(s, 'primordials_gustling'); // no battlecry → clean increment
    playUnit(s, g1.uid);
    expect(s.elementsPlayed).toBe(1);
    // a non-Primordial play does NOT count (tribe-gated)
    playUnit(s, onBench(s, 'corsairs_swab').uid);
    expect(s.elementsPlayed).toBe(1);
    // another element
    playUnit(s, onBench(s, 'primordials_cinderwing').uid);
    expect(s.elementsPlayed).toBe(2);
    // PERSISTENT: selling the played element does NOT decrement (a lifetime play counter)
    sellUnit(s, g1.uid);
    expect(s.elementsPlayed).toBe(2);
    // rides into combat on the CombatBoard scalar
    expect(boardToCombat(s).elementsPlayed).toBe(2);
  });

  it('EV-ELM-02: a golden Primordial still counts as exactly ONE element played (a play, not a stat read)', () => {
    const s = session();
    const g = makeInstance('primordials_gustling', { uid: 'gld', golden: true, bornTurn: s.round });
    s.bench.push(g);
    playUnit(s, g.uid);
    expect(s.elementsPlayed).toBe(1);
  });
});

// ── EV-ELS: Elderstorm — the ELEMENTS scaling capstone (Phase 7, decision #72) ───────────────────
// A TIERED breakpoint on `elementsPlayed` (persistent Primordials-played total) fires one cumulative
// this-combat buff to your Primordials per crossed milestone (8/16/24) — a step, not a line, mirroring
// Magnaforge but on a lifetime PLAY counter. Proves: below tier → silent; N crossed tiers → N cumulative
// buffs on a *witness* Primordial ally (board-wide, not self-only); escalating payoffs; this-combat only;
// and poison still one-shots a buffed body.
describe('EV-ELS — Elderstorm tiered board-wide elements payoff (#72)', () => {
  const bpE = getBreakpoint('primordials_elderstorm');
  const statsFor = (log: CombatEvent[], id: string) =>
    byType(log, 'stats').filter((e) => e.unitId === id);

  // resolve a fight with a fixed `elementsPlayed` scalar; return the buff `stats` events on a WITNESS
  // Primordial ally (a plain Gustling with no start-of-combat effect of its own → its only stats events are
  // Elderstorm's board-wide buffs), proving the payoff is board-wide (not self-only).
  const witnessBuffs = (elementsPlayed: number) => {
    const forge = cu('primordials_elderstorm', { hp: 100000 });
    const ally = cu('primordials_gustling', { hp: 100000 });
    const a: CombatBoard = { units: [forge, ally], playerTier: 6, elementsPlayed };
    const b: CombatBoard = { units: [cu('corsairs_ironclad', { keywords: [], atk: 0, hp: 1 })], playerTier: 6 };
    return statsFor(resolveCombat(a, b, `elm:${elementsPlayed}`), ally.uid);
  };

  it('EV-ELS-01: below the first element-tier → NO board buff fires', () => {
    expect(witnessBuffs(bpE.tiers![0].threshold - 1)).toHaveLength(0);
  });

  it('EV-ELS-02: each crossed element-tier fires one cumulative BOARD-WIDE Primordial buff; payoffs ESCALATE', () => {
    const tiers = bpE.tiers!;
    expect(witnessBuffs(tiers[0].threshold).length).toBe(1); // 8 played → 1 buff on the ally (board-wide)
    expect(witnessBuffs(tiers[1].threshold).length).toBe(2); // 16 → 2
    expect(witnessBuffs(tiers[2].threshold).length).toBe(3); // 24 → 3
    // step-not-line: strictly increasing per-tier payoffs, top ≥1.5× the first (EV-BAL-D shape)
    expect(tiers[1].atk).toBeGreaterThan(tiers[0].atk);
    expect(tiers[2].atk).toBeGreaterThan(tiers[1].atk);
    expect(tiers[2].atk / tiers[0].atk).toBeGreaterThanOrEqual(1.5);
  });

  it('EV-ELS-03: only PRIMORDIALS catch the board buff (filterTribe), not a splashed ally', () => {
    // a non-Primordial ally on the same board is NOT buffed — the payoff is your Primordials only.
    const forge = cu('primordials_elderstorm', { hp: 100000 });
    const primAlly = cu('primordials_gustling', { hp: 100000 });
    const splash = cu('corsairs_ironclad', { hp: 100000, keywords: [] }); // a Corsair riding along
    const a: CombatBoard = { units: [forge, primAlly, splash], playerTier: 6, elementsPlayed: bpE.tiers![2].threshold };
    const b: CombatBoard = { units: [cu('corsairs_ironclad', { keywords: [], atk: 0, hp: 1 })], playerTier: 6 };
    const evs = resolveCombat(a, b, 'elm-filter');
    expect(statsFor(evs, primAlly.uid).length).toBe(3); // the Primordial caught all three tier buffs
    expect(statsFor(evs, splash.uid).length).toBe(0); // the splashed Corsair caught none
  });

  it('EV-ELS-04: the tier buffs are THIS-COMBAT ONLY (never a permanent writeback)', () => {
    for (const e of witnessBuffs(bpE.tiers![2].threshold)) expect(e.permanent).toBeUndefined();
  });

  it('EV-ELS-05: poison one-shots an Elderstorm-buffed body regardless of the board-wide buff (stat-agnostic)', () => {
    // the capstone inflates the whole wide board, but poison ignores stat size (P1): a Primordial that ALSO
    // caught the top-tier board buff still dies to a single poison touch.
    const tower = cu('primordials_gustling', { atk: 40, hp: 40, keywords: [] }); // stand-in for a buffed body, front slot
    const forge = cu('primordials_elderstorm', { hp: 100000, keywords: [] });
    const a: CombatBoard = { units: [tower, forge], playerTier: 6, elementsPlayed: bpE.tiers![2].threshold };
    const b: CombatBoard = { units: [cu('sirens_lurefish', { atk: 2, hp: 2 })], playerTier: 1 }; // poison
    const evs = resolveCombat(a, b, 'elm-psn');
    expect(byType(evs, 'stats').some((e) => e.unitId === tower.uid)).toBe(true); // the board-wide buff landed on the tower
    expect(byType(evs, 'death').some((e) => e.unitId === tower.uid)).toBe(true); // …and poison one-shots it anyway
  });
});
