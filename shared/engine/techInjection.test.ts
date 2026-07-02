// EVALS.md Group G (Phase 4, decision #49) — the tech-pool INJECTION guarantee at the SHOP
// interface. From `systems.techInjection.fromRound` onward, a FRESH roll (startShopPhase draw /
// rollShop / Oreseeker refresh — never a frozen shop) that contains no interaction-tech card has ONE
// slot deterministically replaced by a copy-weighted tech draw at/below tier. Pool accounting is
// net-zero (take one, return the replaced one). Everything stays deterministic (invariant 2b).
import { describe, it, expect } from 'vitest';
import {
  createShopSession,
  startShopPhase,
  rollShop,
  freezeShop,
  createPool,
  getCard,
  economy,
  systems,
  type ShopSession,
} from '@cardgame/shared';

const TECH = systems.techInjection.cardIds;
const FROM = systems.techInjection.fromRound; // 5
const poolTotal = (pool: Record<string, number>) => Object.values(pool).reduce((a, b) => a + b, 0);
const hasTech = (s: ShopSession) => s.shop.some((id) => TECH.includes(id));
const wasInjected = (s: ShopSession) => s.log.some((l) => l.startsWith('tech injected'));

/** A session with a freshly-drawn shop at a given round + tier (goes through the real draw path). */
function freshShopAt(round: number, tier: number, seed: string): ShopSession {
  const s = createShopSession(0, { pool: createPool(), seed });
  s.tier = tier;
  s.round = round - 1; // startShopPhase does +1
  startShopPhase(s);
  return s;
}

describe('EV-TCH — tech-pool injection guarantee (SHOP, decision #49)', () => {
  it('EV-TCH-01: 100% of post-round-5 rolls contain ≥1 tech card (tier permitting)', () => {
    for (let i = 0; i < 80; i++) {
      const s = freshShopAt(FROM, 3, `tch01:${i}`); // tier 3 → T1/T2/T3 tech always available
      expect(hasTech(s), `seed ${i} shop had no tech: ${s.shop.join(',')}`).toBe(true);
    }
    // also holds at a higher tier + a later round (bigger shops, all tech still ≤ tier)
    for (let i = 0; i < 40; i++) {
      const s = freshShopAt(FROM + 4, 6, `tch01b:${i}`);
      expect(hasTech(s)).toBe(true);
    }
  });

  it('EV-TCH-02: same seed + state → same injection (deterministic); rollShop injects too', () => {
    const a = freshShopAt(FROM, 3, 'tch02');
    const b = freshShopAt(FROM, 3, 'tch02');
    expect(a.shop).toEqual(b.shop);
    // rollShop is a fresh-roll path → also injected, and deterministic vs an identical session
    const c = createShopSession(0, { pool: createPool(), seed: 'tch02c' });
    c.tier = 3;
    c.round = FROM;
    c.gold = 10;
    rollShop(c);
    const d = createShopSession(0, { pool: createPool(), seed: 'tch02c' });
    d.tier = 3;
    d.round = FROM;
    d.gold = 10;
    rollShop(d);
    expect(c.shop).toEqual(d.shop);
    expect(hasTech(c)).toBe(true);
  });

  it('EV-TCH-03: pool accounting balances — no leaked or phantom copies (incl. the inject path)', () => {
    let sawInjection = false;
    for (let i = 0; i < 40; i++) {
      const pool = createPool();
      const total0 = poolTotal(pool);
      const s = createShopSession(0, { pool, seed: `tch03:${i}` });
      s.tier = 4;
      s.round = FROM;
      startShopPhase(s);
      if (wasInjected(s)) sawInjection = true;
      // conservation: remaining pool + reserved shop offers == the initial total (take-1 / return-1 nets 0)
      expect(poolTotal(pool) + s.shop.length).toBe(total0);
      // no card ever went negative or above its tier cap
      for (const card of Object.keys(pool)) {
        expect(pool[card]).toBeGreaterThanOrEqual(0);
        expect(pool[card]).toBeLessThanOrEqual(economy.poolCopiesByTier[getCard(card).tier - 1]);
      }
      // the shop is still exactly shopSlotsByTier wide (injection REPLACES a slot, never adds one)
      expect(s.shop.length).toBe(economy.shopSlotsByTier[s.tier - 1]);
      // every injected/natural tech offer is at or below the shop tier
      for (const id of s.shop) if (TECH.includes(id)) expect(getCard(id).tier).toBeLessThanOrEqual(s.tier);
    }
    expect(sawInjection, 'no seed exercised the injection path').toBe(true); // the inject branch is really hit
  });

  it('EV-TCH-04: pre-round-5 is NOT injected, and a FROZEN shop is never re-rolled/injected', () => {
    // pre-round: round 4 draw carries no injection log line
    const early = freshShopAt(FROM - 1, 3, 'tch04early');
    expect(wasInjected(early)).toBe(false);

    // frozen: freeze at round FROM, advance a turn → the frozen offers persist untouched, no injection
    const s = createShopSession(0, { pool: createPool(), seed: 'tch04frozen' });
    s.tier = 3;
    s.round = FROM - 1;
    startShopPhase(s); // round FROM, fresh (may inject) — not what we assert on
    freezeShop(s);
    const frozenOffers = [...s.shop];
    s.log.length = 0; // isolate the next phase's log
    startShopPhase(s); // round FROM+1, FROZEN branch
    expect(s.shop).toEqual(frozenOffers); // persisted byte-for-byte
    expect(wasInjected(s)).toBe(false); // the frozen shop is not re-rolled, so never injected
  });
});
