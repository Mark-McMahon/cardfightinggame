// Triple / upgrade config (spec §4.2, §12.4).

export interface TriplesConfig {
  tripleRewardType: 'golden+discover';
  tripleDiscoverTierOffset: number;
  tripleRewardScalesByTier: boolean;
  goldenStatMultiplier: number;
  copiesForTriple: number;
}

export const triples: TriplesConfig = {
  tripleRewardType: 'golden+discover',
  tripleDiscoverTierOffset: 1,
  tripleRewardScalesByTier: false,
  goldenStatMultiplier: 2,
  copiesForTriple: 3,
};
