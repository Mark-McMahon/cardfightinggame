// The §11.3 balance-gate metrics (decision #29). Pure functions over the harness's per-game
// results — consumed by macro.ts, report.ts, and the EV-BAL-* evals. Every threshold comes from
// `shared/config/sim.ts` (config-driven, pillar #4); nothing here hardcodes a balance number.

import { sim as simCfg, breakpoints, getBreakpoint, resolveCombat, type CombatBoard, type CombatEvent } from '@cardgame/shared';
import { classifyBoard, type MatchResult, type PlayerGameResult } from './harness';
import { buildBoard } from './boards';

const NEUTRAL_PLACEMENT = 4.5; // midpoint of 1..8 (reporting reference only)

// ── classification of a player's peak build ─────────────────────────────────────────────────

export type AxisClass = 'single' | 'multi' | null;

/** (a) A board is single-axis when its dominant axis holds ≥ singleAxisDominanceThreshold of all
 *  axis feeds; boards below minUnitsToClassify are noise (null). */
export function axisClass(cardIds: string[]): AxisClass {
  const c = classifyBoard(cardIds);
  if (c.nonTokenCount < simCfg.minUnitsToClassify) return null;
  if (c.dominantAxisShare <= 0) return null;
  return c.dominantAxisShare >= simCfg.singleAxisDominanceThreshold ? 'single' : 'multi';
}

/** (b) A board is a 2-tribe splash when a second tribe contributes ≥ splashMinSecondTribeUnits. */
export function isTwoTribeSplash(cardIds: string[]): boolean {
  const c = classifyBoard(cardIds);
  return c.nonTokenCount >= simCfg.minUnitsToClassify && c.secondTribeCount >= simCfg.splashMinSecondTribeUnits;
}

// ── (a) single-axis margin ───────────────────────────────────────────────────────────────────

export interface SingleAxisMargin {
  singleWinRate: number;
  multiWinRate: number;
  margin: number; // single − multi (win = placement 1)
  singleN: number;
  multiN: number;
  threshold: number;
  pass: boolean;
}

export function singleAxisMargin(results: MatchResult[]): SingleAxisMargin {
  let singleWins = 0;
  let singleN = 0;
  let multiWins = 0;
  let multiN = 0;
  for (const r of results) {
    for (const p of r.players) {
      const cls = axisClass(p.peakBoard);
      if (cls === null) continue;
      const win = p.placement === 1 ? 1 : 0;
      if (cls === 'single') {
        singleN++;
        singleWins += win;
      } else {
        multiN++;
        multiWins += win;
      }
    }
  }
  const singleWinRate = singleN > 0 ? singleWins / singleN : 0;
  const multiWinRate = multiN > 0 ? multiWins / multiN : 0;
  const margin = singleWinRate - multiWinRate;
  return {
    singleWinRate,
    multiWinRate,
    margin,
    singleN,
    multiN,
    threshold: simCfg.singleAxisMarginMax,
    pass: margin <= simCfg.singleAxisMarginMax,
  };
}

// ── (b) reachability (THE GATE) ───────────────────────────────────────────────────────────────

export interface Reachability {
  developedSplashCount: number;
  hitTwoCount: number;
  fraction: number; // fraction of developed 2-tribe splashes that hit ≥2 distinct breakpoints
  target: number;
  pass: boolean;
}

export function reachability(results: MatchResult[]): Reachability {
  let developed = 0;
  let hitTwo = 0;
  for (const r of results) {
    for (const p of r.players) {
      if (p.maxTier < simCfg.splashDevelopedTier) continue;
      if (!isTwoTribeSplash(p.peakBoard)) continue;
      developed++;
      if (p.breakpointsHit.size >= 2) hitTwo++;
    }
  }
  const fraction = developed > 0 ? hitTwo / developed : 0;
  return {
    developedSplashCount: developed,
    hitTwoCount: hitTwo,
    fraction,
    target: simCfg.splashReachTargetPct,
    pass: developed > 0 && fraction >= simCfg.splashReachTargetPct,
  };
}

// ── (d) non-linearity (step, not line) ─────────────────────────────────────────────────────────

export interface NonLinearityCard {
  card: string;
  threshold: number;
  belowSlope: number; // avg placement improvement per counter-step below threshold
  crossStep: number; // placement improvement crossing the threshold
  ratio: number; // crossStep / belowSlope
  samplesBelow: number;
  samplesAt: number;
}

export interface NonLinearity {
  perCard: NonLinearityCard[];
  meanRatio: number; // mean ratio over cards with sufficient data
  measuredCards: number;
  threshold: number;
  pass: boolean;
}

