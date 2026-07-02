// The Web (spec §16, WEB-FRAMEWORK) — the board-level anti-degeneracy arena. Layer 2 of the
// two-layer discipline: board OUTCOMES are EXPLORED, never pinned. The only thing asserted is the
// FLOOR (EV-BAL-F): no line wins regardless of the opposing tech — no universal winner, and every
// board has a reachable counter. Each committed scaling line must beat a low-tech baseline AND lose
// to ≥1 tech board (context-sensitivity).
//
// Per §16, the six new build-arounds + Nullforge are wired into the COMMITTED rosters (not left to
// the bot-generated pool). Boards whose power comes from the shop path (the Tusker doubler, swarm
// tokens) are grown through the REAL endOfTurnPhase (`assembleGrown`); boards whose payoff fires
// live in combat (start-of-combat, deathrattle, avenge, reborn) are built from their printed cards
// and the engine fires the payoffs during resolveCombat.

import { resolveCombat, type CombatBoard, type CombatEvent } from '@cardgame/shared';
import { buildBoard, assembleGrown } from './boards';

export type Role = 'scaling' | 'tech' | 'baseline';

export interface WebNode {
  name: string;
  role: Role;
  board: CombatBoard;
  note: string;
}

// ── committed rosters ────────────────────────────────────────────────────────────────────────

function scalingNodes(): WebNode[] {
  return [
    {
      name: 'tusk-exponential',
      role: 'scaling',
      // #39 rework: doubles are PURCHASED (escalating shared cost), so the same ×2^6 carry now
      // takes 18 turns of 3-gems/turn income (cumulative price 4+6+…+14 = 54 gems) instead of 6
      // free end-of-turn fires — the committed all-in line, engine-grown, nothing stat-tuned.
      note: 'Ivorytusk with 6 PURCHASED doubles (×2^6, 18 turns of gem income) + 3 generators — the exponential carry.',
      board: assembleGrown(['tuskers_ivorytusk', 'tuskers_gemsnout', 'tuskers_tuskhoarder', 'tuskers_grubtusk'], 18),
    },
    {
      name: 'tusk-spoils-sell', // Tuskmonger build-around (§16 Pattern B) feeding the doubler
      role: 'scaling',
      note: 'Ivorylord with 5 PURCHASED doubles (15 turns of gem income) + Tuskmonger + generators — sell-fueled spoils line.',
      board: assembleGrown(['tuskers_ivorylord', 'tuskers_tuskmonger', 'tuskers_gemsnout', 'tuskers_tuskhoarder', 'tuskers_grubtusk'], 15),
    },
    {
      name: 'swarm-wide',
      role: 'scaling',
      note: 'Brambleling+Grovelord token engine grown 3 turns + Pack Mother avenge + Gorehide floor.',
      board: assembleGrown(['wildkin_grovelord', 'wildkin_brambleling', 'wildkin_packmother', 'wildkin_gorehide'], 3),
    },
    {
      name: 'deaths-revenants',
      role: 'scaling',
      // Phase 4: Last Rites Drummer (adjacentAllies deathrattle → Reborn) exercised live between carries.
      note: 'Reborn/death payoffs; Pale Lich amp + Mortarch + Last Rites Drummer (adjacency Reborn) fire live.',
      board: buildBoard([
        { cardId: 'revenants_cryptling' },
        { cardId: 'revenants_lastrites' },
        { cardId: 'revenants_tombspawn' },
        { cardId: 'revenants_mortarch' },
        { cardId: 'revenants_palelich' },
        { cardId: 'revenants_boncolossus' },
        { cardId: 'revenants_dirgecaller' },
      ]),
    },
    {
      name: 'battlecry-reef', // Tidebinder build-around (§16 Pattern A) committed
      role: 'scaling',
      note: 'Reefkin tempo carry (Deepsinger-megabuffed) + Tidebinder + Chorus Tide; a tall battlecry board.',
      board: buildBoard([
        { cardId: 'reefkin_tideprophet', atk: 18, hp: 18 }, // realized megabuff carry (shop-path outcome)
        { cardId: 'reefkin_tidebinder' },
        { cardId: 'reefkin_chorustide' },
        { cardId: 'reefkin_coralwarden' },
        { cardId: 'reefkin_pearlguard' },
      ]),
    },
    {
      name: 'infernal-sacrifice', // Carrion Sovereign build-around (§16 Pattern A) committed
      role: 'scaling',
      note: 'Sacrificers manufacture deaths at start of combat → Bloodcaller/Carrion Sovereign fire live.',
      board: buildBoard([
        { cardId: 'infernals_hollowpriest' },
        { cardId: 'infernals_pyrewalker' },
        { cardId: 'infernals_bloodcaller' },
        { cardId: 'infernals_dreadmaw' },
        { cardId: 'infernals_carrionsovereign' },
        { cardId: 'infernals_gravebrand', count: 2 },
      ]),
    },
    {
      name: 'construct-redeploy', // Aegis Prime build-around (§16 Pattern A) committed
      role: 'scaling',
      note: 'Die-and-rebuild loop; Foundry/Titanforge/Aegis Prime reassemble Sentinels live.',
      board: buildBoard([
        { cardId: 'constructs_cogling', count: 2 },
        { cardId: 'constructs_reclaimer' },
        { cardId: 'constructs_foundry' },
        { cardId: 'constructs_titanforge' },
        { cardId: 'constructs_aegisprime' },
      ]),
    },
    {
      name: 'corsair-aggro', // Quartermaster build-around (§16 Pattern B) committed
      role: 'scaling',
      // Phase 4: Vanguard Pennant (leftmost +2 attack) exercised live on the wide front body.
      note: 'Wide reborn/shield tempo; Reaver (≥5)/Marauder (≥6) arm the wide board live; Pennant buffs the front.',
      board: buildBoard([
        { cardId: 'corsairs_swab' },
        { cardId: 'corsairs_pennant' },
        { cardId: 'corsairs_cutthroat' },
        { cardId: 'corsairs_reaver' },
        { cardId: 'corsairs_marauder' },
        { cardId: 'corsairs_quartermaster' },
        { cardId: 'corsairs_dreadnought' },
      ]),
    },
    {
      name: 'primordial-cleave',
      role: 'scaling',
      // Phase 4 gate-spread (decision #48): Tempest now arms at alliesAtStart≥6 and Worldspark at ≥7,
      // so the committed cleave line goes FULL-BOARD (7) to reach both — the wider board its payoffs now want.
      note: 'Full-board cleavers; Tempest (≥6) arms + Worldspark (≥7) spreads cleave live on a 7-wide board.',
      board: buildBoard([
        { cardId: 'primordials_gustling', count: 2 },
        { cardId: 'primordials_cinderwing' },
        { cardId: 'primordials_tempest' },
        { cardId: 'primordials_thunderhead' },
        { cardId: 'primordials_sparkling' },
        { cardId: 'primordials_worldspark' },
      ]),
    },
  ];
}

