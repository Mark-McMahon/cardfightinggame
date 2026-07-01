import type { Keyword, KeywordDef } from '../types';

// Keyword *timing* lives in the combat engine (spec §6.5); these defs are the
// human-readable rules text the engine and UI surface.
export const KEYWORDS: Record<Keyword, KeywordDef> = {
  taunt: {
    id: 'taunt',
    name: 'Taunt',
    rulesText: 'Enemies must attack a unit with Taunt before any other.',
  },
  divineShield: {
    id: 'divineShield',
    name: 'Divine Shield',
    rulesText: 'Negates the next instance of damage entirely, then is consumed.',
  },
  poison: {
    id: 'poison',
    name: 'Poison',
    rulesText: 'Any unit this deals damage to is destroyed.',
  },
  reborn: {
    id: 'reborn',
    name: 'Reborn',
    rulesText: 'The first time this dies, it returns with 1 health.',
  },
  cleave: {
    id: 'cleave',
    name: 'Cleave',
    rulesText: 'Also damages the units adjacent to the defender.',
  },
  magnetic: {
    id: 'magnetic',
    name: 'Magnetic',
    rulesText: 'Can be merged onto another unit, combining stats. (Deferred.)',
  },
};
