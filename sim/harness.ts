// Simulator harness (spec §11.2). Drives full matches through the SAME engine `Match` + the
// SAME server `BotAgent` the Colyseus room uses — the sim NEVER re-implements a rule. The one
// thing the sim owns is the ROUND-LOOP DRIVER, which mirrors `server/rooms/MatchRoom.ts`:
//
//   startRound → each living seat takes its bot turn → **endOfTurnPhase(session) per living
//   seat** (KEY INTEGRATION CONTRACT: the engine's Match does NOT run end-of-shop triggers —
//   Brambleling summons, gem doublers, multiplyStats compounders fire here) → resolveCombatPhase.
//
// It also harvests, per player per game: the peak developed board, the max tier reached, and
// the set of distinct breakpoints actually HIT (shop counters read from the session; combat
// counters reconstructed from the pure CombatEvent log). Everything is deterministic in the seed.

import {
  Match,
  Rng,
  endOfTurnPhase,
  getCard,
  getBreakpoint,
  hasBreakpoint,
  hasSpendGated,
  combat as combatCfg,
  type BotWeights,
  type BreakpointCounter,
  type CombatEvent,
  type SeatConfig,
  type TribeId,
} from '@cardgame/shared';
import { BotAgent, driveBotTurn } from '@cardgame/server/bots';

export interface SeatSpec {
  name: string;
  weights: BotWeights;
}

export interface PlayerGameResult {
  seat: number;
  placement: number;
  /** cardIds of the player's most-developed board across the game (peak non-token count). */
  peakBoard: string[];
  maxTier: number;
  /** distinct PRIMARY-PAYOFF card ids assembled: breakpoint cards whose threshold was reached in
   *  some round, plus spend-gated cards (decision #39) whose ability was actually PURCHASED. */
  breakpointsHit: Set<string>;
  /** owned breakpoint card → max counter value achieved (for the non-linearity metric). */
  ownedBreakpointMaxCounter: Map<string, number>;
  /** gems left in the wallet at game end (decision #39 HOARDING diagnostic — output only). */
  unspentGems: number;
}

export interface MatchResult {
  seed: string;
  players: PlayerGameResult[];
  rounds: number;
  combats: number;
  staleCombats: number; // combats that hit maxCombatSteps (spec §11.3 stale-combat output)
}

// ── combat-log analysis (reconstruct a side's breakpoint counters from the pure log) ────────

interface SideCounters {
  startCount: number; // minions at start of combat (== engine `startCount` == alliesAtStart)
  deaths: number;
  revenantDeaths: number;
  shieldBrokenCards: Set<string>; // cardIds on this side whose own shield broke
}

function sideCounters(log: CombatEvent[], side: 'a' | 'b'): SideCounters {
  const start = log[0];
  if (!start || start.t !== 'combatStart') {
    return { startCount: 0, deaths: 0, revenantDeaths: 0, shieldBrokenCards: new Set() };
  }
  const snap = side === 'a' ? start.a : start.b;
  const uidTribe = new Map<string, TribeId>();
  const uidCard = new Map<string, string>();
  const sideUids = new Set<string>();
  for (const u of snap.units) {
    uidTribe.set(u.uid, u.tribe);
    uidCard.set(u.uid, u.cardId);
    sideUids.add(u.uid);
  }
  // Forward pass: attribute summoned units to the side of their owner; tokens inherit the
  // owner's tribe (true for every summon in the catalog — Thornpup←wildkin, Wisp←revenants,
  // Scrapling←constructs, …), so revenantDeaths stays exact.
  let deaths = 0;
  let revenantDeaths = 0;
  const shieldBrokenCards = new Set<string>();
  for (const e of log) {
    if (e.t === 'summon' && sideUids.has(e.ownerId)) {
      const ownerTribe = uidTribe.get(e.ownerId);
      for (const id of e.unitIds) {
        sideUids.add(id);
        if (ownerTribe) uidTribe.set(id, ownerTribe);
      }
    } else if (e.t === 'death' && sideUids.has(e.unitId)) {
      deaths++;
      if (uidTribe.get(e.unitId) === 'revenants') revenantDeaths++;
    } else if (e.t === 'damage' && e.shieldBroken && sideUids.has(e.targetId)) {
      const c = uidCard.get(e.targetId);
      if (c) shieldBrokenCards.add(c);
    }
  }
  return { startCount: snap.units.length, deaths, revenantDeaths, shieldBrokenCards };
}

