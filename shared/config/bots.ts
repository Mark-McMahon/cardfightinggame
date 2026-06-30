// Bot AI tuning (spec §10, §12.7). Difficulty presets = weight bundles.

export interface BotWeights {
  /** Higher = save gold / value econ; lower = spend on tempo. */
  greed: number;
  /** Probability-ish weight toward rolling for upgrades. */
  rollAggression: number;
  /** Round by which the bot commits hard to a tribe. */
  tribeCommitTurn: number;
  /** Bonus multiplier applied to on-tribe / synergy units when scoring. */
  synergyValue: number;
  /** Minimum scored power gain to justify a reroll. */
  rerollThreshold: number;
  /** How eagerly it tiers up (gold buffer it keeps before ramping). */
  tierUpEagerness: number;
  // ── Round-6 breakpoint/axis awareness (spec §16.1, §16.7) ───────────────────
  /** Score bonus per static axis-glyph a card carries that matches the build's
   *  target axis/axes (makes the bot chase its manufactured-event payoffs). */
  axisValue: number;
  /** Extra bonus for a "bridge" card (feeds ≥2 axes) when it matches a target axis —
   *  the cross-tribe glue that lets a 2-tribe splash hit two breakpoints (§16.3). */
  bridgeValue: number;
  /** Bonus for owning a ⭐ breakpoint payoff card (build-defining). */
  breakpointValue: number;
  /** When a 2-tribe splash bot is lopsided (lots of one committed tribe, little of the
   *  other), this nudges scoring toward the under-represented tribe so the splash is real
   *  and its second breakpoint is actually reachable. 0 disables the nudge. */
  splashBalanceBonus: number;
  /** How many DISTINCT breakpoint payoffs the bot actively assembles. While it owns fewer
   *  than this and none is on offer, it will spend a roll to hunt for one (the second break
   *  a splash needs — §16.7b). */
  breakpointHuntTarget: number;
  /** Max rolls per shop turn the bot spends hunting for a missing breakpoint. */
  breakpointHuntMaxRolls: number;
}

export interface BotsConfig {
  difficultyPresets: {
    easy: BotWeights;
    medium: BotWeights;
    hard: BotWeights;
  };
}

export const bots: BotsConfig = {
  difficultyPresets: {
    easy: {
      greed: 0.3,
      rollAggression: 0.2,
      tribeCommitTurn: 6,
      synergyValue: 1.1,
      rerollThreshold: 4,
      tierUpEagerness: 0.3,
      axisValue: 0.5,
      bridgeValue: 0.5,
      breakpointValue: 1,
      splashBalanceBonus: 2,
      breakpointHuntTarget: 1,
      breakpointHuntMaxRolls: 1,
    },
    medium: {
      greed: 0.5,
      rollAggression: 0.45,
      tribeCommitTurn: 4,
      synergyValue: 1.4,
      rerollThreshold: 2.5,
      tierUpEagerness: 0.55,
      axisValue: 2.5,
      bridgeValue: 3,
      breakpointValue: 10,
      splashBalanceBonus: 6,
      breakpointHuntTarget: 2,
      breakpointHuntMaxRolls: 2,
    },
    hard: {
      greed: 0.7,
      rollAggression: 0.6,
      tribeCommitTurn: 3,
      synergyValue: 1.8,
      rerollThreshold: 1.5,
      tierUpEagerness: 0.75,
      axisValue: 2.5,
      bridgeValue: 3,
      breakpointValue: 5,
      splashBalanceBonus: 5,
      breakpointHuntTarget: 3,
      breakpointHuntMaxRolls: 3,
    },
  },
};

export type Difficulty = keyof BotsConfig['difficultyPresets'];
