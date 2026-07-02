// EVALS.md Group B — Keywords (interface: COMBAT). Written to intent (design-spec §7.2, §6.5,
// keywords.ts). Black-box over the CombatEvent[] stream.
import { describe, it, expect } from 'vitest';
import {
  resolveCombat,
  getCard,
  combat as combatCfg,
  triples,
  type CombatUnit,
  type CombatBoard,
  type CombatEvent,
  type Effect,
} from '@cardgame/shared';

let __uid = 0;
function cu(cardId: string, overrides: Partial<CombatUnit> = {}): CombatUnit {
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
    ...overrides,
  };
}
function board(units: CombatUnit[], playerTier = 1): CombatBoard {
  return { units, playerTier };
}
function byType<T extends CombatEvent['t']>(evs: CombatEvent[], t: T) {
  return evs.filter((e): e is Extract<CombatEvent, { t: T }> => e.t === t);
}
function idxOf(evs: CombatEvent[], pred: (e: CombatEvent) => boolean) {
  return evs.findIndex(pred);
}
const SEED = 'seed-kw';
// vanilla body: no keywords / effects, tunable stats
const vanilla = (atk: number, hp: number, o: Partial<CombatUnit> = {}) =>
  cu('corsairs_ironclad', { keywords: [], effects: [], atk, hp, ...o });

