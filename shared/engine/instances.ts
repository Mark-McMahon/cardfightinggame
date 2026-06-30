import type { ClientUnit, CombatUnit, UnitCard, UnitInstance } from '../types';
import { getCard } from '../content/units';
import { triples } from '../config/triples';

let uidCounter = 0;
/** Monotonic uid generator. Match/shop state owns the sequence so a given intent
 *  stream produces a stable set of uids (reproducible sims). */
export function nextUid(prefix = 'u'): string {
  uidCounter += 1;
  return `${prefix}${uidCounter}`;
}

/** Reset the uid counter — used by tests/sims for reproducible runs. */
export function resetUidCounter(): void {
  uidCounter = 0;
}

export function createInstance(
  cardId: string,
  opts: { golden?: boolean; bornTurn?: number; uid?: string } = {},
): UnitInstance {
  const card = getCard(cardId);
  const golden = opts.golden ?? false;
  const mult = golden ? triples.goldenStatMultiplier : 1;
  return {
    uid: opts.uid ?? nextUid(),
    cardId: card.id,
    golden,
    atk: card.atk * mult,
    hp: card.hp * mult,
    keywords: [...card.keywords],
    bornTurn: opts.bornTurn ?? 0,
  };
}

export function cardOf(inst: UnitInstance): UnitCard {
  return getCard(inst.cardId);
}

/** Build a fully self-describing combat unit from a live instance. */
export function toCombatUnit(inst: UnitInstance): CombatUnit {
  const card = cardOf(inst);
  // Planted deathrattles (Reefmourner, §16.3 #5) live on the instance and are permanent;
  // merge them with the card's own effects so combat sees them.
  const effects =
    inst.grantedEffects && inst.grantedEffects.length > 0
      ? [...card.effects, ...inst.grantedEffects]
      : card.effects;
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
    effects,
    auras: card.auras ?? [],
  };
}

export function toClientUnit(inst: UnitInstance): ClientUnit {
  const card = cardOf(inst);
  return {
    ...inst,
    keywords: [...inst.keywords],
    name: card.name,
    tribe: card.tribe,
    tier: card.tier,
    isToken: card.isToken ?? false,
    text: card.text,
  };
}
