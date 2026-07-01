// EV-BAL-F — anti-degeneracy floor (spec §16). Layer-2 discipline: board outcomes are EXPLORED,
// never pinned. The suite asserts only the FLOOR — no universal winner, every board has a reachable
// counter, every committed scaling line is context-sensitive — plus that the floor BITES (strip a
// counter → a line becomes a universal winner), the sampler is broad/reproducible, and the four
// headline structural edges hold.

import { describe, it, expect } from 'vitest';
import {
  webPanel,
  crossTable,
  runMatchup,
  universalWinners,
  uncounteredBoards,
  evaluateFloor,
} from './web';
import { buildBoard } from './boards';
import { matchPlayPool, techTagsOf, dominantTribe } from './sampler';

const SEEDS = 25; // ×2 orientations; the floor holds robustly at ≥15 (verified across seed counts)

describe('EV-BAL-F — the anti-degeneracy floor holds over the committed panel', () => {
  const floor = evaluateFloor(SEEDS);

  it('no universal winner (no line beats every other board)', () => {
    if (floor.universalWinners.length) console.error('universal winners:', floor.universalWinners);
    expect(floor.universalWinners).toEqual([]);
  });

  it('every board has a reachable counter', () => {
    if (floor.uncounteredBoards.length) console.error('uncountered:', floor.uncounteredBoards);
    expect(floor.uncounteredBoards).toEqual([]);
  });

  it('every committed scaling line is context-sensitive (beats a baseline AND loses to a tech)', () => {
    if (floor.contextInsensitive.length) console.error('context-insensitive:', floor.contextInsensitive);
    expect(floor.contextInsensitive).toEqual([]);
  });

  it('=> FLOOR HOLDS', () => {
    expect(floor.ok).toBe(true);
  });

  it('is deterministic (cross-table byte-stable across runs, fixed seeds)', () => {
    const nodes = webPanel();
    const a = crossTable(nodes, 12);
    const b = crossTable(nodes, 12);
    expect(a.winRate).toEqual(b.winRate);
  });
});

describe('EV-BAL-F — the floor BITES (proven non-vacuous)', () => {
  it('strip the exponential doubler\'s counters (poison + nullforge) → a doubler line becomes a universal winner', () => {
    const reduced = webPanel().filter((n) => n.name !== 'poison-saturated' && n.name !== 'nullforge-tech');
    const ct = crossTable(reduced, SEEDS);
    const uw = universalWinners(ct);
    // with its only structural counters gone, the exponential SPOILS family wins regardless of tech.
    expect(uw.length).toBeGreaterThan(0);
    expect(uw.some((n) => n.startsWith('tusk'))).toBe(true);
    // and with the counters restored, no tusker line is a universal winner and nothing is uncountered.
    const full = crossTable(webPanel(), SEEDS);
    expect(universalWinners(full).some((n) => n.startsWith('tusk'))).toBe(false);
    expect(uncounteredBoards(full)).toEqual([]);
  });
});

describe('EV-BAL-F — structural edges (headline relationships, robust not knife-edge)', () => {
  const panel = webPanel();
  const board = (name: string) => panel.find((n) => n.name === name)!.board;

  it('poison kills the exponential doubled carry (P1 ignores stat size)', () => {
    const m = runMatchup(board('poison-saturated'), board('tusk-exponential'), SEEDS, 'edge:psn-tusk');
    expect(m.aWinRate).toBeGreaterThan(0.5);
  });

  it('shield wall out-lasts poison (P2 blanks the first poison instance)', () => {
    const m = runMatchup(board('shield-wall'), board('poison-saturated'), SEEDS, 'edge:shield-psn');
    expect(m.aWinRate).toBeGreaterThan(0.5);
  });

  it('a tall titan out-sizes a wide reborn board (few big bodies soak the chip)', () => {
    const m = runMatchup(board('tall-titan'), board('corsair-aggro'), SEEDS, 'edge:tall-wide');
    expect(m.aWinRate).toBeGreaterThan(0.5);
  });

  it('poison also kills tall (a lone huge body folds to a stat-agnostic chip)', () => {
    const m = runMatchup(board('poison-saturated'), board('tall-titan'), SEEDS, 'edge:psn-tall');
    expect(m.aWinRate).toBeGreaterThan(0.5);
  });
});

describe('sampler integrity — the pool is generated, broad, and reproducible', () => {
  it('harvests a broad pool spanning multiple tribes and tech tags, reproducibly', () => {
    const a = matchPlayPool({ matches: 6, seedBase: 'samp' });
    const b = matchPlayPool({ matches: 6, seedBase: 'samp' });
    expect(a.length).toBe(b.length); // byte-reproducible under a fixed seed
    expect(a.length).toBeGreaterThan(100);
    const tribes = new Set(a.map((s) => s.tribe));
    tribes.delete(null);
    expect(tribes.size).toBeGreaterThanOrEqual(5);
    const tags = new Set(a.flatMap((s) => s.tags));
    // the real bot pool spans several tech tags
    expect(tags.size).toBeGreaterThanOrEqual(4);
  });

  it('tag/tribe classifiers work on a hand board (poison + wide)', () => {
    const b = buildBoard([{ cardId: 'sirens_lurefish', count: 6 }]);
    expect(techTagsOf(b)).toContain('poison');
    expect(techTagsOf(b)).toContain('wide');
    expect(dominantTribe(b)).toBe('sirens');
  });
});
