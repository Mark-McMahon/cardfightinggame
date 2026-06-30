import { PURCHASABLE_UNITS, getCard } from '../content/units';
import { economy } from '../config/economy';
import type { RNG } from './rng';

// Shared finite pool (spec §5). All players draw from one pool; buying removes a
// copy, selling returns it. Tokens & golden are pool-exempt.
export class Pool {
  private counts = new Map<string, number>();

  constructor() {
    for (const card of PURCHASABLE_UNITS) {
      this.counts.set(card.id, economy.poolCopiesByTier[card.tier - 1] ?? 1);
    }
  }

  countOf(cardId: string): number {
    return this.counts.get(cardId) ?? 0;
  }

  /** Remove one copy. Returns false if none left or card is pool-exempt. */
  take(cardId: string): boolean {
    const card = getCard(cardId);
    if (card.isToken) return true; // tokens are unlimited & pool-exempt
    const n = this.counts.get(cardId) ?? 0;
    if (n <= 0) return false;
    this.counts.set(cardId, n - 1);
    return true;
  }

  /** Return one copy (no-op for token/golden/unknown). */
  giveBack(cardId: string): void {
    const card = getCard(cardId);
    if (card.isToken) return;
    this.counts.set(cardId, (this.counts.get(cardId) ?? 0) + 1);
  }

  /** Draw n cards at or below maxTier, weighted by remaining copies. Takes the copies. */
  draw(maxTier: number, n: number, rng: RNG): string[] {
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      const bag: string[] = [];
      for (const [cardId, count] of this.counts) {
        if (count <= 0) continue;
        if (getCard(cardId).tier > maxTier) continue;
        for (let c = 0; c < count; c++) bag.push(cardId);
      }
      if (bag.length === 0) break;
      const picked = bag[rng.int(bag.length)];
      this.take(picked);
      out.push(picked);
    }
    return out;
  }
}
