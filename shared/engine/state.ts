// State factories + the two-channel privacy shape (spec §9.3, EV-INV-PRIV).
//
// PublicState is synced to ALL clients and must never carry private data (shop/bench/board/
// gold/gems/hand/opponent combat log). PrivateState is pushed only to the owning client.

import type {
  ClientUnit,
  MatchPhase,
  PublicPlayer,
  PublicState,
  ShopOffer,
  UnitInstance,
} from '../types';
import { economy, match } from '../config';
import { getCard } from '../content';

export function makePublicPlayer(seat: number, name: string, isBot: boolean): PublicPlayer {
  return {
    seat,
    name,
    hp: match.startingHealth,
    tier: 1,
    alive: true,
    placement: 0,
    isBot,
    connected: true,
    ready: false,
  };
}

export function makePublicState(roomCode: string, players: PublicPlayer[], hostSeat = 0): PublicState {
  return {
    roomCode,
    phase: 'lobby' as MatchPhase,
    round: 0,
    timer: 0,
    players,
    pairings: [],
    hostSeat,
    botFill: true,
    winnerSeat: -1,
  };
}

/** Enrich a live instance with catalog display data for the owning client. */
export function toClientUnit(inst: UnitInstance): ClientUnit {
  const card = getCard(inst.cardId);
  return {
    ...inst,
    name: card.name,
    tribe: card.tribe,
    tier: card.tier,
    isToken: card.isToken ?? false,
    text: card.text,
  };
}

/** A purchasable shop slot's public-facing (to the owner) offer view. */
export function toShopOffer(cardId: string): ShopOffer {
  const card = getCard(cardId);
  return {
    cardId,
    name: card.name,
    tribe: card.tribe,
    tier: card.tier,
    atk: card.atk,
    hp: card.hp,
    keywords: [...card.keywords],
    text: card.text,
  };
}

/** Current base income for a round (spec §5): goldStart, +goldPerTurn each round, capped. The cap
 *  defaults to `economy.goldCap` but callers pass the EFFECTIVE cap (Phase 5 Vault Keeper raises it). */
export function baseIncomeForRound(round: number, cap: number = economy.goldCap): number {
  const income = economy.goldStart + Math.max(0, round - 1) * economy.goldPerTurn;
  return Math.min(cap, income);
}
