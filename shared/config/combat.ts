// Combat config (spec §7, §12.3).

// D7 (design-spec §7.6 #6, §12): the single-valued knobs `attackOrderRule`/
// `firstAttackerTiebreak` are deleted — their behavior is fixed, so they were never real
// knobs. `simultaneousDeaths`/`deathrattleOrder`/`divineShieldNegatesPoison` are honored.
export interface CombatConfig {
  targetingMode: 'random' | 'deterministic';
  tauntOverride: boolean;
  maxCombatSteps: number;
  divineShieldNegatesPoison: boolean;
  cleaveDefault: number; // fraction of attack dealt to neighbors
  simultaneousDeaths: boolean;
  deathrattleOrder: 'boardLeftToRight';
}

export const combat: CombatConfig = {
  targetingMode: 'random',
  tauntOverride: true,
  maxCombatSteps: 400,
  divineShieldNegatesPoison: true,
  cleaveDefault: 1.0,
  simultaneousDeaths: true,
  deathrattleOrder: 'boardLeftToRight',
};
