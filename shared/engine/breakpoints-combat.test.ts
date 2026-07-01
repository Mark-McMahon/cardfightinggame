// EVALS.md Group F — Breakpoints at the COMBAT interface. Property: the payoff fires AT the
// threshold, not below (a step, not a per-unit line). Thresholds/payoffs are READ from
// config/breakpoints.ts (getBreakpoint) — never hardcoded. Design-spec §6.6, §16.4.
// SHOP-only breakpoints (05,08,11,12,19,20,21,22,25,26,27) are out of scope here.
import { describe, it, expect } from 'vitest';
import {
  resolveCombat,
  getCard,
  getBreakpoint,
  engines,
  type CombatUnit,
  type CombatBoard,
  type CombatEvent,
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
const SEED = 'seed-bp';
const vanilla = (atk: number, hp: number, o: Partial<CombatUnit> = {}) =>
  cu('corsairs_ironclad', { keywords: [], effects: [], atk, hp, ...o });
const passiveB = () => board([vanilla(0, 100000)]);
const fillers = (n: number) => Array.from({ length: n }, () => vanilla(0, 100000));
const chaff = (n: number) => Array.from({ length: n }, () => cu('wildkin_thornpup', { atk: 0, hp: 1 }));
const DESTROYERS = ['infernals_hollowpriest', 'infernals_pyrewalker', 'infernals_dreadmaw', 'sirens_maelstromcantor'];
const destroyers = (n: number) => DESTROYERS.slice(0, n).map((id) => cu(id, { hp: 100 }));

// ── alliesAtStart (start-of-combat countAllies) breakpoints ───────────────────────
// board buff: a 0-atk filler witness gains attack only when the ally count reaches the threshold.
function alliesBoardBuff(cardId: string) {
  const bp = getBreakpoint(cardId);
  const run = (allies: number) => {
    const card = cu(cardId, { hp: 100000 });
    const fill = fillers(allies - 1);
    const evs = resolveCombat(board([card, ...fill]), passiveB(), SEED);
    return fill.some((f) => byType(evs, 'stats').some((e) => e.unitId === f.uid && e.atk > 0));
  };
  expect(run(bp.threshold - 1)).toBe(false);
  expect(run(bp.threshold)).toBe(true);
}

describe('EV-BP — alliesAtStart (COMBAT)', () => {
  it('EV-BP-02: Thornwarden — alliesAtStart≥threshold → self +atk/+hp (once)', () => {
    const bp = getBreakpoint('wildkin_thornwarden');
    const base = getCard('wildkin_thornwarden');
    const run = (allies: number) => {
      const card = cu('wildkin_thornwarden', { hp: 100000 });
      const evs = resolveCombat(board([card, ...fillers(allies - 1)]), passiveB(), SEED);
      return byType(evs, 'stats').some((e) => e.unitId === card.uid && e.atk === base.atk + bp.atk!);
    };
    expect(run(bp.threshold - 1)).toBe(false);
    expect(run(bp.threshold)).toBe(true);
  });

  it('EV-BP-03: Grovelord — alliesAtStart≥threshold → board +atk/+hp', () => alliesBoardBuff('wildkin_grovelord'));
  it('EV-BP-23: Tempest — alliesAtStart≥threshold → board +atk', () => alliesBoardBuff('primordials_tempest'));
  it('EV-BP-28: Reaver — alliesAtStart≥threshold → board +atk', () => alliesBoardBuff('corsairs_reaver'));
  it('EV-BP-29: Marauder — alliesAtStart≥threshold → board +atk/+hp', () => alliesBoardBuff('corsairs_marauder'));

  it('EV-BP-17: Titanforge — alliesAtStart≥threshold → summon a Sentinel', () => {
    const bp = getBreakpoint('constructs_titanforge');
    const run = (allies: number) => {
      const card = cu('constructs_titanforge', { hp: 100000 });
      const evs = resolveCombat(board([card, ...fillers(allies - 1)]), passiveB(), SEED);
      return byType(evs, 'summon').some((e) => e.ownerId === card.uid && e.unitIds.length === (bp.summonCount ?? 1));
    };
    expect(run(bp.threshold - 1)).toBe(false);
    expect(run(bp.threshold)).toBe(true);
  });

  it('EV-BP-24: Worldspark — alliesAtStart≥threshold → grant board Cleave', () => {
    const bp = getBreakpoint('primordials_worldspark');
    expect(bp.grantKeyword).toBe('cleave');
    const run = (allies: number) => {
      const card = cu('primordials_worldspark', { hp: 100000 });
      const fill = fillers(allies - 1);
      const evs = resolveCombat(board([card, ...fill]), passiveB(), SEED);
      return byType(evs, 'keyword').some((e) => e.keyword === 'cleave' && e.gained === true && fill.some((f) => f.uid === e.unitId));
    };
    expect(run(bp.threshold - 1)).toBe(false);
    expect(run(bp.threshold)).toBe(true);
  });
});

// ── deaths (afterFriendlyDeaths / deathrattle-gated) breakpoints ───────────────────
describe('EV-BP — deaths (COMBAT)', () => {
  // self-buff-at-threshold cards: manufacture `deaths` via start-of-combat destroys of 0-atk chaff.
  const selfBuffAtDeaths = (cardId: string) => {
    const bp = getBreakpoint(cardId);
    const base = getCard(cardId);
    const run = (deaths: number) => {
      const card = cu(cardId, { hp: 100000 }); // atk stays at base (chaff atk 0 are destroyed instead)
      const evs = resolveCombat(board([card, ...chaff(deaths), ...destroyers(deaths)]), passiveB(), SEED);
      return byType(evs, 'stats').some((e) => e.unitId === card.uid && e.atk === base.atk + bp.atk!);
    };
    expect(run(bp.threshold - 1)).toBe(false);
    expect(run(bp.threshold)).toBe(true);
  };

  it('EV-BP-13: Bloodcaller — deaths≥threshold once → self +atk/+hp', () => selfBuffAtDeaths('infernals_bloodcaller'));

  it('EV-BP-14: Abysslord — deaths≥threshold once → self +atk/+hp AND Cleave', () => {
    const bp = getBreakpoint('infernals_abysslord');
    const base = getCard('infernals_abysslord');
    const run = (deaths: number) => {
      const card = cu('infernals_abysslord', { hp: 100000 });
      const evs = resolveCombat(board([card, ...chaff(deaths), ...destroyers(deaths)]), passiveB(), SEED);
      const buffed = byType(evs, 'stats').some((e) => e.unitId === card.uid && e.atk === base.atk + bp.atk!);
      const cleaved = byType(evs, 'keyword').some((e) => e.unitId === card.uid && e.keyword === 'cleave' && e.gained === true);
      return buffed && cleaved;
    };
    expect(run(bp.threshold - 1)).toBe(false);
    expect(run(bp.threshold)).toBe(true);
  });

  it('EV-BP-04: Pack Mother — deaths≥threshold everyN → board +atk/+hp', () => {
    // NOTE: Pack Mother's CARD reads its payoff from engines.wildkin.avengePayoff* (2/2), NOT the
    // breakpoints.ts row (which lists hp:3). Config divergence flagged in the return. Threshold matches.
    const bp = getBreakpoint('wildkin_packmother');
    const payAtk = engines.wildkin.avengePayoffAtk;
    const payHp = engines.wildkin.avengePayoffHp;
    const run = (deaths: number) => {
      const witness = vanilla(9, 100);
      const evs = resolveCombat(board([cu('wildkin_packmother', { atk: 9, hp: 100 }), witness, ...chaff(deaths), ...destroyers(deaths)]), passiveB(), SEED);
      return byType(evs, 'stats').some((e) => e.unitId === witness.uid && e.atk === 9 + payAtk && e.hp === 100 + payHp);
    };
    expect(run(bp.threshold - 1)).toBe(false);
    expect(run(bp.threshold)).toBe(true);
  });

  it('EV-BP-06: Mortarch — deaths≥threshold once → board +atk/+hp', () => {
    const bp = getBreakpoint('revenants_mortarch');
    const run = (deaths: number) => {
      const witness = vanilla(9, 100);
      const evs = resolveCombat(board([cu('revenants_mortarch', { atk: 9, hp: 100 }), witness, ...chaff(deaths), ...destroyers(deaths)]), passiveB(), SEED);
      return byType(evs, 'stats').some((e) => e.unitId === witness.uid && e.atk === 9 + bp.atk! && e.hp === 100 + bp.hp!);
    };
    expect(run(bp.threshold - 1)).toBe(false);
    expect(run(bp.threshold)).toBe(true);
  });

  it('EV-BP-15: Carrion Sovereign — deaths≥1 everyN → Infernals +atk/+hp (this combat)', () => {
    const bp = getBreakpoint('infernals_carrionsovereign');
    const run = (deaths: number) => {
      const witness = cu('infernals_gravebrand', { atk: 9, hp: 100 }); // infernal witness (its DR won't fire — survives)
      const evs = resolveCombat(board([cu('infernals_carrionsovereign', { atk: 9, hp: 100 }), witness, ...chaff(deaths), ...destroyers(deaths)]), passiveB(), SEED);
      return byType(evs, 'stats').some((e) => e.unitId === witness.uid && e.atk === 9 + bp.atk! && e.hp === 100 + bp.hp!);
    };
    expect(run(0)).toBe(false); // below threshold 1
    expect(run(1)).toBe(true); // at threshold 1
  });

  it('EV-BP-18: Aegis Prime — deaths≥1 everyN → Constructs +atk/+hp (this combat)', () => {
    const bp = getBreakpoint('constructs_aegisprime');
    const run = (deaths: number) => {
      const witness = cu('constructs_cogling', { atk: 9, hp: 100 }); // construct witness (survives)
      const evs = resolveCombat(board([cu('constructs_aegisprime', { atk: 9, hp: 100 }), witness, ...chaff(deaths), ...destroyers(deaths)]), passiveB(), SEED);
      return byType(evs, 'stats').some((e) => e.unitId === witness.uid && e.atk === 9 + bp.atk! && e.hp === 100 + bp.hp!);
    };
    expect(run(0)).toBe(false);
    expect(run(1)).toBe(true);
  });

  // deathrattle-summon-at-threshold: the card must DIE as the Nth death; its deathrattle then summons.
  const deathrattleSummonAtDeaths = (cardId: string, stripKeywords: boolean) => {
    const bp = getBreakpoint(cardId);
    const run = (totalDeaths: number) => {
      // card is destroyed LAST (0 atk, later slot); `totalDeaths` = prior chaff + the card itself
      const prior = totalDeaths - 1;
      const card = cu(cardId, { atk: 0, hp: 1, ...(stripKeywords ? { keywords: [] } : {}) });
      const a = board([...chaff(prior), card, ...destroyers(totalDeaths)]);
      const evs = resolveCombat(a, passiveB(), SEED);
      return byType(evs, 'summon').some((e) => e.ownerId === card.uid && e.unitIds.length === (bp.summonCount ?? 1));
    };
    expect(run(bp.threshold - 1)).toBe(false);
    expect(run(bp.threshold)).toBe(true);
  };

  it('EV-BP-09: Bone Colossus — deaths≥threshold once (deathrattle) → summon reborn wraiths', () =>
    deathrattleSummonAtDeaths('revenants_boncolossus', true));
  it('EV-BP-16: Foundry — deaths≥threshold once (deathrattle) → summon a Sentinel', () =>
    deathrattleSummonAtDeaths('constructs_foundry', false));
});

// ── revenantDeaths / shieldBreak breakpoints ──────────────────────────────────────
describe('EV-BP — revenantDeaths & shieldBreak (COMBAT)', () => {
  it('EV-BP-07: Pale Lich — revenantDeaths≥threshold → damage amp (inert below the threshold)', () => {
    const bp = getBreakpoint('revenants_palelich');
    expect(bp.counter).toBe('revenantDeaths');
    const amp = engines.revenants.undeadDamageAmp;
    const lich = cu('revenants_palelich');
    const chaffRev = [cu('revenants_wisp'), cu('revenants_wisp'), cu('revenants_wisp')];
    const evs = resolveCombat(board([...chaffRev, lich]), board([vanilla(6, 9999)]), SEED);
    const revUids = new Set(chaffRev.map((u) => u.uid));
    let seen = 0;
    let activeIdx = -1;
    evs.forEach((e, i) => {
      if (e.t === 'death' && revUids.has(e.unitId)) {
        seen += 1;
        if (seen === bp.threshold) activeIdx = i;
      }
    });
    expect(activeIdx).toBeGreaterThanOrEqual(0);
    evs.forEach((e, i) => {
      if (e.t === 'damage' && e.sourceId === lich.uid) expect(e.amount).toBe(i > activeIdx ? lich.atk * amp : lich.atk);
    });
  });

  it('EV-BP-10: Pearlguard — shieldBreak≥1 once → board +atk/+hp (only after the break)', () => {
    const bp = getBreakpoint('reefkin_pearlguard');
    const pearl = cu('reefkin_pearlguard');
    const witness = vanilla(0, 100000);
    const evs = resolveCombat(board([pearl, witness]), board([vanilla(2, 100000)]), SEED);
    const breakIdx = evs.findIndex((e) => e.t === 'damage' && (e as any).targetId === pearl.uid && (e as any).shieldBroken === true);
    expect(breakIdx).toBeGreaterThanOrEqual(0);
    const buffIdx = evs.findIndex((e) => e.t === 'stats' && (e as any).unitId === witness.uid && (e as any).atk === bp.atk && (e as any).hp === 100000 + bp.hp!);
    expect(buffIdx).toBeGreaterThan(breakIdx); // payoff fires at (after) the break, not before
  });
});

// ── Mother Thorn: SHOP+COMBAT — the COMBAT half is that its shop counter reads 0 in combat ─────
describe('EV-BP — Mother Thorn combat half', () => {
  it('EV-BP-01 (combat half): tokensThisTurn is shop-scoped → Mother Thorn does NOT buff summons during combat', () => {
    // A Tombspawn summons 2 tokens in combat; Mother Thorn (onSummon, gated on tokensSummonedThisTurn)
    // must NOT fire — the shop counter reads 0 in combat, so summoned tokens get no +tokenAtk/+tokenHp.
    const bp = getBreakpoint('wildkin_motherthorn');
    const mthorn = cu('wildkin_motherthorn', { atk: 9, hp: 100000 });
    const tomb = cu('revenants_tombspawn', { atk: 0, hp: 1 });
    const evs = resolveCombat(board([mthorn, tomb, cu('infernals_hollowpriest', { hp: 100, atk: 3 })]), passiveB(), SEED);
    const summon = byType(evs, 'summon').find((e) => e.ownerId === tomb.uid);
    expect(summon).toBeTruthy();
    const tokenIds = new Set(summon!.unitIds);
    // no summoned token receives Mother Thorn's per-token buff in combat
    expect(byType(evs, 'stats').some((e) => tokenIds.has(e.unitId) && e.atk >= 1 + bp.tokenAtk!)).toBe(false);
  });
});
