// EVALS.md Group L — EV-WBK: combat → persistent-board writeback fold (spec §7.5, decision #38;
// closes §7.6 item 5). Interfaces: COMBAT (the permanent/dAtk/dHp/survivorsA/B event payload) +
// MATCH (Match.resolveCombatPhase runs the fold) + the pure fold helper itself.
//
// Rules pinned here (#38): buffs fold onto SURVIVORS only; a Reborn resurrection counts as
// surviving (the reborn unit keeps its persistent uid — the audit finding that made extra id
// plumbing unnecessary); ghost boards never accrue; a permanent buff on a combat-summoned token
// is a defined, LOGGED no-op; shop-phase permanents never double-apply; the fold reads the log
// and never rewrites it; deltas fold under the same §6.8 clamps combat's buffStats uses
// (atk floored at 0, hp at 1 — EV-WBK-09).
import { describe, it, expect } from 'vitest';
import {
  Match,
  foldPermanentBuffs,
  makeInstance,
  toCombatBoard,
  resolveCombat,
  playUnit,
  getCard,
  UNITS,
  engines,
  type CombatEvent,
  type Effect,
  type SeatConfig,
  type UnitInstance,
} from '@cardgame/shared';

const seats = (n: number): SeatConfig[] =>
  Array.from({ length: n }, (_, i) => ({ name: `P${i}`, isBot: true }));

/** A combat-fired permanent self/board buff, attached via `grantedEffects` (no shipped card
 *  carries one yet — Phases 3+ add them; the seam is exercised through the DSL directly). */
const permBuff = (atk: number, hp: number, selector: 'self' | 'allAllies' = 'self'): Effect => ({
  trigger: { type: 'startOfCombat' },
  target: { selector },
  actions: [{ type: 'buffStats', atk, hp, permanent: true }],
});
const avengePermAll = (atk: number, hp: number): Effect => ({
  trigger: { type: 'afterFriendlyDeaths', threshold: 1, everyN: true },
  target: { selector: 'allAllies' },
  actions: [{ type: 'buffStats', atk, hp, permanent: true }],
});

const endOf = (log: readonly CombatEvent[]) =>
  log.find((e): e is Extract<CombatEvent, { t: 'combatEnd' }> => e.t === 'combatEnd')!;
const startOf = (log: readonly CombatEvent[]) =>
  log.find((e): e is Extract<CombatEvent, { t: 'combatStart' }> => e.t === 'combatStart')!;
/** The combatStart snapshot for a given seat (pairing shuffle decides who is side a/b). */
const snapFor = (m: Match, seat: number) => {
  const pr = m.state.pairings.find((p) => p.aSeat === seat || p.bSeat === seat)!;
  const snap = startOf(m.sessions[seat].lastCombatLog!);
  return pr.aSeat === seat ? snap.a : snap.b;
};
const permStats = (log: readonly CombatEvent[]) =>
  log.filter((e): e is Extract<CombatEvent, { t: 'stats' }> => e.t === 'stats' && e.permanent === true);

// gemsnout (2/3, no keywords, shop-only effect) is the workhorse body.
const body = (uid: string, atk?: number, hp?: number): UnitInstance =>
  makeInstance('tuskers_gemsnout', { uid, atk, hp });

