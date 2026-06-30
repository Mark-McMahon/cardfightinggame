import { describe, it, expect } from 'vitest';
import type { CombatBoard, CombatEvent, CombatUnit, Keyword } from '../types';
import { resolveCombat } from './combat';
import { createInstance, toCombatUnit, resetUidCounter } from './instances';
import { battlecryTriggerCount, damageMultiplierForTribe, endOfTurnTriggerCount, type AuraBearer } from './auras';
import { getCard } from '../content/units';
import { engines } from '../config/engines';
import { getBreakpoint } from '../config/breakpoints';

interface Spec {
  cardId: string;
  uid: string;
  atk?: number;
  hp?: number;
  keywords?: Keyword[];
  golden?: boolean;
}

function mk(spec: Spec): CombatUnit {
  const inst = createInstance(spec.cardId, { uid: spec.uid, golden: spec.golden });
  const cu = toCombatUnit(inst);
  if (spec.atk !== undefined) cu.atk = spec.atk;
  if (spec.hp !== undefined) cu.hp = spec.hp;
  if (spec.keywords !== undefined) cu.keywords = [...spec.keywords];
  return cu;
}

function board(units: CombatUnit[], playerTier = 1): CombatBoard {
  return { units, playerTier };
}

function attacks(events: CombatEvent[]) {
  return events.filter((e): e is Extract<CombatEvent, { t: 'attack' }> => e.t === 'attack');
}
function deaths(events: CombatEvent[]) {
  return events.filter((e): e is Extract<CombatEvent, { t: 'death' }> => e.t === 'death');
}
function damages(events: CombatEvent[]) {
  return events.filter((e): e is Extract<CombatEvent, { t: 'damage' }> => e.t === 'damage');
}
function end(events: CombatEvent[]) {
  const e = events[events.length - 1];
  if (e.t !== 'combatEnd') throw new Error('no combatEnd');
  return e;
}

describe('combat determinism (spec §7, the priority test)', () => {
  it('same (boards, seed) → byte-identical CombatEvent[]', () => {
    const makeBoards = (): [CombatBoard, CombatBoard] => {
      resetUidCounter();
      const a = board([
        mk({ cardId: 'wildkin_gorehide', uid: 'a1', atk: 4, hp: 5, keywords: ['cleave'] }),
        mk({ cardId: 'reefkin_spinefish', uid: 'a2', atk: 2, hp: 2, keywords: ['poison'] }),
        mk({ cardId: 'revenants_cryptling', uid: 'a3', atk: 2, hp: 1, keywords: ['reborn'] }),
      ], 3);
      const b = board([
        mk({ cardId: 'reefkin_pearlguard', uid: 'b1', atk: 2, hp: 3, keywords: ['divineShield', 'taunt'] }),
        mk({ cardId: 'revenants_tombspawn', uid: 'b2', atk: 2, hp: 2 }),
        mk({ cardId: 'wildkin_motherthorn', uid: 'b3', atk: 3, hp: 4 }),
      ], 3);
      return [a, b];
    };
    const [a1, b1] = makeBoards();
    const r1 = resolveCombat(a1, b1, 'seed-XYZ');
    const [a2, b2] = makeBoards();
    const r2 = resolveCombat(a2, b2, 'seed-XYZ');
    expect(JSON.stringify(r1)).toEqual(JSON.stringify(r2));
    // produces a real fight
    expect(attacks(r1).length).toBeGreaterThan(0);
  });

  it('different seeds can produce different logs (randomness is live)', () => {
    const build = () => {
      resetUidCounter();
      const a = board([
        mk({ cardId: 'wildkin_gorehide', uid: 'a1', atk: 2, hp: 6 }),
        mk({ cardId: 'wildkin_gorehide', uid: 'a2', atk: 2, hp: 6 }),
      ]);
      const b = board([
        mk({ cardId: 'wildkin_gorehide', uid: 'b1', atk: 2, hp: 6 }),
        mk({ cardId: 'wildkin_gorehide', uid: 'b2', atk: 2, hp: 6 }),
      ]);
      return [a, b] as [CombatBoard, CombatBoard];
    };
    const logs = new Set<string>();
    for (const s of ['s1', 's2', 's3', 's4', 's5', 's6']) {
      const [a, b] = build();
      logs.add(JSON.stringify(resolveCombat(a, b, s)));
    }
    expect(logs.size).toBeGreaterThan(1);
  });
});

