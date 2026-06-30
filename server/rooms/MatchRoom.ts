import { Room, type Client } from '@colyseus/core';
import { ArraySchema } from '@colyseus/schema';
import {
  Match,
  type Intent,
  type PlayerSeed,
  match as matchCfg,
} from '@cardgame/shared';
import { BotAgent } from '../bots/BotAgent';
import { PairingSchema, PlayerSchema, RoomState } from './schema';

interface JoinOptions {
  name?: string;
  botFill?: boolean;
}

interface Seat {
  seat: number;
  name: string;
  sessionId: string | null; // null → bot
  isBot: boolean;
  connected: boolean;
}

const MAX_SEATS = matchCfg.maxSeats;

export class MatchRoom extends Room<RoomState> {
  override maxClients = MAX_SEATS;

  private seats: Seat[] = [];
  private match: Match | null = null;
  private bots = new Map<number, BotAgent>();
  private resolving = false;

  override onCreate(options: JoinOptions): void {
    this.setState(new RoomState());
    this.state.roomCode = this.roomId;
    this.state.botFill = options.botFill ?? true;
    this.state.phase = 'lobby';

    // ── lobby intents ──
    this.onMessage('setBotFill', (client, value: boolean) => {
      if (this.seatOf(client)?.seat !== this.state.hostSeat) return;
      this.state.botFill = !!value;
    });
    this.onMessage('startMatch', (client) => {
      if (this.seatOf(client)?.seat !== this.state.hostSeat) return;
      this.startMatch();
    });

    // ── gameplay intent (single channel, validated server-side) ──
    this.onMessage('intent', (client, intent: Intent) => {
      const seat = this.seatOf(client);
      if (!seat || !this.match) return;
      const res = this.match.applyIntent(seat.seat, intent);
      if (!res.ok) {
        client.send('error', { reason: res.error ?? 'illegal intent' });
      } else if (res.triples && res.triples.length) {
        client.send('toast', { kind: 'triple', message: `Tripled into a golden!` });
      }
      this.syncPublic();
      this.pushPrivate(seat.seat);
    });

    // drive the clock once; it governs the shop timer + auto-resolve
    this.clock.setInterval(() => this.tick(), 1000);
  }

  override onJoin(client: Client, options: JoinOptions): void {
    if (this.match) {
      // match already started — only reconnections are handled in onLeave/allowReconnection
      return;
    }
    const seat = this.seats.length;
    const s: Seat = {
      seat,
      name: options.name?.slice(0, 16) || `Player ${seat + 1}`,
      sessionId: client.sessionId,
      isBot: false,
      connected: true,
    };
    this.seats.push(s);
    if (this.seats.length === 1) this.state.hostSeat = seat;
    this.rebuildLobbySchema();
    client.send('seat', { seat });
  }

  override async onLeave(client: Client, consented: boolean): Promise<void> {
    const seat = this.seatOf(client);
    if (!seat) return;
    seat.connected = false;
    this.markConnected(seat.seat, false);

    if (!this.match) {
      // left during lobby — free the seat
      this.seats = this.seats.filter((s) => s.sessionId !== client.sessionId);
      this.seats.forEach((s, i) => (s.seat = i));
      if (this.seats.length > 0) this.state.hostSeat = this.seats[0].seat;
      this.rebuildLobbySchema();
      return;
    }

    if (consented) {
      this.handoffToBot(seat.seat);
      return;
    }
    try {
      await this.allowReconnection(client, matchCfg.reconnectGraceSeconds);
      seat.connected = true;
      seat.sessionId = client.sessionId;
      this.markConnected(seat.seat, true);
      this.pushPrivate(seat.seat);
    } catch {
      // grace expired → a bot keeps the seat fighting (spec §9.5)
      this.handoffToBot(seat.seat);
    }
  }

  // ── match lifecycle ──────────────────────────────────────────────────────────
  private startMatch(): void {
    if (this.match) return;
    if (this.state.botFill) {
      while (this.seats.length < MAX_SEATS) {
        const seat = this.seats.length;
        this.seats.push({ seat, name: `Bot ${seat + 1}`, sessionId: null, isBot: true, connected: true });
      }
    }
    if (this.seats.length < 2) {
      // pad to a minimum of 2 so there's an opponent
      while (this.seats.length < 2) {
        const seat = this.seats.length;
        this.seats.push({ seat, name: `Bot ${seat + 1}`, sessionId: null, isBot: true, connected: true });
      }
    }

    const players: PlayerSeed[] = this.seats.map((s) => ({
      seat: s.seat,
      name: s.name,
      isBot: s.isBot,
      difficulty: 'medium',
    }));
    this.match = new Match({
      matchId: this.roomId,
      roomCode: this.roomId,
      players,
      hostSeat: this.state.hostSeat,
      botFill: this.state.botFill,
    });
    for (const s of this.seats) if (s.isBot) this.bots.set(s.seat, new BotAgent('medium'));
    this.match.start();
    this.runBots();
    this.syncPublic();
    this.pushAllPrivate();
    this.broadcast('toast', { kind: 'info', message: 'Match started — round 1!' });
  }

