// Human-readable web inspector (spec §16, WEB-FRAMEWORK). Prints the committed-panel cross-table,
// each board's reachable counters, and the anti-degeneracy floor verdict (EV-BAL-F).
//
// Run:  pnpm sim:web              pnpm --filter @cardgame/sim web -- --seeds 60

import { webPanel, crossTable, countersOf, universalWinners, uncounteredBoards, evaluateFloor } from './web';

function parseSeeds(argv: string[]): number {
  const i = argv.indexOf('--seeds');
  if (i >= 0 && argv[i + 1]) return Math.max(1, Number(argv[i + 1]) || 40);
  return 40;
}

function main(): void {
  const seeds = parseSeeds(process.argv.slice(2));
  const nodes = webPanel();
  const ct = crossTable(nodes, seeds);
  console.log('=== sim:web — anti-degeneracy floor (spec §16) ===');
  console.log(`panel: ${nodes.length} boards, ${seeds} seeds/matchup (×2 orientations)`);
  console.log('');
  // cross-table (row win% vs column)
  const label = (s: string) => s.slice(0, 10).padEnd(10);
  console.log('cross-table (row win% vs col):');
  console.log('           ' + nodes.map((n) => label(n.name).slice(0, 6).padStart(6)).join(' '));
  for (let i = 0; i < nodes.length; i++) {
    const row = nodes
      .map((_, j) => (i === j ? '   -- ' : `${Math.round(ct.winRate[i][j] * 100)}`.padStart(6)))
      .join(' ');
    console.log(`${label(nodes[i].name)} ${row}`);
  }
  console.log('');
  console.log('counters (who beats each board):');
  for (let i = 0; i < nodes.length; i++) {
    const c = countersOf(ct, i);
    console.log(`  [${nodes[i].role[0]}] ${label(nodes[i].name)} <- ${c.length ? c.join(', ') : '*** NONE (uncountered!) ***'}`);
  }
  console.log('');
  const floor = evaluateFloor(seeds);
  console.log('FLOOR VERDICT:');
  console.log(`  universal winners : ${universalWinners(ct).join(', ') || 'none'}`);
  console.log(`  uncountered boards: ${uncounteredBoards(ct).join(', ') || 'none'}`);
  console.log(`  context-insensitive scaling lines: ${floor.contextInsensitive.join(', ') || 'none'}`);
  console.log(`  => ${floor.ok ? 'FLOOR HOLDS (EV-BAL-F PASS)' : 'FLOOR BROKEN (EV-BAL-F FAIL)'}`);
}

main();
