// Match config (spec §4, §12.2).

export interface MatchConfig {
  startingHealth: number;
  /** loss damage = clamp(playerTier*w1 + Σ(survivor tiers)*w2, 0, cap) */
  lossBaseTierWeight: number;
  survivorTierWeight: number;
  lossDamageCap: number;
  simultaneousEliminationRule: 'moreNegativeHpPlacesLower';
  shopTimerBase: number;
  shopTimerPerTier: number;
  /** Extra seconds per gold the wealthiest player has — more gold = more buys/rolls to do. */
  shopTimerPerGold: number;
  shopTimerCap: number;
  reconnectGraceSeconds: number;
  ghostsEnabled: boolean;
  avoidImmediateRematch: boolean;
  maxSeats: number;
  /** Hard cap; if reached, the match is finalized by remaining HP (prevents
   *  two mutually-unkillable boards tying forever — spec open-question §3). */
  maxRounds: number;
}

export const match: MatchConfig = {
  startingHealth: 30,
  lossBaseTierWeight: 1,
  survivorTierWeight: 1,
  lossDamageCap: 15,
  simultaneousEliminationRule: 'moreNegativeHpPlacesLower',
  shopTimerBase: 40,
  shopTimerPerTier: 5,
  shopTimerPerGold: 2,
  shopTimerCap: 90,
  reconnectGraceSeconds: 60,
  ghostsEnabled: true,
  avoidImmediateRematch: true,
  maxSeats: 8,
  maxRounds: 25,
};
