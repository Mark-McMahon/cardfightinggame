// Declarative effect resolver primitives (spec §6.2–6.3, §6.8, §6.9).
//
// This module owns the phase-agnostic parts of the DSL: selectors (WHO), conditions (GATE),
// and the stat-clamp math for the actions (WHAT). The phase-specific action *application*
// (mutating combat fighters vs shop instances, emitting events) lives in combat.ts / shop.ts,
// which drive these helpers. Keeping WHO/GATE/math here means both phases resolve targeting
// and clamps identically (the §6.8 code-only semantics that no data row states).

import type { ConditionSpec, Keyword, TargetSpec, TribeId } from '../types';
import { engines } from '../config';
import type { Rng } from './rng';

/** The minimal shape a selector needs. Both combat Fighters and enriched shop instances satisfy it. */
export interface Targetable {
  uid: string;
  cardId: string;
  atk: number;
  hp: number;
  tribe: TribeId;
  keywords: Keyword[];
  bornTurn?: number;
}

export interface SelectContext<T extends Targetable> {
  source: T;
  /** For `triggerSource` (e.g. onSummon's summoned unit); defaults to source. */
  triggerSource?: T;
  /** Living allies in board order (left→right). */
  allies: T[];
  /** Living enemies in board order (combat only; empty in shop). */
  enemies: T[];
  /**
   * Phase 4 (§6.3, §7.3): pre-computed board-index ±1 neighbor uids of the source for the positional
   * `adjacentAllies` selector. Combat supplies it (it knows the settled board + the source's slot,
   * incl. the D1 deathrattle case where the source is already removed); the shop has no positional
   * deathrattle so it stays undefined → `adjacentAllies` resolves to nothing there.
   */
  adjacentUids?: string[];
  rng: Rng;
}

function applyFilters<T extends Targetable>(pool: T[], spec: TargetSpec, source: T): T[] {
  let out = pool;
  if (spec.excludeSelf) out = out.filter((u) => u.uid !== source.uid);
  if (spec.filterTribe) out = out.filter((u) => u.tribe === spec.filterTribe);
  if (spec.filterKeyword) out = out.filter((u) => u.keywords.includes(spec.filterKeyword!));
  return out;
}

/** Pick the extreme unit by `stat` (default hp); ties → earliest board slot (§6.8). */
function pickExtreme<T extends Targetable>(pool: T[], stat: 'atk' | 'hp', highest: boolean): T | undefined {
  let best: T | undefined;
  let bestVal = 0;
  for (const u of pool) {
    const v = stat === 'atk' ? u.atk : u.hp;
    if (best === undefined || (highest ? v > bestVal : v < bestVal)) {
      // strict comparison keeps the EARLIEST slot on a tie (pool is in board order).
      best = u;
      bestVal = v;
    }
  }
  return best;
}

/**
 * Resolve a target spec to concrete units. `chosenAlly` is resolved by the player in the shop
 * (§7.4) — here it yields nothing; callers list its candidates via `chosenAllyCandidates`.
 */
export function selectTargets<T extends Targetable>(spec: TargetSpec, ctx: SelectContext<T>): T[] {
  const { source, allies, enemies, rng } = ctx;
  const triggerSource = ctx.triggerSource ?? source;
  const count = spec.count ?? 1;
  const stat = spec.stat ?? 'hp';

  switch (spec.selector) {
    case 'self':
      return [source];
    case 'triggerSource':
      return triggerSource ? [triggerSource] : [];
    case 'allAllies':
      return applyFilters(allies, spec, source);
    case 'randomAlly':
      return rng.shuffle(applyFilters(allies, spec, source)).slice(0, count);
    case 'nAllies': // [reserved] — same draw method as randomAlly
      return rng.shuffle(applyFilters(allies, spec, source)).slice(0, count);
    case 'highestStatAlly': {
      const u = pickExtreme(applyFilters(allies, spec, source), stat, true);
      return u ? [u] : [];
    }
    case 'lowestStatAlly': {
      const u = pickExtreme(applyFilters(allies, spec, source), stat, false);
      return u ? [u] : [];
    }
    case 'newestAlly': {
      // [reserved] highest bornTurn, tie → latest slot
      const pool = applyFilters(allies, spec, source);
      return pool.length ? [pool.reduce((a, b) => ((b.bornTurn ?? 0) >= (a.bornTurn ?? 0) ? b : a))] : [];
    }
    case 'oldestAlly': {
      // [reserved] lowest bornTurn, tie → earliest slot
      const pool = applyFilters(allies, spec, source);
      return pool.length ? [pool.reduce((a, b) => ((b.bornTurn ?? 0) < (a.bornTurn ?? 0) ? b : a))] : [];
    }
    case 'chosenAlly':
      // Resolved during the shop phase (player pick). No combat consumer.
      return [];
    case 'leftmostAlly': {
      // POSITIONAL board-index-0 friendly (§6.4). `allies` is already in board order (left→right),
      // so the first filtered entry is the leftmost — distinct from bornTurn `oldestAlly`.
      const pool = applyFilters(allies, spec, source);
      return pool.length ? [pool[0]] : [];
    }
    case 'frontEnemy':
      return enemies.length ? [enemies[0]] : [];
    case 'randomEnemy': // [reserved]
      return rng.shuffle(applyFilters(enemies, spec, source)).slice(0, count);
    case 'highestStatEnemy': {
      const u = pickExtreme(applyFilters(enemies, spec, source), stat, true);
      return u ? [u] : [];
    }
    case 'adjacentAllies': {
      // POSITIONAL board-index ±1 friendlies of the source (Phase 4, §6.3/§7.3, Last Rites Drummer).
      // The caller pre-computes the neighbor uids (it owns board position, incl. the D1 deathrattle
      // case where the source is already removed); we filter `allies` to that set, then apply filters.
      const set = new Set(ctx.adjacentUids ?? []);
      return applyFilters(allies.filter((u) => set.has(u.uid)), spec, source);
    }
    case 'leftNeighbor':
    case 'rightNeighbor':
    case 'neighborsOfTarget':
      // [reserved] — cleave neighbors are computed directly in combat, not via a selector.
      return [];
    default:
      return [];
  }
}

