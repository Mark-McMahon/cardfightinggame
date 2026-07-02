// PUBLIC @colyseus/schema classes — the two-channel PUBLIC half (spec §9.3, invariant 3).
//
// This schema is auto-synced (delta) to EVERY client in the room. It therefore mirrors ONLY
// the fields of `PublicState` / `PublicPlayer` / `Pairing` from `@cardgame/shared`. It MUST
// NEVER carry any private field (gold, shop, bench, board, gems, hand, discover, pendingTarget,
// combat log, log). Private per-player state travels solely on the owner-only `privateState`
// push (see MatchRoom.pushPrivate). This is EV-INV-PRIV enforced at the transport boundary.
//
// `defineTypes` (rather than TS decorators) is used deliberately: it needs no
// experimentalDecorators / useDefineForClassFields tsconfig coupling, so the same source
// typechecks under `tsc` and runs under `tsx`/esbuild identically.

import { Schema, ArraySchema, defineTypes } from '@colyseus/schema';
import type { MatchPhase, Pairing, PublicPlayer, PublicState } from '@cardgame/shared';

export class PlayerSchema extends Schema {
  seat = 0;
  name = '';
  hp = 0;
  tier = 1;
  alive = true;
  placement = 0;
  isBot = false;
  connected = true;
  ready = false;
}
defineTypes(PlayerSchema, {
  seat: 'number',
  name: 'string',
  hp: 'number',
  tier: 'number',
  alive: 'boolean',
  placement: 'number',
  isBot: 'boolean',
  connected: 'boolean',
  ready: 'boolean',
});

export class PairingSchema extends Schema {
  aSeat = 0;
  bSeat = -1;
  ghost = false;
  ghostName = '';
  bye = false;
}
defineTypes(PairingSchema, {
  aSeat: 'number',
  bSeat: 'number',
  ghost: 'boolean',
  ghostName: 'string',
  bye: 'boolean',
});

export class RoomState extends Schema {
  roomCode = '';
  phase = 'lobby';
  round = 0;
  timer = 0;
  players = new ArraySchema<PlayerSchema>();
  pairings = new ArraySchema<PairingSchema>();
  hostSeat = 0;
  botFill = true;
  winnerSeat = -1;
}
defineTypes(RoomState, {
  roomCode: 'string',
  phase: 'string',
  round: 'number',
  timer: 'number',
  players: [PlayerSchema],
  pairings: [PairingSchema],
  hostSeat: 'number',
  botFill: 'boolean',
  winnerSeat: 'number',
});

// ── projection helpers (engine PublicState -> schema) ─────────────────────────────

export function writePlayer(dst: PlayerSchema, src: PublicPlayer, connected: boolean, isBot: boolean): void {
  dst.seat = src.seat;
  dst.name = src.name;
  dst.hp = src.hp;
  dst.tier = src.tier;
  dst.alive = src.alive;
  dst.placement = src.placement;
  dst.ready = src.ready;
  // connected / isBot are owned by the transport layer (reconnect + bot-takeover), not the engine.
  dst.connected = connected;
  dst.isBot = isBot;
}

export function makePairing(src: Pairing): PairingSchema {
  const p = new PairingSchema();
  p.aSeat = src.aSeat;
  p.bSeat = src.bSeat;
  p.ghost = src.ghost;
  p.ghostName = src.ghostName ?? '';
  p.bye = src.bye ?? false;
  return p;
}

export function setPhase(dst: RoomState, phase: MatchPhase): void {
  dst.phase = phase;
}

/** Placate the type-checker that PublicState is the shape we mirror (no runtime effect). */
export type MirroredPublic = PublicState;