/** A combat is "stale" if it ran to the step cap (spec §11.3): a stalemate emits ~maxCombatSteps
 *  attacks. Corrected (D1–D3) combat resolves quickly, so this should be ~0. */
export function combatHitMaxSteps(log: CombatEvent[]): boolean {
  let attacks = 0;
  for (const e of log) if (e.t === 'attack') attacks++;
  return attacks >= combatCfg.maxCombatSteps;
}

function counterValue(counter: BreakpointCounter, shop: ShopSnapshot, cc: SideCounters, cardId: string): number {
  switch (counter) {
    case 'battlecries':
      return shop.battlecries;
    case 'tokensThisTurn':
      return shop.tokens;
    case 'gemsThisTurn':
      return shop.gems;
    case 'alliesAtStart':
      return cc.startCount;
    case 'deaths':
      return cc.deaths;
    case 'revenantDeaths':
      return cc.revenantDeaths;
    case 'shieldBreak':
      return cc.shieldBrokenCards.has(cardId) ? 1 : 0;
    case 'lifetimeDeaths':
      return shop.lifetimeDeaths; // Phase 3: PERSISTENT per-player total (from the session, not the log)
    case 'boardMerges':
      return shop.boardMerges; // Phase 6: total magnetic merges across the board (from the session board state)
    case 'elementsPlayed':
      return shop.elementsPlayed; // Phase 7: PERSISTENT per-player Primordials-played total (from the session)
    default:
      return 0;
  }
}

interface ShopSnapshot {
  battlecries: number;
  tokens: number;
  gems: number;
  boardLen: number;
  board: string[]; // cardIds (post endOfTurnPhase, pre-combat)
  tier: number;
  lifetimeDeaths: number; // Phase 3: persistent friendly-death total at snapshot time
  boardMerges: number; // Phase 6: total magnetic merges across the board at snapshot time (Magnaforge)
  elementsPlayed: number; // Phase 7: persistent Primordials-played total at snapshot time (Elderstorm)
}

// ── the driver ─────────────────────────────────────────────────────────────────────────────

