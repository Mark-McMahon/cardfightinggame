import { describe, it, expect } from 'vitest';
import type { BoardSnapshot, CombatBoard, CombatEvent, Keyword, TribeId } from '@cardgame/shared';
import { resolveCombat, createInstance, toCombatUnit, resetUidCounter } from '@cardgame/shared';
import { buildSteps } from './combatBeats';

// Hand-crafted event streams let us pin the *segmentation* contract precisely — the
// causal ordering and batching that make a swing legible — independent of any card.

type Snap = BoardSnapshot['units'][number];
function snap(uid: string, over: Partial<Snap> = {}): Snap {
  return {
    uid,
    cardId: '',
    name: uid,
    tribe: 'wildkin' as TribeId,
    tier: 1,
    atk: 1,
    hp: 1,
    keywords: [] as Keyword[],
    golden: false,
    ...over,
  };
}
function start(a: Snap[], b: Snap[]): CombatEvent {
  return { t: 'combatStart', seed: 's', a: { playerTier: 1, units: a }, b: { playerTier: 1, units: b } };
}

describe('beat segmentation — causality (no all-at-once)', () => {
  it('strike → death → triggered buff are separate, ordered beats', () => {
    const events: CombatEvent[] = [
      start([snap('A1', { atk: 9, hp: 9 })], [snap('B1', { hp: 5 }), snap('B2', { atk: 1, hp: 1 })]),
      { t: 'attack', side: 'a', attackerId: 'A1', defenderId: 'B1' },
      { t: 'damage', sourceId: 'A1', targetId: 'B1', amount: 9 },
      { t: 'death', unitId: 'B1' },
      { t: 'deathrattle', unitId: 'B1' },
      { t: 'stats', unitId: 'B2', atk: 2, hp: 2, sourceId: 'Bsrc', permanent: true },
      { t: 'combatEnd', winner: 'a', survivors: ['A1'], damageToLoser: 1 },
    ];
    const steps = buildSteps(events, 'a');
    const kinds = steps.map((s) => s.kind);
    const strikeI = kinds.indexOf('strike');
    const deathI = kinds.indexOf('death');
    const buffI = kinds.indexOf('buff');
    expect(strikeI).toBeGreaterThanOrEqual(0);
    expect(deathI).toBeGreaterThan(strikeI); // death is shown after the strike that caused it
    expect(buffI).toBeGreaterThan(deathI); // the buff is shown after the death that triggered it
    expect(steps[strikeI].buffs).toHaveLength(0); // the buff is NOT merged into the strike
    const bf = steps[buffI].buffs[0];
    expect(bf.sourceId).toBe('Bsrc');
    expect(bf.dAtk).toBe(1); // delta preserved (1 → 2)
    expect(bf.dHp).toBe(1);
  });

  it('trivial simultaneous deaths batch into one beat', () => {
    const events: CombatEvent[] = [
      start([snap('A1', { atk: 9, hp: 9 })], [snap('B1'), snap('B2')]),
      { t: 'attack', side: 'a', attackerId: 'A1', defenderId: 'B1' },
      { t: 'damage', sourceId: 'A1', targetId: 'B1', amount: 9 },
      { t: 'death', unitId: 'B1' },
      { t: 'death', unitId: 'B2' },
      { t: 'combatEnd', winner: 'a', survivors: ['A1'], damageToLoser: 1 },
    ];
    expect(buildSteps(events, 'a').filter((s) => s.kind === 'death')).toHaveLength(1);
  });
});

describe('beat segmentation — buff grouping (which unit changed, batched by source)', () => {
  it('a board-wide buff from one source is a single held beat', () => {
    const events: CombatEvent[] = [
      start([snap('A1'), snap('A2'), snap('A3'), snap('A4')], [snap('B1')]),
      { t: 'stats', unitId: 'A2', atk: 2, hp: 2, sourceId: 'S', permanent: true },
      { t: 'stats', unitId: 'A3', atk: 2, hp: 2, sourceId: 'S', permanent: true },
      { t: 'stats', unitId: 'A4', atk: 2, hp: 2, sourceId: 'S', permanent: true },
      { t: 'combatEnd', winner: 'a', survivors: ['A1'], damageToLoser: 0 },
    ];
    const buffs = buildSteps(events, 'a').filter((s) => s.kind === 'buff');
    expect(buffs).toHaveLength(1);
    expect(buffs[0].buffs).toHaveLength(3);
    expect(buffs[0].weight).toBeGreaterThanOrEqual(2); // a real swing → held
  });

  it('buffs from different sources split into separate beats', () => {
    const events: CombatEvent[] = [
      start([snap('A1'), snap('A2')], [snap('B1')]),
      { t: 'stats', unitId: 'A1', atk: 2, hp: 2, sourceId: 'S1', permanent: true },
      { t: 'stats', unitId: 'A2', atk: 2, hp: 2, sourceId: 'S2', permanent: true },
      { t: 'combatEnd', winner: 'a', survivors: ['A1', 'A2'], damageToLoser: 0 },
    ];
    expect(buildSteps(events, 'a').filter((s) => s.kind === 'buff')).toHaveLength(2);
  });

  it('consecutive same-source buffs batch into one beat (permanence no longer splits)', () => {
    const events: CombatEvent[] = [
      start([snap('A1'), snap('A2')], [snap('B1')]),
      // same source S; the (now-ignored) permanent flag differs — they must still batch as ONE beat,
      // since in-combat permanence is not a real distinction.
      { t: 'stats', unitId: 'A1', atk: 2, hp: 2, sourceId: 'S', permanent: true },
      { t: 'stats', unitId: 'A2', atk: 2, hp: 2, sourceId: 'S', permanent: false },
      { t: 'combatEnd', winner: 'a', survivors: ['A1', 'A2'], damageToLoser: 0 },
    ];
    const buffs = buildSteps(events, 'a').filter((s) => s.kind === 'buff');
    expect(buffs).toHaveLength(1);
    expect(buffs[0].buffs).toHaveLength(2);
  });
});

