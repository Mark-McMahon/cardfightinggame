// EVALS.md Group N — EV-LFT / EV-OSS / EV-GRM: Revenant LIFETIME-death scaling (Phase 3).
//  • EV-LFT: the PERSISTENT per-player lifetimeFriendlyDeaths counter is accurate across MULTIPLE
//    combats AND shop-phase sacrifices, and GHOST boards never accrue.
//  • EV-OSS: Ossuary Titan is a DISCRETE, ESCALATING breakpoint on lifetimeDeaths (a step, not a line).
//  • EV-GRM: Gravemonarch permanently doubles ONLY when 5+ friendlies died this combat AND it survived
//    (incl. the Reborn-survivor edge); the double folds onto the PERSISTENT instance (writeback-multiply).
// Design-spec §6.6, §7.5; requirements #44, #45, #46.
import { describe, it, expect } from 'vitest';
import {
  resolveCombat,
  getCard,
  getBreakpoint,
  engines,
  Match,
  makeInstance,
  playUnit,
  resolveTargetChoice,
  foldPermanentBuffs,
  type CombatUnit,
  type CombatBoard,
  type CombatEvent,
  type SeatConfig,
  type UnitInstance,
} from '@cardgame/shared';

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
const board = (units: CombatUnit[], playerTier = 1, lifetimeDeaths = 0): CombatBoard => ({ units, playerTier, lifetimeDeaths });
const vanilla = (atk: number, hp: number, o: Partial<CombatUnit> = {}) =>
  cu('corsairs_ironclad', { keywords: [], effects: [], atk, hp, ...o });
const chaff = (n: number) => Array.from({ length: n }, () => cu('wildkin_thornpup', { atk: 0, hp: 1 }));
// five start-of-combat destroyers (each eats one lowest-atk ally) → a deterministic N friendly deaths.
const DESTROYERS = ['infernals_hollowpriest', 'infernals_pyrewalker', 'infernals_dreadmaw', 'sirens_maelstromcantor', 'infernals_hollowpriest'];
const destroyers = (n: number) => DESTROYERS.slice(0, n).map((id) => cu(id, { hp: 100 }));
const seats = (n: number): SeatConfig[] => Array.from({ length: n }, (_, i) => ({ name: `P${i}`, isBot: true }));
const permStats = (log: CombatEvent[]) =>
  log.filter((e): e is Extract<CombatEvent, { t: 'stats' }> => e.t === 'stats' && e.permanent === true);
const endOf = (log: readonly CombatEvent[]) => log.find((e): e is Extract<CombatEvent, { t: 'combatEnd' }> => e.t === 'combatEnd')!;
const statsFor = (log: CombatEvent[], id: string) =>
  log.filter((e): e is Extract<CombatEvent, { t: 'stats' }> => e.t === 'stats' && e.unitId === id);