function avg(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

// (d) is a CONTROLLED micro experiment, not an organic-macro correlation. Measuring win-rate vs a
// counter value over real matches is confounded: a `deaths`/`alliesAtStart` counter correlates with
// board state (a side that suffers many deaths is often LOSING), not with the payoff's benefit. So
// we isolate the payoff on the `alliesAtStart` marquee family (cleanly controllable board width):
// hold the opponent fixed and vary board width K across the threshold. Below the threshold each
// extra body only trades bodies (belowSlope); crossing it FIRES the payoff (crossStep). A real
// "step, not a line" needs crossStep ≥ nonLinearityMinStepRatio × belowSlope.

const NONLIN_FILLER = 'primordials_sparkling'; // a plain 2/2 body (its battlecry is shop-only → inert in combat)

function widthBoard(cardId: string, width: number): CombatBoard {
  const entries = [{ cardId }];
  for (let i = 1; i < width; i++) entries.push({ cardId: NONLIN_FILLER });
  return buildBoard(entries);
}

function winRateVs(a: CombatBoard, opponents: CombatBoard[], seeds: number, tag: string): number {
  let wins = 0;
  let decisive = 0;
  for (let oi = 0; oi < opponents.length; oi++) {
    for (let i = 0; i < seeds; i++) {
      const w1 = lastWinner(resolveCombat(a, opponents[oi], `${tag}:ab:${oi}:${i}`));
      if (w1 === 'a') wins++;
      if (w1 !== 'tie') decisive++;
      const w2 = lastWinner(resolveCombat(opponents[oi], a, `${tag}:ba:${oi}:${i}`)); // a is side b
      if (w2 === 'b') wins++;
      if (w2 !== 'tie') decisive++;
    }
  }
  return decisive > 0 ? wins / decisive : 0.5;
}

function lastWinner(log: CombatEvent[]): 'a' | 'b' | 'tie' {
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if (e.t === 'combatEnd') return e.winner;
  }
  return 'tie';
}

export function nonLinearity(_results: MatchResult[], seeds = 40): NonLinearity {
  // Fixed opponents calibrated so a below-threshold width board LOSES and the payoff firing is the
  // discriminating variable (too-weak opponents saturate the width ramp and hide the step; too-strong
  // ones flatten everything). A shield wall + a cleave board are the matched controls.
  const opponents: CombatBoard[] = [
    buildBoard([{ cardId: 'primordials_cinderwing', count: 4 }]),
    buildBoard([{ cardId: 'corsairs_ironclad', count: 5 }]),
  ];
  const perCard: NonLinearityCard[] = [];
  for (const b of breakpoints.list) {
    if (b.counter !== 'alliesAtStart' || b.threshold < 3) continue; // controllable + has a below ramp
    const t = b.threshold;
    if (t + 1 > 7) continue; // board cap
    const wr = new Map<number, number>();
    for (let k = t - 2; k <= t + 1; k++) {
      wr.set(k, winRateVs(widthBoard(b.card, k), opponents, seeds, `nl:${b.card}:${k}`));
    }
    const belowSlope = Math.max(0.01, wr.get(t - 1)! - wr.get(t - 2)!); // floor: a near-flat below-ramp
    const crossStep = wr.get(t)! - wr.get(t - 1)!;
    // clamp for reporting sanity (a tiny belowSlope makes the raw ratio explode); still honest — a
    // clamped 20 is far above the 1.5 step threshold.
    const ratio = Math.max(-20, Math.min(20, crossStep / belowSlope));
    perCard.push({ card: b.card, threshold: t, belowSlope, crossStep, ratio, samplesBelow: seeds, samplesAt: seeds });
  }
  const ratios = perCard.map((c) => c.ratio).filter((r) => Number.isFinite(r));
  const meanRatio = avg(ratios);
  return {
    perCard,
    meanRatio,
    measuredCards: perCard.length,
    threshold: simCfg.nonLinearityMinStepRatio,
    pass: perCard.length === 0 ? true : meanRatio >= simCfg.nonLinearityMinStepRatio,
  };
}

// ── (g) stale-combat fraction ─────────────────────────────────────────────────────────────────

export interface StaleCombat {
  combats: number;
  stale: number;
  fraction: number;
  // Corrected (D1–D3) combat should never stalemate; the flag is a tiny epsilon, not a balance knob.
  flag: number;
  pass: boolean;
}

export const STALE_FLAG = 0.01; // harness reporting flag (not a §12 balance constant)

export function staleCombat(results: MatchResult[]): StaleCombat {
  let combats = 0;
  let stale = 0;
  for (const r of results) {
    combats += r.combats;
    stale += r.staleCombats;
  }
  const fraction = combats > 0 ? stale / combats : 0;
  return { combats, stale, fraction, flag: STALE_FLAG, pass: fraction <= STALE_FLAG };
}

// ── aggregate report shape (macro / report consume this) ────────────────────────────────────────

export interface TribeStat {
  tribe: string;
  pickRate: number; // fraction of players whose dominant tribe was this
  avgPlacement: number;
  players: number;
}

export interface UnitStat {
  cardId: string;
  pickRate: number; // fraction of players whose peak board contained it (non-token)
  avgPlacement: number;
  players: number;
  op: boolean; // avg placement notably below neutral (overpowered)
  dead: boolean; // avg placement notably above neutral (dead)
}

export interface BreakpointStat {
  card: string;
  assembledRate: number; // fraction of owners who hit its threshold
  owners: number;
}

export interface MacroReport {
  matches: number;
  playersPerMatch: number;
  singleAxis: SingleAxisMargin;
  reach: Reachability;
  nonLin: NonLinearity;
  stale: StaleCombat;
  tribes: TribeStat[];
  units: UnitStat[];
  breakpoints: BreakpointStat[];
  flags: string[];
}

