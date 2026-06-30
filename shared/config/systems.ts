// Cross-tribe systems incl. deferred stubs (spec §12.6).

export interface SystemsConfig {
  // Active in slice (see economy/combat configs for the live values).
  freezeIsFree: boolean;
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
  trinketOfferTurns: [3, 8],
  trinketTribeWeighting: 0.6,
  tavernSpellShopRarity: 0.1,
  tavernSpellCost: 1,
  tavernSpellPermanent: false,
  heroPowerCost: 2,
  heroPowerBias: 0.5,
};