// ── EV-LFT: persistent lifetime-death accuracy ────────────────────────────────────────────────
describe('EV-LFT — persistent lifetimeFriendlyDeaths accuracy', () => {
  it('EV-LFT-01: friendly combat deaths accrue to the persistent counter, and COMPOUND across combats', () => {
    const m = new Match('lft01', seats(2));
    // p0's two 0/1 chaff die every combat (pure combat never removes them from the persistent board);
    // p1's single 5/10 body survives → p1 accrues nothing.
    m.sessions[0].board = [makeInstance('wildkin_thornpup', { uid: '0a', atk: 0, hp: 1 }), makeInstance('wildkin_thornpup', { uid: '0b', atk: 0, hp: 1 })];
    m.sessions[1].board = [makeInstance('corsairs_ironclad', { uid: '1a', atk: 5, hp: 10 })];

    m.resolveCombatPhase();
    expect(m.sessions[0].lifetimeFriendlyDeaths).toBe(2);
    expect(m.sessions[1].lifetimeFriendlyDeaths).toBe(0);

    m.resolveCombatPhase(); // same boards → two more deaths compound
    expect(m.sessions[0].lifetimeFriendlyDeaths).toBe(4);
    expect(m.sessions[1].lifetimeFriendlyDeaths).toBe(0);
  });

  it('EV-LFT-02: a shop-phase sacrifice (Gorgemaw destroyAlly) increments the SAME counter as combat deaths', () => {
    const m = new Match('lft02', seats(2));
    // seat 0: eat a spare body in the shop (+1 lifetime), then lose a chaff in combat (+1) → 2 total.
    m.sessions[0].board = [makeInstance('wildkin_thornpup', { uid: '0v', atk: 0, hp: 1 })];
    m.sessions[0].bench = [makeInstance('infernals_gorgemaw', { uid: '0m' })];
    m.sessions[1].board = [makeInstance('corsairs_ironclad', { uid: '1a', atk: 5, hp: 10 })];

    playUnit(m.sessions[0], '0m'); // arms on the thornpup
    resolveTargetChoice(m.sessions[0], '0v'); // sacrifice it
    expect(m.sessions[0].lifetimeFriendlyDeaths).toBe(1); // shop sacrifice counted
    expect(m.sessions[0].board.map((u) => u.uid)).toEqual(['0m']); // Gorgemaw is what remains

    // Gorgemaw (now 3/4) still dies to the 5/10 → +1 combat death → 2 total.
    m.resolveCombatPhase();
    expect(m.sessions[0].lifetimeFriendlyDeaths).toBe(2);
  });

  it('EV-LFT-03: GHOST boards never accrue — a dead player’s lifetime counter is frozen across ghost fights', () => {
    const m = new Match('lft03', seats(4));
    for (let i = 0; i < 3; i++) m.sessions[i].board = [makeInstance('corsairs_ironclad', { uid: `${i}a`, atk: 4, hp: 20 })];
    // seat 3 fields two chaff on an about-to-die hero; they die round 1, then it is the ghost.
    m.sessions[3].board = [makeInstance('wildkin_thornpup', { uid: '3a', atk: 0, hp: 1 }), makeInstance('wildkin_thornpup', { uid: '3b', atk: 0, hp: 1 })];
    m.state.players[3].hp = 0; // eliminated after round 1

    m.resolveCombatPhase();
    expect(m.state.players[3].alive).toBe(false);
    const frozen = m.sessions[3].lifetimeFriendlyDeaths; // whatever it accrued while ALIVE

    for (let round = 2; round <= 3; round++) {
      m.resolveCombatPhase();
      const ghostPairing = m.state.pairings.find((p) => p.ghost);
      expect(ghostPairing).toBeTruthy(); // a ghost fight really happened
      // the ghost's chaff die again in the ghost fight, but the DEAD player's counter never moves
      expect(m.sessions[3].lifetimeFriendlyDeaths).toBe(frozen);
    }
  });
});

// ── EV-OSS: Ossuary Titan discrete escalating breakpoints ─────────────────────────────────────
describe('EV-OSS — Ossuary Titan tiered lifetime breakpoints (step, not line)', () => {
  const bp = getBreakpoint('revenants_ossuarytitan');
  const base = getCard('revenants_ossuarytitan');

  const buffsAt = (lifetime: number) => {
    const oss = cu('revenants_ossuarytitan', { hp: 100000 });
    const log = resolveCombat(board([oss], 1, lifetime), board([vanilla(0, 100000)]), `oss:${lifetime}`);
    return statsFor(log, oss.uid);
  };

  it('EV-OSS-01: below the first tier → NO buff fires', () => {
    expect(buffsAt(bp.tiers![0].threshold - 1)).toHaveLength(0);
  });

  it('EV-OSS-02: each crossed tier fires one cumulative self-buff; the step payoffs ESCALATE (non-linear)', () => {
    const tiers = bp.tiers!;
    // one buff per crossed tier
    expect(buffsAt(tiers[0].threshold).length).toBe(1);
    expect(buffsAt(tiers[1].threshold).length).toBe(2);
    expect(buffsAt(tiers[2].threshold).length).toBe(3);
    // cumulative atk at the top tier = base + Σ tier atk
    const sumAtk = tiers.reduce((s, t) => s + t.atk, 0);
    const top = buffsAt(tiers[2].threshold);
    expect(top[top.length - 1].atk).toBe(base.atk + sumAtk);
    // step-not-line: the per-tier payoffs strictly increase (marginal reward rises with each tier)
    expect(tiers[1].atk).toBeGreaterThan(tiers[0].atk);
    expect(tiers[2].atk).toBeGreaterThan(tiers[1].atk);
    const ratio = tiers[2].atk / tiers[0].atk;
    expect(ratio).toBeGreaterThanOrEqual(1.5); // EV-BAL-D shape (top step ≥1.5× the first)
  });

  it('EV-OSS-03: the tier buffs are THIS-COMBAT ONLY (never a permanent writeback)', () => {
    for (const e of buffsAt(bp.tiers![2].threshold)) expect(e.permanent).toBeUndefined();
  });
});

