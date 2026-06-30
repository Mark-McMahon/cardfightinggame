import {
  getCard,
  UNITS,
  breakpoints,
  getBreakpoint,
  hasBreakpoint,
  sim as simCfg,
  type Axis,
  type CombatEvent,
  type TribeId,
  type Breakpoint,
  type BreakpointCounter,
  type SimConfig,
} from '@cardgame/shared';

// ─────────────────────────────────────────────────────────────────────────────
// §16.7 simulator metrics (decision #29). Pure functions over per-player-game records
// + per-combat event logs, so they are unit-testable and reusable. macro.ts collects the
// observations and renders the output; the analysis lives here.
// ─────────────────────────────────────────────────────────────────────────────

/** The ⭐ primary build-around payoffs in the §16.5 catalog (mirrors breakpoints.test). */
export const PRIMARY_PAYOFFS: string[] = [
  'wildkin_thornwarden',
  'wildkin_motherthorn',
  'wildkin_packmother',
  'wildkin_brackentide',
  'revenants_mortarch',
  'revenants_palelich',
  'revenants_tideclaimer',
  'revenants_boncolossus',
  'reefkin_pearlguard',
  'reefkin_chorustide',
  'reefkin_leviathan',
];

const VALID_COUNTERS: BreakpointCounter[] = [
  'deaths',
  'revenantDeaths',
  'tokensThisTurn',
  'battlecries',
  'alliesAtStart',
  'shieldBreak',
];

/** Single-axis stacks under the §16.7a margin watch (decision #25). */
export const WATCHLIST: { label: string; needs: string[] }[] = [
  { label: 'Grovecaller+Grovelord', needs: ['wildkin_grovecaller', 'wildkin_grovelord'] },
  { label: 'Echo Choir', needs: ['reefkin_echochoir'] },
  { label: 'Pale Lich', needs: ['revenants_palelich'] },
];

// ── per-game counter peaks (the highest a player reached in any single round) ──────────
export interface PeakCounters {
  deaths: number; // friendly deaths in a single combat
  revenantDeaths: number; // friendly Revenant deaths in a single combat
  alliesAtStart: number; // minions controlled at a combat's start
  shieldBreak: number; // own divine shields broken in a single combat
  tokensThisTurn: number; // tokens summoned in a single shop turn (post end-of-turn)
  battlecries: number; // resolved battlecries in a single shop turn
}

export function emptyPeaks(): PeakCounters {
  return { deaths: 0, revenantDeaths: 0, alliesAtStart: 0, shieldBreak: 0, tokensThisTurn: 0, battlecries: 0 };
}

export function maxPeaks(into: PeakCounters, add: Partial<PeakCounters>): void {
  for (const k of Object.keys(into) as (keyof PeakCounters)[]) {
    if (add[k] !== undefined) into[k] = Math.max(into[k], add[k]!);
  }
}

