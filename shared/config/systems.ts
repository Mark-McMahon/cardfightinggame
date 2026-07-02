// Cross-tribe systems incl. deferred stubs (spec §12.6).

export interface SystemsConfig {
  // Active in slice (see economy/combat configs for the live values).
  freezeIsFree: boolean;
  // Phase 4 tech-pool injection guarantee (spec §5, decision #49). From `fromRound` onward, if a
  // FRESH roll (startShopPhase draw / rollShop / Oreseeker refresh — never a frozen shop) contains
  // NO card from `cardIds`, ONE slot is replaced by a copy-weighted pool draw restricted to those
  // ids AT OR BELOW the shop tier. The replaced slot is chosen deterministically from the shop RNG.
  techInjection: {
    fromRound: number;
    cardIds: string[];
  };
  // Deferred stubs — reserved, not designed-out.
  trinketOfferTurns: number[];
  trinketTribeWeighting: number;
  tavernSpellShopRarity: number;
  tavernSpellCost: number;
  tavernSpellPermanent: boolean;
  heroPowerCost: number;
  heroPowerBias: number;
}

export const systems: SystemsConfig = {
  freezeIsFree: true,
  techInjection: {
    fromRound: 5,
    // The interaction-tech cards a developed board needs an answer to (poison sources + a
    // stat-neutralizer): Spinefish/Brineling (Reefkin poison), Lurefish/Reefwitch/Venomsong
    // (Sirens poison), Nullforge (Constructs anti-tall resetToBase). All ≤ their shop tier.
    cardIds: ['reefkin_spinefish', 'sirens_lurefish', 'reefkin_brineling', 'sirens_reefwitch', 'sirens_venomsong', 'constructs_nullforge'],
  },
  trinketOfferTurns: [3, 8],
  trinketTribeWeighting: 0.6,
  tavernSpellShopRarity: 0.1,
  tavernSpellCost: 1,
  tavernSpellPermanent: false,
  heroPowerCost: 2,
  heroPowerBias: 0.5,
};
