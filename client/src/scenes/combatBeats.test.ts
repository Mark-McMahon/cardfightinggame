import { describe, it, expect } from 'vitest';
import type { CombatEvent, BoardSnapshot } from '@cardgame/shared';
import { beats, totalWeight, type Beat } from './combatBeats';

// This is the ONE client-logic eval (design-spec §10). It pins the causal-beat segmentation of
// the server's CombatEvent[] — ordering, causal grouping, and pacing weight — so the replay's
// legibility contract can't silently drift.

const snap = (units: Array<{ uid: string; name: string }>): BoardSnapshot => ({
  playerTier: 1,
  units: units.map((u) => ({
    uid: u.uid,
    cardId: 'x',
    name: u.name,
    tribe: 'wildkin',
    tier: 1,
    atk: 1,
    hp: 1,
    keywords: [],
    golden: false,
  })),
});

// A representative fight: start → A strikes B (with a shield break) → B dies (+ deathrattle) →
// the death triggers a board-wide avenge buff → end.
const LOG: CombatEvent[] = [
  { t: 'combatStart', seed: 's', a: snap([{ uid: 'a1', name: 'Alder' }]), b: snap([{ uid: 'b1', name: 'Bram' }, { uid: 'b2', name: 'Bract' }]) },
  { t: 'attack', side: 'a', attackerId: 'a1', defenderId: 'b1' },
  { t: 'damage', sourceId: 'a1', targetId: 'b1', amount: 0, shieldBroken: true },
  { t: 'damage', sourceId: 'a1', targetId: 'b1', amount: 3 },
  { t: 'death', unitId: 'b1' },
  { t: 'deathrattle', unitId: 'b1' },
  { t: 'stats', unitId: 'b2', atk: 3, hp: 4, sourceId: 'b1' },
  { t: 'combatEnd', winner: 'a', survivors: ['a1'], damageToLoser: 2 },
];

const kinds = (bs: Beat[]) => bs.map((b) => b.kind);

describe('combatBeats — causal segmentation', () => {
  it('is a lossless, order-preserving partition of the event stream', () => {
    const bs = beats(LOG);
    // concatenating every beat's events reproduces the input exactly — no drop, reorder, or dup.
    expect(bs.flatMap((b) => b.events)).toEqual(LOG);
  });

  it('is deterministic (same input → deep-equal beats)', () => {
    expect(beats(LOG)).toEqual(beats(LOG));
  });

  it('separates the strike, the deaths it caused, and the death-triggered buffs into ordered beats', () => {
    const bs = beats(LOG);
    expect(kinds(bs)).toEqual(['start', 'strike', 'deaths', 'aftermath', 'end']);

    const strike = bs[1];
    // the strike carries the attack + BOTH its damage events (incl. the shield-break)…
    expect(strike.events.map((e) => e.t)).toEqual(['attack', 'damage', 'damage']);
    // …and NOT the death or the buff — those are downstream causal beats.
    expect(strike.events.some((e) => e.t === 'death' || e.t === 'stats')).toBe(false);
    expect(strike.attackerId).toBe('a1');
    expect(strike.defenderId).toBe('b1');
    expect(strike.side).toBe('a');

    const deaths = bs[2];
    expect(deaths.events.map((e) => e.t)).toEqual(['death', 'deathrattle']);
    expect(deaths.deaths).toEqual(['b1']);

    const aftermath = bs[3];
    expect(aftermath.events.map((e) => e.t)).toEqual(['stats']);
    expect(aftermath.sourceIds).toEqual(['b1']); // the buff is linked back to the unit that died
  });

  it('force-splits consecutive swings into one beat per strike (never merges attacks)', () => {
    const twoSwings: CombatEvent[] = [
      { t: 'combatStart', seed: 's', a: snap([{ uid: 'a1', name: 'A' }]), b: snap([{ uid: 'b1', name: 'B' }]) },
      { t: 'attack', side: 'a', attackerId: 'a1', defenderId: 'b1' },
      { t: 'damage', sourceId: 'a1', targetId: 'b1', amount: 1 },
      { t: 'attack', side: 'b', attackerId: 'b1', defenderId: 'a1' },
      { t: 'damage', sourceId: 'b1', targetId: 'a1', amount: 1 },
      { t: 'combatEnd', winner: 'tie', survivors: [], damageToLoser: 0 },
    ];
    expect(kinds(beats(twoSwings))).toEqual(['start', 'strike', 'strike', 'end']);
  });

  it('groups pre-first-attack effects as startOfCombat, not aftermath', () => {
    const soc: CombatEvent[] = [
      { t: 'combatStart', seed: 's', a: snap([{ uid: 'a1', name: 'A' }]), b: snap([{ uid: 'b1', name: 'B' }]) },
      { t: 'stats', unitId: 'a1', atk: 5, hp: 2, sourceId: 'a1' }, // Infernal self-damage buff, pre-combat
      { t: 'attack', side: 'a', attackerId: 'a1', defenderId: 'b1' },
      { t: 'damage', sourceId: 'a1', targetId: 'b1', amount: 5 },
      { t: 'combatEnd', winner: 'a', survivors: ['a1'], damageToLoser: 1 },
    ];
    expect(kinds(beats(soc))).toEqual(['start', 'startOfCombat', 'strike', 'end']);
  });

  it('weights by impact: more deaths and wider buffs hold longer; start/end hold; trivial strikes are light', () => {
    const oneDeath = beats([{ t: 'death', unitId: 'x1' }])[0];
    const threeDeaths = beats([
      { t: 'death', unitId: 'x1' },
      { t: 'death', unitId: 'x2' },
      { t: 'death', unitId: 'x3' },
    ])[0];
    expect(threeDeaths.weight).toBeGreaterThan(oneDeath.weight);

    const oneBuff = beats([{ t: 'stats', unitId: 'x1', atk: 2, hp: 2, sourceId: 's' }])[0];
    const boardWide = beats([
      { t: 'stats', unitId: 'x1', atk: 2, hp: 2, sourceId: 's' },
      { t: 'stats', unitId: 'x2', atk: 2, hp: 2, sourceId: 's' },
      { t: 'stats', unitId: 'x3', atk: 2, hp: 2, sourceId: 's' },
      { t: 'stats', unitId: 'x4', atk: 2, hp: 2, sourceId: 's' },
    ])[0];
    expect(boardWide.weight).toBeGreaterThan(oneBuff.weight);

    const bs = beats(LOG);
    const strike = bs.find((b) => b.kind === 'strike')!;
    const start = bs.find((b) => b.kind === 'start')!;
    const end = bs.find((b) => b.kind === 'end')!;
    expect(start.weight).toBeGreaterThan(1);
    expect(end.weight).toBeGreaterThan(strike.weight);
    // every beat holds for at least one base step.
    expect(bs.every((b) => b.weight >= 1)).toBe(true);
    expect(totalWeight(bs)).toBeGreaterThan(bs.length); // impactful beats push total dwell above a flat 1-each
  });

  it('handles an empty log without throwing', () => {
    expect(beats([])).toEqual([]);
  });
});
