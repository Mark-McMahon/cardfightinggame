// Shared finite pool (spec §5). All players draw from ONE pool: buying removes a copy,
// selling returns it, rolls draw at/below the player's tier. Token and golden units are
// pool-exempt. Contesting a tribe thins it for everyone (EV-ECO-08).

import { economy } from '../config';
import { PURCHASABLE_UNITS } from '../content';
import type { Rng } from './rng';

export type PoolState = Record<string, number>;

/** Build a full pool: poolCopiesByTier[tier-1] copies of every purchasable (non-token) card. */
export function createPool(): PoolState {
  const pool: PoolState = {};
  for (const card of PURCHASABLE_UNITS) {
    pool[card.id] = economy.poolCopiesByTier[card.tier - 1] ?? 0;
  }
  return pool;
}

/** Card ids currently drawable at/below `tier` with ≥1 copy left. */
function eligible(pool: PoolState, tier: number): Array<{ id: string; count: number }> {
  const out: Array<{ id: string; count: number }> = [];
  for (const card of PURCHASABLE_UNITS) {
    if (card.tier > tier) continue;
    const count = pool[card.id] ?? 0;
    if (count > 0) out.push({ id: card.id, count });
  }
  return out;
}

/** Draw one card id at/below `tier`, weighted by remaining copies; removes the copy. */
export function drawOne(pool: PoolState, tier: number, rng: Rng): string | undefined {
  const list = eligible(pool, tier);
  const total = list.reduce((s, e) => s + e.count, 0);
  if (total === 0) return undefined;
  let r = rng.int(total);
  for (const e of list) {
    if (r < e.count) {
      pool[e.id]!--;
      return e.id;
    }
    r -= e.count;
  }
  return undefined;
}

/** Draw `n` cards at/below `tier` (each a reserved copy, may repeat if copies allow). */
export function draw(pool: PoolState, tier: number, n: number, rng: Rng): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = drawOne(pool, tier, rng);
    if (id) out.push(id);
  }
  return out;
}

/** Return a copy to the pool (unbought roll offers, sold purchasable bodies). */
export function returnCopy(pool: PoolState, cardId: string): void {
  if (!(cardId in pool)) return; // tokens / goldens are pool-exempt
  pool[cardId]!++;
}

/** Take one copy if available (e.g. a Discover pick materializing a real card). */
export function takeCopy(pool: PoolState, cardId: string): boolean {
  if ((pool[cardId] ?? 0) <= 0) return false;
  pool[cardId]!--;
  return true;
}

/** Pick `n` distinct card ids of an exact tier (for Discover options), weighted by copies. */
export function discoverOptions(pool: PoolState, tier: number, n: number, rng: Rng): string[] {
  const clampedTier = Math.max(1, Math.min(tier, economy.tierCount));
  let t = clampedTier;
  let list: string[] = [];
  // Empty/insufficient tier → fill from the next LOWER tier, then skip (D5).
  while (t >= 1) {
    list = PURCHASABLE_UNITS.filter((c) => c.tier === t).map((c) => c.id);
    if (list.length > 0) break;
    t--;
  }
  const shuffled = rng.shuffle(list);
  return shuffled.slice(0, n);
}
