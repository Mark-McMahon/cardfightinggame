import {
  Match,
  getCard,
  TRIBES,
  type TribeId,
  type PlayerSeed,
  type PlayerState,
  type RoundResolution,
} from '@cardgame/shared';
import { BotAgent } from '@cardgame/server/bots';
import { heading, mean, std, pct, bar, verdict, writeJSON, writeCSV, color } from './report';
import {
  classifyBuild,
  computeMargin,
  computeNonLinearity,
  computeReachability,
  deriveCombatCounters,
  emptyPeaks,
  lintBreakpoints,
  maxPeaks,
  reachedBreakpoints,
  type PeakCounters,
  type PlayerGameRecord,
} from './metrics';

// Macro (full-match) simulator (spec §11.2 + §16.7): 8 bots play complete headless
// matches; reports tribe/unit viability AND the four Round-6 balance-gate metrics
// (single-axis margin, splash reachability, breakpoint lint, non-linearity). Reuses the
// SAME shared engine and server BotAgent (no re-implementation).

// ─────────────────────────────────────────────────────────────────────────────
// InstrumentedMatch — read-only observability for the shop-turn counters.
// They are reset by startShopPhase at the top of each round, so the only moment the
// just-ended turn's `battlecriesThisTurn` / `tokensSummonedThisTurn` are final (after
// end-of-turn token summons) AND still intact is the instant beginShopPhase is invoked.
// We capture there. A finished match never calls beginShopPhase, so we also capture in a
// resolveCombatPhase wrapper. NO gameplay logic is touched — pure instrumentation.
// ─────────────────────────────────────────────────────────────────────────────
class InstrumentedMatch extends Match {
  onShopCounters?: (players: PlayerState[]) => void;

  override beginShopPhase(): void {
    this.onShopCounters?.(this.players); // capture before startShopPhase resets the counters
    super.beginShopPhase();
  }

  override resolveCombatPhase(): RoundResolution {
    const res = super.resolveCombatPhase();
    if (this.phase === 'finished') this.onShopCounters?.(this.players); // final turn (no reset)
    return res;
  }
}

interface SeatStyle {
  label: string;
  tribes: TribeId[]; // 1 = mono, 2 = splash
}

// Seat mix: 3 mono (single-axis cohort for the margin/non-linearity checks) + 4 splash
// (the 2-tribe cohort that exercises reachability — all three pairings covered) + 1 mono
// filler to keep the strongest tribe contested.
const SEAT_STYLES: SeatStyle[] = [
  { label: 'mono:wildkin', tribes: ['wildkin'] },
  { label: 'mono:reefkin', tribes: ['reefkin'] },
  { label: 'mono:revenants', tribes: ['revenants'] },
  { label: 'splash:wildkin+reefkin', tribes: ['wildkin', 'reefkin'] },
  { label: 'splash:reefkin+revenants', tribes: ['reefkin', 'revenants'] },
  { label: 'splash:wildkin+revenants', tribes: ['wildkin', 'revenants'] },
  { label: 'mono:revenants', tribes: ['revenants'] },
  { label: 'splash:wildkin+reefkin', tribes: ['wildkin', 'reefkin'] },
];

