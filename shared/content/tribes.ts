import type { TribeDef, TribeId } from '../types';

// Clean-room original tribe names (theme: "mythic menagerie"). Reference names
// (spec §0) are NEVER shipped. Slice uses wildkin, revenants, reefkin.
export const TRIBES: Record<TribeId, TribeDef> = {
  wildkin: {
    id: 'wildkin',
    name: 'Wildkin',
    colorHex: '#5a9e4f',
    blurb: 'Token swarm. Go wide and let the brood compound.',
  },
  reefkin: {
    id: 'reefkin',
    name: 'Reefkin',
    colorHex: '#3a8fb7',
    blurb: 'Cheap battlecry tempo, poison and shields.',
  },
  revenants: {
    id: 'revenants',
    name: 'Revenants',
    colorHex: '#8a5cb0',
    blurb: 'Reborn and death payoffs. Fragile, but it hits above its stats.',
  },
  // ── Deferred (post-slice). Reserved for the full roster. ──
  infernals: { id: 'infernals', name: 'Infernals', colorHex: '#c0392b', blurb: 'Self-damage risk economy.' },
  tuskers: { id: 'tuskers', name: 'Tuskers', colorHex: '#b9770e', blurb: 'Gem currency.' },
  primordials: { id: 'primordials', name: 'Primordials', colorHex: '#16a085', blurb: 'Play-count scaling, reroll.' },
  sirens: { id: 'sirens', name: 'Sirens', colorHex: '#2980b9', blurb: 'Temp spellcraft.' },
  constructs: { id: 'constructs', name: 'Constructs', colorHex: '#7f8c8d', blurb: 'Magnetic merge.' },
  corsairs: { id: 'corsairs', name: 'Corsairs', colorHex: '#34495e', blurb: 'On-buy tempo.' },
};

/** Tribes that have shippable content in the vertical slice. */
export const SLICE_TRIBES: TribeId[] = ['wildkin', 'reefkin', 'revenants'];
