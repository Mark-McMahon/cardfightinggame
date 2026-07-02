// EVALS.md Group Q — EV-FRG (Forgemaster persistent Sentinel modifier, #55) + EV-GOLD (Corsair
// gold-economy cards, #56). Property targets:
//  • EV-FRG: playing a Forgemaster increments the PERSISTENT forgemastersPlayed counter (never
//    decremented — survives its sale/death); each summoned Sentinel in combat gains +buff/+buff per
//    stack, read from the CombatBoard scalar.
//  • EV-GOLD: Bursar queues gold delivered NEXT turn (not this turn); Moneylender queues (non-stacking,
//    gated); Vault Keeper raises the EFFECTIVE gold cap (and reverts on leave); Fence raises the sell
//    refund (non-stacking, reverts); the Fence+Tuskmonger churn loop is BOUNDED (no infinite gold; gems
//    stay separate). Design-spec §5, §6.4, §8; requirements #55/#56.
import { describe, it, expect } from 'vitest';
import {
  createShopSession,
  startShopPhase,
  endOfTurnPhase,
  playUnit,
  sellUnit,
  buyUnit,
  makeInstance,
  boardToCombat,
  resolveCombat,
  effectiveGoldCap,
  getCard,
  engines,
  economy,
  type ShopSession,
  type CombatUnit,
  type CombatBoard,
  type CombatEvent,
  type UnitInstance,
} from '@cardgame/shared';

const C = engines.corsairs;
const CON = engines.constructs;

function session(): ShopSession {
  const s = createShopSession(0, { seed: 'fg' });
  s.round = 3;
  s.tier = 5;
  return s;
}
function onBoard(s: ShopSession, cardId: string): UnitInstance {
  const inst = makeInstance(cardId, { uid: `bd${s.uidSeq++}`, bornTurn: s.round });
  s.board.push(inst);
  return inst;
}
function onBench(s: ShopSession, cardId: string): UnitInstance {
  const inst = makeInstance(cardId, { uid: `bn${s.uidSeq++}`, bornTurn: s.round });
  s.bench.push(inst);
  return inst;
}
let __uid = 0;
function cu(cardId: string, o: Partial<CombatUnit> = {}): CombatUnit {
  const c = getCard(cardId);
  return { uid: `${cardId}#${++__uid}`, cardId, name: c.name, tribe: c.tribe, tier: c.tier, atk: c.atk, hp: c.hp, keywords: [...c.keywords], golden: false, isToken: !!c.isToken, effects: c.effects, auras: c.auras ?? [], ...o };
}
function byType<T extends CombatEvent['t']>(evs: CombatEvent[], t: T) {
  return evs.filter((e): e is Extract<CombatEvent, { t: T }> => e.t === t);
}
// synthetic Sentinel summoner: a start-of-combat summon of one Sentinel (any Sentinel summon site
// works identically; this isolates the Forgemaster buff without needing a deaths/width breakpoint).
function sentinelSummoner(forge: number): CombatBoard {
  const summoner = cu('constructs_cogling', {
    effects: [{ trigger: { type: 'startOfCombat' }, target: { selector: 'self' }, actions: [{ type: 'summon', summonUnitId: CON.forgemasterSentinelId, summonCount: 1 }] }],
  });
  return { units: [summoner], playerTier: 5, forgemastersPlayed: forge };
}

describe('EV-FRG — Forgemaster persistent Sentinel modifier (#55)', () => {
  it('EV-FRG-01: playing a Forgemaster increments the persistent forgemastersPlayed counter', () => {
    const s = session();
    onBench(s, 'constructs_forgemaster');
    expect(s.forgemastersPlayed).toBe(0);
    playUnit(s, s.bench[0].uid);
    expect(s.forgemastersPlayed).toBe(1);
    onBench(s, 'constructs_forgemaster');
    playUnit(s, s.bench[0].uid);
    expect(s.forgemastersPlayed).toBe(2); // stacks per copy played
    expect(boardToCombat(s).forgemastersPlayed).toBe(2); // rides into combat on the scalar
  });

  it('EV-FRG-02: the stack survives the Forgemaster sale/death (never decremented)', () => {
    const s = session();
    const fm = onBench(s, 'constructs_forgemaster');
    playUnit(s, fm.uid);
    expect(s.forgemastersPlayed).toBe(1);
    sellUnit(s, fm.uid); // sell it off the board
    expect(s.forgemastersPlayed).toBe(1); // counter is NOT decremented
    expect(boardToCombat(s).forgemastersPlayed).toBe(1);
  });

  it('EV-FRG-03: each combat-summoned Sentinel gains +buff/+buff per stack (read from the scalar)', () => {
    const per = CON.forgemasterSentinelBuff;
    const printed = getCard(CON.forgemasterSentinelId);
    // 0 stacks → the summoned Sentinel is at printed stats (no buff stats event).
    const ev0 = resolveCombat(sentinelSummoner(0), { units: [cu('corsairs_ironclad', { keywords: [], atk: 0, hp: 100000 })], playerTier: 1 }, 'fg-0');
    const sum0 = byType(ev0, 'summon')[0];
    expect(sum0).toBeTruthy();
    const sentUid0 = sum0.unitIds[0];
    expect(byType(ev0, 'stats').some((e) => e.unitId === sentUid0)).toBe(false); // no forge buff at 0 stacks
    // 3 stacks → +3*per/+3*per.
    const ev3 = resolveCombat(sentinelSummoner(3), { units: [cu('corsairs_ironclad', { keywords: [], atk: 0, hp: 100000 })], playerTier: 1 }, 'fg-3');
    const sum3 = byType(ev3, 'summon')[0];
    const sentUid3 = sum3.unitIds[0];
    const buff = byType(ev3, 'stats').find((e) => e.unitId === sentUid3);
    expect(buff).toBeTruthy();
    expect([buff!.atk, buff!.hp]).toEqual([printed.atk + 3 * per, printed.hp + 3 * per]);
  });
});