// ── EV-GRM: Gravemonarch contested-condition double ───────────────────────────────────────────
describe('EV-GRM — Gravemonarch survive-a-near-wipe double (writeback-multiply)', () => {
  const V = engines.revenants;
  const gmPerm = (log: CombatEvent[], id: string) =>
    permStats(log).filter((e) => e.unitId === id && e.permanentFactor != null);

  it('EV-GRM-01: 5+ friendly deaths this combat AND survived → a permanent ×factor writeback event fires', () => {
    const gm = cu('revenants_gravemonarch', { uid: 'gm', hp: 100000, keywords: [] });
    const log = resolveCombat(board([gm, ...chaff(5), ...destroyers(5)]), board([vanilla(0, 100000)]), 'grm01');
    expect(endOf(log).deathsA).toBeGreaterThanOrEqual(V.graveEmperorDeathThreshold);
    expect(endOf(log).survivorsA).toContain('gm');
    const perm = gmPerm(log, 'gm');
    expect(perm).toHaveLength(1);
    expect(perm[0].permanentFactor).toBe(V.graveEmperorFactor);
  });

  it('EV-GRM-02: only 4 deaths (below the threshold) → NO double', () => {
    const gm = cu('revenants_gravemonarch', { uid: 'gm', hp: 100000, keywords: [] });
    const log = resolveCombat(board([gm, ...chaff(4), ...destroyers(4)]), board([vanilla(0, 100000)]), 'grm02');
    expect(endOf(log).deathsA).toBe(V.graveEmperorDeathThreshold - 1);
    expect(gmPerm(log, 'gm')).toHaveLength(0);
  });

  it('EV-GRM-03: Gravemonarch DIES (reborn stripped) with 5+ deaths → NO double (it must survive)', () => {
    const gm = cu('revenants_gravemonarch', { uid: 'gm', atk: 6, hp: 7, keywords: [] });
    const log = resolveCombat(board([gm, ...chaff(5), ...destroyers(5)]), board([vanilla(50, 50)]), 'grm03');
    expect(endOf(log).survivorsA).not.toContain('gm');
    expect(gmPerm(log, 'gm')).toHaveLength(0);
  });

  it('EV-GRM-04: a REBORN return counts as surviving; the double folds onto the PERSISTENT instance (not its 1-hp combat state)', () => {
    // gm dies once (Reborn → 6/1), a big ally finishes the lone 7/1 enemy, gm survives via the reborn body.
    const gm = cu('revenants_gravemonarch', { uid: 'gm', atk: 6, hp: 7 }); // Reborn kept
    const log = resolveCombat(board([gm, ...chaff(5), ...destroyers(4), vanilla(20, 20)]), board([vanilla(7, 1)]), 'grm04');
    expect(log.some((e) => e.t === 'death' && e.unitId === 'gm')).toBe(true); // it really died
    expect(endOf(log).survivorsA).toContain('gm'); // ...and returned as a survivor
    const perm = gmPerm(log, 'gm');
    expect(perm).toHaveLength(1);

    // The persistent instance is 6/7 (its combat state was the 6/1 reborn body). The fold multiplies the
    // PERSISTENT stats by the factor — 6/7 → 12/14 — NOT the 1-hp combat body.
    const persistent: UnitInstance = makeInstance('revenants_gravemonarch', { uid: 'gm' }); // 6/7
    foldPermanentBuffs(log, [persistent], endOf(log).survivorsA ?? [], 'a');
    expect(persistent.atk).toBe(6 * V.graveEmperorFactor);
    expect(persistent.hp).toBe(7 * V.graveEmperorFactor);
  });
});
