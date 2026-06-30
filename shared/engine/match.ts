import type {
  ClientUnit,
  CombatBoard,
  CombatEvent,
  Intent,
  Pairing,
  PrivateState,
  PublicPlayer,
  PublicState,
  ShopOffer,
  MatchPhase,
} from '../types';
import type { Difficulty } from '../config/bots';
import { economy } from '../config/economy';
import { match as matchCfg } from '../config/match';
import { getCard } from '../content/units';
import { Pool } from './pool';
import { RNG } from './rng';
import { resolveCombat, summarizeCombat } from './combat';
import { toClientUnit } from './instances';
import {
  autoResolvePending,
  boardToCombat,
  buyUnit,
  currentTierUpCost,
  endOfTurnPhase,
  freezeShop,
  moveUnit,
  playUnit,
  resolveDiscoverPick,
  resolveTargetChoice,
  rollShop,
  sellUnit,
  startShopPhase,
  tierUp,
  unfreezeShop,
  type OpResult,
} from './shop';
import { createPlayerState, logLine, type PlayerState } from './state';

export interface PlayerSeed {
  seat: number;
  name: string;
  isBot: boolean;
  difficulty?: Difficulty;
}

export interface CombatReport {
  pairing: Pairing;
  events: CombatEvent[];
  winnerSeat: number; // -1 for tie / ghost win with no living owner
  damage: number;
  loserSeat: number; // -1 if none
}

export interface RoundResolution {
  reports: CombatReport[];
  /** combat log each living participant should see (keyed by seat). */
  logsBySeat: Map<number, CombatEvent[]>;
  eliminated: number[]; // seats eliminated this round
  finished: boolean;
}

interface GhostSnapshot {
  name: string;
  board: CombatBoard;
}

/** A decided combat assignment for the round: who fights whom (or which ghost). The
 *  public `pairing` is the part clients may see; `ghost`/`ghostIndex` stay server-side. */
interface Matchup {
  aSeat: number;
  bSeat: number;
  ghost?: GhostSnapshot;
  ghostIndex?: number;
  pairing: Pairing;
}

export interface MatchOptions {
  matchId: string;
  players: PlayerSeed[];
  hostSeat: number;
  botFill: boolean;
  roomCode: string;
}

export class Match {
  readonly matchId: string;
  readonly roomCode: string;
  players: PlayerState[] = [];
  pool = new Pool();
  round = 0;
  phase: MatchPhase = 'lobby';
  hostSeat: number;
  botFill: boolean;
  winnerSeat = -1;
  pairings: Pairing[] = [];
  timer = 0;

  private rng: RNG;
  private ghosts: GhostSnapshot[] = [];
  private prevOpponent = new Map<number, number>();
  /** The round's combat assignments, decided at shop-phase start so the prep UI can
   *  reveal the upcoming opponent; combat reuses this same plan (spec §4.4). */
  private matchups: Matchup[] = [];

  constructor(opts: MatchOptions) {
    this.matchId = opts.matchId;
    this.roomCode = opts.roomCode;
    this.hostSeat = opts.hostSeat;
    this.botFill = opts.botFill;
    this.rng = new RNG(`${opts.matchId}|shop`);
    for (const ps of opts.players) {
      this.players.push(
        createPlayerState(ps.seat, ps.name, ps.isBot, ps.difficulty ?? 'medium', matchCfg.startingHealth),
      );
    }
  }

  get alivePlayers(): PlayerState[] {
    return this.players.filter((p) => p.alive);
  }

