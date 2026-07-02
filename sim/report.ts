// Full balance report (spec §11.3 outputs). Runs the macro sim + static audits + the web floor,
// writes CSV/JSON to sim-out/, and prints a console summary that auto-flags overpowered / dead /
// dominant-build / stale-combat / gate failures.
//
// Run:  pnpm --filter @cardgame/sim report -- --matches 200 --seed run --seeds 40

import { mkdirSync, writeFileSync } from 'node:fs';
import { runMacro } from './macro';
import { capsAudit, breakpointAudit } from './audit';
import { coherenceReport } from './coherence';
import { evaluateFloor } from './web';

function parse(argv: string[]): { matches: number; seedBase: string; seeds: number } {
  let matches = 200;
  let seedBase = 'run';
  let seeds = 40;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--matches' && argv[i + 1]) matches = Math.max(1, Number(argv[i + 1]) || matches);
    if (argv[i] === '--seed' && argv[i + 1]) seedBase = argv[i + 1];
    if (argv[i] === '--seeds' && argv[i + 1]) seeds = Math.max(1, Number(argv[i + 1]) || seeds);
  }
  return { matches, seedBase, seeds };
}

function main(): void {
  const { matches, seedBase, seeds } = parse(process.argv.slice(2));
  const outDir = 'sim-out';
  mkdirSync(outDir, { recursive: true });

  const { report } = runMacro({ matches, seedBase });
  const caps = capsAudit();
  const bp = breakpointAudit();
  const coh = coherenceReport();
  const floor = evaluateFloor(seeds);

  // JSON dump (full)
  writeFileSync(
    `${outDir}/report.json`,
    JSON.stringify(
      {
        macro: report,
        audit: { caps, breakpoint: bp },
        coherence: coh,
        floor,
      },
      null,
      2,
    ),
  );

  // CSV: units
  const unitCsv = ['cardId,pickRate,avgPlacement,players,op,dead']
    .concat(report.units.map((u) => `${u.cardId},${u.pickRate.toFixed(4)},${u.avgPlacement.toFixed(3)},${u.players},${u.op},${u.dead}`))
    .join('\n');
  writeFileSync(`${outDir}/units.csv`, unitCsv);

  // CSV: tribes
  const tribeCsv = ['tribe,pickRate,avgPlacement,players']
    .concat(report.tribes.map((t) => `${t.tribe},${t.pickRate.toFixed(4)},${t.avgPlacement.toFixed(3)},${t.players}`))
    .join('\n');
  writeFileSync(`${outDir}/tribes.csv`, tribeCsv);

  // CSV: breakpoints
  const bpCsv = ['card,assembledRate,owners']
    .concat(report.breakpoints.map((b) => `${b.card},${b.assembledRate.toFixed(4)},${b.owners}`))
    .join('\n');
  writeFileSync(`${outDir}/breakpoints.csv`, bpCsv);

  // console summary
  console.log('=== sim:report — balance gate (spec §11.3 + §16) ===');
  console.log(`matches ${matches}  seed ${seedBase}  web-seeds ${seeds}`);
  console.log('');
  console.log('BALANCE-GATE EVALS:');
  console.log(`  EV-BAL-A single-axis margin : ${report.singleAxis.pass ? 'PASS' : 'FAIL'}  ${(report.singleAxis.margin * 100).toFixed(1)}pp (<= ${(report.singleAxis.threshold * 100).toFixed(0)}pp)`);
  console.log(`  EV-BAL-B reachability GATE  : ${report.reach.pass ? 'PASS' : 'FAIL'}  ${(report.reach.fraction * 100).toFixed(1)}% (>= ${(report.reach.target * 100).toFixed(0)}%)  n=${report.reach.developedSplashCount}`);
  console.log(`  EV-BAL-C breakpoint lint    : ${bp.ok ? 'PASS' : 'FAIL'}  ${bp.violations.length} violations`);
  console.log(`  EV-BAL-D non-linearity      : ${report.nonLin.pass ? 'PASS' : 'FAIL'}  ratio ${report.nonLin.meanRatio.toFixed(2)} (>= ${report.nonLin.threshold})  cards=${report.nonLin.measuredCards}`);
  console.log(`  EV-BAL-E caps lint          : ${caps.ok ? 'PASS' : 'FAIL'}  ${caps.violations.length} violations`);
  console.log(`  EV-BAL-F anti-degeneracy    : ${floor.ok ? 'PASS' : 'FAIL'}  UW=${floor.universalWinners.length} uncountered=${floor.uncounteredBoards.length}`);
  console.log(`  EV-BAL-G stale-combat       : ${report.stale.pass ? 'PASS' : 'FAIL'}  ${(report.stale.fraction * 100).toFixed(2)}% (<= ${(report.stale.flag * 100).toFixed(0)}%)`);
  console.log(`  coherence (Part B)          : ${coh.ok ? 'PASS' : 'FAIL'}`);
  const h = report.hoarding;
  console.log(`  hoarding (diagnostic, #39)  : unspent gems at game end — mean ${h.mean.toFixed(2)}  p50 ${h.p50}  p90 ${h.p90}  max ${h.max}  (${h.withGems}/${h.players} players; output only, not a gate)`);
  console.log('');
  console.log(`auto-flags (${report.flags.length}):`);
  if (report.flags.length === 0) console.log('  none');
  for (const f of report.flags) console.log(`  ! ${f}`);
  console.log('');
  console.log(`wrote ${outDir}/report.json, units.csv, tribes.csv, breakpoints.csv`);
}

main();
