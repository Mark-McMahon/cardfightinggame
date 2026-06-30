import { Schema, type, ArraySchema } from '@colyseus/schema';

// Public room schema (spec §9.3) — synced to ALL clients via @colyseus/schema
// delta sync. Holds only non-sensitive data: HP, tier, alive/placement, pairings.
// Private state (shop/bench/board/gold/combat log) is pushed per-client instead.

export class PlayerSchema extends Schema {
  @type('number') seat = 0;
  @type('string') name = '';
  @type('number') hp = 0;
  @type('number') tier = 1;
  @type('boolean') alive = true;
  @type('number') placement = 0;
  @type('boolean') isBot = false;
  @type('boolean') connected = true;
  @type('boolean') ready = false;
}

export class PairingSchema extends Schema {
  @type('number') aSeat = 0;
  @type('number') bSeat = -1;
  @type('boolean') ghost = false;
  @type('string') ghostName = '';
}

export class RoomState extends Schema {
  @type('string') roomCode = '';
  @type('string') phase = 'lobby';
  @type('number') round = 0;
  @type('number') timer = 0;
  @type('number') hostSeat = 0;
  @type('boolean') botFill = true;
  @type('number') winnerSeat = -1;
  @type([PlayerSchema]) players = new ArraySchema<PlayerSchema>();
  @type([PairingSchema]) pairings = new ArraySchema<PairingSchema>();
}
