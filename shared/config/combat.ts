// Combat config (spec §7, §12.3).

export interface CombatConfig {
  targetingMode: 'random' | 'deterministic';
  tauntOverride: boolean;
  attackOrderRule: 'moreMinionsFirst';
  firstAttackerTiebreak: 'seed';
  maxCombatSteps: number;
  divineShieldNegatesPoison: boolean;
  cleaveDefault: number; // fraction of attack dealt to neighbors
  simultaneousDeaths: boolean;
  deathrattleOrder: 'boardLeftToRight';
}

export const combat: CombatConfig = {
  targetingMode: 'random',
  tauntOverride: true,
  attackOrderRule: 'moreMinionsFirst',
  firstAttackerTiebreak: 'seed',
  maxCombatSteps: 400,
  divineShieldNegatesPoison: true,
  cleaveDefault: 1.0,
  simultaneousDeaths: true,
  deathrattleOrder: 'boardLeftToRight',
};
