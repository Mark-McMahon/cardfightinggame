import {
  resolveCombat,
  summarizeCombat,
  createInstance,
  toCombatUnit,
  resetUidCounter,
  type CombatBoard,
  type CombatUnit,
  type Keyword,
} from '@cardgame/shared';
import { heading, mean, pct, bar, writeJSON, color } from './report';

// Micro (combat) simulator (spec §11.2): two fixed boards × N seeds → win/tie/loss%.
// Because combat is a pure seeded function the results are exactly reproducible.

interface UnitSpec {
  cardId: string;
  atk?: number;
  hp?: number;
  keywords?: Keyword[];
  golden?: boolean;
}

let n = 0;
function build(specs: UnitSpec[], playerTier: number): CombatBoard {
  const units: CombatUnit[] = specs.map((s) => {
    const inst = createInstance(s.cardId, { uid: `m${n++}`, golden: s.golden });
    const cu = toCombatUnit(inst);
    if (s.atk !== undefined) cu.atk = s.atk;
    if (s.hp !== undefined) cu.hp = s.hp;
    if (s.keywords) cu.keywords = [...s.keywords];
    return cu;
  });
  return { units, playerTier };
}

interface Scenario {
  name: string;
  a: () => CombatBoard;
  b: () => CombatBoard;
}

const scenarios: Scenario[] = [
  {
    name: 'Wide Wildkin swarm  vs  Tall Revenant carry',
    a: () =>
      build(
        [
          { cardId: 'wildkin_motherthorn', atk: 5, hp: 7 },
          { cardId: 'wildkin_thornpup', atk: 3, hp: 3 },
          { cardId: 'wildkin_thornpup', atk: 3, hp: 3 },
          { cardId: 'wildkin_thornpup', atk: 3, hp: 3 },
          { cardId: 'wildkin_gorehide', atk: 4, hp: 4 },
          { cardId: 'wildkin_thornpup', atk: 3, hp: 3 },
          { cardId: 'wildkin_thornpup', atk: 3, hp: 3 },
        ],
        4,
      ),
    b: () =>
      build(
        [
          { cardId: 'revenants_boncolossus' },
          { cardId: 'revenants_palelich' },
          { cardId: 'revenants_cryptling' },
          { cardId: 'revenants_dirgecaller' },
        ],
        4,
      ),
  },
  {
    name: 'Wide poison board    vs  Tall stat board',
    a: () =>
      build(
        [
          { cardId: 'reefkin_pearlguard' },
          { cardId: 'reefkin_spinefish', atk: 1, hp: 2 },
          { cardId: 'reefkin_spinefish', atk: 1, hp: 2 },
          { cardId: 'reefkin_spinefish', atk: 1, hp: 2 },
          { cardId: 'reefkin_spinefish', atk: 1, hp: 2 },
          { cardId: 'reefkin_spinefish', atk: 1, hp: 2 },
          { cardId: 'reefkin_coralwarden' },
        ],
        4,
      ),
    b: () =>
      build(
        [
          { cardId: 'wildkin_thornbeast' },
          { cardId: 'revenants_boncolossus' },
          { cardId: 'reefkin_leviathan' },
        ],
        4,
      ),
  },
  {
    name: 'Cleave finisher      vs  Clustered tokens',
    a: () => build([{ cardId: 'wildkin_thornbeast', atk: 8, hp: 10 }], 5),
    b: () =>
      build(
        [
          { cardId: 'wildkin_thornpup', atk: 2, hp: 4 },
          { cardId: 'wildkin_thornpup', atk: 2, hp: 4 },
          { cardId: 'wildkin_thornpup', atk: 2, hp: 4 },
          { cardId: 'wildkin_thornpup', atk: 2, hp: 4 },
          { cardId: 'wildkin_thornpup', atk: 2, hp: 4 },
        ],
        3,
      ),
  },
  {
    name: 'Tier-5 mirror        (variance check)',
    a: () => build([{ cardId: 'reefkin_tideprophet' }, { cardId: 'wildkin_thornbeast' }, { cardId: 'revenants_palelich' }], 5),
    b: () => build([{ cardId: 'reefkin_tideprophet' }, { cardId: 'wildkin_thornbeast' }, { cardId: 'revenants_palelich' }], 5),
  },
];

function runScenario(s: Scenario, seeds: number) {
  let aWin = 0;
  let bWin = 0;
  let tie = 0;
  const dmgs: number[] = [];
  const survivors: number[] = [];
  let stale = 0;

  for (let i = 0; i < seeds; i++) {
    resetUidCounter();
    n = 0;
    const events = resolveCombat(s.a(), s.b(), `micro|${s.name}|${i}`);
    const out = summarizeCombat(events);
    if (out.winner === 'a') aWin++;
    else if (out.winner === 'b') bWin++;
    else tie++;
    dmgs.push(out.damageToLoser);
    survivors.push(out.survivors.length);
    if (out.steps >= 399) stale++;
  }
  return { aWin, bWin, tie, avgDmg: mean(dmgs), avgSurv: mean(survivors), stale, seeds };
}

function main() {
  const seedsArg = process.argv.find((a) => a.startsWith('--seeds='));
  const seeds = seedsArg ? parseInt(seedsArg.split('=')[1], 10) : 2000;

  heading(`Micro simulator — ${seeds} seeds per matchup`);
  const out: Record<string, unknown>[] = [];
  for (const s of scenarios) {
    const r = runScenario(s, seeds);
    const aFrac = r.aWin / seeds;
    const flag =
      r.stale > seeds * 0.05
        ? `${color.yellow}⚠ stale combats${color.reset}`
        : r.tie > seeds * 0.5
          ? `${color.yellow}⚠ tie-heavy${color.reset}`
          : '';
    console.log(`\n${color.bold}${s.name}${color.reset}`);
    console.log(
      `  A ${bar(aFrac)} ${pct(r.aWin, seeds)}   ` +
        `B ${pct(r.bWin, seeds)}   tie ${pct(r.tie, seeds)}   ` +
        `${color.dim}avgDmg ${r.avgDmg.toFixed(1)} · avgSurv ${r.avgSurv.toFixed(1)}${color.reset} ${flag}`,
    );
    out.push({ scenario: s.name, ...r });
  }
  const path = writeJSON('micro.json', out);
  console.log(`\n${color.dim}→ wrote ${path}${color.reset}`);
}

main();
