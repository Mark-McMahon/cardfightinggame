// Seeded PRNG (spec §7). Pure & deterministic: identical seed string → identical
// stream. ALL combat randomness (targeting, first-attacker tiebreak) draws here.

/** FNV-1a 32-bit string hash → 32-bit unsigned seed. */
export function hashSeed(...parts: Array<string | number>): number {
  const str = parts.join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — small, fast, fully deterministic 32-bit generator. */
export class RNG {
  private state: number;

  constructor(seed: number | string) {
    this.state = typeof seed === 'number' ? seed >>> 0 : hashSeed(seed);
    // Avoid a degenerate all-zero state.
    if (this.state === 0) this.state = 0x9e3779b9;
  }

  /** Next float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  bool(): boolean {
    return this.next() < 0.5;
  }

  /** Pick one element (returns undefined for empty arrays). */
  pick<T>(arr: readonly T[]): T | undefined {
    if (arr.length === 0) return undefined;
    return arr[this.int(arr.length)];
  }

  /** Fisher–Yates shuffle into a new array (does not mutate input). */
  shuffle<T>(arr: readonly T[]): T[] {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
}