const OP_BAND = 1.75; // std-devs from the unit-population mean that trips an OP/dead outlier flag (reporting only)

export function buildMacroReport(results: MatchResult[]): MacroReport {
  const players: PlayerGameResult[] = [];
  for (const r of results) for (const p of r.players) players.push(p);
  const totalPlayers = players.length || 1;

  // tribes
  const tribeAgg = new Map<string, { place: number; n: number }>();
  for (const p of players) {
    const c = classifyBoard(p.peakBoard);
    if (!c.dominantTribe) continue;
    const t = tribeAgg.get(c.dominantTribe) ?? { place: 0, n: 0 };
    t.place += p.placement;
    t.n++;
    tribeAgg.set(c.dominantTribe, t);
  }
  const tribes: TribeStat[] = [...tribeAgg.entries()]
    .map(([tribe, v]) => ({ tribe, pickRate: v.n / totalPlayers, avgPlacement: v.place / v.n, players: v.n }))
    .sort((a, b) => a.avgPlacement - b.avgPlacement);

  // units
  const unitAgg = new Map<string, { place: number; n: number }>();
  for (const p of players) {
    const seen = new Set<string>();
    for (const id of p.peakBoard) {
      if (seen.has(id)) continue;
      seen.add(id);
      const u = unitAgg.get(id) ?? { place: 0, n: 0 };
      u.place += p.placement;
      u.n++;
      unitAgg.set(id, u);
    }
  }
  // OP/dead are STATISTICAL OUTLIERS, not distance from the 4.5 neutral: units only appear on
  // boards that developed far enough to have that unit, so the owner-subpopulation baseline is
  // better than 4.5. Flag units whose avg placement is > OP_BAND std-devs from the population mean.
  const MIN_PICKS = 10;
  const sampled = [...unitAgg.entries()].filter(([, v]) => v.n >= MIN_PICKS).map(([, v]) => v.place / v.n);
  const popMean = sampled.length ? sampled.reduce((a, b) => a + b, 0) / sampled.length : NEUTRAL_PLACEMENT;
  const popStd = sampled.length
    ? Math.sqrt(sampled.reduce((a, b) => a + (b - popMean) ** 2, 0) / sampled.length)
    : 1;
  const units: UnitStat[] = [...unitAgg.entries()]
    .map(([cardId, v]) => {
      const avgPlacement = v.place / v.n;
      return {
        cardId,
        pickRate: v.n / totalPlayers,
        avgPlacement,
        players: v.n,
        op: v.n >= MIN_PICKS && avgPlacement <= popMean - OP_BAND * popStd,
        dead: v.n >= MIN_PICKS && avgPlacement >= popMean + OP_BAND * popStd,
      };
    })
    .sort((a, b) => a.avgPlacement - b.avgPlacement);

  // breakpoints assembled-rate
  const bpOwners = new Map<string, number>();
  const bpHits = new Map<string, number>();
  for (const p of players) {
    for (const card of p.ownedBreakpointMaxCounter.keys()) bpOwners.set(card, (bpOwners.get(card) ?? 0) + 1);
    for (const card of p.breakpointsHit) bpHits.set(card, (bpHits.get(card) ?? 0) + 1);
  }
  const bpStats: BreakpointStat[] = breakpoints.list.map((b) => {
    const owners = bpOwners.get(b.card) ?? 0;
    const hits = bpHits.get(b.card) ?? 0;
    return { card: b.card, owners, assembledRate: owners > 0 ? hits / owners : 0 };
  });

  const singleAxis = singleAxisMargin(results);
  const reach = reachability(results);
  const nonLin = nonLinearity(results);
  const stale = staleCombat(results);

  const flags: string[] = [];
  if (!singleAxis.pass) flags.push(`OVERPOWERED single-axis margin ${(singleAxis.margin * 100).toFixed(1)}pp > ${(singleAxis.threshold * 100).toFixed(0)}pp`);
  if (!reach.pass) flags.push(`REACHABILITY GATE FAIL ${(reach.fraction * 100).toFixed(1)}% < ${(reach.target * 100).toFixed(0)}%`);
  if (!nonLin.pass) flags.push(`NON-LINEARITY ratio ${nonLin.meanRatio.toFixed(2)} < ${nonLin.threshold}`);
  if (!stale.pass) flags.push(`STALE COMBAT ${(stale.fraction * 100).toFixed(2)}% > ${(stale.flag * 100).toFixed(0)}%`);
  for (const u of units) {
    if (u.op) flags.push(`OP unit ${u.cardId} avgP ${u.avgPlacement.toFixed(2)}`);
    if (u.dead) flags.push(`DEAD unit ${u.cardId} avgP ${u.avgPlacement.toFixed(2)}`);
  }

  return {
    matches: results.length,
    playersPerMatch: results[0]?.players.length ?? 0,
    singleAxis,
    reach,
    nonLin,
    stale,
    tribes,
    units,
    breakpoints: bpStats,
    flags,
  };
}

export { getBreakpoint };