export function runMatch(seed: string, seats: SeatSpec[]): MatchResult {
  const seatConfigs: SeatConfig[] = seats.map((s) => ({ name: s.name, isBot: true }));
  const m = new Match(seed, seatConfigs, 'SIM');
  const agents = seats.map((s, i) => new BotAgent(s.weights, new Rng(`${seed}:bot:${i}`)));

  const per: PlayerGameResult[] = seats.map((_, seat) => ({
    seat,
    placement: 0,
    peakBoard: [],
    maxTier: 1,
    breakpointsHit: new Set<string>(),
    ownedBreakpointMaxCounter: new Map<string, number>(),
    unspentGems: 0,
  }));
  const peakCount = new Array<number>(seats.length).fill(-1);

  let combats = 0;
  let staleCombats = 0;
  let rounds = 0;
  const MAX_LOOP = 60; // hard safety bound (maxRounds=25 + margin); never reached in practice.

  while (!m.isFinished() && rounds < MAX_LOOP) {
    rounds++;
    m.startRound();

    // 1) each living seat takes its full bot turn (deterministic; same call the server makes).
    for (const p of m.state.players) {
      if (!p.alive) continue;
      driveBotTurn(
        agents[p.seat],
        () => m.privateState(p.seat),
        () => m.state,
        (intent) => m.applyIntent(p.seat, intent),
      );
    }

    // 2) KEY CONTRACT: end-of-turn triggers BEFORE combat, for every living seat.
    for (const p of m.state.players) if (p.alive) endOfTurnPhase(m.sessions[p.seat]);

    // 3) snapshot per-seat shop counters + board (post endOfTurnPhase, pre-combat).
    const shop = new Map<number, ShopSnapshot>();
    for (const p of m.state.players) {
      if (!p.alive) continue;
      const s = m.sessions[p.seat];
      shop.set(p.seat, {
        battlecries: s.battlecriesThisTurn,
        tokens: s.tokensThisTurn,
        gems: s.gemsThisTurn,
        boardLen: s.board.length,
        board: s.board.map((u) => u.cardId),
        tier: s.tier,
        lifetimeDeaths: s.lifetimeFriendlyDeaths,
        boardMerges: s.board.reduce((n, u) => n + (u.mergeCount ?? 0), 0),
        elementsPlayed: s.elementsPlayed,
      });
      // spend-gated payoffs (decision #39): a purchased activation IS an assembled primary
      // payoff — count it beside breakpoint hits (the reachability gate measures payoffs, and
      // spend-gated is the second legal payoff class, §11.3c).
      for (const [cardId, uses] of Object.entries(s.abilityUses)) {
        if (uses > 0 && hasSpendGated(cardId)) per[p.seat].breakpointsHit.add(cardId);
      }
      // Phase 5 (#54): the MAGNETIC merge tower is an assembled PRIMARY PAYOFF (a go-tall
      // consolidation body) — credit it toward the reachability gate exactly as #39 credits a
      // PURCHASED spend-gated ability. A splash that assembled a merged tower HAS reached a primary
      // payoff. Synthetic id (not a catalog card) so it never collides with the breakpoints.list ⭐
      // registry. FLAGGED for final-validation ratification (#58): this metric extension landed with
      // the same content it helps validate, so a human must ratify the merge tower as a legitimate
      // primary payoff — it clears empirically (116/1600 player-games on the canonical `run` seed,
      // per-unit cap=5 reached), matching the #39 spend-gated precedent, so it is a payoff-CLASS
      // extension, not a goalpost move.
      //
      // The Forgemaster Sentinel-stack (#55) is DELIBERATELY NOT credited here. Measured through the
      // real Match+BotAgent it fires in only ~1/1600 macro player-games (bots buy the 3/5 body, but
      // its no-payoff-bump valuation — kept small on purpose so it can't crowd real breakpoints off
      // splash builds, #57 — leaves it benched and later sold, never developed to board). A credit
      // would be VACUOUS: removing it moved the gate 0.00pp (52.59% either way on the `run` seed). Its
      // combat scalar (`forgemastersPlayed` → Sentinel buff) is instead PINNED by the determinism +
      // property evals (EV-FRG-01..03, EV-GLD-16); the macro-sim non-coverage is a DOCUMENTED gap
      // (#58, design-spec §11.2), NOT number-tuned away — matching the #47(b) Cindermarshal precedent.
      if (s.board.some((u) => (u.mergeCount ?? 0) > 0)) per[p.seat].breakpointsHit.add('constructs_magnetic_merge');
      // track peak developed board + max tier
      const rec = per[p.seat];
      rec.maxTier = Math.max(rec.maxTier, s.tier);
      const nonTok = s.board.reduce((n, u) => n + (getCard(u.cardId).isToken ? 0 : 1), 0);
      if (nonTok > peakCount[p.seat]) {
        peakCount[p.seat] = nonTok;
        rec.peakBoard = s.board.map((u) => u.cardId);
      }
    }

    // 4) resolve all combats (pure), then analyze each side's breakpoint hits from the log.
    m.resolveCombatPhase();

    for (const pr of m.state.pairings) {
      const log = m.sessions[pr.aSeat].lastCombatLog;
      if (log) {
        combats++;
        if (combatHitMaxSteps(log)) staleCombats++;
      }
      analyzeSeat(pr.aSeat, 'a', log, shop.get(pr.aSeat), per);
      if (!pr.ghost && pr.bSeat >= 0) analyzeSeat(pr.bSeat, 'b', log, shop.get(pr.bSeat), per);
    }
  }

  for (const p of m.state.players) {
    per[p.seat].placement = p.placement;
    per[p.seat].unspentGems = m.sessions[p.seat].gems; // #39 hoarding diagnostic (wallet at game end)
  }
  return { seed, players: per, rounds, combats, staleCombats };
}

