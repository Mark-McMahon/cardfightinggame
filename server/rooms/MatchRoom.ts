// MatchRoom — one Colyseus room = one match (≤ maxSeats), spec §9.1 lifecycle:
//   created → lobby → starting → (round: shop → combat)* → finished → disposed.
//
// The room is a pure TRANSPORT + AUTHORITY wrapper (invariant 1). It owns NO game rules: the
// engine (`@cardgame/shared`) owns gold/shop/pool/RNG/combat/HP/pairings/placement. Clients
// send INTENTS only; every intent is validated by `Match.applyIntent` before anything mutates.
//
// Two-channel privacy (invariant 3):
//   • PUBLIC  → the `RoomState` @colyseus/schema, auto-delta-synced to ALL clients ("state").
//   • PRIVATE → `PrivateState`, pushed with `client.send('privateState', …)` to the OWNER ONLY.
//     Opponent shop/hand/board/gold never leaves the server (EV-INV-PRIV at the transport edge).

import { Room, type Client } from '@colyseus/core';
import {
  Match,
  Rng,
  computeTimer,
  endOfTurnPhase,
  bots as botsCfg,
  match as matchCfg,
  type BotWeights,
  type Difficulty,
  type Intent,
  type CombatEvent,
  type SeatConfig,
  type ToastEvent,
} from '@cardgame/shared';
import { PlayerSchema, RoomState, makePairing, writePlayer } from './schema';
import { BotAgent, driveBotTurn } from '../bots/BotAgent';

// ── transport-loop timings (not game rules; pacing only) ──────────────────────────
const START_DELAY_MS = 1200; // lobby → first shop (let clients render the board)
const COMBAT_REPLAY_MS = 6500; // hold on 'combat' so clients can watch the replay before next shop
const SHOP_TICK_MS = 1000; // visible countdown cadence

interface SeatMeta {
  name: string;
  isBot: boolean; // true for original bots AND humans taken over after a lost reconnect
  connected: boolean;
  sessionId?: string; // the owning human's socket (undefined for bots / while disconnected)
  agent?: BotAgent; // present iff this seat is driven by AI
}

type RoomPhase = 'lobby' | 'starting' | 'shop' | 'combat' | 'finished';

export interface CreateOptions {
  name?: string;
  botFill?: boolean;
  botDifficulty?: Difficulty;
  seed?: string;
}

export class MatchRoom extends Room<RoomState> {
  private match: Match | null = null;
  private matchSeed = 'match';
  private botDifficulty: Difficulty = 'medium';
  private phaseState: RoomPhase = 'lobby';

  private humans: string[] = []; // lobby seat order (index = seat) — humans only
  private seatBySession = new Map<string, number>();
  private seatInfo: SeatMeta[] = [];
  private hostSessionId: string | null = null;

  private shopEndsAt = 0;
  private resolving = false;
  private tickHandle?: ReturnType<typeof setInterval>;
  private timeouts = new Set<ReturnType<typeof setTimeout>>();

  // ── lifecycle ────────────────────────────────────────────────────────────────

  override onCreate(options: CreateOptions = {}): void {
    this.maxClients = matchCfg.maxSeats;
    this.autoDispose = true;
    this.matchSeed = String(options.seed ?? this.roomId);
    this.botDifficulty = options.botDifficulty ?? 'medium';

    const state = new RoomState();
    state.roomCode = this.roomId;
    state.phase = 'lobby';
    state.botFill = options.botFill ?? true;
    state.hostSeat = 0;
    state.winnerSeat = -1;
    this.setState(state);

    this.onMessage('setBotFill', (client, msg: { botFill: boolean }) => {
      if (client.sessionId !== this.hostSessionId) return this.sendError(client, 'only the host can change bot-fill');
      if (this.phaseState !== 'lobby') return this.sendError(client, 'match already started');
      this.state.botFill = !!msg?.botFill;
    });

    this.onMessage('startMatch', (client) => {
      if (client.sessionId !== this.hostSessionId) return this.sendError(client, 'only the host can start');
      if (this.phaseState !== 'lobby') return this.sendError(client, 'match already started');
      this.beginMatch(client);
    });

    this.onMessage('intent', (client, intent: Intent) => this.handleIntent(client, intent));
  }

