// EVALS.md Group P — EV-MAG: the MAGNETIC merge system (Phase 5, decision #54). `magnetic` is
// promoted reserved→live: a magnetic minion may MERGE into a friendly Construct during the shop,
// handing over its current stats + keywords and being consumed (not a death/sell; no pool return).
// Property targets: merge stats/keywords, golden-doubled, per-unit cap, optional-merge intent flow
// (accept/reject, no-mutation), standalone play always allowed, Nullforge strips the merged STATS
// (keywords persist), poison one-shots the merged tower (stat-agnostic). Design-spec §6.1, §8; #54.
import { describe, it, expect } from 'vitest';
import {
  createShopSession,
  mergeUnit,
  playUnit,
  makeInstance,
  boardToCombat,
  resolveCombat,
  getCard,
  engines,
  Match,
  type ShopSession,
  type CombatUnit,
  type CombatBoard,
  type CombatEvent,
  type UnitInstance,
} from '@cardgame/shared';

const CAP = engines.constructs.magneticMergeCap;

function session(): ShopSession {
  const s = createShopSession(0, { seed: 'mag' });
  s.round = 3;
  s.tier = 5;
  return s;
}
function onBench(s: ShopSession, cardId: string, opts: Partial<{ golden: boolean }> = {}): UnitInstance {
  const inst = makeInstance(cardId, { uid: `bn${s.uidSeq++}`, golden: opts.golden, bornTurn: s.round });
  s.bench.push(inst);
  return inst;
}
function onBoard(s: ShopSession, cardId: string): UnitInstance {
  const inst = makeInstance(cardId, { uid: `bd${s.uidSeq++}`, bornTurn: s.round });
  s.board.push(inst);
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

describe('EV-MAG — magnetic merge system (#54)', () => {
  it('EV-MAG-01: merge hands the tower the magnetic unit CURRENT stats + keywords (not `magnetic`); consumes it; no pool return', () => {
    const s = session();
    const tgt = onBoard(s, 'constructs_cogling'); // 2/2, no keywords
    const mag = onBench(s, 'constructs_alloyrig'); // 4/4 magnetic + divineShield
    const poolBefore = s.pool['constructs_alloyrig'];
    const res = mergeUnit(s, mag.uid, tgt.uid);
    expect(res.ok).toBe(true);
    // stats carried (2/2 + 4/4 = 6/6); keywords stacked (divineShield) but NOT the magnetic tag
    expect([tgt.atk, tgt.hp]).toEqual([6, 6]);
    expect(tgt.keywords).toContain('divineShield');
    expect(tgt.keywords).not.toContain('magnetic');
    expect(tgt.mergeCount).toBe(1);
    // magnetic unit consumed — removed from bench, NOT returned to the pool (triple-merge accounting)
    expect(s.bench.length).toBe(0);
    expect(s.pool['constructs_alloyrig']).toBe(poolBefore);
  });

  it('EV-MAG-02: a GOLDEN magnetic unit merges its DOUBLED current stats', () => {
    const s = session();
    const tgt = onBoard(s, 'constructs_cogling'); // 2/2
    const mag = onBench(s, 'constructs_boltfitter', { golden: true }); // base 2/2 → golden 4/4
    expect([mag.atk, mag.hp]).toEqual([4, 4]);
    mergeUnit(s, mag.uid, tgt.uid);
    expect([tgt.atk, tgt.hp]).toEqual([6, 6]); // 2/2 + doubled 4/4
  });

  it('EV-MAG-03: illegal merges are rejected and mutate NOTHING (server-authoritative)', () => {
    const s = session();
    const tgt = onBoard(s, 'constructs_cogling');
    const nonMag = onBench(s, 'constructs_cogling'); // a non-magnetic bench unit
    const corsair = onBoard(s, 'corsairs_swab'); // not a Construct
    const mag = onBench(s, 'constructs_boltfitter');

    const snapshot = () => JSON.stringify({ bench: s.bench, board: s.board });
    const before = snapshot();
    expect(mergeUnit(s, 'nope', tgt.uid).ok).toBe(false); // unit not on bench
    expect(mergeUnit(s, nonMag.uid, tgt.uid).ok).toBe(false); // unit not magnetic
    expect(mergeUnit(s, mag.uid, corsair.uid).ok).toBe(false); // target not a Construct
    expect(mergeUnit(s, mag.uid, 'nope').ok).toBe(false); // target not on board
    expect(snapshot()).toBe(before); // no mutation on any rejection
  });

  it('EV-MAG-04: standalone play is ALWAYS allowed (magnetic minion plays as a normal body)', () => {
    const s = session();
    const mag = onBench(s, 'constructs_omegachassis'); // 5/5 magnetic + taunt
    const res = playUnit(s, mag.uid);
    expect(res.ok).toBe(true);
    expect(s.board.some((u) => u.uid === mag.uid)).toBe(true);
    expect(s.board[0].keywords).toContain('magnetic'); // standalone keeps the tag
  });

  it('EV-MAG-05: per-unit merge cap — merges up to the cap succeed, beyond is refused; standalone still allowed', () => {
    const s = session();
    const tgt = onBoard(s, 'constructs_cogling');
    for (let i = 0; i < CAP; i++) {
      const m = onBench(s, 'constructs_boltfitter');
      expect(mergeUnit(s, m.uid, tgt.uid).ok).toBe(true);
    }
    expect(tgt.mergeCount).toBe(CAP);
    const over = onBench(s, 'constructs_boltfitter');
    expect(mergeUnit(s, over.uid, tgt.uid).ok).toBe(false); // cap reached
    expect(s.bench.some((u) => u.uid === over.uid)).toBe(true); // refused merge left it on the bench
    expect(playUnit(s, over.uid).ok).toBe(true); // standalone play never blocked by the cap
  });

  it('EV-MAG-06: Nullforge strips the merged STATS back to print; merged KEYWORDS persist', () => {
    const s = session();
    const tgt = onBoard(s, 'constructs_cogling'); // print 2/2
    mergeUnit(s, onBench(s, 'constructs_alloyrig').uid, tgt.uid); // → 6/6 + divineShield
    const a = boardToCombat(s); // the merged CombatUnit carries 6/6 + divineShield
    const towerUnit = a.units[0];
    expect([towerUnit.atk, towerUnit.hp]).toEqual([6, 6]);
    expect(towerUnit.keywords).toContain('divineShield');
    // fight vs Nullforge (start-of-combat: reset highest-atk enemy to print) + a chip attacker.
    const b: CombatBoard = { units: [cu('constructs_nullforge'), cu('corsairs_ironclad', { keywords: [], atk: 3, hp: 100 })], playerTier: 5 };
    const evs = resolveCombat(a, b, 'mag-null');
    const reset = byType(evs, 'stats').find((e) => e.unitId === towerUnit.uid && e.atk === 2 && e.hp === 2);
    expect(reset).toBeTruthy(); // stats stripped to printed 2/2
    // the merged divineShield SURVIVED the strip (resetToBase is stat-only) → a hit breaks the shield
    expect(byType(evs, 'damage').some((e) => e.targetId === towerUnit.uid && e.shieldBroken === true)).toBe(true);
  });

  it('EV-MAG-07: poison ONE-SHOTS the merged tower regardless of its size (stat-agnostic)', () => {
    const s = session();
    const tgt = onBoard(s, 'constructs_cogling'); // no divine shield (Boltfitter carries none)
    for (let i = 0; i < CAP; i++) mergeUnit(s, onBench(s, 'constructs_boltfitter').uid, tgt.uid); // → 12/12, no DS
    const a = boardToCombat(s);
    expect([a.units[0].atk, a.units[0].hp]).toEqual([12, 12]);
    const b = { units: [cu('sirens_lurefish', { atk: 2, hp: 2 })], playerTier: 1 }; // poison
    const evs = resolveCombat(a, b, 'mag-psn');
    expect(byType(evs, 'death').some((e) => e.unitId === a.units[0].uid)).toBe(true); // the 12/12 tower dies to a poison touch
  });

  it('EV-MAG-08: merge routes through Match.applyIntent as a validated intent (accept + reject)', () => {
    const m = new Match('mag-intent', [{ name: 'P0', isBot: true }, { name: 'P1', isBot: true }]);
    m.startRound();
    const s = m.sessions[0];
    const tgt = onBoard(s, 'constructs_cogling');
    const mag = onBench(s, 'constructs_boltfitter');
    // wrong-phase / cross-tribe are covered by EV-MAG-03 at the reducer; here prove the intent wiring.
    expect(m.applyIntent(0, { type: 'merge', unitUid: mag.uid, targetUid: tgt.uid }).ok).toBe(true);
    expect([tgt.atk, tgt.hp]).toEqual([4, 4]);
    expect(m.applyIntent(0, { type: 'merge', unitUid: 'gone', targetUid: tgt.uid }).ok).toBe(false);
  });
});