function techNodes(): WebNode[] {
  return [
    {
      name: 'poison-saturated',
      role: 'tech',
      note: 'A saturated poison package (2 tribes) — kills any stat size (P1); the answer to tall/doubler.',
      board: buildBoard([
        { cardId: 'sirens_lurefish', count: 2 },
        { cardId: 'sirens_venomsong' },
        { cardId: 'sirens_tempestsinger' },
        { cardId: 'sirens_maelstromcantor' },
        { cardId: 'reefkin_spinefish' },
        { cardId: 'sirens_sirenling' },
      ]),
    },
    {
      name: 'cleave-wide',
      role: 'tech',
      note: 'Wide cleavers — mow swarm/shield width; strip shields.',
      board: buildBoard([
        { cardId: 'primordials_cinderwing', count: 2 },
        { cardId: 'primordials_thunderhead' },
        { cardId: 'primordials_worldspark' },
        { cardId: 'tuskers_gemtitan' },
        { cardId: 'primordials_gustling', count: 2 },
      ]),
    },
    {
      name: 'shield-wall',
      role: 'tech',
      note: 'A wide divine-shield taunt wall — divine shield negates the first poison instance (P2).',
      board: buildBoard([
        { cardId: 'corsairs_ironclad', count: 2 },
        { cardId: 'constructs_bulwark' },
        { cardId: 'corsairs_stormrider' },
        { cardId: 'corsairs_seaqueen' },
        { cardId: 'reefkin_pearlguard' },
        { cardId: 'corsairs_ironclad' },
      ]),
    },
    {
      name: 'tall-titan',
      role: 'tech',
      note: 'A few gigantic taunt bodies — one-shot any single attacker, soak wide chip (counter to width).',
      board: buildBoard([
        { cardId: 'tuskers_gemtitan', atk: 40, hp: 40 },
        { cardId: 'tuskers_warhoard', atk: 34, hp: 34 },
        { cardId: 'constructs_sentinel', atk: 30, hp: 30 },
      ]),
    },
    {
      name: 'nullforge-tech',
      role: 'tech',
      note: 'Nullforge strips the enemy biggest body to printed stats (anti-tall/doubler) + shielded bodies.',
      board: buildBoard([
        { cardId: 'constructs_nullforge' },
        { cardId: 'constructs_nullforge' },
        { cardId: 'constructs_bulwark' },
        { cardId: 'corsairs_ironclad' },
        { cardId: 'constructs_titanforge' },
      ]),
    },
  ];
}

function baselineNodes(): WebNode[] {
  return [
    {
      name: 'vanilla-wide',
      role: 'baseline',
      note: 'Seven low-tech bodies — a developed board with no engine.',
      board: buildBoard([
        { cardId: 'corsairs_deckhand', count: 2 },
        { cardId: 'primordials_sparkling', count: 2 },
        { cardId: 'primordials_tideling', count: 2 },
        { cardId: 'reefkin_brineling' },
      ]),
    },
    {
      name: 'vanilla-few',
      role: 'baseline',
      note: 'A thin low-tech board — the genuine floor.',
      board: buildBoard([{ cardId: 'corsairs_deckhand' }, { cardId: 'primordials_tideling' }, { cardId: 'reefkin_brineling' }]),
    },
  ];
}