describe('keyword timing (spec §7.2–7.3)', () => {
  it('taunt forces the attacker onto a taunt unit first', () => {
    resetUidCounter();
    const a = board([
      mk({ cardId: 'wildkin_gorehide', uid: 'a1', atk: 5, hp: 5, keywords: [] }),
      mk({ cardId: 'reefkin_spinefish', uid: 'a2', atk: 0, hp: 1, keywords: [] }),
      mk({ cardId: 'reefkin_spinefish', uid: 'a3', atk: 0, hp: 1, keywords: [] }),
    ]);
    const b = board([
      mk({ cardId: 'reefkin_spinefish', uid: 'bFiller', atk: 0, hp: 5, keywords: [] }),
      mk({ cardId: 'reefkin_pearlguard', uid: 'bTaunt', atk: 0, hp: 9, keywords: ['taunt'] }),
    ]);
    const events = resolveCombat(a, b, 'taunt-seed');
    const firstA = attacks(events).find((e) => e.side === 'a');
    expect(firstA?.defenderId).toBe('bTaunt');
  });

  it('divine shield negates the first damage instance entirely', () => {
    resetUidCounter();
    const a = board([
      mk({ cardId: 'wildkin_gorehide', uid: 'a1', atk: 9, hp: 9, keywords: [] }),
      mk({ cardId: 'reefkin_spinefish', uid: 'a2', atk: 0, hp: 1, keywords: [] }),
    ]);
    const b = board([mk({ cardId: 'reefkin_pearlguard', uid: 'bDS', atk: 0, hp: 3, keywords: ['divineShield'] })]);
    const events = resolveCombat(a, b, 'ds-seed');
    const broken = damages(events).find((d) => d.targetId === 'bDS' && d.shieldBroken);
    expect(broken).toBeTruthy();
    expect(broken?.amount).toBe(0);
    // a second hit kills it (shield consumed)
    expect(deaths(events).some((d) => d.unitId === 'bDS')).toBe(true);
  });

  it('poison destroys any unit it deals >0 damage to', () => {
    resetUidCounter();
    const a = board([
      mk({ cardId: 'reefkin_spinefish', uid: 'aPoison', atk: 1, hp: 1, keywords: ['poison'] }),
      mk({ cardId: 'reefkin_spinefish', uid: 'aF', atk: 0, hp: 1 }),
    ]);
    const b = board([mk({ cardId: 'wildkin_gorehide', uid: 'bBig', atk: 0, hp: 50, keywords: [] })]);
    const events = resolveCombat(a, b, 'poison-seed');
    expect(deaths(events).some((d) => d.unitId === 'bBig')).toBe(true);
    expect(end(events).winner).toBe('a');
  });

  it('divine shield blocks poison too', () => {
    resetUidCounter();
    const a = board([
      mk({ cardId: 'reefkin_spinefish', uid: 'aPoison', atk: 1, hp: 1, keywords: ['poison'] }),
      mk({ cardId: 'reefkin_spinefish', uid: 'aF', atk: 0, hp: 1 }),
    ]);
    const b = board([mk({ cardId: 'reefkin_pearlguard', uid: 'bDS', atk: 0, hp: 5, keywords: ['divineShield'] })]);
    const events = resolveCombat(a, b, 'poison-ds-seed');
    // first poison hit only breaks the shield; bDS must not die from that instance
    const firstHit = damages(events).find((d) => d.targetId === 'bDS');
    expect(firstHit?.shieldBroken).toBe(true);
  });

  it('reborn returns the unit once with 1 HP', () => {
    resetUidCounter();
    const a = board([
      mk({ cardId: 'wildkin_gorehide', uid: 'aBig', atk: 10, hp: 10, keywords: [] }),
      mk({ cardId: 'reefkin_spinefish', uid: 'aF', atk: 0, hp: 1 }),
    ]);
    const b = board([mk({ cardId: 'revenants_cryptling', uid: 'bReborn', atk: 1, hp: 1, keywords: ['reborn'] })]);
    const events = resolveCombat(a, b, 'reborn-seed');
    expect(events.some((e) => e.t === 'keyword' && e.keyword === 'reborn' && e.unitId === 'bReborn')).toBe(true);
    // reborn body is summoned back
    expect(events.some((e) => e.t === 'summon' && e.unitIds.includes('bReborn~r'))).toBe(true);
  });

  it('cleave hits the defender plus its neighbours', () => {
    resetUidCounter();
    const a = board([
      mk({ cardId: 'wildkin_gorehide', uid: 'aCleave', atk: 3, hp: 10, keywords: ['cleave'] }),
      mk({ cardId: 'reefkin_spinefish', uid: 'aF1', atk: 0, hp: 1 }),
      mk({ cardId: 'reefkin_spinefish', uid: 'aF2', atk: 0, hp: 1 }),
    ]);
    const b = board([
      mk({ cardId: 'reefkin_spinefish', uid: 'b1', atk: 0, hp: 10 }),
      mk({ cardId: 'reefkin_spinefish', uid: 'b2', atk: 0, hp: 10 }),
      mk({ cardId: 'reefkin_spinefish', uid: 'b3', atk: 0, hp: 10 }),
    ]);
    const events = resolveCombat(a, b, 'cleave-seed');
    expect(events.some((e) => e.t === 'keyword' && e.keyword === 'cleave')).toBe(true);
    // the cleaving attacker damages at least 2 distinct enemies on its first swing
    const firstAttack = events.findIndex((e) => e.t === 'attack' && e.attackerId === 'aCleave');
    const window = events.slice(firstAttack, firstAttack + 6);
    const hitTargets = new Set(
      window.filter((e): e is Extract<CombatEvent, { t: 'damage' }> => e.t === 'damage' && e.sourceId === 'aCleave').map((d) => d.targetId),
    );
    expect(hitTargets.size).toBeGreaterThanOrEqual(2);
  });
});