describe('EV-KW — keywords', () => {
  it('EV-KW-TAUNT: defender pick is restricted to taunt units while any live', () => {
    const attacker = vanilla(1, 100000); // tiny atk so nothing dies; observe many picks
    const tauntU = cu('corsairs_ironclad', { keywords: ['taunt'], effects: [], atk: 1, hp: 100000 });
    const nonTaunt = vanilla(1, 100000);
    const evs = resolveCombat(board([attacker]), board([tauntU, nonTaunt]), SEED);
    const aAttacks = byType(evs, 'attack').filter((e) => e.side === 'a');
    expect(aAttacks.length).toBeGreaterThan(0);
    for (const e of aAttacks) expect(e.defenderId).toBe(tauntU.uid); // taunt override forces the taunt
  });

  it('EV-KW-DS-01: first hit fully negated, shield consumed, shieldBroken=true, onShieldBreak fires immediately', () => {
    const pearl = cu('reefkin_pearlguard'); // DS + taunt; onShieldBreak → board +1/+3
    const attacker = vanilla(2, 20);
    const evs = resolveCombat(board([attacker]), board([pearl]), SEED);
    const firstHit = byType(evs, 'damage').find((e) => e.targetId === pearl.uid);
    expect(firstHit?.shieldBroken).toBe(true);
    // onShieldBreak resolves immediately: a stats buff on the shielded unit follows that hit
    const hitIdx = idxOf(evs, (e) => e.t === 'damage' && (e as any).targetId === pearl.uid && (e as any).shieldBroken === true);
    const buffIdx = idxOf(evs, (e) => e.t === 'stats' && (e as any).unitId === pearl.uid);
    expect(buffIdx).toBeGreaterThan(hitIdx);
    // the shielded unit is NOT killed by that first instance
    const firstDeath = idxOf(evs, (e) => e.t === 'death' && (e as any).unitId === pearl.uid);
    expect(firstDeath === -1 || firstDeath > hitIdx).toBe(true);
  });

  it('EV-KW-DS-02: divine shield blanks a poison instance; the shielded unit survives it (divineShieldNegatesPoison)', () => {
    expect(combatCfg.divineShieldNegatesPoison).toBe(true); // pin the config the eval names
    const poison = cu('sirens_lurefish', { atk: 2, hp: 1 }); // poison; dies to retaliation after one swing
    const filler = vanilla(0, 100000); // keeps A alive but cannot kill the shielded body
    const shielded = cu('corsairs_ironclad', { keywords: ['divineShield', 'taunt'], effects: [], atk: 2, hp: 100000 });
    const evs = resolveCombat(board([poison, filler]), board([shielded]), SEED);
    const firstHit = byType(evs, 'damage').find((e) => e.targetId === shielded.uid);
    expect(firstHit?.shieldBroken).toBe(true);
    // poison was blanked by the shield → the shielded unit never dies
    expect(byType(evs, 'death').some((e) => e.unitId === shielded.uid)).toBe(false);
  });

  it('EV-KW-PSN-01: poison dealing >0 unblocked damage kills the target regardless of remaining HP', () => {
    const poison = cu('sirens_lurefish', { atk: 1, hp: 20 });
    const bigHp = vanilla(0, 500); // no shield; huge HP; cannot retaliate-kill
    const evs = resolveCombat(board([poison]), board([bigHp]), SEED);
    expect(byType(evs, 'death').some((e) => e.unitId === bigHp.uid)).toBe(true);
  });

  it('EV-KW-PSN-02: poison dealing 0 damage (fully blocked / zero-atk) causes no poison kill', () => {
    const poison = cu('sirens_lurefish', { atk: 0, hp: 20 }); // 0 damage → not >0 → no flag
    const target = vanilla(0, 10);
    const evs = resolveCombat(board([poison]), board([target]), SEED);
    expect(byType(evs, 'death').some((e) => e.unitId === target.uid)).toBe(false);
  });

  it('EV-KW-RBN: reborn returns once — own slot, 1 HP, base atk, buffs dropped, after its deathrattle', () => {
    // Buffed reborn body with a deathrattle. Base card atk = 1.
    const base = getCard('revenants_cryptling');
    const cryptling = cu('revenants_cryptling', { atk: 9, hp: 5 }); // buffed above print
    const killer = vanilla(9, 100000);
    const evs = resolveCombat(board([cryptling]), board([killer]), SEED);

    const deaths = byType(evs, 'death').filter((e) => e.unitId === cryptling.uid);
    expect(deaths.length).toBe(2); // dies, reborn (once), dies again — reborn was stripped
    const firstDeathIdx = idxOf(evs, (e) => e.t === 'death' && (e as any).unitId === cryptling.uid);
    const drIdx = idxOf(evs, (e) => e.t === 'deathrattle' && (e as any).unitId === cryptling.uid);
    expect(drIdx).toBeGreaterThanOrEqual(firstDeathIdx); // deathrattle fires on death
    // after reborn it swings at BASE atk (buffs dropped), same uid (own slot)
    const returnSwing = evs
      .map((e, i) => ({ e, i }))
      .find(({ e, i }) => e.t === 'damage' && (e as any).sourceId === cryptling.uid && i > drIdx);
    expect(returnSwing).toBeTruthy();
    expect((returnSwing!.e as any).amount).toBe(base.atk); // base card atk, not the +9 buff

    // golden reborn returns at base atk × goldenStatMultiplier
    const golden = cu('revenants_cryptling', { golden: true, atk: 12, hp: 5 });
    const evs2 = resolveCombat(board([golden]), board([vanilla(12, 100000)]), SEED);
    const gDeath = idxOf(evs2, (e) => e.t === 'death' && (e as any).unitId === golden.uid);
    const gSwing = evs2
      .map((e, i) => ({ e, i }))
      .find(({ e, i }) => e.t === 'damage' && (e as any).sourceId === golden.uid && i > gDeath);
    expect((gSwing!.e as any).amount).toBe(base.atk * triples.goldenStatMultiplier);
  });

  it('EV-KW-CLV: cleave hits L/R neighbors for atk·cleaveDefault (rounded); the center takes full', () => {
    const cleaver = cu('primordials_gustling', { keywords: ['cleave'], effects: [], atk: 4, hp: 100000 });
    const left = vanilla(1, 100000);
    const center = cu('corsairs_ironclad', { keywords: ['taunt'], effects: [], atk: 1, hp: 100000 }); // taunt → forced defender
    const right = vanilla(1, 100000);
    const evs = resolveCombat(board([cleaver]), board([left, center, right]), SEED);
    const cleaveDmg = byType(evs, 'damage').filter((e) => e.sourceId === cleaver.uid);
    const splash = Math.round(cleaver.atk * combatCfg.cleaveDefault);
    expect(cleaveDmg.some((e) => e.targetId === center.uid && e.amount === cleaver.atk)).toBe(true);
    expect(cleaveDmg.some((e) => e.targetId === left.uid && e.amount === splash)).toBe(true);
    expect(cleaveDmg.some((e) => e.targetId === right.uid && e.amount === splash)).toBe(true);
  });

  it('EV-KW-CLV-DS (D3ii): cleave neighbors are recomputed against the post-insert line after an onShieldBreak summon', () => {
    // Synthesized defender (live primitives only: onShieldBreak trigger + summon action) — no shipped
    // card summons on shield-break, but the D3ii engine rule must still hold for such an effect.
    const summonOnBreak: Effect = {
      trigger: { type: 'onShieldBreak' },
      target: { selector: 'self' },
      actions: [{ type: 'summon', summonUnitId: 'wildkin_thornpup', summonCount: 1 }],
    };
    const cleaver = cu('primordials_gustling', { keywords: ['cleave'], effects: [], atk: 4, hp: 100000 });
    // lone shielded taunt: pre-break it has NO neighbor; the shield-break insert CREATES one.
    const center = cu('corsairs_ironclad', {
      keywords: ['divineShield', 'taunt'],
      effects: [summonOnBreak],
      atk: 1,
      hp: 100000,
    });
    const evs = resolveCombat(board([cleaver]), board([center]), SEED);

    expect(byType(evs, 'damage').some((e) => e.targetId === center.uid && e.shieldBroken === true)).toBe(true);
    const summon = byType(evs, 'summon')[0];
    expect(summon).toBeTruthy();
    const insertedUid = summon.unitIds[0];
    // stale index → the summoned unit is never a cleave target; recomputed → it takes splash damage
    const splash = Math.round(cleaver.atk * combatCfg.cleaveDefault);
    expect(byType(evs, 'damage').some((e) => e.sourceId === cleaver.uid && e.targetId === insertedUid && e.amount === splash)).toBe(true);
  });

  // EV-KW-MAG (the reserved-no-op pin) is RETIRED (Phase 5, decision #54): `magnetic` is now LIVE — the
  // Constructs merge system. Its behavior is pinned by the EV-MAG family (shared/engine/magnetic.test.ts)
  // + the determinism golden EV-GLD-15. As a combat body, a magnetic minion still fights identically to a
  // vanilla one (magnetic is a SHOP-phase merge tag, no combat effect) — pinned here so that stays true.
  it('EV-KW-MAG-BODY: a magnetic body has no COMBAT effect (magnetic is a shop-phase merge tag)', () => {
    const magnetic = cu('corsairs_ironclad', { keywords: ['magnetic'], effects: [], atk: 3, hp: 20 });
    const foe = vanilla(2, 20);
    const evs = resolveCombat(board([magnetic]), board([foe]), SEED);
    expect(byType(evs, 'combatEnd').length).toBe(1);
    expect(byType(evs, 'keyword').some((e) => e.keyword === 'magnetic')).toBe(false);
    expect(byType(evs, 'damage').some((e) => e.sourceId === magnetic.uid && e.amount === magnetic.atk)).toBe(true);
  });
});
