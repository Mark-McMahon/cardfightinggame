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
  | 'shieldBreak' // this unit's own divine shield broke (Pearlguard; degenerate threshold 1)
  | 'gemsThisTurn'; // gems generated this shop turn (Round-6 Tuskers — the compounding doubler)

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
  factor?: number; // Tuskers: multiplyStats factor for the ×N doubler (clamped to multiplyFactorCap)
  summonUnitId?: string; // token-summon payoffs (Brackentide / Tideclaimer / Bone Colossus)
  summonCount?: number;
  grantKeyword?: 'divineShield' | 'cleave'; // board-wide keyword grant (Reef Leviathan / Worldspark)
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
    // Mother Thorn redesign (audit Gate 1): the free per-turn whole-board slab is REMOVED. Only the
    // per-token buff remains, and its threshold is raised 2→3 so it costs a real over-summon (a second
    // generator / a summon-battlecry), not one autopilot Brambleling. tokenAtk/tokenHp only.
    { card: 'wildkin_motherthorn', counter: 'tokensThisTurn', threshold: 3, tokenAtk: 2, tokenHp: 2 },
    { card: 'wildkin_thornwarden', counter: 'alliesAtStart', threshold: 5, once: true, atk: 2, hp: 4 }, // threshold 4→5 (audit Gate 3): a real go-wide commitment, matching Grovelord/Tempest/Titanforge; payoff still pays splashes to compete with mono (§16.7a)
    { card: 'wildkin_grovelord', counter: 'alliesAtStart', threshold: 5, once: true, atk: 2, hp: 2 }, // Prompt-1 Part B rework: a wide-board start-of-combat bomb that survives a full board (was a cap-truncated summon)
    { card: 'wildkin_packmother', counter: 'deaths', threshold: 2, atk: 2, hp: 2 }, // each-N (existing avenge); hp aligned to as-shipped card payoff (engines.wildkin.avengePayoff = 2/2)
    { card: 'wildkin_brackentide', counter: 'battlecries', threshold: 2, summonUnitId: 'wildkin_thornpup', summonCount: 2 },
    // ── Revenants / DEATHS ──
    { card: 'revenants_mortarch', counter: 'deaths', threshold: 3, once: true, atk: 3, hp: 3 },
    { card: 'revenants_palelich', counter: 'revenantDeaths', threshold: 3, amp: 2 },
    { card: 'revenants_tideclaimer', counter: 'battlecries', threshold: 2, summonUnitId: 'revenants_rebornwisp', summonCount: 1 },
    { card: 'revenants_boncolossus', counter: 'deaths', threshold: 4, once: true, summonUnitId: 'revenants_rebornwraith', summonCount: 2 },
    // ── Reefkin / BATTLECRIES (+ ENDURE) ──
    { card: 'reefkin_pearlguard', counter: 'shieldBreak', threshold: 1, once: true, atk: 1, hp: 3 },
    { card: 'reefkin_chorustide', counter: 'battlecries', threshold: 2, atk: 3, hp: 3 },
    { card: 'reefkin_leviathan', counter: 'battlecries', threshold: 3, grantKeyword: 'divineShield' },
    // ── Prompt-2: Infernals / SACRIFICE (reuse the combat `deaths` counter — an aggressor's
    //    manufactured deaths). Self-buff carries: a step at the threshold, countered by poison. ──
    { card: 'infernals_bloodcaller', counter: 'deaths', threshold: 3, once: true, atk: 5, hp: 3 },
    { card: 'infernals_abysslord', counter: 'deaths', threshold: 4, once: true, atk: 8, hp: 6 },
    // Carrion Sovereign (audit: Infernals T6 capstone + Pattern-A death scalar). everyN at threshold 1
    // → fires on EVERY friendly death; combat-only BY DESIGN (explicit permanent:false — the §7.5
    // writeback is live, this card deliberately opts out), so each +atk/+hp is paid by a spent
    // body and resets each fight. Registered as a breakpoint so the anti-linear lint bounds it (like
    // Pack Mother). Organic ceiling = deaths manufacturable in one combat; folds to poison + width.
    { card: 'infernals_carrionsovereign', counter: 'deaths', threshold: 1, atk: 2, hp: 1 },
    // ── Prompt-2: Constructs / ASSEMBLY (reuse `deaths` + `alliesAtStart`). Rebuild payoffs —
    //    summon a guardian; countered by poison/tall (the refill can't out-attrition a chip). ──
    { card: 'constructs_foundry', counter: 'deaths', threshold: 4, once: true, summonUnitId: 'constructs_sentinel', summonCount: 1 },
    { card: 'constructs_titanforge', counter: 'alliesAtStart', threshold: 5, once: true, summonUnitId: 'constructs_sentinel', summonCount: 1 },
    // Aegis Prime (audit: Constructs T6 capstone + Pattern-A redeploy scalar). everyN at threshold 1 →
    // each friendly death pumps the surviving Constructs (combat-only); the assembly loop IS the fuel.
    // Registered as a breakpoint so the anti-linear lint bounds it. Folds to poison + tall.
    { card: 'constructs_aegisprime', counter: 'deaths', threshold: 1, atk: 1, hp: 1 },

    // ═══ Round-6 replayability expansion — four tribes, each with a distinct keyword strength ═══
    // ── Tuskers / SPOILS: the EXPONENTIAL engine — reworked by decision #39. The doublers are no
    //    longer gemsThisTurn breakpoints: each ×factor step is now PURCHASED with spendable gems
    //    (activated ability, escalating per-game cost). They are registered in the SPEND-GATED
    //    payoff registry below (`spendGated`) — the §11.3c lint's second legal primary-payoff
    //    class. Still beatable by poison (P1 ignores stat size). ──
    // ── Primordials / ELEMENTS: play-count → WIDE cleave splash. Counter: TALL (few targets waste
    //    cleave) + poison. Reuses `battlecries` (each play) and `alliesAtStart` (went wide). ──
    { card: 'primordials_stormcaller', counter: 'battlecries', threshold: 2, atk: 2, hp: 1 },
    { card: 'primordials_tempest', counter: 'alliesAtStart', threshold: 5, once: true, atk: 2 },
    { card: 'primordials_worldspark', counter: 'alliesAtStart', threshold: 5, once: true, grantKeyword: 'cleave' },
    // ── Sirens / SPELLCRAFT: a second POISON home + start-of-combat burst. Counter: divine-shield
    //    walls (blank the poison instance) + being out-tempo'd. Reuses `battlecries`. ──
    { card: 'sirens_deepchanter', counter: 'battlecries', threshold: 2, atk: 2, hp: 2 },
    { card: 'sirens_abysscantor', counter: 'battlecries', threshold: 3 }, // payoff (board-wide Poison) is granted in-card
    { card: 'sirens_leviathansong', counter: 'battlecries', threshold: 3, atk: 2, hp: 2 },
    // ── Corsairs / TEMPO: on-buy aggression → sticky REBORN / divine-shield width. Counter: poison
    //    (kills each reborn body twice over) + cleave (mows the width). Reuses `alliesAtStart`. ──
    { card: 'corsairs_reaver', counter: 'alliesAtStart', threshold: 5, once: true, atk: 1 }, // 4→5 threshold + 2→1 atk: a real go-wide commitment, not trivially-on (macro OP watch)
    { card: 'corsairs_marauder', counter: 'alliesAtStart', threshold: 5, once: true, atk: 2, hp: 1 },
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

