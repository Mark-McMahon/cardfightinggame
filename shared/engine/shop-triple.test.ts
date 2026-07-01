// EVALS.md Group G — triple / golden / discover + D5 fizzle edges (interface: SHOP).
// Written to intent (design-spec §4.2 triples, §4.7 D5). Numbers imported from config.
import { describe, it, expect } from 'vitest';
import {
  createShopSession,
  buyUnit,
  sellUnit,
  resolveDiscoverPick,
  discoverOptions,
  createPool,
  makeInstance,
  Rng,
  economy,
  triples,
  getCard,
  PURCHASABLE_UNITS,
  type ShopSession,
} from '@cardgame/shared';

let __u = 0;
const uid = () => `T${__u++}`;
function put(s: ShopSession, cardId: string, where: 'board' | 'bench' = 'bench', golden = false) {
  const inst = makeInstance(cardId, { uid: uid(), bornTurn: s.round, golden });
  (where === 'board' ? s.board : s.bench).push(inst);
  return inst;
}
/** Buy a specific card by forcing it into the shop's slot 0. */
function buyCard(s: ShopSession, cardId: string) {
  s.shop = [cardId];
  s.gold = economy.buyCost;
  return buyUnit(s, 0);
}

describe('EV-ECO — triple / golden / discover (SHOP)', () => {
  it('EV-ECO-10: holding a 3rd copy merges to a golden (×goldenStatMultiplier) and grants a Discover', () => {
    const s = createShopSession(0, { pool: createPool(), seed: 'trip10' });
    s.round = 1;
    const card = getCard('reefkin_tidecaller');
    put(s, 'reefkin_tidecaller'); // copy 1
    put(s, 'reefkin_tidecaller'); // copy 2
    const res = buyCard(s, 'reefkin_tidecaller'); // copy 3 → triple
    expect(res.ok).toBe(true);
    expect(res.triples).toEqual(['reefkin_tidecaller']);
    const golden = s.bench.find((u) => u.golden);
    expect(golden).toBeTruthy();
    expect(golden!.atk).toBe(card.atk * triples.goldenStatMultiplier);
    expect(golden!.hp).toBe(card.hp * triples.goldenStatMultiplier);
    // the 3 non-golden copies are consumed
    expect(s.bench.filter((u) => u.cardId === 'reefkin_tidecaller' && !u.golden).length).toBe(0);
    // Discover granted: 1-of-3 from tier + tripleDiscoverTierOffset
    expect(s.discover).toBeTruthy();
    expect(s.discover!.options.length).toBeLessThanOrEqual(3);
    const wantTier = Math.min(s.tier + triples.tripleDiscoverTierOffset, economy.tierCount);
    for (const id of s.discover!.options) expect(getCard(id).tier).toBe(wantTier);
  });

  it('EV-ECO-10: a merge re-scans and cascades (6 non-golden copies → two goldens)', () => {
    const s = createShopSession(0, { pool: createPool(), seed: 'trip10b' });
    s.round = 1;
    for (let i = 0; i < triples.copiesForTriple * 2 - 1; i++) put(s, 'corsairs_swab'); // 5 copies
    const res = buyCard(s, 'corsairs_swab'); // 6th → first triple, re-scan → second triple
    expect(res.triples).toEqual(['corsairs_swab', 'corsairs_swab']);
    expect(s.bench.filter((u) => u.golden && u.cardId === 'corsairs_swab').length).toBe(2);
  });

  it('EV-ECO-10: bench-full when a Discover would be granted → Discover lost (logged); golden is pool-exempt', () => {
    const pool = createPool();
    const s = createShopSession(0, { pool, seed: 'trip10c' });
    s.round = 1;
    // 3 copies of the merge card live on the BOARD (so the merge fires without needing bench room for them)
    for (let i = 0; i < triples.copiesForTriple; i++) put(s, 'reefkin_tidecaller', 'board');
    // fill bench to (benchCap − 1) with DISTINCT unrelated bodies (so they don't self-triple), then buy a
    // body → bench hits cap and the board merge fires.
    const fillers = PURCHASABLE_UNITS.filter(
      (c) => c.id !== 'reefkin_tidecaller' && c.id !== 'corsairs_deckhand',
    ).slice(0, economy.benchCap - 1);
    for (const c of fillers) put(s, c.id, 'bench');
    const poolBefore = pool['reefkin_tidecaller'];
    const res = buyCard(s, 'corsairs_deckhand'); // fills bench to cap, then detectTriples merges the 3 board copies
    expect(res.triples).toEqual(['reefkin_tidecaller']);
    // golden created but Discover lost (bench over cap after the golden was pushed)
    expect(s.discover).toBeNull();
    expect(s.log.some((l) => /Discover lost/i.test(l))).toBe(true);
    // golden is pool-exempt: the merge did not return copies to the pool
    expect(pool['reefkin_tidecaller']).toBe(poolBefore);
  });

  it('EV-ECO-10: tokens are pool-exempt and never triple (3 tokens do not merge)', () => {
    const s = createShopSession(0, { pool: createPool(), seed: 'trip10d' });
    s.round = 1;
    for (let i = 0; i < triples.copiesForTriple; i++) put(s, 'wildkin_thornpup', 'bench'); // isToken
    const res = buyCard(s, 'wildkin_brambleling'); // trigger a detect scan
    expect(res.triples ?? []).toEqual([]); // tokens excluded from triple counting
    expect(s.bench.some((u) => u.golden)).toBe(false);
  });

  it('EV-ECO-13: resolveDiscoverPick resolves the choice; options come from tier + offset', () => {
    const s = createShopSession(0, { pool: createPool(), seed: 'trip13' });
    s.round = 1;
    put(s, 'reefkin_tidecaller');
    put(s, 'reefkin_tidecaller');
    buyCard(s, 'reefkin_tidecaller'); // triple → discover pending
    expect(s.discover).toBeTruthy();
    const chosen = s.discover!.options[0];
    const benchBefore = s.bench.length;
    const res = resolveDiscoverPick(s, 0);
    expect(res.ok).toBe(true);
    expect(s.discover).toBeNull();
    expect(s.bench.length).toBe(benchBefore + 1);
    expect(s.bench.some((u) => u.cardId === chosen)).toBe(true);
  });

  it('EV-ECO-15 (D5): Discover from an empty tier+offset pool fills from the next LOWER tier', () => {
    const pool = createPool();
    // discoverOptions filters the catalog by exact tier, falling to the next lower tier when a tier is empty.
    // tier+offset above tierCount clamps down; every returned option is at that filled tier, count ≤ 3.
    const opts = discoverOptions(pool, economy.tierCount + 5, 3, new Rng('disc'));
    expect(opts.length).toBeLessThanOrEqual(3);
    expect(opts.length).toBeGreaterThan(0); // full catalog → never empty; falls to the highest populated tier
    const tiers = new Set(opts.map((id) => getCard(id).tier));
    expect(tiers.size).toBe(1);
    expect([...tiers][0]).toBeLessThanOrEqual(economy.tierCount);
  });

  it('EV-ECO-15 (D5): onSell fires only on a purchasable body, not a token', () => {
    const s = createShopSession(0, { pool: createPool(), seed: 'trip15b' });
    s.round = 1;
    put(s, 'tuskers_tuskmonger', 'board'); // onSell → +2 gems
    // selling a TOKEN does not fire onSell
    const token = put(s, 'wildkin_thornpup', 'bench');
    const gems0 = s.gems;
    sellUnit(s, token.uid);
    expect(s.gems).toBe(gems0); // no onSell for a token body
    // selling a purchasable body DOES fire onSell
    const body = put(s, 'wildkin_brambleling', 'bench');
    sellUnit(s, body.uid);
    expect(s.gems).toBe(gems0 + 2);
  });
});