function analyzeSeat(
  seat: number,
  side: 'a' | 'b',
  log: CombatEvent[] | null,
  shop: ShopSnapshot | undefined,
  per: PlayerGameResult[],
): void {
  if (!shop) return;
  const rec = per[seat];
  const cc: SideCounters = log
    ? sideCounters(log, side)
    : { startCount: shop.boardLen, deaths: 0, revenantDeaths: 0, shieldBrokenCards: new Set() };
  for (const cardId of shop.board) {
    if (!hasBreakpoint(cardId)) continue;
    const bp = getBreakpoint(cardId);
    const val = counterValue(bp.counter, shop, cc, cardId);
    const prev = rec.ownedBreakpointMaxCounter.get(cardId) ?? 0;
    if (val > prev) rec.ownedBreakpointMaxCounter.set(cardId, val);
    if (val >= bp.threshold) rec.breakpointsHit.add(cardId);
  }
}

// ── board classification (shared by metrics + report) ───────────────────────────────────────

export interface BoardClass {
  nonTokenCount: number;
  tribeCounts: Map<TribeId, number>;
  dominantTribe: TribeId | null;
  secondTribe: TribeId | null;
  secondTribeCount: number;
  dominantAxisShare: number; // max single-axis feed share of all axis feeds (0 if no feeds)
}

export function classifyBoard(cardIds: string[]): BoardClass {
  const tribeCounts = new Map<TribeId, number>();
  const axisFeed = new Map<string, number>();
  let nonTokenCount = 0;
  let totalFeeds = 0;
  for (const id of cardIds) {
    const card = getCard(id);
    if (card.isToken) continue;
    nonTokenCount++;
    tribeCounts.set(card.tribe, (tribeCounts.get(card.tribe) ?? 0) + 1);
    for (const ax of card.axis ?? []) {
      axisFeed.set(ax, (axisFeed.get(ax) ?? 0) + 1);
      totalFeeds++;
    }
  }
  const sortedTribes = [...tribeCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const maxAxis = Math.max(0, ...axisFeed.values());
  return {
    nonTokenCount,
    tribeCounts,
    dominantTribe: sortedTribes[0]?.[0] ?? null,
    secondTribe: sortedTribes[1]?.[0] ?? null,
    secondTribeCount: sortedTribes[1]?.[1] ?? 0,
    dominantAxisShare: totalFeeds > 0 ? maxAxis / totalFeeds : 0,
  };
}

/** Build the 8 bot seat specs (spec §11.2 "8 bot configs").
 *
 * The reachability GATE (§11.3b) measures whether a *developed, competently-played* 2-tribe
 * splash can reach two breakpoints in a normal game — so the lobby is the two COMPETENT presets
 * (`hard`: breakpointHuntTarget 3; `medium`: 2) alternating. `easy` (breakpointHuntTarget 1)
 * deliberately never assembles a second break, so an easy-heavy lobby would measure bot weakness,
 * not the design's reachability — the WEB-FRAMEWORK "curated SEAT_STYLES" intent. (An easy-inclusive
 * lobby is still available via `makeMixedSeatSpecs` for the general macro pick-rate survey.) */
export function makeSeatSpecs(presets: { easy: BotWeights; medium: BotWeights; hard: BotWeights }): SeatSpec[] {
  const order: Array<[string, BotWeights]> = [
    ['hard-0', presets.hard],
    ['medium-1', presets.medium],
    ['hard-2', presets.hard],
    ['medium-3', presets.medium],
    ['hard-4', presets.hard],
    ['medium-5', presets.medium],
    ['hard-6', presets.hard],
    ['medium-7', presets.medium],
  ];
  return order.map(([name, weights]) => ({ name, weights }));
}

/** A difficulty-mixed lobby (incl. `easy`) — for surveying pick/win rates across skill, not for
 *  the reachability gate. */
export function makeMixedSeatSpecs(presets: { easy: BotWeights; medium: BotWeights; hard: BotWeights }): SeatSpec[] {
  const order: Array<[string, BotWeights]> = [
    ['hard-0', presets.hard],
    ['medium-1', presets.medium],
    ['hard-2', presets.hard],
    ['medium-3', presets.medium],
    ['easy-4', presets.easy],
    ['hard-5', presets.hard],
    ['medium-6', presets.medium],
    ['easy-7', presets.easy],
  ];
  return order.map(([name, weights]) => ({ name, weights }));
}