/** Candidate list for a player-targeted (`chosenAlly`) battlecry in the shop (§7.4, EV-ECO-11). */
export function chosenAllyCandidates<T extends Targetable>(spec: TargetSpec, source: T, allies: T[]): T[] {
  return applyFilters(allies, spec, source);
}

// ── Conditions (GATE) ────────────────────────────────────────────────────────

/** Phase-scoped counters. The caller populates ONLY the ones its phase owns (§6.3):
 *  combat → deathsThisCombat (+ countAllies at start); shop → battlecries/tokens/gems (+ countAllies). */
export interface ConditionCounts {
  countAllies?: number;
  gemsThisTurn?: number;
  battlecriesThisTurn?: number;
  tokensThisTurn?: number;
  deathsThisCombat?: number;
  /** Phase 3: the controller's persistent friendly-death total (combat carries it in on the
   *  CombatBoard snapshot; shop reads the live session counter). */
  lifetimeDeaths?: number;
}

/** Evaluate an optional condition. Missing/unknown → true; wrong-phase counter reads 0 (§6.3). */
export function evaluateCondition(cond: ConditionSpec | undefined, counts: ConditionCounts): boolean {
  if (!cond) return true;
  const v = cond.value ?? 0;
  switch (cond.kind) {
    case 'countAllies':
      return (counts.countAllies ?? 0) >= v;
    case 'gemsThisTurnAtLeast':
      return (counts.gemsThisTurn ?? 0) >= v;
    case 'battlecriesThisTurnAtLeast':
      return (counts.battlecriesThisTurn ?? 0) >= v;
    case 'tokensSummonedThisTurnAtLeast':
      return (counts.tokensThisTurn ?? 0) >= v;
    case 'deathsThisCombatAtLeast':
      return (counts.deathsThisCombat ?? 0) >= v;
    case 'alliesAtMost':
      // ≤ value minions on the source's side (Phase 3 Lone Vanguard go-tall gate).
      return (counts.countAllies ?? 0) <= v;
    case 'lifetimeDeathsAtLeast':
      return (counts.lifetimeDeaths ?? 0) >= v;
    default:
      // [reserved] kinds (hasTribe/hasKeyword/goldAtLeast/tierAtLeast/isGolden/isToken):
      // no live consumer → treated as unknown → true (spec §6.3 default).
      return true;
  }
}

// ── Stat math (WHAT clamps, §6.8) ──────────────────────────────────────────────

export interface Stats {
  atk: number;
  hp: number;
}

/** buffStats / setStats result clamps: atk floored at 0, hp at 1, both rounded (§6.8). */
export function applyBuff(cur: Stats, dAtk: number, dHp: number): Stats {
  return {
    atk: Math.max(0, Math.round(cur.atk + dAtk)),
    hp: Math.max(1, Math.round(cur.hp + dHp)),
  };
}

/** multiplyStats: factor clamped to multiplyFactorCap (BOTH phases), rounded, floored, and
 *  bounded by the engineering seatbelt statSanityBound (§6.8, Tuskers). */
export function applyMultiply(cur: Stats, factor: number): Stats {
  const f = Math.min(factor, engines.tuskers.multiplyFactorCap);
  const bound = engines.tuskers.statSanityBound;
  return {
    atk: Math.min(bound, Math.max(0, Math.round(cur.atk * f))),
    hp: Math.min(bound, Math.max(1, Math.round(cur.hp * f))),
  };
}

/** The effective, capped multiply factor (for callers that need the number itself). */
export function cappedMultiplyFactor(factor: number): number {
  return Math.min(factor, engines.tuskers.multiplyFactorCap);
}
