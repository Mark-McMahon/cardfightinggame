import type { Axis, Keyword, TribeId } from '@cardgame/shared';

// Iconographic glyphs (clean-room §0: abstract/original only, no existing-game art/branding).

/**
 * Tribe crest emblem (design-spec §16.6 "tribe icons"). A static, categorical badge —
 * the visual partner to the tribe colour. Kept deliberately distinct from the four axis
 * glyphs below so a card never shows the same emoji meaning two different things
 * (revenants → 🪦 grave, NOT the 💀 deaths axis). Falls back to the tribe's initial.
 */
export const TRIBE_CREST: Record<TribeId, string> = {
  wildkin: '🌿',
  reefkin: '🌊',
  revenants: '🪦',
  // ── Deferred tribes (post-slice) — emblems reserved so the full roster reads cleanly. ──
  infernals: '🔥',
  tuskers: '💎',
  primordials: '🌀',
  sirens: '🎶',
  constructs: '⚙️',
  corsairs: '⚓',
};

/**
 * Static axis glyph (design-spec §16.6). Marks which competing axis a card *feeds* — a
 * categorical, sortable property like the tribe crest. NEVER board-aware/reactive
 * (decision #28): derived from the card's static `axis` tag, never from what you own.
 *
 * NOTE: no longer rendered on the card face or hover (text-first rework — the axis is
 * archetype jargon, not "what the card does"). Retained as the canonical axis→display
 * mapping for the simulator and any future sort/filter UI.
 */
export const AXIS_GLYPH: Record<Axis, string> = {
  swarm: '🐾',
  deaths: '💀',
  battlecries: '🗣️',
  endure: '🛡️',
  sacrifice: '🩸', // Infernals — spend your own bodies for burst
  assembly: '⚙️', // Constructs — leave scrap on death & reassemble
  spoils: '💎', // Tuskers — gem greed → the compounding doubler
  elements: '🌩️', // Primordials — play-count → wide cleave splash
  spellcraft: '🎼', // Sirens — a second poison home + start-of-combat burst
  tempo: '⚓', // Corsairs — on-buy aggression → sticky reborn/shield width
};

export const AXIS_LABEL: Record<Axis, string> = {
  swarm: 'Swarm',
  deaths: 'Deaths',
  battlecries: 'Battlecries',
  endure: 'Endure',
  sacrifice: 'Sacrifice',
  assembly: 'Assembly',
  spoils: 'Spoils',
  elements: 'Elements',
  spellcraft: 'Spellcraft',
  tempo: 'Tempo',
};

/**
 * Keyword icons (timing rules live in the engine — these are display only, §6.5).
 * NOTE: taunt is 🧱 (a guard wall), NOT 🛡️ — the shield is reserved for the Endure axis
 * glyph (AXIS_GLYPH.endure), and a card may carry both. Keeping them distinct avoids one
 * emoji meaning two things on the same card. Likewise poison is 🧪 (a toxin vial), NOT a
 * skull: ☠️/💀 read as generic "death" (and collide with the Deaths axis glyph 💀 and the
 * Revenants crest 🪦), so nothing on a card reads as death except where death is meant.
 */
export const KW_ICON: Record<Keyword, string> = {
  taunt: '🧱',
  divineShield: '🔆',
  poison: '🧪',
  reborn: '♻️',
  cleave: '🪓',
  magnetic: '🧲',
};

/**
 * Short keyword labels. The card face is now icon-only (text-first rework) — the keyword
 * is named in the native hover title and spelled out in full inside the ability sentence,
 * so these words are no longer printed beside the icon. Retained for any non-face UI that
 * needs a terse keyword label.
 */
export const KW_LABEL: Record<Keyword, string> = {
  taunt: 'Taunt',
  divineShield: 'Shield',
  poison: 'Poison',
  reborn: 'Reborn',
  cleave: 'Cleave',
  magnetic: 'Magnetic',
};