// ─────────────────────────────────────────────────────────────────────────────
// Spend-gated payoff registry (decision #39/#40; spec §6.6a, §11.3c)
// ─────────────────────────────────────────────────────────────────────────────
// The SECOND legal primary-payoff class beside breakpoints: a payoff whose every step is
// PURCHASED with a currency (an explicit decision), not accrued from board state. The
// §11.3c lint accepts a card's threshold-free primary payoff ONLY if it is registered
// here, its card carries an `activated` ability, and its `costKnobs` resolve to positive
// finite numbers in `engines[<tribe>]` — exponential scaling is legal only where each
// step is bought (decision #40: "when in doubt add a cost, not a bigger number").

export interface SpendGatedPayoff {
  card: string; // catalog id — the lint cross-checks against the catalog + its `activated` spec
  currency: 'gems'; // only spendable currency today (gold↔gems stays one-way via Gemwright)
  costKnobs: string[]; // engines[<card.tribe>] knob names that price each step
}

export const spendGated: SpendGatedPayoff[] = [
  // the three doublers share the escalating per-game formula (doubleBaseCost + doubleCostStep·k)
  { card: 'tuskers_ivorytusk', currency: 'gems', costKnobs: ['doubleBaseCost', 'doubleCostStep'] },
  { card: 'tuskers_ivorylord', currency: 'gems', costKnobs: ['doubleBaseCost', 'doubleCostStep'] },
  { card: 'tuskers_gemtitan', currency: 'gems', costKnobs: ['doubleBaseCost', 'doubleCostStep'] },
  // gem sinks (flat costs)
  { card: 'tuskers_gemwright', currency: 'gems', costKnobs: ['gemwrightCost'] },
  { card: 'tuskers_facetguard', currency: 'gems', costKnobs: ['facetguardCost'] },
  { card: 'tuskers_oreseeker', currency: 'gems', costKnobs: ['oreseekerCost'] },
];

const spendByCard: Record<string, SpendGatedPayoff> = Object.fromEntries(spendGated.map((r) => [r.card, r]));

export function hasSpendGated(card: string): boolean {
  return card in spendByCard;
}

export function getSpendGated(card: string): SpendGatedPayoff {
  const r = spendByCard[card];
  if (!r) throw new Error(`No spend-gated registry row for ${card}`);
  return r;
}
