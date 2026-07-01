// One board vs the whole web (spec §16 tooling). Prints how a named committed board fares against
// every panel node + its reachable counters.
//
// Run:  pnpm --filter @cardgame/sim web:probe -- tusk-exponential [--seeds 40]

import { webPanel, runMatchup } from './web';

function main(): void {
  const argv = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const seedsFlag = process.argv.indexOf('--seeds');
  const seeds = seedsFlag >= 0 ? Math.max(1, Number(process.argv[seedsFlag + 1]) || 40) : 40;
  const target = argv[0];
  const nodes = webPanel();
  if (!target) {
    console.log('usage: web:probe <board-name> [--seeds N]');
    console.log('boards: ' + nodes.map((n) => n.name).join(', '));
    return;
  }
  const node = nodes.find((n) => n.name === target);
  if (!node) {
    console.log(`unknown board "${target}". boards: ${nodes.map((n) => n.name).join(', ')}`);
    return;
  }
  console.log(`=== web:probe ${target} (${node.role}) — ${seeds} seeds ×2 ===`);
  console.log(node.note);
  console.log('');
  const counters: string[] = [];
  for (const other of nodes) {
    if (other.name === target) continue;
    const m = runMatchup(node.board, other.board, seeds, `probe:${target}:${other.name}`);
    const verdict = m.aWinRate > 0.5 ? 'WIN ' : m.aWinRate < 0.5 ? 'LOSE' : 'EVEN';
    if (m.aWinRate < 0.5) counters.push(other.name);
    console.log(`  ${verdict} ${(m.aWinRate * 100).toFixed(0).padStart(3)}%  vs ${other.name} [${other.role}]`);
  }
  console.log('');
  console.log(`reachable counters (${counters.length}): ${counters.join(', ') || 'NONE — degenerate!'}`);
}

main();