describe('effect resolution in combat', () => {
  it('Tombspawn deathrattle still summons Grave Wisps in combat (death engine)', () => {
    resetUidCounter();
    // Mother Thorn's token amp is now a SHOP breakpoint (§16.5), so it must NOT buff
    // combat-summoned tokens — but the underlying summon engine still fires.
    const a = board([mk({ cardId: 'wildkin_gorehide', uid: 'aKiller', atk: 10, hp: 30, keywords: [] })]);
    const b = board([
      mk({ cardId: 'revenants_tombspawn', uid: 'bTomb', atk: 1, hp: 1 }),
      mk({ cardId: 'wildkin_motherthorn', uid: 'bMother', atk: 3, hp: 20 }),
    ]);
    const events = resolveCombat(a, b, 'summon-seed');
    const summonedUids = events
      .filter((e): e is Extract<CombatEvent, { t: 'summon' }> => e.t === 'summon')
      .flatMap((e) => e.unitIds);
    expect(summonedUids.length).toBeGreaterThanOrEqual(2); // two wisps
    // Mother Thorn does NOT amp them in combat (shop-scoped breakpoint).
    const buffedToken = events.some(
      (e) => e.t === 'stats' && summonedUids.includes(e.unitId) && e.atk >= 2,
    );
    expect(buffedToken).toBe(false);
  });

  it('Pale Lich deals base damage below its death breakpoint (§16.2 conversion)', () => {
    resetUidCounter();
    const a = board([
      mk({ cardId: 'revenants_palelich', uid: 'lich', atk: 4, hp: 6, keywords: [] }),
      mk({ cardId: 'reefkin_spinefish', uid: 'aF', atk: 0, hp: 1 }),
    ]);
    const b = board([mk({ cardId: 'reefkin_spinefish', uid: 'dummy', atk: 0, hp: 100, keywords: [] })]);
    const events = resolveCombat(a, b, 'lich-seed');
    // 0 Revenant deaths → amp off → Pale Lich (atk 4) deals 4, not 8.
    const lichHit = damages(events).find((d) => d.sourceId === 'lich');
    expect(lichHit?.amount).toBe(4);
  });

  it('avenge (Pack Mother) buffs the board after N friendly deaths (engine 3)', () => {
    resetUidCounter();
    const a = board([
      mk({ cardId: 'wildkin_packmother', uid: 'mom', atk: 2, hp: 30, keywords: [] }),
      mk({ cardId: 'wildkin_thornpup', uid: 't1', atk: 0, hp: 1 }),
      mk({ cardId: 'wildkin_thornpup', uid: 't2', atk: 0, hp: 1 }),
      mk({ cardId: 'wildkin_thornpup', uid: 't3', atk: 0, hp: 1 }),
    ]);
    const b = board([mk({ cardId: 'wildkin_gorehide', uid: 'monster', atk: 5, hp: 100, keywords: [] })]);
    const events = resolveCombat(a, b, 'avenge-seed');
    // after 3 thornpup deaths Pack Mother gains +2 atk → atk 4
    const buffed = events.some((e) => e.t === 'stats' && e.unitId === 'mom' && e.atk >= 4);
    expect(buffed).toBe(true);
  });
});

