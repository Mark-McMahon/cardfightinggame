// Seeded PRNG (spec §6.8, §7). FNV-1a(seed:string) → mulberry32 with Fisher–Yates shuffle.
//
// Determinism (invariant 2) is a property of the DRAW ORDER + COUNT, not just the outputs:
// every piece of combat/shop randomness must draw from a single seeded instance in a fixed
// sequence so that `same (inputs, seed)` reproduces an identical event log within this impl
// (D4 — cross-impl byte-identity is deliberately NOT required).

/** FNV-1a 32-bit hash of a string → a 32-bit unsigned seed for mulberry32. */
export function fnv1a(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    // 32-bit FNV prime multiply, kept in uint32 space.
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Seeded PRNG. All engine randomness flows through one of these instances. */
export class Rng {
  private state: number;

  constructor(seed: string | number) {
    const s = typeof seed === 'number' ? seed >>> 0 : fnv1a(seed);
    // Avoid a zero state (mulberry32 is fine at 0, but salt for good measure).
    this.state = (s ^ 0x9e3779b9) >>> 0;
  }

  /** Next float in [0, 1). mulberry32. */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [0, maxExclusive). */
  int(maxExclusive: number): number {
    if (maxExclusive <= 0) return 0;
    return Math.floor(this.next() * maxExclusive);
  }

  /** Coin flip. Used for the first-attacker tie (§7.1.4). */
  bool(): boolean {
    return this.next() < 0.5;
  }

  /** Uniform pick from a non-empty array (the defender pick, §7.2.3). */
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)];
  }

  /** Fisher–Yates shuffle → a NEW array (random-target draws use shuffle().slice(count), §6.8). */
  shuffle<T>(arr: readonly T[]): T[] {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
    return out;
  }
}

/** Convenience factory. */
export function makeRng(seed: string | number): Rng {
  return new Rng(seed);
}