  player(seat: number): PlayerState | undefined {
    return this.players.find((p) => p.seat === seat);
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────
  start(): void {
    this.round = 1;
    this.beginShopPhase();
  }

  beginShopPhase(): void {
    this.phase = 'shop';
    for (const p of this.alivePlayers) {
      startShopPhase(p, this.round, this.pool, this.rng);
    }
    // One shared shop clock for the round. It scales with the *wealthiest* alive player
    // (tier + gold) so whoever has the most to do still has enough time — more gold means
    // more buys/rolls/placements to resolve. Gold was just reset to this round's income above.
    const maxTier = Math.max(1, ...this.alivePlayers.map((p) => p.tier));
    const maxGold = Math.max(0, ...this.alivePlayers.map((p) => p.gold));
    this.timer = Math.min(
      matchCfg.shopTimerCap,
      matchCfg.shopTimerBase + maxTier * matchCfg.shopTimerPerTier + maxGold * matchCfg.shopTimerPerGold,
    );
    // Decide pairings NOW, at the start of prep, and publish them so each player can see
    // who they'll fight this round — this informs level/buy decisions (spec §4.4). Combat
    // reuses this exact plan; only the live board snapshots are read at resolve time.
    this.matchups = this.computePairings();
    this.pairings = this.matchups.map((m) => m.pairing);
  }

  allReady(): boolean {
    const living = this.alivePlayers;
    return living.length > 0 && living.every((p) => p.ready);
  }

  // ── intents (spec §4.2, §9.2) ────────────────────────────────────────────────
  applyIntent(seat: number, intent: Intent): OpResult {
    if (this.phase !== 'shop') return { ok: false, error: 'Not in shop phase' };
    const p = this.player(seat);
    if (!p || !p.alive) return { ok: false, error: 'No such living player' };

    switch (intent.type) {
      case 'buy':
        return buyUnit(p, intent.shopIndex, this.pool, this.rng, this.round);
      case 'sell':
        return sellUnit(p, intent.unitUid, this.pool);
      case 'roll':
        return rollShop(p, this.pool, this.rng);
      case 'freeze':
        return freezeShop(p);
      case 'unfreeze':
        return unfreezeShop(p);
      case 'tierUp':
        return tierUp(p);
      case 'playUnit':
        return playUnit(p, intent.unitUid, intent.toSlot, this.pool, this.rng, this.round);
      case 'moveUnit':
        return moveUnit(p, intent.unitUid, intent.toSlot);
      case 'targetChoice':
        return resolveTargetChoice(p, intent.targetUid, this.round);
      case 'discoverPick':
        return resolveDiscoverPick(p, intent.optionIndex, this.pool, this.rng, this.round);
      case 'readyUp':
        p.ready = true;
        return { ok: true };
      default:
        return { ok: false, error: 'Unknown intent' };
    }
  }

  // ── combat phase (spec §4.4–4.6) ─────────────────────────────────────────────
  resolveCombatPhase(): RoundResolution {
    this.phase = 'combat';

    // Finalize each board: auto-resolve pending choices, then end-of-turn growth.
    for (const p of this.alivePlayers) {
      autoResolvePending(p, this.pool, this.rng, this.round);
      endOfTurnPhase(p, this.pool, this.rng, this.round);
    }

    // Pairings were decided and published at the start of this shop phase; reuse them so
    // combat matches exactly what each player was shown during prep (spec §4.4).
    const matchups = this.matchups;

    const reports: CombatReport[] = [];
    const logsBySeat = new Map<number, CombatEvent[]>();

    for (const m of matchups) {
      const a = this.player(m.aSeat)!;
      const boardA = boardToCombat(a);
      const boardB = m.ghost ? m.ghost.board : boardToCombat(this.player(m.bSeat)!);
      const seed = `${this.matchId}|${this.round}|${m.aSeat}vs${m.ghost ? `ghost${m.ghostIndex}` : m.bSeat}`;
      const events = resolveCombat(boardA, boardB, seed);
      const outcome = summarizeCombat(events);

      let winnerSeat = -1;
      let loserSeat = -1;
      let damage = 0;
      if (outcome.winner === 'a') {
        winnerSeat = m.aSeat;
        if (!m.ghost) {
          loserSeat = m.bSeat;
          damage = outcome.damageToLoser;
        }
      } else if (outcome.winner === 'b') {
        if (!m.ghost) winnerSeat = m.bSeat;
        loserSeat = m.aSeat;
        damage = outcome.damageToLoser;
      }

      if (loserSeat >= 0 && damage > 0) {
        const loser = this.player(loserSeat)!;
        loser.hp -= damage;
        loser.lastDamage = damage;
      }

      // record per-seat result + log
      const aResult = outcome.winner === 'a' ? 'win' : outcome.winner === 'b' ? 'loss' : 'tie';
      a.lastResult = aResult;
      a.lastCombatLog = events;
      a.lastDamage = aResult === 'loss' ? outcome.damageToLoser : 0;
      logsBySeat.set(m.aSeat, events);
      logLine(a, `Combat vs ${m.ghost ? m.ghost.name : this.player(m.bSeat)!.name}: ${aResult.toUpperCase()}`);

      if (!m.ghost) {
        const b = this.player(m.bSeat)!;
        const bResult = outcome.winner === 'b' ? 'win' : outcome.winner === 'a' ? 'loss' : 'tie';
        b.lastResult = bResult;
        b.lastCombatLog = events;
        b.lastDamage = bResult === 'loss' ? outcome.damageToLoser : 0;
        logsBySeat.set(m.bSeat, events);
        logLine(b, `Combat vs ${a.name}: ${bResult.toUpperCase()}`);
        this.prevOpponent.set(m.aSeat, m.bSeat);
        this.prevOpponent.set(m.bSeat, m.aSeat);
      }

      reports.push({ pairing: m.pairing, events, winnerSeat, damage, loserSeat });
    }

    const eliminated = this.processEliminations();
    let finished = this.alivePlayers.length <= 1;

    if (finished) {
      const survivor = this.alivePlayers[0];
      if (survivor) {
        survivor.placement = 1;
        this.winnerSeat = survivor.seat;
      }
      this.phase = 'finished';
    } else if (this.round >= matchCfg.maxRounds) {
      // hard cap reached → finalize by remaining HP (best HP wins)
      const ranked = [...this.alivePlayers].sort((a, b) => b.hp - a.hp);
      ranked.forEach((p, i) => {
        p.placement = i + 1;
        if (i > 0) p.alive = false;
      });
      this.winnerSeat = ranked[0]?.seat ?? -1;
      this.phase = 'finished';
      finished = true;
    } else {
      this.round += 1;
      this.beginShopPhase();
    }

    return { reports, logsBySeat, eliminated, finished };
  }

  private processEliminations(): number[] {
    const aliveBefore = this.alivePlayers.length;
    const dying = this.alivePlayers.filter((p) => p.hp <= 0);
    if (dying.length === 0) return [];
    // most-negative HP places lowest (spec simultaneousEliminationRule)
    dying.sort((a, b) => a.hp - b.hp);
    let openPlacement = aliveBefore;
    const eliminated: number[] = [];
    for (const p of dying) {
      p.alive = false;
      p.placement = openPlacement;
      openPlacement -= 1;
      eliminated.push(p.seat);
      // snapshot final board as a ghost
      this.ghosts.push({ name: p.name, board: boardToCombat(p) });
      logLine(p, `Eliminated — placed ${p.placement}`);
    }
    return eliminated;
  }

  // ── pairing (spec §4.4) ──────────────────────────────────────────────────────
  private computePairings(): Matchup[] {
    const seats = this.alivePlayers.map((p) => p.seat);
    let best: number[] | null = null;

    // Try several seeded shuffles; prefer an arrangement with no immediate rematch.
    for (let attempt = 0; attempt < 8; attempt++) {
      const order = this.rng.shuffle(seats);
      let rematch = false;
      for (let i = 0; i + 1 < order.length; i += 2) {
        if (matchCfg.avoidImmediateRematch && this.prevOpponent.get(order[i]) === order[i + 1]) {
          rematch = true;
          break;
        }
      }
      if (!best) best = order;
      if (!rematch) {
        best = order;
        break;
      }
    }
    const order = best ?? seats;

    const matchups: Matchup[] = [];

    let i = 0;
    for (; i + 1 < order.length; i += 2) {
      const aSeat = order[i];
      const bSeat = order[i + 1];
      matchups.push({ aSeat, bSeat, pairing: { aSeat, bSeat, ghost: false } });
    }

    // odd leftover → ghost
    if (i < order.length) {
      const aSeat = order[i];
      const ghost = this.pickGhost(aSeat);
      if (ghost) {
        const ghostIndex = this.ghosts.indexOf(ghost.snapshot);
        matchups.push({
          aSeat,
          bSeat: -1,
          ghost: ghost.snapshot,
          ghostIndex: ghostIndex >= 0 ? ghostIndex : ghost.syntheticIndex,
          pairing: { aSeat, bSeat: -1, ghost: true, ghostName: ghost.snapshot.name },
        });
      }
      // if no ghost is available the leftover player simply gets a bye this round
    }

    return matchups;
  }

  private pickGhost(forSeat: number): { snapshot: GhostSnapshot; syntheticIndex: number } | null {
    if (!matchCfg.ghostsEnabled) return null;
    if (this.ghosts.length > 0) {
      return { snapshot: this.ghosts[this.ghosts.length - 1], syntheticIndex: this.ghosts.length - 1 };
    }
    // No eliminations yet: snapshot a random other living player's board.
    const others = this.alivePlayers.filter((p) => p.seat !== forSeat);
    const pick = this.rng.pick(others);
    if (!pick) return null;
    return { snapshot: { name: `${pick.name} (echo)`, board: boardToCombat(pick) }, syntheticIndex: 1000 + pick.seat };
  }

  // ── state projections (spec §9.3) ─────────────────────────────────────────────
  getPublicState(): PublicState {
    const players: PublicPlayer[] = this.players.map((p) => ({
      seat: p.seat,
      name: p.name,
      hp: Math.max(0, p.hp),
      tier: p.tier,
      alive: p.alive,
      placement: p.placement,
      isBot: p.isBot,
      connected: p.connected,
      ready: p.ready,
    }));
    return {
      roomCode: this.roomCode,
      phase: this.phase,
      round: this.round,
      timer: Math.ceil(this.timer),
      players,
      pairings: this.pairings,
      hostSeat: this.hostSeat,
      botFill: this.botFill,
      winnerSeat: this.winnerSeat,
    };
  }

  getPrivateState(seat: number): PrivateState | null {
    const p = this.player(seat);
    if (!p) return null;
    const offers: ShopOffer[] = p.shop.map((cardId) => {
      const c = getCard(cardId);
      return {
        cardId,
        name: c.name,
        tribe: c.tribe,
        tier: c.tier,
        atk: c.atk,
        hp: c.hp,
        keywords: c.keywords,
        text: c.text,
      };
    });
    const toClient = (list: PlayerState['board']): ClientUnit[] => list.map(toClientUnit);
    return {
      seat,
      gold: p.gold,
      baseIncome: p.baseIncome,
      tier: p.tier,
      tierUpCost: currentTierUpCost(p),
      rerollCost: economy.rerollCost,
      shop: offers,
      frozen: p.frozen,
      bench: toClient(p.bench),
      board: toClient(p.board),
      gems: p.gems,
      discover: p.discover
        ? {
            reason: p.discover.reason,
            options: p.discover.options.map((cardId) => {
              const c = getCard(cardId);
              return {
                cardId,
                name: c.name,
                tribe: c.tribe,
                tier: c.tier,
                atk: c.atk,
                hp: c.hp,
                keywords: c.keywords,
                text: c.text,
              };
            }),
          }
        : null,
      pendingTarget: p.pendingTarget
        ? {
            sourceUid: p.pendingTarget.sourceUid,
            sourceName: p.pendingTarget.sourceName,
            legalTargets: p.pendingTarget.legalTargets,
            description: p.pendingTarget.description,
          }
        : null,
      lastCombatLog: p.lastCombatLog,
      log: p.log,
    };
  }
}
