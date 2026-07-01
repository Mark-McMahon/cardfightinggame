// UnitCard → UnitInstance → CombatUnit (spec §6.7, §7.1). No IO; pure data transforms.

import type { CombatBoard, CombatUnit, UnitInstance } from '../types';
import { getCard } from '../content';
import { triples } from '../config';

/** Golden units carry stats × goldenStatMultiplier (spec §4.2, config/triples). */
export function goldenMultiplier(): number {
  return triples.goldenStatMultiplier;
}

export interface MakeInstanceOpts {
  uid: string;
  golden?: boolean;
  bornTurn?: number;
  /** Override starting stats (e.g. a golden built by triple-merge). Defaults to the card's. */
  atk?: number;
  hp?: number;
}

/** Instantiate a live owned unit from a catalog card. uid is caller-supplied (deterministic). */
export function makeInstance(cardId: string, opts: MakeInstanceOpts): UnitInstance {
  const card = getCard(cardId);
  const golden = opts.golden ?? false;
  const mult = golden ? goldenMultiplier() : 1;
  return {
    uid: opts.uid,
    cardId,
    golden,
    atk: opts.atk ?? card.atk * mult,
    hp: opts.hp ?? card.hp * mult,
    keywords: [...card.keywords],
    bornTurn: opts.bornTurn ?? 0,
  };
}

/** Enrich a live instance into a fully self-describing combat unit (spec §7.1.1). The
 *  combat engine reads everything it needs from this object; planted deathrattles
 *  (`grantedEffects`) are merged into the effect list so they fire in combat. */
export function instanceToCombatUnit(inst: UnitInstance): CombatUnit {
  const card = getCard(inst.cardId);
  return {
    uid: inst.uid,
    cardId: inst.cardId,
    name: card.name,
    tribe: card.tribe,
    tier: card.tier,
    atk: inst.atk,
    hp: inst.hp,
    keywords: [...inst.keywords],
    golden: inst.golden,
    isToken: card.isToken ?? false,
    effects: [...card.effects, ...(inst.grantedEffects ?? [])],
    auras: card.auras ? [...card.auras] : [],
  };
}

/** Convert a player's board (ordered left→right) into a CombatBoard for resolveCombat. */
export function toCombatBoard(board: UnitInstance[], playerTier: number): CombatBoard {
  return {
    units: board.map(instanceToCombatUnit),
    playerTier,
  };
}
