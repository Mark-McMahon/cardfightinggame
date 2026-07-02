// Match orchestration (spec §4). Owns the round loop, pairing (D8 ghost), loss damage (D6),
// elimination/placement (§4.6, D9), the shared pool, and intent validation (invariant 1:
// a rejected intent mutates nothing). Combat itself is the pure resolveCombat.

import type { CombatBoard, CombatEvent, Intent, MatchPhase, Pairing, PrivateState, PublicState } from '../types';
import { match as matchCfg } from '../config';
import { Rng } from './rng';
import { createPool, type PoolState } from './pool';
import {
  activateAbility,
  buyUnit,
  boardToCombat,
  createShopSession,
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
  toPrivateState,
  unfreezeShop,
  type OpResult,
  type ShopSession,
} from './shop';
import { makePublicState, makePublicPlayer } from './state';
import { resolveCombat } from './combat';
import { foldPermanentBuffs } from './combatWriteback';

export interface SeatConfig {
  name: string;
  isBot: boolean;
}

interface GhostRecord {
  seat: number;
  name: string;
  board: CombatBoard;
}

/** Public turn timer (spec §4.3), sized to the wealthiest living player. */
export function computeTimer(maxTier: number, maxGold: number): number {
  return Math.min(
    matchCfg.shopTimerCap,
    matchCfg.shopTimerBase + maxTier * matchCfg.shopTimerPerTier + maxGold * matchCfg.shopTimerPerGold,
  );
}

export class Match {
  readonly seed: string;
  readonly pool: PoolState;
  readonly sessions: ShopSession[];
  public state: PublicState;
  private round = 0;
  private ghosts: GhostRecord[] = []; // elimination order; most-recent = last
  private lastOpponent: Record<number, number> = {};
  private pairingsReady = false; // `state.pairings` holds this round's pairing, not yet consumed by combat

  constructor(seed: string, seats: SeatConfig[], roomCode = 'ROOM') {
    this.seed = seed;
    this.pool = createPool();
    const players = seats.map((s, seat) => makePublicPlayer(seat, s.name, s.isBot));
    this.state = makePublicState(roomCode, players);
    this.sessions = seats.map((_, seat) =>
      createShopSession(seat, { pool: this.pool, rng: new Rng(`${seed}:shop:${seat}`) }),
    );
  }

  get phase(): MatchPhase {
    return this.state.phase;
  }

  private alivePlayers() {
    return this.state.players.filter((p) => p.alive);
  }

  // ── shop phase ──────────────────────────────────────────────────────────────────

  /** Begin a new round's shop phase for all living players. */
  startRound(): void {
    this.round += 1;
    this.state.phase = 'shop';
    this.state.round = this.round;
    for (const p of this.state.players) {
      p.ready = false;
      if (p.alive) startShopPhase(this.sessions[p.seat]);
    }
    // Pair NOW, at the start of the shop, so `state.pairings` (public schema) previews the ACTUAL
    // upcoming opponent during the whole shop phase — not last round's stale pairing. Deterministic
    // and unchanged from pairing at combat-start: the inputs (alive set, lastOpponent, most-recent
    // ghost) are identical between shop-start and combat-start of the same round — nobody dies during
    // the shop. Combat reuses this exact list (ensurePairings is idempotent per round). (spec §4.4)
    this.ensurePairings();
    this.refreshTimer();
  }

  private refreshTimer(): void {
    let maxTier = 1;
    let maxGold = 0;
    for (const p of this.alivePlayers()) {
      const s = this.sessions[p.seat];
      maxTier = Math.max(maxTier, s.tier);
      maxGold = Math.max(maxGold, s.gold);
      p.tier = s.tier; // mirror tier into the public channel
    }
    this.state.timer = computeTimer(maxTier, maxGold);
  }