describe('EV-WBK — combat writeback fold (§7.5, decision #38)', () => {
  it('EV-WBK-01: a combat-fired permanent buff persists onto the UnitInstance and is visible in the NEXT combat', () => {
    const m = new Match('wbk01', seats(2));
    const u = body('0u0'); // 2/3
    u.grantedEffects = [permBuff(2, 3)];
    m.sessions[0].board = [u];
    m.sessions[1].board = []; // instant loss for seat 1; seat 0's unit survives

    m.resolveCombatPhase();
    // fold applied the DELTA onto the persistent instance (2/3 → 4/6)
    expect(m.sessions[0].board[0].atk).toBe(4);
    expect(m.sessions[0].board[0].hp).toBe(6);
    expect(m.sessions[0].log.some((l) => l.includes('writeback: 0u0 keeps +2/+3'))).toBe(true);

    m.resolveCombatPhase(); // next combat: the persisted stats are the STARTING stats
    const snap = snapFor(m, 0);
    expect(snap.units[0].atk).toBe(4);
    expect(snap.units[0].hp).toBe(6);
    // and it compounds again (the buff re-fires and re-folds)
    expect(m.sessions[0].board[0].atk).toBe(6);
    expect(m.sessions[0].board[0].hp).toBe(9);
  });

  it('EV-WBK-02: combat-only buffs (permanent:false or unflagged) still reset — the next combat sees the persistent stats', () => {
    for (const flag of [false, undefined] as const) {
      const m = new Match('wbk02', seats(2));
      const u = body('0u0'); // 2/3
      u.grantedEffects = [
        {
          trigger: { type: 'startOfCombat' },
          target: { selector: 'self' },
          actions: [{ type: 'buffStats', atk: 2, hp: 3, ...(flag === undefined ? {} : { permanent: flag }) }],
        },
      ];
      m.sessions[0].board = [u];
      m.sessions[1].board = [];

      m.resolveCombatPhase();
      expect(m.sessions[0].board[0].atk).toBe(2); // untouched — nothing folded
      expect(m.sessions[0].board[0].hp).toBe(3);
      expect(permStats(m.sessions[0].lastCombatLog!)).toHaveLength(0);

      m.resolveCombatPhase();
      const snap = snapFor(m, 0);
      expect(snap.units[0].atk).toBe(2); // next combat starts from printed stats
      expect(snap.units[0].hp).toBe(3);
    }
  });

  it('EV-WBK-03: a permanent buff targeting a combat-summoned token is a defined, LOGGED no-op — no crash, no persistent mutation', () => {
    // Tombspawn dies → summons 2 Grave Wisps (per-fight `sum#N` uids); the avenge buffer then
    // permanent-buffs allAllies INCLUDING the wisps.
    const tomb = makeInstance('revenants_tombspawn', { uid: '0u0', atk: 0, hp: 1 });
    const buffer = body('0u1', 0, 30);
    buffer.grantedEffects = [avengePermAll(1, 1)];
    const enemy = body('1u0', 2, 6);
    const log = resolveCombat(toCombatBoard([tomb, buffer], 1), toCombatBoard([enemy], 1), 'wbk03');

    const tokenPerms = permStats(log).filter((e) => e.unitId.startsWith('sum#'));
    expect(tokenPerms.length).toBeGreaterThan(0); // the seam really hit tokens

    const persistent = [tomb, buffer];
    const res = foldPermanentBuffs(log, persistent, endOf(log).survivorsA ?? [], 'a');
    // token targets → tokenNoOps + a log line each; never a throw, never a board write
    for (const e of tokenPerms) expect(res.tokenNoOps).toContain(e.unitId);
    expect(res.logLines.some((l) => l.includes('combat-summoned sum#'))).toBe(true);
    expect(tomb.atk).toBe(0); // tomb died before any buff — untouched
    expect(tomb.hp).toBe(1);
    // the buffer (a survivor) accrued exactly its own permanent deltas
    const own = permStats(log).filter((e) => e.unitId === '0u1');
    expect(buffer.atk).toBe(0 + own.reduce((s, e) => s + (e.dAtk ?? 0), 0));
    expect(buffer.hp).toBe(30 + own.reduce((s, e) => s + (e.dHp ?? 0), 0));

    // side isolation: folding for side B ignores side A's permanent events entirely —
    // A's buffs are never mislabeled as B's token no-ops (each side folds its own board).
    const resB = foldPermanentBuffs(log, [enemy], endOf(log).survivorsB ?? [], 'b');
    expect(resB.applied).toEqual([]);
    expect(resB.tokenNoOps).toEqual([]);
    expect(resB.logLines).toEqual([]);
  });

  it('EV-WBK-04: dead units do not accrue; a Reborn resurrection DOES (it keeps its uid and counts as surviving)', () => {
    // (a) Reborn: swab (2/1, reborn) dies to retaliation, reborns, then gets a permanent +2/+2.
    const swab = makeInstance('corsairs_swab', { uid: '0u0' }); // 2/1 reborn
    const buffer = body('0u1', 0, 30);
    buffer.grantedEffects = [avengePermAll(2, 2)];
    const enemy = body('1u0', 1, 3);
    const log = resolveCombat(toCombatBoard([swab, buffer], 1), toCombatBoard([enemy], 1), 'wbk04a');

    const end = endOf(log);
    expect(log.some((e) => e.t === 'death' && e.unitId === '0u0')).toBe(true); // it really died
    // THE UID FINDING: the reborn unit returns under its ORIGINAL persistent uid and is a survivor.
    expect(end.survivorsA).toContain('0u0');

    foldPermanentBuffs(log, [swab, buffer], end.survivorsA ?? [], 'a');
    expect(swab.atk).toBe(4); // 2/1 + the permanent +2/+2 — the in-combat reborn reset
    expect(swab.hp).toBe(3); //   (a non-permanent stats event) is never folded

    // (b) dead-without-reborn: a unit permanent-buffs itself, then dies → nothing accrues.
    const dier = body('2u0', 3, 1);
    dier.grantedEffects = [permBuff(5, 0)];
    const meat = body('2u1', 10, 30);
    const killer = body('3u0', 5, 4);
    const log2 = resolveCombat(toCombatBoard([dier, meat], 1), toCombatBoard([killer], 1), 'wbk04b');
    const end2 = endOf(log2);
    expect(permStats(log2).some((e) => e.unitId === '2u0')).toBe(true); // buff DID fire
    expect(end2.survivorsA).not.toContain('2u0'); // but it died
    const res2 = foldPermanentBuffs(log2, [dier, meat], end2.survivorsA ?? [], 'a');
    expect(dier.atk).toBe(3); // untouched
    expect(dier.hp).toBe(1);
    expect(res2.logLines.some((l) => l.includes('2u0') && l.includes('did not survive'))).toBe(true);
  });

  it('EV-WBK-05: ghost-board combats never mutate the dead player’s stored snapshot or session board', () => {
    const m = new Match('wbk05', seats(4));
    for (let i = 0; i < 3; i++) m.sessions[i].board = [body(`${i}u0`, 10, 10)];
    // seat 3 carries a combat-fired permanent self-buff on an unkillable 0-atk wall
    const ghostUnit = body('3u0', 0, 99999);
    ghostUnit.grantedEffects = [permBuff(2, 2)];
    m.sessions[3].board = [ghostUnit];
    m.state.players[3].hp = 0; // eliminated after round 1 → becomes the ghost

    // Round 1: seat 3 is still ALIVE, so its side legitimately folds (+2/+2 → 2/100001) —
    // elimination then snapshots that board as the ghost.
    m.resolveCombatPhase();
    expect(m.state.players[3].alive).toBe(false);
    expect(m.sessions[3].board[0].atk).toBe(2);
    expect(m.sessions[3].board[0].hp).toBe(100001);
    const writebackLinesAtDeath = m.sessions[3].log.filter((l) => l.includes('writeback')).length;

    // Rounds 2 & 3: 3 alive → one ghost fight per round vs seat 3's frozen snapshot.
    for (let round = 2; round <= 3; round++) {
      m.resolveCombatPhase();
      const ghostPairing = m.state.pairings.find((p) => p.ghost);
      expect(ghostPairing).toBeTruthy();
      const soloLog = m.sessions[ghostPairing!.aSeat].lastCombatLog!;
      // the ghost's permanent buff really fired in the ghost fight...
      expect(permStats(soloLog).some((e) => e.unitId === '3u0')).toBe(true);
      // ...and the ghost side SURVIVED, so only the ghost rule blocks accrual
      expect(endOf(soloLog).survivorsB).toContain('3u0');
      // every ghost fight starts from the SAME frozen snapshot — no accrual across rounds
      const snap = startOf(soloLog);
      expect(snap.b.units[0].atk).toBe(2);
      expect(snap.b.units[0].hp).toBe(100001);
    }
    // the dead player's persistent board and log gained nothing after death
    expect(m.sessions[3].board[0].atk).toBe(2);
    expect(m.sessions[3].board[0].hp).toBe(100001);
    expect(m.sessions[3].log.filter((l) => l.includes('writeback')).length).toBe(writebackLinesAtDeath);
  });

  it('EV-WBK-06: shop-phase permanents (battlecry path) apply once — never doubled by the writeback fold', () => {
    const m = new Match('wbk06', seats(2));
    const ally = body('0u0'); // 2/3
    m.sessions[0].board = [ally];
    m.sessions[0].bench = [makeInstance('primordials_tideling', { uid: '0u9' })];
    // Tideling battlecry: other minions +1 atk, permanent:true — resolves in the SHOP by
    // mutating the persistent instance directly (no combat event).
    const played = playUnit(m.sessions[0], '0u9');
    expect(played.ok).toBe(true);
    expect(ally.atk).toBe(3); // shop permanent applied once

    m.sessions[1].board = [body('1u0', 0, 50)]; // 0-atk punching bag; seat 0 survives + wins
    m.resolveCombatPhase();
    expect(permStats(m.sessions[0].lastCombatLog!)).toHaveLength(0); // no combat permanence emitted
    expect(ally.atk).toBe(3); // NOT 4 — the fold had nothing to re-apply
    expect(ally.hp).toBe(3);
  });

  it('EV-WBK-07: the fold reads the log and never rewrites it (byte-identical before/after)', () => {
    const u = body('0u0');
    u.grantedEffects = [permBuff(2, 3, 'allAllies')];
    const mate = body('0u1', 1, 8);
    const enemy = body('1u0', 3, 5);
    const log = resolveCombat(toCombatBoard([u, mate], 1), toCombatBoard([enemy], 1), 'wbk07');
    const before = structuredClone(log);
    foldPermanentBuffs(log, [u, mate], endOf(log).survivorsA ?? [], 'a');
    expect(log).toEqual(before);
  });

  it('EV-WBK-08 (content audit lint): no shipped card silently became persistent — every combat-fired buffStats is explicitly non-permanent (or shop-gated)', () => {
    // Triggers the combat engine fires. `onSummon` fires in BOTH phases: a combat-fired
    // permanent there is allowed only behind a shop-scoped condition (reads 0 in combat —
    // Mother Thorn's tokensSummonedThisTurnAtLeast gate).
    const combatTriggers = new Set([
      'startOfCombat',
      'onAttack',
      'onShieldBreak',
      'onDamaged',
      'deathrattle',
      'afterFriendlyDeaths',
      'onSummon',
    ]);
    const shopScopedConditions = new Set([
      'battlecriesThisTurnAtLeast',
      'tokensSummonedThisTurnAtLeast',
      'gemsThisTurnAtLeast',
    ]);
    const offenders: string[] = [];
    for (const card of UNITS) {
      const all = [...card.effects];
      for (const e of all) {
        if (!combatTriggers.has(e.trigger.type)) continue;
        for (const a of e.actions) {
          if (a.type !== 'buffStats') continue;
          if (a.permanent === false) continue; // explicit combat-only: OK
          if (a.permanent === true && e.condition && shopScopedConditions.has(e.condition.kind)) continue;
          offenders.push(`${card.id}: ${e.trigger.type} buffStats permanent=${String(a.permanent)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
    // and the token-floor knob is honored from config (currently combat-only)
    expect(engines.wildkin.tokenBuffPermanent).toBe(false);
    const gorehide = getCard('wildkin_gorehide');
    expect(gorehide.effects[0].actions[0].permanent).toBe(engines.wildkin.tokenBuffPermanent);
  });

  it('EV-WBK-09: the fold applies deltas under the §6.8 clamps — a permanent debuff can never write atk<0 or hp<1 onto the persistent board (#38 rule h)', () => {
    // A combat-only +5/+5 lands FIRST, so the permanent -6/-5 applies UNCLAMPED in combat
    // (2/3 → 7/8 → 1/3; emitted dAtk=-6, dHp=-5) while the persistent instance is still 2/3.
    // A raw `atk += dAtk; hp += dHp` fold would write -4/-2 onto the persistent board and
    // send a nonpositive-hp unit into the next combat; the fold must clamp (atk≥0, hp≥1).
    const u = body('0u0'); // 2/3
    u.grantedEffects = [
      {
        trigger: { type: 'startOfCombat' },
        target: { selector: 'self' },
        actions: [
          { type: 'buffStats', atk: 5, hp: 5 }, // combat-only riser (unflagged)
          { type: 'buffStats', atk: -6, hp: -5, permanent: true }, // permanent debuff
        ],
      },
    ];
    const enemy = body('1u0', 0, 1); // 0-atk body: 0u0 kills it and survives
    const log = resolveCombat(toCombatBoard([u], 1), toCombatBoard([enemy], 1), 'wbk09');

    const perm = permStats(log);
    expect(perm).toHaveLength(1);
    expect(perm[0].dAtk).toBe(-6); // unclamped in combat (7/8 → 1/3, floors not hit)
    expect(perm[0].dHp).toBe(-5);
    const end = endOf(log);
    expect(end.survivorsA).toContain('0u0');

    const res = foldPermanentBuffs(log, [u], end.survivorsA ?? [], 'a');
    expect(res.applied).toEqual([{ uid: '0u0', dAtk: -6, dHp: -5 }]);
    expect(u.atk).toBe(0); // NOT -4 — §6.8 atk floor
    expect(u.hp).toBe(1); //  NOT -2 — §6.8 hp floor
  });

  it('EV-WBK-10: the writeback-multiply extension folds a permanent multiplyStats onto the survivor (×factor) and compounds across combats', () => {
    // Phase 3 seam extension: a combat-fired multiplyStats flagged permanent:true emits permanentFactor
    // (the capped factor), and the fold multiplies the SURVIVING persistent instance by it — through the
    // same §6.8 applyMultiply clamps, never the combat-inflated absolutes. Compounds like the buff fold.
    const m = new Match('wbk10', seats(2));
    const u = body('0u0'); // 2/3
    u.grantedEffects = [
      {
        trigger: { type: 'startOfCombat' },
        target: { selector: 'self' },
        actions: [{ type: 'multiplyStats', factor: 2, permanent: true }],
      },
    ];
    m.sessions[0].board = [u];
    m.sessions[1].board = []; // instant loss for seat 1; seat 0's unit survives

    m.resolveCombatPhase();
    const perm = permStats(m.sessions[0].lastCombatLog!);
    expect(perm).toHaveLength(1);
    expect(perm[0].permanentFactor).toBe(2); // multiply carries a factor…
    expect(perm[0].dAtk).toBeUndefined(); // …never a buff delta (a permanent event is EITHER, never both)
    expect(m.sessions[0].board[0].atk).toBe(4); // 2 × 2 (persistent stats, not the combat absolutes)
    expect(m.sessions[0].board[0].hp).toBe(6); // 3 × 2
    expect(m.sessions[0].log.some((l) => l.includes('writeback: 0u0 keeps ×2'))).toBe(true);

    m.resolveCombatPhase(); // next combat: the doubled stats are the STARTING stats, and double again
    const snap = snapFor(m, 0);
    expect(snap.units[0].atk).toBe(4);
    expect(snap.units[0].hp).toBe(6);
    expect(m.sessions[0].board[0].atk).toBe(8); // ×2 compounds
    expect(m.sessions[0].board[0].hp).toBe(12);
  });
});