describe('Round-6 breakpoints & engine plumbing (spec §16.2–16.3)', () => {
  it('Pale Lich aura is gated on the Revenant-death breakpoint and capped', () => {
    const bearers: AuraBearer[] = [{ tribe: 'revenants', auras: getCard('revenants_palelich').auras! }];
    const thr = engines.revenants.undeadDamageThreshold;
    const capped = Math.min(engines.revenants.undeadDamageAmp, engines.revenants.undeadDamageAmpCap);
    // below threshold → inert (×1); at/after → active, clamped to the cap
    expect(damageMultiplierForTribe(bearers, 'revenants', { deaths: 9, revenantDeaths: thr - 1 })).toBe(1);
    expect(damageMultiplierForTribe(bearers, 'revenants', { deaths: 9, revenantDeaths: thr })).toBe(capped);
  });

  it('trigger multipliers are clamped to their config caps (§16.2)', () => {
    const bc: AuraBearer[] = [
      { tribe: 'reefkin', auras: [{ scope: 'yourBattlecries', modifier: { kind: 'triggerMultiplier', value: 9 }, stacks: true }] },
    ];
    const eot: AuraBearer[] = [
      { tribe: 'wildkin', auras: [{ scope: 'yourEndOfTurn', modifier: { kind: 'triggerMultiplier', value: 9 }, stacks: true }] },
    ];
    expect(battlecryTriggerCount(bc)).toBe(engines.reefkin.battlecryTriggerMultiplierCap);
    expect(endOfTurnTriggerCount(eot)).toBe(engines.wildkin.endOfTurnTriggerMultiplierCap);
  });

  it('Thornwarden gains stats at the minion breakpoint, nothing below it (§16.3 #3)', () => {
    const buildA = (n: number) => {
      const units = [mk({ cardId: 'wildkin_thornwarden', uid: 'ward', atk: 2, hp: 3, keywords: ['taunt'] })];
      for (let i = 0; i < n - 1; i++) units.push(mk({ cardId: 'wildkin_thornpup', uid: `wp${i}`, atk: 0, hp: 5 }));
      return board(units);
    };
    const dummy = () => board([mk({ cardId: 'reefkin_spinefish', uid: 'd', atk: 0, hp: 50, keywords: [] })]);
    const wardBuffed = (events: CombatEvent[]) =>
      events.some((e) => e.t === 'stats' && e.unitId === 'ward' && e.hp >= 6);
    resetUidCounter();
    expect(wardBuffed(resolveCombat(buildA(4), dummy(), 'tw4'))).toBe(true);
    resetUidCounter();
    expect(wardBuffed(resolveCombat(buildA(3), dummy(), 'tw3'))).toBe(false);
  });

  it('Pearlguard buffs the board when its shield breaks (§16.3 #4)', () => {
    resetUidCounter();
    const a = board([mk({ cardId: 'wildkin_gorehide', uid: 'atk', atk: 5, hp: 50, keywords: [] })]);
    const b = board([
      mk({ cardId: 'reefkin_pearlguard', uid: 'pearl', atk: 0, hp: 3, keywords: ['divineShield', 'taunt'] }),
      mk({ cardId: 'reefkin_spinefish', uid: 'ally', atk: 0, hp: 10, keywords: [] }),
    ]);
    const events = resolveCombat(a, b, 'pearl-seed');
    expect(events.some((e) => e.t === 'damage' && e.targetId === 'pearl' && e.shieldBroken)).toBe(true);
    expect(events.some((e) => e.t === 'stats' && e.unitId === 'ally' && e.hp >= 12)).toBe(true);
  });

  it('Mortarch fires once at the death breakpoint (determinism check)', () => {
    const build = (): [CombatBoard, CombatBoard] => {
      resetUidCounter();
      const a = board([
        mk({ cardId: 'revenants_mortarch', uid: 'mort', atk: 0, hp: 50, keywords: [] }),
        mk({ cardId: 'wildkin_thornpup', uid: 't1', atk: 0, hp: 1, keywords: ['taunt'] }),
        mk({ cardId: 'wildkin_thornpup', uid: 't2', atk: 0, hp: 1, keywords: ['taunt'] }),
        mk({ cardId: 'wildkin_thornpup', uid: 't3', atk: 0, hp: 1, keywords: ['taunt'] }),
      ]);
      const b = board([mk({ cardId: 'reefkin_brineling', uid: 'killer', atk: 5, hp: 200, keywords: [] })]);
      return [a, b];
    };
    const [a, b] = build();
    const events = resolveCombat(a, b, 'mort-seed');
    // mort starts at 0 atk, so a stats event reaching the configured payoff = the break fired.
    const payoffAtk = getBreakpoint('revenants_mortarch').atk ?? 0;
    const mortBuffs = events.filter((e) => e.t === 'stats' && e.unitId === 'mort' && e.atk >= payoffAtk);
    expect(mortBuffs.length).toBeGreaterThanOrEqual(1);
    const [a2, b2] = build();
    expect(JSON.stringify(resolveCombat(a2, b2, 'mort-seed'))).toEqual(JSON.stringify(events));
  });

  it('Bone Colossus summons Reborn Wraiths only past its death breakpoint', () => {
    const build = (pups: number): [CombatBoard, CombatBoard] => {
      resetUidCounter();
      // drop taunt+reborn so the pups (taunt) die first; high HP so Colossus outlives them
      // (taunt only redirects the enemy's initiated attacks, not retaliation on its own swing)
      const units = [mk({ cardId: 'revenants_boncolossus', uid: 'colossus', atk: 0, hp: 50, keywords: [] })];
      for (let i = 0; i < pups; i++) units.push(mk({ cardId: 'wildkin_thornpup', uid: `bp${i}`, atk: 0, hp: 1, keywords: ['taunt'] }));
      const a = board(units);
      const b = board([mk({ cardId: 'reefkin_brineling', uid: 'killer', atk: 5, hp: 200, keywords: [] })]);
      return [a, b];
    };
    const hasWraith = (events: CombatEvent[]) =>
      events.some((e) => e.t === 'summon' && e.unitIds.some((u) => u.includes('rebornwraith')));
    const [a4, b4] = build(4);
    expect(hasWraith(resolveCombat(a4, b4, 'bc4'))).toBe(true); // 4 pups + self = 5 deaths
    const [a2, b2] = build(2);
    expect(hasWraith(resolveCombat(a2, b2, 'bc2'))).toBe(false); // 2 pups + self = 3 deaths
  });

  it('token-death floor grants capped Attack to Gorehide (§16.5 thin floor)', () => {
    resetUidCounter();
    const units = [mk({ cardId: 'wildkin_gorehide', uid: 'gore', atk: 2, hp: 300 })];
    for (let i = 0; i < 7; i++) units.push(mk({ cardId: 'wildkin_thornpup', uid: `gp${i}`, atk: 0, hp: 1, keywords: ['taunt'] }));
    const a = board(units);
    const b = board([mk({ cardId: 'reefkin_brineling', uid: 'killer', atk: 1, hp: 500, keywords: [] })]);
    const events = resolveCombat(a, b, 'floor-seed');
    const goreAtks = events
      .filter((e): e is Extract<CombatEvent, { t: 'stats' }> => e.t === 'stats' && e.unitId === 'gore')
      .map((e) => e.atk);
    // 7 token deaths, +1 each, capped at the config cap
    expect(Math.max(...goreAtks)).toBe(2 + engines.wildkin.tokenDeathFloorCapAtk);
  });

  it('Pallbearer doubles the next friendly deathrattle (determinism check)', () => {
    const build = (): [CombatBoard, CombatBoard] => {
      resetUidCounter();
      const a = board([
        mk({ cardId: 'revenants_pallbearer', uid: 'pall', atk: 0, hp: 1, keywords: ['taunt'] }),
        mk({ cardId: 'revenants_graverobber', uid: 'rob', atk: 0, hp: 1, keywords: ['taunt'] }),
        mk({ cardId: 'revenants_cryptling', uid: 'surv', atk: 0, hp: 50, keywords: [] }),
      ]);
      const b = board([mk({ cardId: 'wildkin_gorehide', uid: 'cleaver', atk: 5, hp: 200, keywords: ['cleave'] })]);
      return [a, b];
    };
    const [a, b] = build();
    const events = resolveCombat(a, b, 'pall-seed');
    // Pallbearer (slot 0) is processed first in the shared death batch → arms the double;
    // Graverobber's "Revenants +1/+1" then fires twice → survivor reaches +2.
    const survAtks = events
      .filter((e): e is Extract<CombatEvent, { t: 'stats' }> => e.t === 'stats' && e.unitId === 'surv')
      .map((e) => e.atk);
    expect(Math.max(...survAtks)).toBeGreaterThanOrEqual(2);
    const [a2, b2] = build();
    expect(JSON.stringify(resolveCombat(a2, b2, 'pall-seed'))).toEqual(JSON.stringify(events));
  });
});

