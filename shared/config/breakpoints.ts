// Breakpoint config (Round-6, spec §16.4). Every ⭐ primary payoff is a named, discrete
// { counter, threshold, payoff } entry — the design law of "breakpoints over linear
// stacking" (decision #22) made data. The §16.7c lint asserts every primary payoff is
// expressible here and flags any per-unit scaling that lacks a threshold.

export type BreakpointCounter =
  | 'deaths' // friendly deaths this combat (avenge / Mortarch / Bone Colossus)
  | 'revenantDeaths' // revenant friendly deaths this combat (Pale Lich)
  | 'tokensThisTurn' // tokens summoned this shop turn (Mother Thorn — shop-scoped, see memory)
  | 'battlecries' // resolved battlecries this shop turn (Echo Choir doubles)
  | 'alliesAtStart' // minions controlled at start of combat (Thornwarden)
  | 'shieldBreak'; // this unit's own divine shield broke (Pearlguard; degenerate threshold 1)

export interface Breakpoint {
  card: string; // catalog id — the lint cross-checks against the catalog
  counter: BreakpointCounter;
  threshold: number;
  once?: boolean; // fire once at the threshold vs each-N (avenge style)
  // payoff fields (interpreted per card; all numbers live here, never in logic):
  atk?: number; // board/self stat payoff
  hp?: number;
  tokenAtk?: number; // Mother Thorn: per-summoned-token buff
  tokenHp?: number;
  amp?: number; // Pale Lich: damage multiplier once active (clamped to engines cap)
  summonUnitId?: string; // token-summon payoffs (Brackentide / Tideclaimer / Bone Colossus)
  summonCount?: number;
  grantKeyword?: 'divineShield'; // Reef Leviathan: board-wide keyword grant
}

export interface BreakpointsConfig {
  list: Breakpoint[];
}

export const breakpoints: BreakpointsConfig = {
  list: [
    // ── Wildkin / SWARM ──
    // tokensThisTurn / battlecries thresholds tuned DOWN from the spec's illustrative 3/4
    // (§16.5) to 2/3: the reachability gate (§16.7b) showed the shop-turn breakpoints were
    // unreachable for a splash at 3+, so splashing was never worth it (failure mode B).
    { card: 'wildkin_motherthorn', counter: 'tokensThisTurn', threshold: 2, atk: 3, hp: 3, tokenAtk: 2, tokenHp: 2 },
    { card: 'wildkin_thornwarden', counter: 'alliesAtStart', threshold: 4, once: true, atk: 2, hp: 4 }, // payoff buffed: splashes reach it but it must pay to compete with mono (§16.7a)
    { card: 'wildkin_packmother', counter: 'deaths', threshold: 2, atk: 2, hp: 3 }, // each-N (existing avenge)
    { card: 'wildkin_brackentide', counter: 'battlecries', threshold: 2, summonUnitId: 'wildkin_thornpup', summonCount: 2 },
    // ── Revenants / DEATHS ──
    { card: 'revenants_mortarch', counter: 'deaths', threshold: 3, once: true, atk: 3, hp: 3 },
    { card: 'revenants_palelich', counter: 'revenantDeaths', threshold: 3, amp: 2 },
    { card: 'revenants_tideclaimer', counter: 'battlecries', threshold: 2, summonUnitId: 'revenants_rebornwisp', summonCount: 1 },
    { card: 'revenants_boncolossus', counter: 'deaths', threshold: 4, once: true, summonUnitId: 'revenants_rebornwraith', summonCount: 2 },
    // ── Reefkin / BATTLECRIES (+ ENDURE) ──
    { card: 'reefkin_pearlguard', counter: 'shieldBreak', threshold: 1, once: true, atk: 2, hp: 3 },
    { card: 'reefkin_chorustide', counter: 'battlecries', threshold: 2, atk: 3, hp: 3 },
    { card: 'reefkin_leviathan', counter: 'battlecries', threshold: 3, grantKeyword: 'divineShield' },
  ],
};

const byCard: Record<string, Breakpoint> = Object.fromEntries(breakpoints.list.map((b) => [b.card, b]));

/** Look up the breakpoint for a card (throws if missing — content/config must stay in sync). */
export function getBreakpoint(card: string): Breakpoint {
  const b = byCard[card];
  if (!b) throw new Error(`No breakpoint configured for ${card}`);
  return b;
}

export function hasBreakpoint(card: string): boolean {
  return card in byCard;
}