/** Which peak counter a breakpoint's `counter` reads. */
function peakFor(counter: BreakpointCounter, peak: PeakCounters): number {
  switch (counter) {
    case 'deaths':
      return peak.deaths;
    case 'revenantDeaths':
      return peak.revenantDeaths;
    case 'tokensThisTurn':
      return peak.tokensThisTurn;
    case 'battlecries':
      return peak.battlecries;
    case 'alliesAtStart':
      return peak.alliesAtStart;
    case 'shieldBreak':
      return peak.shieldBreak;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Combat-counter derivation — read a side's manufactured-event counts from its log.
// Combat is a pure seeded function, so this is exact & reproducible.
// ─────────────────────────────────────────────────────────────────────────────

interface UnitMeta {
  side: 'a' | 'b';
  tribe: TribeId | null;
}

/** Resolve a summoned unit's tribe from its uid. Combat summons encode the cardId as
 *  `cardId#born@side`; reborns append `~r` to their parent's uid. */
function tribeOfSummonUid(uid: string, known: Map<string, UnitMeta>): TribeId | null {
  if (uid.endsWith('~r')) {
    const parent = uid.slice(0, -2);
    return known.get(parent)?.tribe ?? null;
  }
  const cardId = uid.split('#')[0];
  try {
    return getCard(cardId).tribe;
  } catch {
    return null;
  }
}

export interface CombatCounterReach {
  deaths: number;
  revenantDeaths: number;
  alliesAtStart: number;
  shieldBreak: number;
}

/**
 * Derive one side's manufactured-event counts from a combat event log. `side` identifies
 * which player we are scoring (pairings tell macro.ts which seat is 'a' vs 'b').
 */
export function deriveCombatCounters(events: CombatEvent[], side: 'a' | 'b'): CombatCounterReach {
  const meta = new Map<string, UnitMeta>();
  const out: CombatCounterReach = { deaths: 0, revenantDeaths: 0, alliesAtStart: 0, shieldBreak: 0 };

  const start = events[0];
  if (start && start.t === 'combatStart') {
    for (const u of start.a.units) meta.set(u.uid, { side: 'a', tribe: u.tribe });
    for (const u of start.b.units) meta.set(u.uid, { side: 'b', tribe: u.tribe });
    out.alliesAtStart = (side === 'a' ? start.a.units : start.b.units).length;
  }

  for (const e of events) {
    switch (e.t) {
      case 'summon': {
        const owner = e.ownerId as 'a' | 'b'; // combat sets this to side.id ('a' | 'b')
        for (const uid of e.unitIds) {
          meta.set(uid, { side: owner, tribe: tribeOfSummonUid(uid, meta) });
        }
        break;
      }
      case 'death': {
        const m = meta.get(e.unitId);
        if (m && m.side === side) {
          out.deaths += 1;
          if (m.tribe === 'revenants') out.revenantDeaths += 1;
        }
        break;
      }
      case 'damage': {
        if (e.shieldBroken) {
          const m = meta.get(e.targetId);
          if (m && m.side === side) out.shieldBreak += 1;
        }
        break;
      }
      default:
        break;
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Build classification by axis (the static UnitCard.axis glyphs, §16.6).
// ─────────────────────────────────────────────────────────────────────────────

export type BuildClass = 'single-axis' | 'multi-axis' | 'unclassified';

export interface BuildProfile {
  unitCount: number; // non-token units on the final board
  tribes: { tribe: TribeId; n: number }[]; // descending
  secondTribeUnits: number;
  isSplash: boolean;
  axisFeeds: { axis: Axis; n: number }[]; // descending
  dominantAxis: Axis | null;
  dominantAxisShare: number;
  klass: BuildClass;
}

export function classifyBuild(cardIds: string[], cfg: SimConfig = simCfg): BuildProfile {
  const units = cardIds.filter((id) => !getCard(id).isToken);
  const tribeCounts = new Map<TribeId, number>();
  const axisCounts = new Map<Axis, number>();
  for (const id of units) {
    const card = getCard(id);
    tribeCounts.set(card.tribe, (tribeCounts.get(card.tribe) ?? 0) + 1);
    for (const ax of card.axis ?? []) axisCounts.set(ax, (axisCounts.get(ax) ?? 0) + 1);
  }
  const tribes = [...tribeCounts.entries()].map(([tribe, n]) => ({ tribe, n })).sort((a, b) => b.n - a.n);
  const axisFeeds = [...axisCounts.entries()].map(([axis, n]) => ({ axis, n })).sort((a, b) => b.n - a.n);
  const totalFeeds = axisFeeds.reduce((s, f) => s + f.n, 0);
  const dominantAxis = axisFeeds[0]?.axis ?? null;
  const dominantAxisShare = totalFeeds > 0 ? axisFeeds[0].n / totalFeeds : 0;
  const secondTribeUnits = tribes[1]?.n ?? 0;
  const isSplash = secondTribeUnits >= cfg.splashMinSecondTribeUnits;

  let klass: BuildClass = 'unclassified';
  if (units.length >= cfg.minUnitsToClassify && totalFeeds > 0) {
    klass = dominantAxisShare >= cfg.singleAxisDominanceThreshold ? 'single-axis' : 'multi-axis';
  }
  return { unitCount: units.length, tribes, secondTribeUnits, isSplash, axisFeeds, dominantAxis, dominantAxisShare, klass };
}

// ─────────────────────────────────────────────────────────────────────────────
// Breakpoint reach — which payoffs a player both OWNED and triggered (counter ≥ threshold).
// ─────────────────────────────────────────────────────────────────────────────

export function breakpointAxis(bp: Breakpoint): Axis {
  switch (bp.counter) {
    case 'tokensThisTurn':
      return 'swarm';
    case 'deaths':
    case 'revenantDeaths':
      return 'deaths';
    case 'battlecries':
      return 'battlecries';
    case 'alliesAtStart':
    case 'shieldBreak':
      return 'endure';
  }
}

export interface ReachResult {
  reachedCards: string[]; // breakpoint card ids owned + threshold met
  reachedAxes: Axis[]; // distinct axes among reachedCards
}

export function reachedBreakpoints(ownedCardIds: string[], peak: PeakCounters): ReachResult {
  const owned = new Set(ownedCardIds);
  const reachedCards: string[] = [];
  const axes = new Set<Axis>();
  for (const bp of breakpoints.list) {
    if (!owned.has(bp.card)) continue;
    if (peakFor(bp.counter, peak) >= bp.threshold) {
      reachedCards.push(bp.card);
      axes.add(breakpointAxis(bp));
    }
  }
  return { reachedCards, reachedAxes: [...axes] };
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-game record (built by macro.ts) and the four metrics.
// ─────────────────────────────────────────────────────────────────────────────

export interface PlayerGameRecord {
  seat: number;
  assignedStyle: string; // e.g. "mono:wildkin" or "splash:wildkin+reefkin"
  placement: number; // 1 = win
  tier: number; // final tier reached
  cardIds: string[]; // final board (incl. tokens; classify filters them)
  profile: BuildProfile;
  peak: PeakCounters;
  reach: ReachResult;
}

const winRate = (recs: PlayerGameRecord[]): number =>
  recs.length === 0 ? 0 : recs.filter((r) => r.placement === 1).length / recs.length;
const avgPlacement = (recs: PlayerGameRecord[]): number =>
  recs.length === 0 ? 0 : recs.reduce((s, r) => s + r.placement, 0) / recs.length;

// ── (a) single-axis margin ─────────────────────────────────────────────────────
export interface MarginResult {
  single: { n: number; winRate: number; avgPlacement: number };
  multi: { n: number; winRate: number; avgPlacement: number };
  margin: number; // winRate(single) - winRate(multi)
  marginMax: number;
  pass: boolean;
  watchlist: { label: string; n: number; winRate: number; avgPlacement: number; lead: number; pass: boolean }[];
}

export function computeMargin(records: PlayerGameRecord[], cfg: SimConfig = simCfg): MarginResult {
  const single = records.filter((r) => r.profile.klass === 'single-axis');
  const multi = records.filter((r) => r.profile.klass === 'multi-axis');
  const multiWin = winRate(multi);
  const margin = winRate(single) - multiWin;
  const watchlist = WATCHLIST.map((w) => {
    const recs = records.filter((r) => w.needs.every((id) => r.cardIds.includes(id)));
    const wr = winRate(recs);
    const lead = wr - multiWin;
    return { label: w.label, n: recs.length, winRate: wr, avgPlacement: avgPlacement(recs), lead, pass: lead <= cfg.singleAxisMarginMax };
  });
  return {
    single: { n: single.length, winRate: winRate(single), avgPlacement: avgPlacement(single) },
    multi: { n: multi.length, winRate: multiWin, avgPlacement: avgPlacement(multi) },
    margin,
    marginMax: cfg.singleAxisMarginMax,
    pass: margin <= cfg.singleAxisMarginMax,
    watchlist,
  };
}

// ── (b) reachability (the gate) ────────────────────────────────────────────────
export interface ReachabilityResult {
  splashN: number;
  pctTwoPlusAll: number; // fraction over ALL splash boards (incl. early-eliminated)
  developedN: number; // splash boards that reached splashDevelopedTier
  pctTwoPlus: number; // fraction of DEVELOPED splash boards reaching ≥2 distinct breakpoints
  pctTwoPlusDistinctAxes: number; // ... on ≥2 distinct axes (the real cross-tribe payoff)
  target: number;
  developedTier: number;
  pass: boolean;
  avgOwnedBreaks: number; // avg breakpoint cards a developed splash board owns
  avgReachedBreaks: number; // avg breakpoint cards a developed splash board actually triggers
  byStyle: { style: string; n: number; pctTwoPlus: number }[]; // per assigned splash style
  // per-breakpoint reach rate among players who owned it (surfaces too-high thresholds):
  perBreakpoint: { card: string; counter: BreakpointCounter; threshold: number; owned: number; reached: number; rate: number }[];
  // failure-mode summary
  failTooStrongSingleAxis: boolean; // mode A (cross-referenced from margin)
  failSplashUnviable: boolean; // mode B
}

export function computeReachability(
  records: PlayerGameRecord[],
  marginFailed: boolean,
  cfg: SimConfig = simCfg,
): ReachabilityResult {
  const allSplash = records.filter((r) => r.profile.isSplash);
  // "in a normal game" → splashes that actually developed (reached the dev tier).
  const splash = allSplash.filter((r) => r.tier >= cfg.splashDevelopedTier);
  const reach2 = (rs: PlayerGameRecord[]) => (rs.length ? rs.filter((r) => r.reach.reachedCards.length >= 2).length / rs.length : 0);
  const pctTwoPlus = reach2(splash);
  const twoPlusAxes = splash.filter((r) => r.reach.reachedAxes.length >= 2).length;
  const ownedBreakCount = (r: PlayerGameRecord) => r.cardIds.filter((id) => breakpoints.list.some((b) => b.card === id)).length;
  const avgOwnedBreaks = splash.length ? splash.reduce((s, r) => s + ownedBreakCount(r), 0) / splash.length : 0;
  const avgReachedBreaks = splash.length ? splash.reduce((s, r) => s + r.reach.reachedCards.length, 0) / splash.length : 0;

  const styles = [...new Set(splash.map((r) => r.assignedStyle))].sort();
  const byStyle = styles.map((style) => {
    const rs = splash.filter((r) => r.assignedStyle === style);
    return { style, n: rs.length, pctTwoPlus: reach2(rs) };
  });

  const perBreakpoint = breakpoints.list.map((bp) => {
    const owners = records.filter((r) => r.cardIds.includes(bp.card));
    const reached = owners.filter((r) => peakFor(bp.counter, r.peak) >= bp.threshold).length;
    return {
      card: bp.card,
      counter: bp.counter,
      threshold: bp.threshold,
      owned: owners.length,
      reached,
      rate: owners.length ? reached / owners.length : 0,
    };
  });

  const failSplashUnviable = pctTwoPlus < cfg.splashReachTargetPct;
  return {
    splashN: allSplash.length,
    pctTwoPlusAll: reach2(allSplash),
    developedN: splash.length,
    pctTwoPlus,
    pctTwoPlusDistinctAxes: splash.length ? twoPlusAxes / splash.length : 0,
    target: cfg.splashReachTargetPct,
    developedTier: cfg.splashDevelopedTier,
    pass: !failSplashUnviable,
    avgOwnedBreaks,
    avgReachedBreaks,
    byStyle,
    perBreakpoint,
    failTooStrongSingleAxis: marginFailed,
    failSplashUnviable,
  };
}

// ── (c) breakpoint lint ─────────────────────────────────────────────────────────
export interface LintResult {
  pass: boolean;
  issues: string[];
}

export function lintBreakpoints(): LintResult {
  const issues: string[] = [];
  const byCard = new Map(breakpoints.list.map((b) => [b.card, b]));

  // 1) every configured breakpoint is structurally sound
  for (const b of breakpoints.list) {
    try {
      getCard(b.card);
    } catch {
      issues.push(`breakpoint references unknown card "${b.card}"`);
    }
    if (!VALID_COUNTERS.includes(b.counter)) issues.push(`breakpoint ${b.card} has invalid counter "${b.counter}"`);
    if (!(b.threshold > 0)) issues.push(`breakpoint ${b.card} needs a positive threshold`);
  }

  // 2) unique card ids
  const ids = breakpoints.list.map((b) => b.card);
  if (new Set(ids).size !== ids.length) issues.push('breakpoint card ids are not unique');

  // 3) every primary (⭐) payoff is expressed as a discrete breakpoint
  for (const id of PRIMARY_PAYOFFS) {
    if (!hasBreakpoint(id)) issues.push(`primary payoff ${id} has no config breakpoint`);
  }

  // 4) no non-token unit has an unbounded per-event PRIMARY payoff without a threshold —
  //    i.e. avenge-style (afterFriendlyDeaths, everyN) scaling must be a breakpoint or a
  //    capped thin floor (tokensOnly). Flags any future linear-stacking redline (#22).
  for (const card of UNITS) {
    if (card.isToken) continue;
    for (const e of card.effects) {
      if (e.trigger.type !== 'afterFriendlyDeaths') continue;
      const everyN = e.trigger.everyN ?? true;
      const isCappedFloor = e.trigger.tokensOnly === true; // Gorehide / Thornbeast — capped in engines
      if (everyN && !isCappedFloor && !byCard.has(card.id)) {
        issues.push(`${card.id} scales per-N (afterFriendlyDeaths) with no config breakpoint or cap`);
      }
    }
  }

  return { pass: issues.length === 0, issues };
}

// ── (d) non-linearity (step-not-line commitment curve) ─────────────────────────
export interface NonLinearityAxis {
  axis: Axis;
  counter: BreakpointCounter;
  threshold: number;
  buckets: { value: number; n: number; avgPlacement: number; winRate: number }[]; // value 0..cap (cap = "+")
  crossingImprovement: number; // avgPlacement drop from (threshold-1) → (threshold)
  subThresholdSlope: number; // average per-step drop below the threshold
  stepRatio: number;
  pass: boolean;
}

export interface NonLinearityResult {
  axes: NonLinearityAxis[];
  pass: boolean;
}

/** One marquee breakpoint per axis to trace the commitment curve against. */
const NONLINEAR_AXES: { axis: Axis; card: string }[] = [
  { axis: 'swarm', card: 'wildkin_motherthorn' }, // tokensThisTurn ≥ 3
  { axis: 'deaths', card: 'revenants_mortarch' }, // deaths ≥ 3
  { axis: 'battlecries', card: 'reefkin_chorustide' }, // battlecries ≥ 3
];

const BUCKET_CAP = 5; // values ≥ cap fold into the top "+" bucket

export function computeNonLinearity(records: PlayerGameRecord[], cfg: SimConfig = simCfg): NonLinearityResult {
  const axes: NonLinearityAxis[] = [];
  for (const { axis, card } of NONLINEAR_AXES) {
    const bp = getBreakpoint(card);
    const owners = records.filter((r) => r.cardIds.includes(card));
    const valueOf = (r: PlayerGameRecord) => Math.min(BUCKET_CAP, peakFor(bp.counter, r.peak));
    const buckets: NonLinearityAxis['buckets'] = [];
    for (let v = 0; v <= BUCKET_CAP; v++) {
      const recs = owners.filter((r) => valueOf(r) === v);
      buckets.push({ value: v, n: recs.length, avgPlacement: avgPlacement(recs), winRate: winRate(recs) });
    }
    // improvement = drop in avg placement (lower is better). Guard empty buckets.
    const avgAt = (v: number) => buckets[v]?.avgPlacement ?? 0;
    const nAt = (v: number) => buckets[v]?.n ?? 0;
    const t = bp.threshold;
    const crossingImprovement = nAt(t) && nAt(t - 1) ? avgAt(t - 1) - avgAt(t) : 0;
    // sub-threshold slope: average per-step drop across populated buckets below threshold
    let drops = 0;
    let steps = 0;
    for (let v = 1; v < t; v++) {
      if (nAt(v) && nAt(v - 1)) {
        drops += avgAt(v - 1) - avgAt(v);
        steps += 1;
      }
    }
    const subThresholdSlope = steps ? drops / steps : 0;
    const stepRatio = subThresholdSlope > 0.05 ? crossingImprovement / subThresholdSlope : crossingImprovement > 0 ? Infinity : 0;
    // pass when the threshold crossing is a clear step (or there's no sub-slope to beat but
    // the crossing still improves). Only assert when we have samples on both sides.
    const haveSamples = nAt(t) >= 3 && nAt(t - 1) >= 3;
    const pass = !haveSamples || stepRatio >= cfg.nonLinearityMinStepRatio;
    axes.push({ axis, counter: bp.counter, threshold: t, buckets, crossingImprovement, subThresholdSlope, stepRatio, pass });
  }
  return { axes, pass: axes.every((a) => a.pass) };
}
