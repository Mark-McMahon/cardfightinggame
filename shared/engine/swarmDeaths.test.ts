// EVALS Group P — EV-SWD: the Wildkin SWARM↔DEATHS scaling capstone (Phase 7, decision #74). Wildkin was the
// weakest tribe — a wide board of modest tokens with only a flat, width-capped Grovelord buff. Thornqueen turns
// the swarm's endless FALLEN into a whole-board payoff: a TIERED breakpoint on the PERSISTENT `lifetimeDeaths`
// counter (REUSED from Ossuary Titan — no new plumbing; combat deaths incl. tokens feed it via match.ts), firing
// one cumulative this-combat buff to your WILDKIN per crossed milestone (8/16/24). Proves: below tier → silent;
// N crossed tiers → N cumulative buffs on a *witness* Wildkin ally (board-wide, not self-only); escalating;
// Wildkin-only via filterTribe; this-combat only; and poison still one-shots a buffed body. Design-spec §6.6, §8; #74.
import { describe, it, expect } from 'vitest';
import {
  resolveCombat,
  getCard,
  getBreakpoint,
  type CombatUnit,
  type CombatBoard,
  type CombatEvent,
} from '@cardgame/shared';

let __uid = 0;
function cu(cardId: string, o: Partial<CombatUnit> = {}): CombatUnit {
  const c = getCard(cardId);
  return {
    uid: `${cardId}#${++__uid}`, cardId, name: c.name, tribe: c.tribe, tier: c.tier,
    atk: o.atk ?? c.atk, hp: o.hp ?? c.hp, keywords: o.keywords ?? [...c.keywords],
    golden: false, isToken: !!c.isToken, effects: c.effects, auras: c.auras ?? [],
  };
}
const byType = <T extends CombatEvent['t']>(evs: CombatEvent[], t: T) =>
  evs.filter((e): e is Extract<CombatEvent, { t: T }> => e.t === t);

describe('EV-SWD — Thornqueen tiered board-wide lifetime-deaths payoff (#74)', () => {
  const bpQ = getBreakpoint('wildkin_thornqueen');
  const statsFor = (log: CombatEvent[], id: string) => byType(log, 'stats').filter((e) => e.unitId === id);

  // resolve a fight with a fixed `lifetimeDeaths` scalar; return the buff `stats` events on a WITNESS Wildkin ally
  // (a plain Thornpup token with no start-of-combat effect → its only stats events are Thornqueen's board buffs).
  const witnessBuffs = (lifetimeDeaths: number) => {
    const queen = cu('wildkin_thornqueen', { hp: 100000, keywords: [] });
    const ally = cu('wildkin_thornpup', { hp: 100000 });
    const a: CombatBoard = { units: [queen, ally], playerTier: 6, lifetimeDeaths };
    const b: CombatBoard = { units: [cu('corsairs_ironclad', { keywords: [], atk: 0, hp: 1 })], playerTier: 6 };
    return statsFor(resolveCombat(a, b, `swd:${lifetimeDeaths}`), ally.uid);
  };

  it('EV-SWD-01: below the first death-tier → NO board buff fires', () => {
    expect(witnessBuffs(bpQ.tiers![0].threshold - 1)).toHaveLength(0);
  });

  it('EV-SWD-02: each crossed death-tier fires one cumulative BOARD-WIDE Wildkin buff; payoffs ESCALATE', () => {
    const tiers = bpQ.tiers!;
    expect(witnessBuffs(tiers[0].threshold).length).toBe(1); // 8 deaths → 1 buff on the ally (board-wide)
    expect(witnessBuffs(tiers[1].threshold).length).toBe(2); // 16 → 2
    expect(witnessBuffs(tiers[2].threshold).length).toBe(3); // 24 → 3
    expect(tiers[1].atk).toBeGreaterThan(tiers[0].atk);
    expect(tiers[2].atk).toBeGreaterThan(tiers[1].atk);
    expect(tiers[2].atk / tiers[0].atk).toBeGreaterThanOrEqual(1.5);
  });

  it('EV-SWD-03: only WILDKIN catch the board buff (filterTribe), not a splashed ally', () => {
    const queen = cu('wildkin_thornqueen', { hp: 100000, keywords: [] });
    const wild = cu('wildkin_thornpup', { hp: 100000 });
    const splash = cu('corsairs_ironclad', { hp: 100000, keywords: [] }); // a Corsair riding along
    const a: CombatBoard = { units: [queen, wild, splash], playerTier: 6, lifetimeDeaths: bpQ.tiers![2].threshold };
    const b: CombatBoard = { units: [cu('corsairs_ironclad', { keywords: [], atk: 0, hp: 1 })], playerTier: 6 };
    const evs = resolveCombat(a, b, 'swd-filter');
    expect(statsFor(evs, wild.uid).length).toBe(3); // the Wildkin caught all three tier buffs
    expect(statsFor(evs, splash.uid).length).toBe(0); // the splashed Corsair caught none
  });

  it('EV-SWD-04: the tier buffs are THIS-COMBAT ONLY (never a permanent writeback)', () => {
    for (const e of witnessBuffs(bpQ.tiers![2].threshold)) expect(e.permanent).toBeUndefined();
  });

  it('EV-SWD-05: poison one-shots a Thornqueen-buffed body regardless of the board-wide buff (stat-agnostic)', () => {
    const tower = cu('wildkin_thornpup', { atk: 40, hp: 40, keywords: [] }); // stand-in for a buffed swarm body, front slot
    const queen = cu('wildkin_thornqueen', { hp: 100000, keywords: [] });
    const a: CombatBoard = { units: [tower, queen], playerTier: 6, lifetimeDeaths: bpQ.tiers![2].threshold };
    const b: CombatBoard = { units: [cu('sirens_lurefish', { atk: 2, hp: 2 })], playerTier: 1 }; // poison
    const evs = resolveCombat(a, b, 'swd-psn');
    expect(byType(evs, 'stats').some((e) => e.unitId === tower.uid)).toBe(true); // the board-wide buff landed
    expect(byType(evs, 'death').some((e) => e.unitId === tower.uid)).toBe(true); // …and poison one-shots it anyway
  });
});