  private tick(): void {
    if (!this.match || this.state.phase !== 'shop' || this.resolving) return;
    this.match.timer -= 1;
    this.state.timer = Math.max(0, Math.ceil(this.match.timer));
    if (this.match.timer <= 0 || this.match.allReady()) {
      this.resolveCombat();
    }
  }

  private resolveCombat(): void {
    if (!this.match || this.resolving) return;
    this.resolving = true;
    const res = this.match.resolveCombatPhase();
    this.syncPublic();

    // private combat logs (each player sees only their own fight, tagged with their side)
    for (const report of res.reports) {
      const aSeat = report.pairing.aSeat;
      const bSeat = report.pairing.bSeat;
      const aName = this.match.player(aSeat)?.name ?? 'Opponent';
      const oppForA = report.pairing.ghost ? report.pairing.ghostName ?? 'Ghost' : this.match.player(bSeat)?.name ?? 'Opponent';
      this.sendCombat(aSeat, report.events, 'a', oppForA);
      if (!report.pairing.ghost) this.sendCombat(bSeat, report.events, 'b', aName);
    }
    for (const elim of res.eliminated) {
      const p = this.match.player(elim);
      this.broadcast('toast', { kind: 'eliminated', message: `${p?.name} placed ${p?.placement}`, seat: elim });
    }

    if (res.finished) {
      const winner = this.match.player(this.match.winnerSeat);
      this.broadcast('toast', { kind: 'placement', message: `${winner?.name} wins! 🏆`, seat: this.match.winnerSeat });
      this.state.phase = 'finished';
      this.resolving = false;
      return;
    }

    this.runBots();
    this.syncPublic();
    this.pushAllPrivate();
    this.resolving = false;
  }

  private runBots(): void {
    if (!this.match) return;
    for (const p of this.match.alivePlayers) {
      const bot = this.bots.get(p.seat);
      if (bot) bot.takeShopTurn(this.match, p.seat, this.match.round);
    }
  }

  private handoffToBot(seat: number): void {
    const s = this.seats.find((x) => x.seat === seat);
    if (!s) return;
    s.isBot = true;
    s.sessionId = null;
    if (this.match) {
      const p = this.match.player(seat);
      if (p) p.isBot = true;
      if (!this.bots.has(seat)) this.bots.set(seat, new BotAgent('medium'));
      // let the bot finish the current shop turn if we're mid-shop
      if (this.state.phase === 'shop') this.bots.get(seat)!.takeShopTurn(this.match, seat, this.match.round);
    }
    this.markConnected(seat, true); // bot is "connected"
    this.syncPublic();
  }

  // ── state projection helpers ───────────────────────────────────────────────────
  private seatOf(client: Client): Seat | undefined {
    return this.seats.find((s) => s.sessionId === client.sessionId);
  }
  private clientFor(sessionId: string): Client | undefined {
    return this.clients.find((c) => c.sessionId === sessionId);
  }

  private rebuildLobbySchema(): void {
    this.state.players = new ArraySchema<PlayerSchema>();
    for (const s of this.seats) {
      const ps = new PlayerSchema();
      ps.seat = s.seat;
      ps.name = s.name;
      ps.hp = matchCfg.startingHealth;
      ps.tier = 1;
      ps.alive = true;
      ps.placement = 0;
      ps.isBot = s.isBot;
      ps.connected = s.connected;
      ps.ready = false;
      this.state.players.push(ps);
    }
  }

  private markConnected(seat: number, connected: boolean): void {
    const ps = this.state.players.find((p) => p.seat === seat);
    if (ps) ps.connected = connected;
  }

  private syncPublic(): void {
    if (!this.match) return;
    const pub = this.match.getPublicState();
    this.state.phase = pub.phase;
    this.state.round = pub.round;
    this.state.timer = pub.timer;
    this.state.hostSeat = pub.hostSeat;
    this.state.botFill = pub.botFill;
    this.state.winnerSeat = pub.winnerSeat;

    this.state.players = new ArraySchema<PlayerSchema>();
    for (const p of pub.players) {
      const ps = new PlayerSchema();
      Object.assign(ps, p);
      this.state.players.push(ps);
    }
    this.state.pairings = new ArraySchema<PairingSchema>();
    for (const pr of pub.pairings) {
      const prs = new PairingSchema();
      prs.aSeat = pr.aSeat;
      prs.bSeat = pr.bSeat;
      prs.ghost = pr.ghost;
      prs.ghostName = pr.ghostName ?? '';
      this.state.pairings.push(prs);
    }
  }

  private pushPrivate(seat: number): void {
    if (!this.match) return;
    const s = this.seats.find((x) => x.seat === seat);
    if (!s || !s.sessionId) return;
    const priv = this.match.getPrivateState(seat);
    if (priv) this.clientFor(s.sessionId)?.send('privateState', priv);
  }

  private pushAllPrivate(): void {
    for (const s of this.seats) if (s.sessionId) this.pushPrivate(s.seat);
  }

  private sendCombat(seat: number, events: unknown, side: 'a' | 'b', opponentName: string): void {
    const s = this.seats.find((x) => x.seat === seat);
    if (!s || !s.sessionId) return;
    this.clientFor(s.sessionId)?.send('combatLog', { events, side, opponentName });
  }
}