describe('stats events carry source + permanence (replay legibility, §16.6 rework)', () => {
  it('token-death floor self-buff is sourced to the bearer and flagged per config', () => {
    resetUidCounter();
    const units = [mk({ cardId: 'wildkin_gorehide', uid: 'gore', atk: 2, hp: 300 })];
    for (let i = 0; i < 3; i++) units.push(mk({ cardId: 'wildkin_thornpup', uid: `gp${i}`, atk: 0, hp: 1, keywords: ['taunt'] }));
    const a = board(units);
    const b = board([mk({ cardId: 'reefkin_brineling', uid: 'killer', atk: 1, hp: 500 })]);
    const events = resolveCombat(a, b, 'src-floor');
    const goreStats = events.filter((e): e is Extract<CombatEvent, { t: 'stats' }> => e.t === 'stats' && e.unitId === 'gore');
    expect(goreStats.length).toBeGreaterThan(0);
    for (const s of goreStats) {
      expect(s.sourceId).toBe('gore'); // grows off its own token deaths
      expect(s.permanent).toBe(engines.wildkin.tokenBuffPermanent);
    }
  });

  it('a deathrattle buff is sourced to the dying unit and flagged this-combat (combat buffs do not persist)', () => {
    resetUidCounter();
    // Cryptling dies (reborn stripped) → deathrattle gives the one other friendly Revenant
    // +1/+1; with a single eligible ally the random target is deterministic.
    const a = board([
      mk({ cardId: 'revenants_cryptling', uid: 'crypt', atk: 1, hp: 1, keywords: [] }),
      mk({ cardId: 'revenants_cryptling', uid: 'ally', atk: 1, hp: 50, keywords: [] }),
    ]);
    const b = board([mk({ cardId: 'reefkin_brineling', uid: 'killer', atk: 9, hp: 200 })]);
    const events = resolveCombat(a, b, 'src-dr');
    const allyBuff = events.find(
      (e): e is Extract<CombatEvent, { t: 'stats' }> => e.t === 'stats' && e.unitId === 'ally',
    );
    expect(allyBuff).toBeDefined();
    expect(allyBuff!.sourceId).toBe('crypt');
    expect(allyBuff!.permanent).toBe(false); // combat-fired buffs are this-combat-only
  });
});

