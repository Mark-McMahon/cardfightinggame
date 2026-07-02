// EVALS.md Group G — Economy / shop reducer (interface: SHOP / INTENT). Property evals written
// to intent (design-spec §4.2, §5, §9.7). Numbers are IMPORTED from config, never hardcoded.
// Triple/discover live in shop-triple.test.ts; battlecry/target/onSell patterns in intent.test.ts.
import { describe, it, expect } from 'vitest';
import {
  createShopSession,
  startShopPhase,
  endOfTurnPhase,
  buyUnit,
  sellUnit,
  rollShop,
  freezeShop,
  tierUp,
  playUnit,
  moveUnit,
  makeInstance,
  createPool,
  baseIncomeForRound,
  toPrivateState,
  economy,
  triples,
  engines,
  getCard,
  PURCHASABLE_UNITS,
  type ShopSession,
} from '@cardgame/shared';

let __u = 0;
const uid = () => `T${__u++}`;
function put(s: ShopSession, cardId: string, where: 'board' | 'bench' = 'board') {
  const inst = makeInstance(cardId, { uid: uid(), bornTurn: s.round });
  (where === 'board' ? s.board : s.bench).push(inst);
  return inst;
}
const poolTotal = (pool: Record<string, number>) => Object.values(pool).reduce((a, b) => a + b, 0);