  override onJoin(client: Client, options: CreateOptions = {}): void {
    if (this.phaseState !== 'lobby') {
      // reconnections are routed via allowReconnection (not onJoin); a fresh onJoin after
      // start is a genuine late join → reject (seats are locked at start, spec §3).
      throw new Error('match already started');
    }
    const seat = this.humans.length;
    this.humans.push(client.sessionId);
    this.seatBySession.set(client.sessionId, seat);

    const p = new PlayerSchema();
    p.seat = seat;
    p.name = (options.name ?? `Player ${seat + 1}`).slice(0, 24);
    p.hp = matchCfg.startingHealth;
    p.tier = 1;
    p.alive = true;
    p.placement = 0;
    p.isBot = false;
    p.connected = true;
    p.ready = false;
    this.state.players.push(p);

    if (this.humans.length === 1) {
      this.hostSessionId = client.sessionId;
      this.state.hostSeat = 0;
    }
    client.send('welcome', { seat, roomCode: this.state.roomCode });
    if (this.humans.length >= this.maxClients) this.lock();
  }

  override async onLeave(client: Client, consented: boolean): Promise<void> {
    if (this.phaseState === 'lobby') {
      this.removeLobbyPlayer(client.sessionId);
      return;
    }
    const seat = this.seatBySession.get(client.sessionId);
    if (seat === undefined) return;
    this.setConnected(seat, false);
    this.syncPublic();

    if (consented) {
      this.convertToBot(seat);
      return;
    }
    // §9.5: the board persists and keeps fighting; permit rejoin within the grace window.
    try {
      await this.allowReconnection(client, matchCfg.reconnectGraceSeconds);
      this.setConnected(seat, true);
      this.syncPublic();
      client.send('welcome', { seat, roomCode: this.state.roomCode });
      this.pushPrivate(seat);
    } catch {
      // grace expired → a bot takes over so the match never stalls.
      this.convertToBot(seat);
    }
  }

  override onDispose(): void {
    this.stopTick();
    for (const t of this.timeouts) clearTimeout(t);
    this.timeouts.clear();
  }

  // ── lobby helpers ──────────────────────────────────────────────────────────────

  private removeLobbyPlayer(sessionId: string): void {
    const idx = this.humans.indexOf(sessionId);
    if (idx < 0) return;
    this.humans.splice(idx, 1);
    this.state.players.splice(idx, 1);
    // re-index remaining humans so seats stay 0..N-1 contiguous (the engine keys on index).
    this.seatBySession.clear();
    for (let i = 0; i < this.humans.length; i++) {
      this.seatBySession.set(this.humans[i], i);
      const p = this.state.players[i];
      if (p) p.seat = i;
      const c = this.clientById(this.humans[i]);
      c?.send('welcome', { seat: i, roomCode: this.state.roomCode });
    }
    if (sessionId === this.hostSessionId) {
      this.hostSessionId = this.humans[0] ?? null;
      this.state.hostSeat = 0;
    }
  }

  // ── match start ────────────────────────────────────────────────────────────────

  private beginMatch(host: Client): void {
    const humanCount = this.humans.length;
    const total = this.state.botFill ? this.maxClients : humanCount;
    if (total < 2) {
      this.sendError(host, 'need at least 2 seats to start (enable bot-fill or wait for players)');
      return;
    }
    const weights: BotWeights = botsCfg.difficultyPresets[this.botDifficulty];
    const seatConfigs: SeatConfig[] = [];
    const seatInfo: SeatMeta[] = [];
    for (let i = 0; i < total; i++) {
      if (i < humanCount) {
        const sid = this.humans[i];
        const name = this.state.players[i]?.name ?? `Player ${i + 1}`;
        seatConfigs.push({ name, isBot: false });
        seatInfo.push({ name, isBot: false, connected: true, sessionId: sid });
      } else {
        const name = `Bot ${i + 1}`;
        seatConfigs.push({ name, isBot: true });
        seatInfo.push({ name, isBot: true, connected: true, agent: this.makeAgent(i, weights) });
      }
    }

    this.match = new Match(this.matchSeed, seatConfigs, this.state.roomCode);
    this.seatInfo = seatInfo;
    this.seatBySession.clear();
    for (let i = 0; i < humanCount; i++) this.seatBySession.set(this.humans[i], i);

    this.lock();
    this.phaseState = 'starting';
    this.syncPublic();
    this.schedule(() => this.beginShop(), START_DELAY_MS);
  }

  private makeAgent(seat: number, weights: BotWeights): BotAgent {
    return new BotAgent(weights, new Rng(`${this.matchSeed}:bot:${seat}`));
  }

  // ── round loop ───────────────────────────────────────────────────────────────

  private beginShop(): void {
    const m = this.match;
    if (!m || this.phaseState === 'finished') return;
    this.resolving = false;

    m.startRound(); // engine: phase='shop', fresh shops, ready reset, budget timer computed
    this.phaseState = 'shop';
    this.shopEndsAt = Date.now() + m.state.timer * 1000; // engine timer == phase budget (§4.3)

    // bots (and taken-over seats) take their whole turn now and ready up (deterministic).
    for (let seat = 0; seat < m.state.players.length; seat++) {
      if (this.isBotSeat(seat) && m.state.players[seat].alive) this.runBotSeat(seat);
    }

    this.syncPublic();
    this.pushPrivateAll();
    this.startTick();
    this.maybeEndShop(); // all-bot / all-ready lobbies resolve without waiting on the clock
  }