  /** Validate + apply a player intent. A rejected intent returns {ok:false,error} and mutates
   *  nothing (EV-INV-SRV). */
  applyIntent(seat: number, intent: Intent): OpResult {
    const player = this.state.players[seat];
    if (!player) return { ok: false, error: 'invalid seat' };
    if (intent.type === 'readyUp') {
      if (this.state.phase !== 'shop' || !player.alive) return { ok: false, error: 'not in shop' };
      player.ready = true;
      return { ok: true };
    }
    if (this.state.phase !== 'shop') return { ok: false, error: 'not shop phase' };
    if (!player.alive) return { ok: false, error: 'eliminated' };
    const s = this.sessions[seat];
    let res: OpResult;
    switch (intent.type) {
      case 'buy':
        res = buyUnit(s, intent.shopIndex);
        break;
      case 'sell':
        res = sellUnit(s, intent.unitUid);
        break;
      case 'roll':
        res = rollShop(s);
        break;
      case 'freeze':
        res = freezeShop(s);
        break;
      case 'unfreeze':
        res = unfreezeShop(s);
        break;
      case 'tierUp':
        res = tierUp(s);
        break;
      case 'playUnit':
        res = playUnit(s, intent.unitUid, intent.toSlot);
        break;
      case 'moveUnit':
        res = moveUnit(s, intent.unitUid, intent.toSlot);
        break;
      case 'targetChoice':
        res = resolveTargetChoice(s, intent.targetUid);
        break;
      case 'activate':
        res = activateAbility(s, intent.unitUid);
        break;
      case 'discoverPick':
        res = resolveDiscoverPick(s, intent.optionIndex);
        break;
      default:
        return { ok: false, error: 'unknown intent' };
    }
    if (res.ok) this.refreshTimer();
    return res;
  }

  privateState(seat: number): PrivateState {
    return toPrivateState(this.sessions[seat]);
  }

  // ── pairing (spec §4.4, D8) ────────────────────────────────────────────────────

  computePairings(): Pairing[] {
    const rng = new Rng(`${this.seed}:pair:${this.round}`);
    const order = rng.shuffle(this.alivePlayers().map((p) => p.seat));
    // avoidImmediateRematch (where possible): if a consecutive pair repeats last round, swap.
    if (matchCfg.avoidImmediateRematch) {
      for (let i = 0; i + 1 < order.length; i += 2) {
        if (this.lastOpponent[order[i]] === order[i + 1] && i + 2 < order.length) {
          const tmp = order[i + 1];
          order[i + 1] = order[i + 2];
          order[i + 2] = tmp;
        }
      }
    }
    const pairings: Pairing[] = [];
    const arr = [...order];
    if (arr.length % 2 === 1) {
      const soloSeat = arr.pop()!;
      const ghost = this.ghosts[this.ghosts.length - 1];
      pairings.push({
        aSeat: soloSeat,
        bSeat: -1,
        ghost: true,
        ghostName: ghost ? ghost.name : 'Ghost',
      });
    }
    for (let i = 0; i + 1 < arr.length; i += 2) {
      pairings.push({ aSeat: arr[i], bSeat: arr[i + 1], ghost: false });
    }
    return pairings;
  }

  /** Compute `state.pairings` once per shop and mark them ready. Idempotent within a round: called at
   *  shop-start (so the client can preview the opponent) and again at combat-start, which REUSES the
   *  same list — combat always fights exactly what the shop showed. `resolveCombatPhase` consumes the
   *  pairing (clears the flag) so a fresh resolve without a preceding `startRound` re-pairs against the
   *  current alive set (the round-0 engine tests, and the ghost driver in combatWriteback.test). */
  private ensurePairings(): void {
    if (!this.pairingsReady) {
      this.state.pairings = this.computePairings();
      this.pairingsReady = true;
    }
  }

  // ── combat phase (spec §4.5–4.6) ─────────────────────────────────────────────────