export function webPanel(): WebNode[] {
  return [...scalingNodes(), ...techNodes(), ...baselineNodes()];
}

// ── matchup analysis (pure, deterministic) ──────────────────────────────────────────────────────

function endWinner(log: CombatEvent[]): 'a' | 'b' | 'tie' {
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if (e.t === 'combatEnd') return e.winner;
  }
  return 'tie';
}

export interface Matchup {
  aWin: number;
  bWin: number;
  tie: number;
  seeds: number;
  aWinRate: number; // A's win share of decisive results (ties excluded from the denominator)
}

/** A vs B over N seeds, run in BOTH orientations to cancel the side-A-first bias (D2). */
export function runMatchup(a: CombatBoard, b: CombatBoard, seeds: number, seedBase = 'web'): Matchup {
  let aWin = 0;
  let bWin = 0;
  let tie = 0;
  for (let i = 0; i < seeds; i++) {
    const w1 = endWinner(resolveCombat(a, b, `${seedBase}:ab:${i}`));
    if (w1 === 'a') aWin++;
    else if (w1 === 'b') bWin++;
    else tie++;
    const w2 = endWinner(resolveCombat(b, a, `${seedBase}:ba:${i}`)); // A is now side b
    if (w2 === 'b') aWin++;
    else if (w2 === 'a') bWin++;
    else tie++;
  }
  const decisive = aWin + bWin;
  return { aWin, bWin, tie, seeds: seeds * 2, aWinRate: decisive > 0 ? aWin / decisive : 0.5 };
}

const BEAT_MARGIN = 0.5; // strictly-more decisive wins

export function beats(a: CombatBoard, b: CombatBoard, seeds: number): boolean {
  return runMatchup(a, b, seeds).aWinRate > BEAT_MARGIN;
}

export interface CrossTable {
  nodes: WebNode[];
  /** winRate[i][j] = node i's win share vs node j. */
  winRate: number[][];
  seeds: number;
}

export function crossTable(nodes: WebNode[], seeds: number): CrossTable {
  const n = nodes.length;
  const winRate: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0.5));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      if (j < i) {
        winRate[i][j] = 1 - winRate[j][i]; // reuse the symmetric run (ties → both 0.5)
        continue;
      }
      const m = runMatchup(nodes[i].board, nodes[j].board, seeds, `web:${i}:${j}`);
      winRate[i][j] = m.aWinRate;
    }
  }
  return { nodes, winRate, seeds };
}

/** Boards that beat EVERY other board — must be empty for the floor to hold. */
export function universalWinners(ct: CrossTable): string[] {
  const out: string[] = [];
  for (let i = 0; i < ct.nodes.length; i++) {
    let beatsAll = true;
    for (let j = 0; j < ct.nodes.length; j++) {
      if (i === j) continue;
      if (ct.winRate[i][j] <= BEAT_MARGIN) {
        beatsAll = false;
        break;
      }
    }
    if (beatsAll) out.push(ct.nodes[i].name);
  }
  return out;
}

/** Names of nodes that counter node i (beat it). */
export function countersOf(ct: CrossTable, i: number): string[] {
  const out: string[] = [];
  for (let j = 0; j < ct.nodes.length; j++) {
    if (i === j) continue;
    if (ct.winRate[j][i] > BEAT_MARGIN) out.push(ct.nodes[j].name);
  }
  return out;
}

/** Boards with NO counter in the panel — must be empty for the floor to hold. */
export function uncounteredBoards(ct: CrossTable): string[] {
  const out: string[] = [];
  for (let i = 0; i < ct.nodes.length; i++) {
    if (countersOf(ct, i).length === 0) out.push(ct.nodes[i].name);
  }
  return out;
}

export interface FloorResult {
  ok: boolean;
  universalWinners: string[];
  uncounteredBoards: string[];
  contextInsensitive: string[]; // scaling lines that don't (beat a baseline AND lose to a tech)
}

export function evaluateFloor(seeds: number): FloorResult {
  const nodes = webPanel();
  const ct = crossTable(nodes, seeds);
  const uw = universalWinners(ct);
  const uc = uncounteredBoards(ct);
  const idx = new Map(nodes.map((n, i) => [n.name, i]));
  const techIdx = nodes.map((n, i) => ({ n, i })).filter((x) => x.n.role === 'tech');
  const baseIdx = nodes.map((n, i) => ({ n, i })).filter((x) => x.n.role === 'baseline');

  const contextInsensitive: string[] = [];
  for (const node of nodes) {
    if (node.role !== 'scaling') continue;
    const i = idx.get(node.name)!;
    const beatsABaseline = baseIdx.some((b) => ct.winRate[i][b.i] > BEAT_MARGIN);
    const losesToATech = techIdx.some((t) => ct.winRate[t.i][i] > BEAT_MARGIN);
    if (!beatsABaseline || !losesToATech) contextInsensitive.push(node.name);
  }
  return {
    ok: uw.length === 0 && uc.length === 0 && contextInsensitive.length === 0,
    universalWinners: uw,
    uncounteredBoards: uc,
    contextInsensitive,
  };
}