function runMatch(matchIdx: number): PlayerGameRecord[] {
  const players: PlayerSeed[] = Array.from({ length: 8 }, (_, i) => ({
    seat: i,
    name: `Bot${i}`,
    isBot: true,
    difficulty: 'medium' as const,
  }));
  const m = new InstrumentedMatch({ matchId: `macro-${matchIdx}`, roomCode: `M${matchIdx}`, players, hostSeat: 0, botFill: true });
  const agents = SEAT_STYLES.map((s) => new BotAgent({ difficulty: 'medium', committedTribes: s.tribes }));

  const peaks: PeakCounters[] = Array.from({ length: 8 }, () => emptyPeaks());

  m.onShopCounters = (ps) => {
    for (const p of ps) {
      maxPeaks(peaks[p.seat], { tokensThisTurn: p.tokensSummonedThisTurn, battlecries: p.battlecriesThisTurn });
    }
  };

  m.start();

  let round = 0;
  while (m.phase !== 'finished' && round < 40) {
    round += 1;
    for (const p of m.alivePlayers) agents[p.seat].takeShopTurn(m, p.seat, m.round);
    const res = m.resolveCombatPhase();
    // Combat-scoped counters from each pairing's log; the pairing tells us each seat's side.
    for (const rep of res.reports) {
      const { aSeat, bSeat, ghost } = rep.pairing;
      const a = deriveCombatCounters(rep.events, 'a');
      maxPeaks(peaks[aSeat], a);
      if (!ghost && bSeat >= 0) maxPeaks(peaks[bSeat], deriveCombatCounters(rep.events, 'b'));
    }
  }

  return m.players.map((p) => {
    const cardIds = p.board.map((u) => u.cardId);
    return {
      seat: p.seat,
      assignedStyle: SEAT_STYLES[p.seat].label,
      placement: p.placement || 8,
      tier: p.tier,
      cardIds,
      profile: classifyBuild(cardIds),
      peak: peaks[p.seat],
      reach: reachedBreakpoints(cardIds, peaks[p.seat]),
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Reporting
// ─────────────────────────────────────────────────────────────────────────────

function reportTribesAndUnits(records: PlayerGameRecord[]): {
  tribeRows: Record<string, string | number>[];
  unitRows: Record<string, string | number>[];
  flagsOP: string[];
  flagsDead: string[];
} {
  const endStates = records.length;

  // ── tribe viability (by the dominant tribe of the actual final board) ──
  heading('Tribe viability (by dominant tribe; avg placement, lower = better, 4.5 = neutral)');
  const tribeRows: Record<string, string | number>[] = [];
  const sliceTribes: TribeId[] = ['wildkin', 'reefkin', 'revenants'];
  for (const tribe of sliceTribes) {
    const recs = records.filter((r) => r.profile.tribes[0]?.tribe === tribe);
    if (recs.length === 0) continue;
    const placements = recs.map((r) => r.placement);
    const avg = mean(placements);
    const wins = recs.filter((r) => r.placement === 1).length;
    const c = avg < 3.6 ? color.red : avg > 5.4 ? color.yellow : color.green;
    console.log(
      `  ${TRIBES[tribe].name.padEnd(10)} ${c}avg ${avg.toFixed(2)}${color.reset}  ` +
        `win ${pct(wins, recs.length).padStart(6)}  top4 ${pct(placements.filter((p) => p <= 4).length, recs.length)}  ` +
        `${color.dim}n=${recs.length}${color.reset}`,
    );
    tribeRows.push({ tribe, avgPlacement: avg.toFixed(3), winRate: (wins / recs.length).toFixed(3), n: recs.length });
  }

  // ── per-unit signal (tier-relative outlier flags) ──
  interface UnitAgg {
    cardId: string;
    appearances: number;
    placements: number[];
  }
  const unitAgg = new Map<string, UnitAgg>();
  for (const r of records) {
    for (const id of new Set(r.cardIds)) {
      if (getCard(id).isToken) continue;
      const ua = unitAgg.get(id) ?? { cardId: id, appearances: 0, placements: [] };
      ua.appearances += 1;
      ua.placements.push(r.placement);
      unitAgg.set(id, ua);
    }
  }
  const units = [...unitAgg.values()];
  const appearanceRate = (u: UnitAgg) => u.appearances / endStates;
  const byTier = new Map<number, UnitAgg[]>();
  for (const u of units) {
    const t = getCard(u.cardId).tier;
    (byTier.get(t) ?? byTier.set(t, []).get(t)!).push(u);
  }
  const tierStats = new Map<number, { mean: number; std: number; meanPick: number }>();
  for (const [t, us] of byTier) {
    const avgs = us.map((u) => mean(u.placements));
    tierStats.set(t, { mean: mean(avgs), std: std(avgs), meanPick: mean(us.map(appearanceRate)) });
  }

  heading('Per-unit signal  (flags vs same-tier peers; pick = boards with it)');
  const unitRows: Record<string, string | number>[] = [];
  const flagsOP: string[] = [];
  const flagsDead: string[] = [];
  units
    .sort((a, b) => getCard(a.cardId).tier - getCard(b.cardId).tier || mean(a.placements) - mean(b.placements))
    .forEach((u) => {
      const card = getCard(u.cardId);
      const avgP = mean(u.placements);
      const pick = appearanceRate(u);
      const ts = tierStats.get(card.tier)!;
      const cohort = (byTier.get(card.tier) ?? []).length;
      const reliable = cohort >= 3 && ts.std > 0.1 && pick >= 0.4 * ts.meanPick;
      let flag = '';
      if (reliable && avgP < ts.mean - 1.6 * ts.std) {
        flag = `${color.red}OP${color.reset}`;
        flagsOP.push(card.name);
      } else if (cohort >= 3 && pick < 0.15 * ts.meanPick) {
        flag = `${color.yellow}DEAD${color.reset}`;
        flagsDead.push(card.name);
      } else if (reliable && avgP > ts.mean + 1.6 * ts.std) {
        flag = `${color.yellow}weak${color.reset}`;
      }
      console.log(
        `  ${color.dim}T${card.tier}${color.reset} ${card.name.padEnd(20)} ` +
          `pick ${pct(u.appearances, endStates).padStart(6)}  avgP ${avgP.toFixed(2)}  ${bar(1 - (avgP - 1) / 7, 14)} ${flag}`,
      );
      unitRows.push({ cardId: u.cardId, tier: card.tier, tribe: card.tribe, pickRate: pick.toFixed(3), avgPlacement: avgP.toFixed(3), appearances: u.appearances });
    });

  heading('Outlier summary (tier-relative)');
  console.log(`  ${color.red}OP units:${color.reset}   ${flagsOP.length ? flagsOP.join(', ') : 'none ✓'}`);
  console.log(`  ${color.yellow}Dead units:${color.reset} ${flagsDead.length ? flagsDead.join(', ') : 'none ✓'}`);

  return { tribeRows, unitRows, flagsOP, flagsDead };
}

function reportMetrics(records: PlayerGameRecord[]) {
  const margin = computeMargin(records);
  const reach = computeReachability(records, !margin.pass);
  const lint = lintBreakpoints();
  const nonlin = computeNonLinearity(records);

  // ── (a) single-axis margin ──
  heading('§16.7(a) Single-axis margin  (mono single-axis stacks must not out-win multi-axis)');
  console.log(
    `  ${color.dim}single-axis${color.reset} n=${margin.single.n} win ${(100 * margin.single.winRate).toFixed(1)}% avgP ${margin.single.avgPlacement.toFixed(2)}   ` +
      `${color.dim}multi-axis${color.reset} n=${margin.multi.n} win ${(100 * margin.multi.winRate).toFixed(1)}% avgP ${margin.multi.avgPlacement.toFixed(2)}`,
  );
  verdict(
    'single-axis margin',
    margin.pass,
    `lead ${(100 * margin.margin).toFixed(1)}pp (limit ${(100 * margin.marginMax).toFixed(0)}pp)`,
  );
  for (const w of margin.watchlist) {
    const c = w.pass ? color.green : color.red;
    console.log(
      `    ${color.dim}watch${color.reset} ${w.label.padEnd(22)} n=${String(w.n).padStart(4)}  win ${(100 * w.winRate).toFixed(1).padStart(5)}%  avgP ${w.avgPlacement.toFixed(2)}  ${c}lead ${(100 * w.lead).toFixed(1)}pp${color.reset}`,
    );
  }

  // ── (b) reachability (the gate) ──
  heading('§16.7(b) Reachability  ⟵ GATE  (a 2-tribe splash must realistically hit two breaks)');
  console.log(
    `  splash boards n=${reach.splashN} (all)  →  developed (tier ≥${reach.developedTier}) n=${reach.developedN}  ` +
      `reached ≥2 breakpoints: ${color.bold}${(100 * reach.pctTwoPlus).toFixed(1)}%${color.reset}  ` +
      `${color.dim}(all splashes ${(100 * reach.pctTwoPlusAll).toFixed(1)}%; ≥2 distinct axes ${(100 * reach.pctTwoPlusDistinctAxes).toFixed(1)}%)${color.reset}`,
  );
  console.log(`  ${color.dim}developed splash owns ${reach.avgOwnedBreaks.toFixed(2)} breakpoint cards · actually triggers ${reach.avgReachedBreaks.toFixed(2)}${color.reset}`);
  const styleLine = reach.byStyle.map((s) => `${s.style.replace('splash:', '')} ${(100 * s.pctTwoPlus).toFixed(0)}% (n=${s.n})`).join('   ');
  console.log(`  ${color.dim}by pairing:${color.reset} ${styleLine}`);
  verdict('splash reachability', reach.pass, `${(100 * reach.pctTwoPlus).toFixed(1)}% ≥ target ${(100 * reach.target).toFixed(0)}%`);
  console.log(`  ${color.dim}Failure modes — A single-axis too strong: ${reach.failTooStrongSingleAxis ? `${color.red}YES${color.reset}` : 'no'}${color.dim}   B splash unviable: ${reach.failSplashUnviable ? `${color.red}YES${color.reset}` : 'no'}${color.reset}`);
  console.log(`  ${color.dim}breakpoint reach-rate when owned (low rate = threshold too high to splash into):${color.reset}`);
  for (const b of reach.perBreakpoint) {
    const c = b.owned === 0 ? color.dim : b.rate >= 0.5 ? color.green : b.rate >= 0.2 ? color.yellow : color.red;
    console.log(
      `    ${b.card.padEnd(24)} ${b.counter.padEnd(15)} ≥${b.threshold}  owned ${String(b.owned).padStart(4)}  ${c}reached ${(100 * b.rate).toFixed(0).padStart(3)}%${color.reset}`,
    );
  }

  // ── (c) breakpoint lint ──
  heading('§16.7(c) Breakpoint lint  (every primary payoff is a discrete config breakpoint)');
  verdict('breakpoint lint', lint.pass, lint.pass ? 'all primary payoffs are config breakpoints; no uncapped per-unit scaling' : `${lint.issues.length} issue(s)`);
  for (const issue of lint.issues) console.log(`    ${color.red}✗${color.reset} ${issue}`);

  // ── (d) non-linearity ──
  heading('§16.7(d) Non-linearity  (win-rate vs commitment shows a step at the threshold, not a line)');
  for (const a of nonlin.axes) {
    console.log(`  ${color.bold}${a.axis}${color.reset} (counter ${a.counter}, break ≥${a.threshold}) avg placement by commitment:`);
    const line = a.buckets
      .map((bk) => {
        const label = bk.value === 5 ? '5+' : String(bk.value);
        const mark = bk.value === a.threshold ? '▶' : ' ';
        const val = bk.n ? bk.avgPlacement.toFixed(2) : ' — ';
        return `${mark}${label}:${bk.n ? '' : color.dim}${val}${color.reset}(${bk.n})`;
      })
      .join('  ');
    console.log(`    ${line}`);
    verdict(
      `${a.axis} step`,
      a.pass,
      `crossing Δ ${a.crossingImprovement.toFixed(2)} vs sub-slope ${a.subThresholdSlope.toFixed(2)} → ratio ${Number.isFinite(a.stepRatio) ? a.stepRatio.toFixed(2) : '∞'}`,
    );
  }

  return { margin, reach, lint, nonlin };
}

function main() {
  const arg = process.argv.find((a) => a.startsWith('--matches='));
  const matches = arg ? parseInt(arg.split('=')[1], 10) : 400;

  heading(`Macro simulator — ${matches} matches (8 bots: 3 mono / 4 splash / 1 filler)`);

  const records: PlayerGameRecord[] = [];
  for (let i = 0; i < matches; i++) records.push(...runMatch(i));

  const { tribeRows, unitRows, flagsOP, flagsDead } = reportTribesAndUnits(records);
  const { margin, reach, lint, nonlin } = reportMetrics(records);

  // ── gate summary ──
  const gates = [
    ['single-axis margin (a)', margin.pass],
    ['reachability GATE (b)', reach.pass],
    ['breakpoint lint (c)', lint.pass],
    ['non-linearity (d)', nonlin.pass],
  ] as const;
  heading('Round-6 balance gate (decisions #25/#29)');
  for (const [label, pass] of gates) verdict(label, pass, pass ? 'ok' : 'needs tuning');
  const allPass = gates.every(([, p]) => p);
  console.log(
    `\n  ${allPass ? color.green + 'GATE CLEAR' : color.yellow + 'GATE BLOCKED'}${color.reset} — ` +
      `${allPass ? 'content may ship (step 1 → steps 3–5)' : 'tune config numbers and re-run'}`,
  );

  writeJSON('macro.json', {
    matches,
    endStates: records.length,
    tribes: tribeRows,
    units: unitRows,
    flagsOP,
    flagsDead,
    metrics: {
      margin,
      reachability: reach,
      lint,
      nonLinearity: nonlin,
      gateClear: allPass,
    },
  });
  writeCSV('macro-units.csv', unitRows);
  console.log(`\n${color.dim}→ wrote sim-out/macro.json, sim-out/macro-units.csv${color.reset}`);
}

main();