  /** Resolve every pairing's combat, apply loss damage, then eliminations/placement. */
  resolveCombatPhase(): void {
    this.state.phase = 'combat';
    this.ensurePairings(); // reuse the shop-phase pairing (or compute if resolved without a startRound)
    const pairings = this.state.pairings;
    this.pairingsReady = false; // consumed: the next startRound (or bare resolve) re-pairs

    for (const pr of pairings) {
      if (pr.ghost) {
        const ghost = this.ghosts[this.ghosts.length - 1];
        const aBoard = boardToCombat(this.sessions[pr.aSeat]);
        const bBoard: CombatBoard = ghost ? ghost.board : { units: [], playerTier: 1 };
        const seed = `${this.seed}:combat:${this.round}:${pr.aSeat}:ghost`;
        const log = resolveCombat(aBoard, bBoard, seed);
        this.sessions[pr.aSeat].lastCombatLog = log;
        const end = endEvent(log);
        // No hero damage flows TO a ghost; only the live player can take damage.
        if (end && end.winner === 'b') this.damagePlayer(pr.aSeat, end.damageToLoser);
        // Writeback fold (§7.5, decision #38): only the LIVE side accrues. The ghost is a
        // frozen snapshot of a dead player's board — it never accrues (its side is skipped).
        this.applyWriteback(pr.aSeat, log, end?.survivorsA ?? [], 'a');
      } else {
        const aBoard = boardToCombat(this.sessions[pr.aSeat]);
        const bBoard = boardToCombat(this.sessions[pr.bSeat]);
        const seed = `${this.seed}:combat:${this.round}:${pr.aSeat}:${pr.bSeat}`;
        const log = resolveCombat(aBoard, bBoard, seed);
        this.sessions[pr.aSeat].lastCombatLog = log;
        this.sessions[pr.bSeat].lastCombatLog = log;
        this.lastOpponent[pr.aSeat] = pr.bSeat;
        this.lastOpponent[pr.bSeat] = pr.aSeat;
        const end = endEvent(log);
        if (end) {
          if (end.winner === 'a') this.damagePlayer(pr.bSeat, end.damageToLoser);
          else if (end.winner === 'b') this.damagePlayer(pr.aSeat, end.damageToLoser);
        }
        // Writeback fold (§7.5, decision #38): BOTH live sides accrue their survivors' buffs.
        this.applyWriteback(pr.aSeat, log, end?.survivorsA ?? [], 'a');
        this.applyWriteback(pr.bSeat, log, end?.survivorsB ?? [], 'b');
      }
    }

    this.processEliminations();
    if (this.round >= matchCfg.maxRounds && this.alivePlayers().length > 1) {
      this.finalizeByHp();
    }
  }

  private damagePlayer(seat: number, amount: number): void {
    this.state.players[seat].hp -= amount;
  }

  /** §7.5 writeback: fold a side's combat-fired permanent buffs onto its surviving persistent
   *  instances; the fold's narration (incl. token no-ops) goes to that player's session log. */
  private applyWriteback(seat: number, log: CombatEvent[], survivors: string[], side: 'a' | 'b'): void {
    const s = this.sessions[seat];
    const res = foldPermanentBuffs(log, s.board, survivors, side);
    s.log.push(...res.logLines);
  }

  /** §4.6 eliminations: HP≤0 → lowest open placement; more-negative HP places lower (worse). */
  private processEliminations(): void {
    const dying = this.state.players.filter((p) => p.alive && p.hp <= 0);
    if (dying.length > 0) {
      const aliveCount = this.alivePlayers().length;
      // ascending hp → most-negative first (they take the worst/highest placement number).
      dying.sort((a, b) => a.hp - b.hp || b.seat - a.seat);
      let place = aliveCount;
      for (const p of dying) {
        p.alive = false;
        p.placement = place--;
        this.ghosts.push({
          seat: p.seat,
          name: p.name,
          board: boardToCombat(this.sessions[p.seat]),
        });
      }
    }
    const remaining = this.alivePlayers();
    if (remaining.length === 1) {
      remaining[0].placement = 1;
      this.state.winnerSeat = remaining[0].seat;
      this.state.phase = 'finished';
    } else if (remaining.length === 0) {
      // Mutual elimination: the last-eliminated placed 1 is the winner.
      const first = this.state.players.find((p) => p.placement === 1);
      if (first) this.state.winnerSeat = first.seat;
      this.state.phase = 'finished';
    }
  }

  /** §4.6 maxRounds cutoff: finalize by remaining HP; HP tie → seat order (D9). */
  private finalizeByHp(): void {
    const alive = this.alivePlayers().sort((a, b) => b.hp - a.hp || a.seat - b.seat);
    let place = 1;
    for (const p of alive) {
      p.placement = place++;
      p.alive = false;
    }
    if (alive.length > 0) this.state.winnerSeat = alive[0].seat;
    this.state.phase = 'finished';
  }

  isFinished(): boolean {
    return this.state.phase === 'finished';
  }
}

function endEvent(log: CombatEvent[]): Extract<CombatEvent, { t: 'combatEnd' }> | undefined {
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if (e.t === 'combatEnd') return e;
  }
  return undefined;
}
