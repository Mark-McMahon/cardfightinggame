// Micro (combat) sim (spec §11.2). Two FIXED CombatBoards × N seeds → win/tie/loss %, avg
// surviving stats, avg hero damage. Exactly reproducible because `resolveCombat` is pure.
//
// Run:  pnpm sim:micro            (default demo matchup)
//       pnpm --filter @cardgame/sim micro -- --seeds 500

import { resolveCombat, type CombatBoard, type CombatEvent } from '@cardgame/shared';
import { buildBoard, assembleGrown } from './boards';

export interface MicroResult {
  seeds: number;
  aWins: number;
  bWins: number;
  ties: number;
  aWinPct: number;
  bWinPct: number;
  tiePct: number;
  avgSurvivors: number; // avg surviving units on the winning side
  avgSurvivorStats: number; // avg (atk+hp) summed over survivors, per decisive combat
  avgHeroDamage: number; // avg damageToLoser over decisive combats
}

function endEvent(log: CombatEvent[]): Extract<CombatEvent, { t: 'combatEnd' }> | undefined {
  for (let i = log.length - 1; i >= 0; i--) if (log[i].t === 'combatEnd') return log[i] as any;
  return undefined;
}

/** Survivor stat sum for the winning side, read from the last snapshot-equivalent (summed stats
 *  events are lossy, so we recount from the final board via the combatEnd survivors + a re-read). */
function survivorStats(log: CombatEvent[], survivors: string[]): number {
  // Track latest known atk/hp per uid from combatStart + stats events.
  const atk = new Map<string, number>();
  const hp = new Map<string, number>();
  for (const e of log) {
    if (e.t === 'combatStart') {
      for (const u of e.a.units) {
        atk.set(u.uid, u.atk);
        hp.set(u.uid, u.hp);
      }
      for (const u of e.b.units) {
        atk.set(u.uid, u.atk);
        hp.set(u.uid, u.hp);
      }
    } else if (e.t === 'stats') {
      atk.set(e.unitId, e.atk);
      hp.set(e.unitId, e.hp);
    }
  }
  let sum = 0;
  for (const uid of survivors) sum += (atk.get(uid) ?? 0) + (hp.get(uid) ?? 0);
  return sum;
}

export function runMicro(boardA: CombatBoard, boardB: CombatBoard, seeds: number, seedBase = 'micro'): MicroResult {
  let aWins = 0;
  let bWins = 0;
  let ties = 0;
  let survivorUnits = 0;
  let survivorStatSum = 0;
  let heroDamage = 0;
  let decisive = 0;
  for (let i = 0; i < seeds; i++) {
    const log = resolveCombat(boardA, boardB, `${seedBase}:${i}`);
    const end = endEvent(log);
    if (!end) {
      ties++;
      continue;
    }
    if (end.winner === 'a') aWins++;
    else if (end.winner === 'b') bWins++;
    else ties++;
    if (end.winner !== 'tie') {
      decisive++;
      survivorUnits += end.survivors.length;
      survivorStatSum += survivorStats(log, end.survivors);
      heroDamage += end.damageToLoser;
    }
  }
  return {
    seeds,
    aWins,
    bWins,
    ties,
    aWinPct: aWins / seeds,
    bWinPct: bWins / seeds,
    tiePct: ties / seeds,
    avgSurvivors: decisive ? survivorUnits / decisive : 0,
    avgSurvivorStats: decisive ? survivorStatSum / decisive : 0,
    avgHeroDamage: decisive ? heroDamage / decisive : 0,
  };
}

function fmtPct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

// ── CLI ────────────────────────────────────────────────────────────────────────────────────
function parseSeeds(argv: string[]): number {
  const i = argv.indexOf('--seeds');
  if (i >= 0 && argv[i + 1]) return Math.max(1, Number(argv[i + 1]) || 200);
  return 200;
}

function main(): void {
  const seeds = parseSeeds(process.argv.slice(2));
  // Demo matchup: a heavily-doubled Tusker carry (18 shop turns of PURCHASED doubles, #39)
  // vs a saturated poison board. The carry is enormous, yet poison ignores stat size (P1).
  const doubler = assembleGrown(
    ['tuskers_ivorytusk', 'tuskers_gemsnout', 'tuskers_tuskhoarder', 'tuskers_grubtusk'],
    18,
  );
  const poison = buildBoard([
    { cardId: 'sirens_lurefish', count: 2 },
    { cardId: 'sirens_venomsong' },
    { cardId: 'sirens_tempestsinger' },
    { cardId: 'reefkin_spinefish' },
    { cardId: 'sirens_maelstromcantor' },
  ]);

  const doublerAtk = doubler.units.find((u) => u.cardId === 'tuskers_ivorytusk');
  console.log('=== sim:micro ===');
  console.log(`seeds: ${seeds}`);
  console.log(`A = tusk-doubler (18 turns, purchased doubles): Ivorytusk grew to ${doublerAtk?.atk}/${doublerAtk?.hp}, ${doubler.units.length} units`);
  console.log(`B = saturated poison: ${poison.units.length} units`);
  const res = runMicro(doubler, poison, seeds, 'micro-demo');
  console.log('');
  console.log(`A win: ${fmtPct(res.aWinPct)}   B win: ${fmtPct(res.bWinPct)}   tie: ${fmtPct(res.tiePct)}`);
  console.log(`avg surviving units (winner): ${res.avgSurvivors.toFixed(2)}`);
  console.log(`avg surviving stat total (winner): ${res.avgSurvivorStats.toFixed(1)}`);
  console.log(`avg hero damage: ${res.avgHeroDamage.toFixed(2)}`);
  console.log('');
  console.log(`Reproducible: same (boards, seed) → identical log (combat is pure).`);
}

// tsx runs this file directly.
if (import.meta.url === `file://${process.argv[1]}`) main();
