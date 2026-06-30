// Economy config (spec §5, §12.1). Arrays are tier-indexed as documented.

export interface EconomyConfig {
  goldStart: number;
  goldPerTurn: number;
  goldCap: number;
  buyCost: number;
  sellRefund: number;
  rerollCost: number;
  freezeCost: number;
  freezePartialAllowed: boolean;
  /** Cost to advance FROM the given tier. Index by current tier (1..6); index 0 unused; index 6 = maxed. */
  tierUpBaseCost: number[];
  tierUpDiscountPerTurn: number;
  /** Units offered per roll. Index by (tier - 1). */
  shopSlotsByTier: number[];
  /** Shared-pool copies per unit. Index by (tier - 1). */
  poolCopiesByTier: number[];
  boardCap: number;
  benchCap: number;
  tierCount: number;
}

export const economy: EconomyConfig = {
  goldStart: 3,
  goldPerTurn: 1,
  goldCap: 10,
  buyCost: 3,
  sellRefund: 1,
  rerollCost: 1,
  freezeCost: 0,
  freezePartialAllowed: false,
  tierUpBaseCost: [0, 5, 7, 8, 9, 10],
  tierUpDiscountPerTurn: 1,
  shopSlotsByTier: [3, 4, 4, 5, 5, 6],
  poolCopiesByTier: [15, 13, 11, 9, 7, 6],
  boardCap: 7,
  benchCap: 10,
  tierCount: 6,
};