  private runBotSeat(seat: number): void {
    const m = this.match;
    const agent = this.seatInfo[seat]?.agent;
    if (!m || !agent) return;
    driveBotTurn(
      agent,
      () => m.privateState(seat),
      () => m.state,
      (intent) => m.applyIntent(seat, intent),
    );
  }

  private onTick(): void {
    if (this.phaseState !== 'shop') return;
    this.state.timer = Math.max(0, Math.ceil((this.shopEndsAt - Date.now()) / 1000));
    if (this.state.timer <= 0) this.endShop();
  }

  private maybeEndShop(): void {
    const m = this.match;
    if (this.phaseState !== 'shop' || this.resolving || !m) return;
    const alive = m.state.players.filter((p) => p.alive);
    if (alive.length > 0 && alive.every((p) => p.ready)) this.endShop();
  }

  private endShop(): void {
    if (this.resolving) return;
    this.resolving = true;
    this.stopTick();
    this.resolveRound();
  }

  private resolveRound(): void {
    const m = this.match;
    if (!m) return;
    const aliveBefore = new Set(m.state.players.filter((p) => p.alive).map((p) => p.seat));

    // End-of-shop triggers (Brambleling summons, gem doublers, multiplyStats compounders).
    // The engine's resolveCombatPhase does NOT run these — the round DRIVER must (shop.ts /
    // spec §4). Do it for every living seat, then resolve all combats.
    for (const p of m.state.players) if (p.alive) endOfTurnPhase(m.sessions[p.seat]);
    m.resolveCombatPhase(); // pair + pure combat + loss damage + eliminations + placement

    this.phaseState = m.isFinished() ? 'finished' : 'combat';
    this.syncPublic();

    // private channel: each connected human gets their own combat log + refreshed state.
    for (let seat = 0; seat < m.state.players.length; seat++) {
      const client = this.clientBySeat(seat);
      if (!client) continue;
      const log = m.sessions[seat].lastCombatLog;
      if (log) client.send('combatLog', log);
      this.pushPrivate(seat);
    }
    this.emitCombatToasts(aliveBefore);

    if (m.isFinished()) {
      const winner = m.state.players.find((p) => p.seat === m.state.winnerSeat);
      if (winner) this.broadcastToast({ kind: 'placement', message: `${winner.name} wins the match!`, seat: winner.seat });
      this.stopTick();
    } else {
      this.schedule(() => this.beginShop(), COMBAT_REPLAY_MS);
    }
  }

  private emitCombatToasts(aliveBefore: Set<number>): void {
    const m = this.match;
    if (!m) return;
    for (const pr of m.state.pairings) {
      const end = lastCombatEnd(m.sessions[pr.aSeat].lastCombatLog);
      if (!end) continue;
      this.toastSeat(pr.aSeat, { kind: 'combatResult', seat: pr.aSeat, message: resultMsg(end.winner === 'a' ? 'win' : end.winner === 'b' ? 'lose' : 'tie', end.damageToLoser) });
      if (!pr.ghost && pr.bSeat >= 0) {
        this.toastSeat(pr.bSeat, { kind: 'combatResult', seat: pr.bSeat, message: resultMsg(end.winner === 'b' ? 'win' : end.winner === 'a' ? 'lose' : 'tie', end.damageToLoser) });
      }
    }
    for (const p of m.state.players) {
      if (aliveBefore.has(p.seat) && !p.alive) {
        this.broadcastToast({ kind: 'eliminated', seat: p.seat, message: `${p.name} was eliminated — placed #${p.placement}` });
      }
    }
  }

  // ── intents ────────────────────────────────────────────────────────────────────

  private handleIntent(client: Client, intent: Intent): void {
    const m = this.match;
    const seat = this.seatBySession.get(client.sessionId);
    if (seat === undefined || !m) return this.sendError(client, 'not seated');
    if (this.phaseState !== 'shop') return this.sendError(client, 'not shop phase', intent);

    const res = m.applyIntent(seat, intent);
    if (!res.ok) {
      this.sendError(client, res.error ?? 'rejected', intent);
      return;
    }
    if (res.triples && res.triples.length > 0) {
      client.send('toast', { kind: 'triple', seat, message: `Triple! (${res.triples.join(', ')})` } satisfies ToastEvent);
    }
    this.syncPublic(); // ready / tier changed → reflect in public
    this.pushPrivate(seat);
    this.maybeEndShop();
  }

