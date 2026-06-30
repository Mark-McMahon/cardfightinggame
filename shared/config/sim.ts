// Simulator balance-gate config (spec §16.7, decision #29 — extends §11.3).
//
// These are the thresholds the macro-sim's four metrics assert against. They are the
// "balance gate that must clear before content ships": single-axis margin, 2-tribe-splash
// reachability, the breakpoint lint, and the non-linearity (step-not-line) curve check.
// Kept here in shared/config so the gate stays config-driven like every other number
// (pillar #4) — tuning the gate = edit this file, never sim logic.

export interface SimConfig {
  // ── (a) single-axis margin ──────────────────────────────────────────────────
  /** Max allowed lead, in win-rate (placement==1) fraction, of a single-axis stacked
   *  build over the multi-axis cohort. Exceeding it ⇒ the payoff curve is too linear. */
  singleAxisMarginMax: number;
  /** A board is "single-axis" when its dominant axis accounts for at least this share of
   *  all axis-feeds on the board (e.g. 0.6 = 60% of the board pulls one way). */
  singleAxisDominanceThreshold: number;
  /** Boards with fewer non-token units than this are too small to classify (noise). */
  minUnitsToClassify: number;

  // ── (b) reachability (the gate) ──────────────────────────────────────────────
  /** A board is a "2-tribe splash" when a second tribe contributes at least this many
   *  non-token units (alongside the dominant tribe). */
  splashMinSecondTribeUnits: number;
  /** Min fraction of 2-tribe-splash players who must hit ≥2 distinct breakpoints in a
   *  game. Below this ⇒ failure mode B: breakpoints tuned too high, splashing not worth it. */
  splashReachTargetPct: number;
  /** "Can a splash hit two breaks in a normal game" is measured over splashes that actually
   *  played one — i.e. reached at least this tier (a round-2 elimination never had the
   *  chance to assemble, and that's true of mono builds too). */
  splashDevelopedTier: number;

  // ── (d) non-linearity ────────────────────────────────────────────────────────
  /** Crossing a marquee breakpoint threshold must improve avg placement by at least this
   *  multiple of the average per-step slope below the threshold — a step, not a line. */
  nonLinearityMinStepRatio: number;
}

export const sim: SimConfig = {
  singleAxisMarginMax: 0.08, // ≤8pp win-rate lead tolerated for a mono single-axis stack
  singleAxisDominanceThreshold: 0.6,
  minUnitsToClassify: 3,

  splashMinSecondTribeUnits: 2,
  splashReachTargetPct: 0.5, // ≥50% of developed splash players reach two breaks in a game
  splashDevelopedTier: 3,

  nonLinearityMinStepRatio: 1.5,
};
