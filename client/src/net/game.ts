// game — the Colyseus transport layer, and the ONLY place the network is touched. It maps the
// server message protocol (§9, MatchRoom) onto the store, and exposes intent/lobby senders. Scenes
// never import colyseus.js; they call these functions and read the store via hooks.
//
// Protocol (from the regenerated MatchRoom):
//   client→server: create('match', opts) · joinById(code, {name}) · send('setBotFill'|'startMatch'|'intent', …)
//   server→client: 'state' (auto schema delta) · 'welcome' · 'privateState' · 'combatLog' · 'toast' · 'error'

import { Client, Room } from 'colyseus.js';
import type { Intent, PublicState, PrivateState, CombatEvent, ToastEvent, MatchPhase, Difficulty } from '@cardgame/shared';
import { store } from './store';

export interface CreateOpts {
  name?: string;
  botFill?: boolean;
  botDifficulty?: Difficulty;
  seed?: string;
}

let client: Client | null = null;
let room: Room | null = null;

/**
 * ws endpoint resolution:
 *  1. VITE_SERVER_URL (build-time) wins — for pointing a separately-hosted client at a server.
 *  2. Dev (`import.meta.env.DEV`): Vite (:5173) and Colyseus (:2567) are separate origins.
 *  3. Prod: the server serves this bundle too (§9.8), so connect SAME-ORIGIN — no port suffix
 *     (443 for wss). colyseus.js derives the http(s) matchmake URL from this automatically.
 */
function endpoint(): string {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env;
  if (env?.VITE_SERVER_URL) return env.VITE_SERVER_URL;
  const proto = typeof location !== 'undefined' && location.protocol === 'https:' ? 'wss' : 'ws';
  if (typeof location === 'undefined') return `${proto}://localhost:2567`;
  if (env?.DEV) return `${proto}://${location.hostname}:2567`;
  return `${proto}://${location.host}`;
}

function getClient(): Client {
  if (!client) client = new Client(endpoint());
  return client;
}

/** Project the @colyseus/schema RoomState into a plain, typed PublicState the UI can read. */
function toPublic(s: Record<string, unknown>): PublicState {
  const players = (s.players as Array<Record<string, unknown>>) ?? [];
  const pairings = (s.pairings as Array<Record<string, unknown>>) ?? [];
  return {
    roomCode: String(s.roomCode ?? ''),
    phase: (s.phase as MatchPhase) ?? 'lobby',
    round: Number(s.round ?? 0),
    timer: Number(s.timer ?? 0),
    hostSeat: Number(s.hostSeat ?? 0),
    botFill: Boolean(s.botFill),
    winnerSeat: Number(s.winnerSeat ?? -1),
    players: players.map((p) => ({
      seat: Number(p.seat),
      name: String(p.name ?? ''),
      hp: Number(p.hp ?? 0),
      tier: Number(p.tier ?? 1),
      alive: Boolean(p.alive),
      placement: Number(p.placement ?? 0),
      isBot: Boolean(p.isBot),
      connected: Boolean(p.connected),
      ready: Boolean(p.ready),
    })),
    pairings: pairings.map((pr) => ({
      aSeat: Number(pr.aSeat),
      bSeat: Number(pr.bSeat ?? -1),
      ghost: Boolean(pr.ghost),
      ghostName: pr.ghostName ? String(pr.ghostName) : undefined,
      bye: Boolean(pr.bye),
    })),
  };
}

function wire(r: Room): void {
  room = r;
  store.setConn({ connected: true, connecting: false, roomCode: r.roomId, error: null });

  // 'state' — full public snapshot on every schema delta. `.toJSON()` gives plain nested objects.
  r.onStateChange((s) => {
    const raw = typeof (s as { toJSON?: () => unknown }).toJSON === 'function' ? (s as { toJSON: () => Record<string, unknown> }).toJSON() : (s as unknown as Record<string, unknown>);
    store.setPublic(toPublic(raw));
  });

  r.onMessage('welcome', (m: { seat: number; roomCode: string }) => {
    store.setConn({ seat: m.seat, roomCode: m.roomCode });
  });
  r.onMessage('privateState', (m: PrivateState) => store.setPrivate(m));
  r.onMessage('combatLog', (m: CombatEvent[]) => store.setCombatLog(m));
  r.onMessage('toast', (m: ToastEvent) => store.pushToast(m));
  r.onMessage('error', (m: { error: string }) => {
    store.setConn({ error: m.error });
    store.pushToast({ kind: 'info', message: m.error });
  });

  r.onError((code, message) => store.setConn({ error: message ?? `connection error (${code})`, connecting: false }));
  r.onLeave(() => store.setConn({ connected: false }));
}

export async function createRoom(opts: CreateOpts): Promise<void> {
  store.setConn({ connecting: true, error: null });
  try {
    wire(await getClient().create('match', opts));
  } catch (e) {
    store.setConn({ connecting: false, error: errMsg(e) });
    throw e;
  }
}

export async function joinRoom(code: string, name?: string): Promise<void> {
  store.setConn({ connecting: true, error: null });
  try {
    wire(await getClient().joinById(code, { name }));
  } catch (e) {
    store.setConn({ connecting: false, error: errMsg(e) });
    throw e;
  }
}

export function setBotFill(botFill: boolean): void {
  room?.send('setBotFill', { botFill });
}

export function startMatch(): void {
  room?.send('startMatch', {});
}

export function sendIntent(intent: Intent): void {
  room?.send('intent', intent);
}

export function leaveRoom(): void {
  room?.leave();
  room = null;
  store.reset();
}

// ── drag shop→board = buy + place (§4.2 decision #28). There is no combined intent, so this
//    sequences buy → (await the resulting private push) → playUnit. buyUnit appends to the end of
//    the bench, so the newly-bought unit is the one bench uid that wasn't there before the buy. ──
let pendingPlay: { unsub: () => void; timer: ReturnType<typeof setTimeout> } | null = null;

function clearPendingPlay(): void {
  if (pendingPlay) {
    pendingPlay.unsub();
    clearTimeout(pendingPlay.timer);
    pendingPlay = null;
  }
}

export function buyThenPlay(shopIndex: number, toSlot: number): void {
  clearPendingPlay();
  const before = new Set((store.getState().privateState?.bench ?? []).map((u) => u.uid));
  sendIntent({ type: 'buy', shopIndex });
  const unsub = store.subscribe(() => {
    const bench = store.getState().privateState?.bench ?? [];
    const added = bench.find((u) => !before.has(u.uid));
    if (added) {
      sendIntent({ type: 'playUnit', unitUid: added.uid, toSlot });
      clearPendingPlay();
    }
  });
  const timer = setTimeout(clearPendingPlay, 2500); // buy rejected (no gold / full bench) → give up
  pendingPlay = { unsub, timer };
}

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return 'failed to connect (is the server running on :2567?)';
}
