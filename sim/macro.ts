// Macro (full-match) sim (spec §11.2, §11.3). 8 bot configs × M matches → per unit/build/tribe
// pick rate, avg placement, win rate, "assembled the combo?" rate, and the four balance-gate
// metrics (a single-axis margin, b reachability, d non-linearity, g stale-combat). Drives full
// matches via the engine `Match` + server `BotAgent`, honoring the endOfTurnPhase-before-combat
// integration contract. Seeded/deterministic: same (matches, seedBase) → identical report.
//
// Run:  pnpm sim:macro
//       pnpm --filter @cardgame/sim macro -- --matches 200 --seed run

import { bots } from '@cardgame/shared';
import { makeSeatSpecs, runMatch, type MatchResult } from './harness';
import { buildMacroReport, type MacroReport } from './metrics';

export interface MacroOpts {
  matches: number;
  seedBase: string;
}

export function runMacro(opts: MacroOpts): { results: MatchResult[]; report: MacroReport } {
  const seats = makeSeatSpecs(bots.difficultyPresets);
  const results: MatchResult[] = [];
  for (let i = 0; i < opts.matches; i++) {
    results.push(runMatch(`${opts.seedBase}:${i}`, seats));
  }
  return { results, report: buildMacroReport(results) };
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}
function pass(b: boolean): string {
  return b ? 'PASS' : 'FAIL';
}

export function printReport(report: MacroReport): void {
  console.log('=== sim:macro — balance-gate report (spec §11.3) ===');
  console.log(`matches: ${report.matches}   players/match: ${report.playersPerMatch}`);
  console.log('');
  const a = report.singleAxis;
  console.log(`(a) single-axis margin   : ${pass(a.pass)}  margin ${(a.margin * 100).toFixed(1)}pp (limit ${(a.threshold * 100).toFixed(0)}pp)  [single ${pct(a.singleWinRate)} n=${a.singleN} | multi ${pct(a.multiWinRate)} n=${a.multiN}]`);
  const b = report.reach;
  console.log(`(b) reachability GATE    : ${pass(b.pass)}  ${pct(b.fraction)} of developed splashes hit >=2 breaks (target ${pct(b.target)})  [n=${b.developedSplashCount}]`);
  const d = report.nonLin;
  console.log(`(d) non-linearity        : ${pass(d.pass)}  mean step ratio ${d.meanRatio.toFixed(2)} (min ${d.threshold})  [${d.measuredCards} marquee cards measured]`);
  const g = report.stale;
  console.log(`(g) stale-combat         : ${pass(g.pass)}  ${(g.fraction * 100).toFixed(2)}% of ${g.combats} combats hit maxCombatSteps (flag ${(g.flag * 100).toFixed(0)}%)`);
  const h = report.hoarding;
  console.log(`hoarding (diagnostic)    : end-of-game unspent gems — mean ${h.mean.toFixed(2)}  p50 ${h.p50}  p90 ${h.p90}  max ${h.max}  (${h.withGems}/${h.players} players held gems; #39, not a gate)`);
  console.log('');
  console.log('tribes (avg placement, lower=better):');
  for (const t of report.tribes) {
    console.log(`  ${t.tribe.padEnd(12)} avgP ${t.avgPlacement.toFixed(2)}  pick ${pct(t.pickRate)}  n=${t.players}`);
  }
  console.log('');
  console.log('top-5 / bottom-5 units by avg placement:');
  for (const u of report.units.slice(0, 5)) console.log(`  + ${u.cardId.padEnd(26)} avgP ${u.avgPlacement.toFixed(2)}  pick ${pct(u.pickRate)}`);
  for (const u of report.units.slice(-5)) console.log(`  - ${u.cardId.padEnd(26)} avgP ${u.avgPlacement.toFixed(2)}  pick ${pct(u.pickRate)}`);
  console.log('');
  const lowAssembled = report.breakpoints.filter((b2) => b2.owners >= 5 && b2.assembledRate < 0.5).sort((x, y) => x.assembledRate - y.assembledRate);
  if (lowAssembled.length) {
    console.log('breakpoints under-assembled (owners>=5, <50% hit):');
    for (const b2 of lowAssembled) console.log(`  ${b2.card.padEnd(26)} assembled ${pct(b2.assembledRate)}  owners=${b2.owners}`);
    console.log('');
  }
  console.log(`flags (${report.flags.length}):`);
  if (report.flags.length === 0) console.log('  none — gate CLEAR');
  for (const f of report.flags) console.log(`  ! ${f}`);
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────
function parseOpts(argv: string[]): MacroOpts {
  let matches = 200; // Monte-Carlo sample large enough for the reachability gate to be stable
  let seedBase = 'macro';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--matches' && argv[i + 1]) matches = Math.max(1, Number(argv[i + 1]) || matches);
    if (argv[i] === '--seed' && argv[i + 1]) seedBase = argv[i + 1];
  }
  return { matches, seedBase };
}

function main(): void {
  const opts = parseOpts(process.argv.slice(2));
  const t0 = Date.now();
  const { report } = runMacro(opts);
  printReport(report);
  console.log('');
  console.log(`(${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
