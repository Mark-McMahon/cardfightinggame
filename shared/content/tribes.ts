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
  // ── Prompt-2 expansion (shippable). ──
  infernals: { id: 'infernals', name: 'Infernals', colorHex: '#c0392b', blurb: 'Risk engine. Spend your own bodies and health for burst — fragile, but it spikes.' },
  constructs: { id: 'constructs', name: 'Constructs', colorHex: '#7f8c8d', blurb: 'Assembly. Leave scrap on death and reassemble — a board that degrades gracefully.' },
  // ── Round-6 replayability expansion (shippable). Each adds a distinct keyword strength. ──
  tuskers: { id: 'tuskers', name: 'Tuskers', colorHex: '#b9770e', blurb: 'Spoils. Hoard gems, then DOUBLE a carry — exponential stats that only poison can ignore.' },
  primordials: { id: 'primordials', name: 'Primordials', colorHex: '#16a085', blurb: 'Elements. Play wide and Cleave the board apart — splash that folds to a single tall body.' },
  sirens: { id: 'sirens', name: 'Sirens', colorHex: '#2980b9', blurb: 'Spellcraft. Poison and start-of-combat burst — a stat-agnostic pick that shields answer.' },
  corsairs: { id: 'corsairs', name: 'Corsairs', colorHex: '#34495e', blurb: 'Tempo. On-buy aggression with Reborn and shields — sticky width that cleave and poison punish.' },
};

/** Tribes that have shippable content. Round-6 expands the pool to all NINE tribes: the
 *  original slice (Wildkin/Reefkin/Revenants) + Prompt-2 (Infernals/Constructs) + the four
 *  replayability tribes (Tuskers/Primordials/Sirens/Corsairs). */
export const SLICE_TRIBES: TribeId[] = [
  'wildkin', 'reefkin', 'revenants', 'infernals', 'constructs',
  'tuskers', 'primordials', 'sirens', 'corsairs',
];