describe('Spinefish deathrattle spreads Poison (combat-only, regression)', () => {
  it('grants Poison to a friendly that then poison-kills, and flags the grant', () => {
    resetUidCounter();
    // Spinefish dies to the shielded enemy's retaliation, then its deathrattle gives the lone
    // ally Poison; the ally's next hit poison-kills the (now unshielded) enemy → side A wins.
    const a = board([
      mk({ cardId: 'reefkin_spinefish', uid: 'spine', atk: 2, hp: 1, keywords: ['poison'] }),
      mk({ cardId: 'reefkin_brineling', uid: 'bruiser', atk: 2, hp: 20, keywords: [] }),
    ]);
    const b = board([mk({ cardId: 'wildkin_gorehide', uid: 'killer', atk: 3, hp: 50, keywords: ['divineShield'] })]);
    const events = resolveCombat(a, b, 'spine-probe');

    // the deathrattle GRANT is flagged so the replay can tell it apart from an affliction
    const grant = events.find(
      (e): e is Extract<CombatEvent, { t: 'keyword' }> =>
        e.t === 'keyword' && e.keyword === 'poison' && e.unitId === 'bruiser',
    );
    expect(grant?.gained).toBe(true);
    expect(grant?.sourceId).toBe('spine');

    // the granted poison actually works within the combat
    expect(deaths(events).some((d) => d.unitId === 'killer')).toBe(true);
    expect(end(events).winner).toBe('a');
  });
});