describe('beat segmentation — keyword GAINED mid-combat (Spinefish → Poison)', () => {
  it('a gained keyword is its own beat, names the source, and shows on the recipient card', () => {
    const events: CombatEvent[] = [
      start([snap('A1', { atk: 2, hp: 1 }), snap('A2', { atk: 2, hp: 5 })], [snap('B1', { hp: 9 })]),
      { t: 'attack', side: 'a', attackerId: 'A1', defenderId: 'B1' },
      { t: 'damage', sourceId: 'A1', targetId: 'B1', amount: 2 },
      { t: 'death', unitId: 'A1' },
      { t: 'deathrattle', unitId: 'A1' },
      { t: 'keyword', unitId: 'A2', keyword: 'poison', gained: true, sourceId: 'A1' },
      { t: 'combatEnd', winner: 'a', survivors: ['A2'], damageToLoser: 1 },
    ];
    const steps = buildSteps(events, 'a');
    const gainI = steps.findIndex((s) => s.kind === 'gain');
    expect(gainI).toBeGreaterThanOrEqual(0);
    expect(steps[gainI].gains[0]).toMatchObject({ targetId: 'A2', keyword: 'poison', sourceId: 'A1' });
    // the recipient's card now carries the keyword → its ability icon shows for the rest of replay
    expect(steps[gainI].a.find((u) => u.uid === 'A2')!.keywords).toContain('poison');
    // causal: the grant beat comes after the death that triggered the deathrattle
    expect(steps.slice(0, gainI).some((s) => s.kind === 'death')).toBe(true);
  });

  it('a poison AFFLICTION (no `gained` flag) is not a gain beat', () => {
    const events: CombatEvent[] = [
      start([snap('A1', { atk: 2, hp: 3, keywords: ['poison'] })], [snap('B1', { hp: 9 })]),
      { t: 'attack', side: 'a', attackerId: 'A1', defenderId: 'B1' },
      { t: 'damage', sourceId: 'A1', targetId: 'B1', amount: 2 },
      { t: 'keyword', unitId: 'B1', keyword: 'poison' },
      { t: 'death', unitId: 'B1' },
      { t: 'combatEnd', winner: 'a', survivors: ['A1'], damageToLoser: 1 },
    ];
    const steps = buildSteps(events, 'a');
    expect(steps.some((s) => s.kind === 'gain')).toBe(false);
    expect(steps.some((s) => s.poisoned.includes('B1'))).toBe(true);
  });
});

describe('beat segmentation — real engine output', () => {
  it("Cryptling's deathrattle buff segments as its own beat after a death", () => {
    resetUidCounter();
    const mk = (cardId: string, uid: string, over: Record<string, unknown> = {}) => {
      const cu = toCombatUnit(createInstance(cardId, { uid }));
      Object.assign(cu, over);
      return cu;
    };
    const a: CombatBoard = {
      playerTier: 1,
      units: [
        mk('revenants_cryptling', 'crypt', { atk: 1, hp: 1, keywords: [] }),
        mk('revenants_cryptling', 'ally', { atk: 1, hp: 50, keywords: [] }),
      ],
    };
    const b: CombatBoard = { playerTier: 1, units: [mk('reefkin_brineling', 'killer', { atk: 9, hp: 200 })] };
    const steps = buildSteps(resolveCombat(a, b, 'beats-dr'), 'a');

    const buffIdx = steps.findIndex((s) => s.kind === 'buff' && s.buffs.some((x) => x.targetId === 'ally'));
    expect(buffIdx).toBeGreaterThanOrEqual(0);
    // cause precedes effect: a death beat exists before the buff beat
    expect(steps.slice(0, buffIdx).some((s) => s.kind === 'death')).toBe(true);
  });
});