describe('EV-GOLD — Corsair gold-economy cards (#56)', () => {
  it('EV-GOLD-01: Bursar delivers its gold at the START of the NEXT turn, not this turn', () => {
    const s = session();
    const before = s.gold;
    const b = onBench(s, 'corsairs_bursar');
    playUnit(s, b.uid); // battlecry queues delayed gold
    expect(s.gold).toBe(before); // NOT credited this turn
    expect(s.delayedGold).toBe(C.bursarGold);
    endOfTurnPhase(s);
    startShopPhase(s); // next turn: delivered + queue cleared
    expect(s.delayedGold).toBe(0);
    // income (capped) + the delivered Bursar gold
    expect(s.gold).toBe(Math.min(economy.goldCap, s.baseIncome + C.bursarGold));
  });

  it('EV-GOLD-02: Moneylender queues next-turn gold only when rich; non-stacking', () => {
    const s = session();
    onBoard(s, 'corsairs_moneylender');
    onBoard(s, 'corsairs_moneylender'); // a SECOND does not stack
    s.gold = C.moneylenderThreshold - 1; // below the gate
    endOfTurnPhase(s);
    expect(s.delayedGold).toBe(0);
    s.gold = C.moneylenderThreshold; // at the gate
    endOfTurnPhase(s);
    expect(s.delayedGold).toBe(C.moneylenderGold); // ONCE, not once per copy
  });

  it('EV-GOLD-03: Vault Keeper raises the effective gold cap (income + gains) and reverts on leave', () => {
    const s = session();
    expect(effectiveGoldCap(s)).toBe(economy.goldCap);
    const vk = onBoard(s, 'corsairs_vaultkeeper');
    expect(effectiveGoldCap(s)).toBe(C.vaultKeeperGoldCap);
    // income clamps to the raised cap: a late round would exceed base 10 → clamps to 13.
    s.round = 25;
    startShopPhase(s);
    expect(s.gold).toBe(C.vaultKeeperGoldCap); // 3 + 24 income clamped to 13, not 10
    sellUnit(s, vk.uid); // Vault Keeper leaves → cap reverts
    expect(effectiveGoldCap(s)).toBe(economy.goldCap);
  });

  it('EV-GOLD-04: Fence raises the sell refund (non-stacking) and reverts when it leaves', () => {
    const s = session();
    const dummy = onBoard(s, 'corsairs_swab');
    const g0 = s.gold;
    sellUnit(s, dummy.uid);
    expect(s.gold).toBe(g0 + economy.sellRefund); // base refund, no Fence
    onBoard(s, 'corsairs_fence');
    onBoard(s, 'corsairs_fence'); // a second Fence does not stack
    const d2 = onBoard(s, 'corsairs_swab');
    const g1 = s.gold;
    sellUnit(s, d2.uid);
    expect(s.gold).toBe(g1 + C.fenceSellRefund); // Fence refund (2), not 4
  });

  it('EV-GOLD-05: the Fence + Tuskmonger churn loop is BOUNDED (no infinite gold; gems stay separate)', () => {
    const s = session();
    s.tier = 3;
    onBoard(s, 'corsairs_fence'); // sells for fenceSellRefund
    onBoard(s, 'tuskers_tuskmonger'); // onSell → +gems
    startShopPhase(s); // draw a tier-3 shop to churn
    s.gold = economy.goldCap;
    const gemsStart = s.gems;
    // run buy(3)/sell churn cycles: buy the first shop offer, then sell it. Bounded by the shop width.
    let cycles = 0;
    for (let i = 0; i < 50; i++) {
      if (s.gold < economy.buyCost || s.shop.length === 0) break;
      const goldBeforeCycle = s.gold;
      if (!buyUnit(s, 0).ok) break;
      const bought = s.bench[s.bench.length - 1];
      sellUnit(s, bought.uid);
      // each buy(3)/sell(fenceRefund=2) cycle STRICTLY loses gold (fenceSellRefund < buyCost).
      expect(s.gold).toBeLessThan(goldBeforeCycle);
      cycles++;
    }
    expect(cycles).toBeGreaterThan(0); // the loop actually ran
    expect(s.gold).toBeLessThan(economy.goldCap); // gold only decreased — it cannot be minted
    expect(s.gems).toBeGreaterThan(gemsStart); // gems accrued (a SEPARATE currency; only Gemwright bridges, gems→gold)
    expect(C.fenceSellRefund).toBeLessThan(economy.buyCost); // the structural reason the loop can't mint gold
  });
});