  // ── connection / bot-takeover helpers ────────────────────────────────────────

  private setConnected(seat: number, connected: boolean): void {
    const meta = this.seatInfo[seat];
    if (meta) meta.connected = connected;
    const p = this.state.players[seat];
    if (p) p.connected = connected;
  }

  private convertToBot(seat: number): void {
    const meta = this.seatInfo[seat];
    if (!meta) return;
    meta.isBot = true;
    meta.connected = false;
    meta.sessionId = undefined;
    meta.agent ??= this.makeAgent(seat, botsCfg.difficultyPresets[this.botDifficulty]);
    if (this.match) this.match.state.players[seat].isBot = true;
    const p = this.state.players[seat];
    if (p) {
      p.isBot = true;
      p.connected = false;
    }
    // if the abandoned seat still owes a shop turn, let the bot finish it immediately.
    const m = this.match;
    if (m && this.phaseState === 'shop' && m.state.players[seat]?.alive && !m.state.players[seat].ready) {
      this.runBotSeat(seat);
      this.syncPublic();
      this.maybeEndShop();
    }
  }

  private isBotSeat(seat: number): boolean {
    return this.seatInfo[seat]?.isBot === true;
  }

  // ── public / private channels ──────────────────────────────────────────────────

  /** Mirror engine PublicState → the public schema. NEVER writes any private field. */
  private syncPublic(): void {
    const m = this.match;
    if (!m) return;
    const st = m.state;
    this.state.roomCode = st.roomCode;
    this.state.phase = this.phaseState;
    this.state.round = st.round;
    this.state.botFill = st.botFill;
    this.state.winnerSeat = st.winnerSeat;
    this.state.timer =
      this.phaseState === 'shop' ? Math.max(0, Math.ceil((this.shopEndsAt - Date.now()) / 1000)) : 0;

    while (this.state.players.length < st.players.length) this.state.players.push(new PlayerSchema());
    while (this.state.players.length > st.players.length) this.state.players.pop();
    for (let i = 0; i < st.players.length; i++) {
      const meta = this.seatInfo[i];
      const dst = this.state.players[i];
      const src = st.players[i];
      if (dst) writePlayer(dst, src, meta?.connected ?? true, meta?.isBot ?? src.isBot);
    }

    this.state.pairings.splice(0, this.state.pairings.length);
    for (const pr of st.pairings) this.state.pairings.push(makePairing(pr));
  }

  private pushPrivate(seat: number): void {
    const m = this.match;
    const client = this.clientBySeat(seat);
    if (m && client) client.send('privateState', m.privateState(seat));
  }

  private pushPrivateAll(): void {
    const m = this.match;
    if (!m) return;
    for (let seat = 0; seat < m.state.players.length; seat++) this.pushPrivate(seat);
  }

  // ── messaging / lookup ───────────────────────────────────────────────────────

  private clientById(sessionId: string): Client | undefined {
    return this.clients.find((c) => c.sessionId === sessionId);
  }

  private clientBySeat(seat: number): Client | undefined {
    const sid = this.seatInfo[seat]?.sessionId;
    if (!sid) return undefined;
    return this.clientById(sid);
  }

  private sendError(client: Client, error: string, intent?: Intent): void {
    client.send('error', { error, intent });
  }

  private broadcastToast(t: ToastEvent): void {
    this.broadcast('toast', t);
  }

  private toastSeat(seat: number, t: ToastEvent): void {
    this.clientBySeat(seat)?.send('toast', t);
  }

  // ── timers ───────────────────────────────────────────────────────────────────

  private startTick(): void {
    this.stopTick();
    this.tickHandle = setInterval(() => this.onTick(), SHOP_TICK_MS);
  }

  private stopTick(): void {
    if (this.tickHandle) {
      clearInterval(this.tickHandle);
      this.tickHandle = undefined;
    }
  }

  private schedule(fn: () => void, ms: number): void {
    const h = setTimeout(() => {
      this.timeouts.delete(h);
      fn();
    }, ms);
    this.timeouts.add(h);
  }
}

// ── small pure helpers ───────────────────────────────────────────────────────────

function lastCombatEnd(log: CombatEvent[] | null): Extract<CombatEvent, { t: 'combatEnd' }> | undefined {
  if (!log) return undefined;
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if (e.t === 'combatEnd') return e;
  }
  return undefined;
}

function resultMsg(kind: 'win' | 'lose' | 'tie', dmg: number): string {
  if (kind === 'win') return `Victory — dealt ${dmg}`;
  if (kind === 'lose') return `Defeat — took ${dmg}`;
  return 'Draw — no damage';
}

// re-exported for callers that want the timer formula without importing the engine directly.
export { computeTimer };