describe('EV-ECO — economy / shop reducer', () => {
  it('EV-ECO-01: income = goldStart round 1, +goldPerTurn each round, capped at goldCap', () => {
    const s = createShopSession(0, { seed: 'eco01' });
    for (let r = 1; r <= 12; r++) {
      startShopPhase(s);
      const expected = Math.min(economy.goldCap, economy.goldStart + (r - 1) * economy.goldPerTurn);
      expect(baseIncomeForRound(r)).toBe(expected);
      expect(s.gold).toBe(expected);
      expect(s.baseIncome).toBe(expected);
    }
    // explicit boundaries: round 1 == goldStart; a late round is clamped to goldCap.
    expect(baseIncomeForRound(1)).toBe(economy.goldStart);
    expect(baseIncomeForRound(99)).toBe(economy.goldCap);
  });

  it('EV-ECO-02: buy costs buyCost, moves shop→bench; rejected (no mutation) if unaffordable or bench full', () => {
    const s = createShopSession(0, { seed: 'eco02' });
    startShopPhase(s); // round 1, gold == goldStart (== buyCost), shop drawn
    const boughtId = s.shop[0];
    const shopLenBefore = s.shop.length;
    const res = buyUnit(s, 0);
    expect(res.ok).toBe(true);
    expect(s.gold).toBe(economy.goldStart - economy.buyCost);
    expect(s.bench.length).toBe(1);
    expect(s.bench[0].cardId).toBe(boughtId);
    expect(s.shop.length).toBe(shopLenBefore - 1);

    // unaffordable: no gold → reject, no mutation
    const s2 = createShopSession(1, { seed: 'eco02b' });
    startShopPhase(s2);
    s2.gold = economy.buyCost - 1;
    const goldB = s2.gold, benchB = s2.bench.length, shopB = s2.shop.length;
    const r2 = buyUnit(s2, 0);
    expect(r2.ok).toBe(false);
    expect(r2.error).toBeTruthy();
    expect(s2.gold).toBe(goldB);
    expect(s2.bench.length).toBe(benchB);
    expect(s2.shop.length).toBe(shopB);

    // bench full: benchCap bodies already → reject, no mutation
    const s3 = createShopSession(2, { seed: 'eco02c' });
    startShopPhase(s3);
    s3.gold = 999;
    for (let i = 0; i < economy.benchCap; i++) put(s3, 'wildkin_brambleling', 'bench');
    const shopC = [...s3.shop];
    const r3 = buyUnit(s3, 0);
    expect(r3.ok).toBe(false);
    expect(s3.bench.length).toBe(economy.benchCap);
    expect(s3.shop).toEqual(shopC);
  });

  it('EV-ECO-03: sell refunds sellRefund, returns a pool copy, and fires onSell', () => {
    const pool = createPool();
    const s = createShopSession(0, { pool, seed: 'eco03' });
    s.round = 1;
    const inst = put(s, 'wildkin_brambleling', 'bench'); // purchasable, non-token, non-golden
    const poolBefore = pool['wildkin_brambleling'];
    s.gold = 0;
    const res = sellUnit(s, inst.uid);
    expect(res.ok).toBe(true);
    expect(s.gold).toBe(economy.sellRefund);
    expect(pool['wildkin_brambleling']).toBe(poolBefore + 1); // copy returned
    expect(s.bench.length).toBe(0);

    // onSell fires: Tuskmonger (onSell → +2 gems) on board, sell another body
    const s2 = createShopSession(1, { seed: 'eco03b' });
    s2.round = 1;
    put(s2, 'tuskers_tuskmonger', 'board');
    const victim = put(s2, 'wildkin_brambleling', 'bench');
    const gemsBefore = s2.gems;
    sellUnit(s2, victim.uid);
    expect(s2.gems).toBe(gemsBefore + 2);
  });

  it('EV-ECO-04: roll costs rerollCost and redraws the shop; rejected without gold', () => {
    const s = createShopSession(0, { seed: 'eco04' });
    startShopPhase(s);
    s.gold = economy.rerollCost;
    const before = [...s.shop];
    const res = rollShop(s);
    expect(res.ok).toBe(true);
    expect(s.gold).toBe(0);
    expect(s.shop.length).toBe(before.length); // full redraw of non-frozen slots
    // reject with no gold, no mutation
    const shopNow = [...s.shop];
    const r2 = rollShop(s);
    expect(r2.ok).toBe(false);
    expect(s.shop).toEqual(shopNow);
    expect(s.gold).toBe(0);
  });

  it('EV-ECO-05: freeze is free and the frozen offer set persists into the next shop', () => {
    const s = createShopSession(0, { seed: 'eco05' });
    startShopPhase(s);
    const goldBefore = s.gold;
    const frozenOffers = [...s.shop];
    const res = freezeShop(s);
    expect(res.ok).toBe(true);
    expect(s.frozen).toBe(true);
    expect(s.gold).toBe(goldBefore); // freezeCost == 0
    startShopPhase(s); // next turn
    expect(s.shop).toEqual(frozenOffers); // same offers persisted
    expect(s.frozen).toBe(false); // freeze cleared after being honored
  });

  it('EV-ECO-06: tierUp cost = tierUpBaseCost[tier] − discountPerTurn×skips (floored ≥0), discount resets on tier-up', () => {
    const base = economy.tierUpBaseCost[1]; // cost to advance FROM tier 1
    // skips = round − lastTierUpRound
    const cost = (round: number, lastTierUp: number) => {
      const s = createShopSession(0, { seed: 'eco06' });
      s.tier = 1;
      s.round = round;
      s.lastTierUpRound = lastTierUp;
      return toPrivateState(s).tierUpCost;
    };
    expect(cost(1, 1)).toBe(base); // 0 skips
    expect(cost(3, 1)).toBe(Math.max(0, base - economy.tierUpDiscountPerTurn * 2)); // 2 skips
    expect(cost(99, 1)).toBe(0); // floored at 0

    // discount resets on tier-up
    const s = createShopSession(1, { seed: 'eco06b' });
    s.tier = 1;
    s.round = 4;
    s.lastTierUpRound = 1; // 3 skips → discounted cost
    s.gold = 999;
    const discounted = toPrivateState(s).tierUpCost;
    expect(discounted).toBe(Math.max(0, base - economy.tierUpDiscountPerTurn * 3));
    tierUp(s);
    expect(s.tier).toBe(2);
    expect(s.lastTierUpRound).toBe(4); // reset to this round → skips now 0
    expect(toPrivateState(s).tierUpCost).toBe(economy.tierUpBaseCost[2]); // no discount right after tiering
  });

  it('EV-ECO-07: shop offers shopSlotsByTier[tier−1] units', () => {
    for (let tier = 1; tier <= economy.tierCount; tier++) {
      const s = createShopSession(0, { seed: `eco07-${tier}` });
      s.tier = tier;
      startShopPhase(s);
      expect(s.shop.length).toBe(economy.shopSlotsByTier[tier - 1]);
    }
  });

  it('EV-ECO-08: ≤ poolCopiesByTier copies exist; rolls draw only at/below tier; contesting depletes the shared pool', () => {
    const fresh = createPool();
    // copies per card == poolCopiesByTier[card.tier-1]
    for (const card of PURCHASABLE_UNITS) {
      expect(fresh[card.id]).toBe(economy.poolCopiesByTier[card.tier - 1]);
    }
    // shared pool: two sessions draw from ONE pool; copies are conserved (moved to shop, not created).
    const pool = createPool();
    const total0 = poolTotal(pool);
    const a = createShopSession(0, { pool, seed: 'eco08a' });
    const b = createShopSession(1, { pool, seed: 'eco08b' });
    a.tier = 1;
    b.tier = 3;
    startShopPhase(a);
    startShopPhase(b);
    // rolls draw only at/below player tier
    for (const id of a.shop) expect(getCard(id).tier).toBeLessThanOrEqual(1);
    for (const id of b.shop) expect(getCard(id).tier).toBeLessThanOrEqual(3);
    // conservation: remaining pool + drawn offers == initial total (contention depletes the shared pool)
    expect(poolTotal(pool) + a.shop.length + b.shop.length).toBe(total0);
    // no card ever exceeds its tier cap
    for (const card of PURCHASABLE_UNITS) {
      expect(pool[card.id]).toBeLessThanOrEqual(economy.poolCopiesByTier[card.tier - 1]);
    }
  });

  it('EV-ECO-09 (D7): boardCap/benchCap enforced, both read from economy config', () => {
    // board cap
    const s = createShopSession(0, { seed: 'eco09' });
    s.round = 1;
    for (let i = 0; i < economy.boardCap; i++) put(s, 'wildkin_brambleling', 'bench');
    for (const inst of [...s.bench]) playUnit(s, inst.uid); // fill board to cap
    expect(s.board.length).toBe(economy.boardCap);
    const overflow = put(s, 'wildkin_brambleling', 'bench');
    const r = playUnit(s, overflow.uid);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('board full');
    expect(s.board.length).toBe(economy.boardCap);

    // bench cap
    const s2 = createShopSession(1, { seed: 'eco09b' });
    startShopPhase(s2);
    s2.gold = 999;
    for (let i = 0; i < economy.benchCap; i++) put(s2, 'wildkin_brambleling', 'bench');
    expect(s2.bench.length).toBe(economy.benchCap);
    const r2 = buyUnit(s2, 0);
    expect(r2.ok).toBe(false);
    expect(r2.error).toBe('bench full');
  });

  it('EV-ECO-12: moveUnit reorders the board and updates slot indices', () => {
    const s = createShopSession(0, { seed: 'eco12' });
    s.round = 1;
    const a = put(s, 'wildkin_brambleling');
    const b = put(s, 'reefkin_tidecaller');
    const c = put(s, 'corsairs_swab');
    expect(s.board.map((u) => u.uid)).toEqual([a.uid, b.uid, c.uid]);
    const res = moveUnit(s, c.uid, 0); // move last to front
    expect(res.ok).toBe(true);
    expect(s.board.map((u) => u.uid)).toEqual([c.uid, a.uid, b.uid]);
    moveUnit(s, c.uid, 2); // move front to end
    expect(s.board.map((u) => u.uid)).toEqual([a.uid, b.uid, c.uid]);
  });

  it('EV-ECO-14 (#39, supersedes D10): gems accumulate & persist as a SPENDABLE wallet; gemsThisTurn resets each shop turn', () => {
    const s = createShopSession(0, { seed: 'eco14' });
    put(s, 'tuskers_gemsnout'); // endOfTurn: +gemBaseValue gem
    const per = engines.tuskers.gemBaseValue;
    startShopPhase(s); // turn 1
    expect(s.gemsThisTurn).toBe(0);
    endOfTurnPhase(s);
    expect(s.gems).toBe(per);
    expect(s.gemsThisTurn).toBe(per);
    startShopPhase(s); // turn 2 → gemsThisTurn resets, gems persists
    expect(s.gemsThisTurn).toBe(0);
    expect(s.gems).toBe(per); // carried over
    endOfTurnPhase(s);
    expect(s.gems).toBe(per * 2); // accumulates across turns
    expect(s.gemsThisTurn).toBe(per);
    // #39 (supersedes D10's "cosmetic"): the wallet is a REAL currency, spent only through
    // `activateAbility` (pinned by EV-ABL-01..). It still never touches the GOLD economy's
    // prices — tier-up / reroll costs are gold-denominated and unaffected by any gem total —
    // and the only gem→gold bridge is Gemwright's one-way activation (EV-ABL-07).
    const priv = toPrivateState(s);
    s.gems = 9999;
    const priv2 = toPrivateState(s);
    expect(priv2.tierUpCost).toBe(priv.tierUpCost);
    expect(priv2.rerollCost).toBe(priv.rerollCost);
    // the wallet is uncapped by design (#39) — hoarding is a sim DIAGNOSTIC, not an engine cap
    expect(priv2.gems).toBe(9999);
  });
});
