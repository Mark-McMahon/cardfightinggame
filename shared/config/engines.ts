// Per-tribe engine tuning knobs (spec §12.5). One block per reference engine.
// Content data files read these numbers so balance = edit config, never logic.

export interface EnginesConfig {
  wildkin: {
    tokensPerTurn: number;
    buffPerToken: number;
    tokenBuffPermanent: boolean;
    endOfTurnTriggerMultiplier: number;
    endOfTurnTriggerMultiplierCap: number; // Round-6 cap (§16.2 Grovecaller)
    avengeDeathThreshold: number;
    avengePayoffAtk: number;
    avengePayoffHp: number;
    tokenDeathFloorAtk: number; // Round-6 thin floor: +atk each friendly token dies (§16.5)
    tokenDeathFloorCapAtk: number; // total floor atk cap (never dominant — §16.1)
    deathrattleReplayScope: 'adjacent' | 'wholeBoard';
    deathrattleReplayEachAttack: boolean;
    cleavePercent: number;
  };
  reefkin: {
    battlecryChainAtk: number;
    battlecryChainHp: number;
    battlecryTriggerMultiplier: number;
    battlecryTriggerMultiplierCap: number; // Round-6 cap (§16.2 Echo Choir)
    battlecryDoublerStacks: boolean;
    megabuffAtk: number;
    megabuffHp: number;
    megabuffPersists: boolean;
    plantedDeathrattleAtk: number; // Round-6 Reefmourner planted "Deathrattle: board +x/+y"
    plantedDeathrattleHp: number;
  };
  revenants: {
    rebornHp: number;
    deathPayoffHp: number;
    undeadDamageAmp: number; // multiplier (now gated on a DEATHS breakpoint — §16.2)
    undeadDamageAmpCap: number; // Round-6 cap on the amp value
    undeadDamageThreshold: number; // revenant deaths needed to switch the amp on
    undeadDamageAmpStacks: boolean;
  };
  infernals: {
    selfDamageHpCost: number;
    selfDamageBuffAtk: number;
    selfDamageBuffHp: number;
    boardAttackBuffPerTurn: number;
    sacrificeBuffAtk: number;
    sacrificeBuffHp: number;
  };
  tuskers: {
    gemBaseValue: number;
    gemCarryOver: boolean;
    gemAmplifierValue: number;
    gemDumpThreshold: number;
    gemDumpPayoffAtk: number;
    gemDumpPayoffHp: number;
  };
  primordials: {
    elementalPlayBuffAtk: number;
    elementalPlayBuffHp: number;
    rerollSynergyAtk: number;
    rerollSynergySoftCap: number;
  };
  sirens: {
    spellcraftBuffAtk: number;
    spellcraftBuffHp: number;
    spellpowerPerCast: number;
  };
  constructs: {
    magneticStatsCarried: boolean;
    magneticKeywordsStack: boolean;
    mechDeathTokenAtk: number;
    mechDeathTokenHp: number;
  };
  corsairs: {
    onBuyBuffAtk: number;
    onBuyBuffHp: number;
    costReductionAmount: number;
  };
}

export const engines: EnginesConfig = {
  wildkin: {
    tokensPerTurn: 2, // tuned up (macro §16.7b/d): SWARM was unreachable (Mother Thorn 14%) and a trap
    buffPerToken: 2, // tuned up (macro): token engine was under-rewarding
    tokenBuffPermanent: false, // token-death floor fires IN combat ("this combat" per card text) — combat buffs don't persist (writeback gap), so flagging it permanent was a no-op lie
    endOfTurnTriggerMultiplier: 2,
    endOfTurnTriggerMultiplierCap: 2,
    avengeDeathThreshold: 2, // fires sooner — go-wide payoff
    avengePayoffAtk: 2,
    avengePayoffHp: 2,
    tokenDeathFloorAtk: 1,
    tokenDeathFloorCapAtk: 6,
    deathrattleReplayScope: 'adjacent',
    deathrattleReplayEachAttack: true,
    cleavePercent: 1.0,
  },
  reefkin: {
    battlecryChainAtk: 1,
    battlecryChainHp: 1,
    battlecryTriggerMultiplier: 2,
    battlecryTriggerMultiplierCap: 2,
    battlecryDoublerStacks: false,
    megabuffAtk: 4,
    megabuffHp: 4,
    megabuffPersists: true,
    plantedDeathrattleAtk: 1,
    plantedDeathrattleHp: 1,
  },
  revenants: {
    rebornHp: 1,
    deathPayoffHp: 2,
    undeadDamageAmp: 2,
    undeadDamageAmpCap: 2,
    undeadDamageThreshold: 3,
    undeadDamageAmpStacks: false,
  },
  infernals: {
    selfDamageHpCost: 1,
    selfDamageBuffAtk: 2,
    selfDamageBuffHp: 2,
    boardAttackBuffPerTurn: 1,
    sacrificeBuffAtk: 3,
    sacrificeBuffHp: 3,
  },
  tuskers: {
    gemBaseValue: 1,
    gemCarryOver: true,
    gemAmplifierValue: 1,
    gemDumpThreshold: 3,
    gemDumpPayoffAtk: 2,
    gemDumpPayoffHp: 2,
  },
  primordials: {
    elementalPlayBuffAtk: 1,
    elementalPlayBuffHp: 1,
    rerollSynergyAtk: 1,
    rerollSynergySoftCap: 5,
  },
  sirens: {
    spellcraftBuffAtk: 2,
    spellcraftBuffHp: 2,
    spellpowerPerCast: 1,
  },
  constructs: {
    magneticStatsCarried: true,
    magneticKeywordsStack: true,
    mechDeathTokenAtk: 1,
    mechDeathTokenHp: 1,
  },
  corsairs: {
    onBuyBuffAtk: 1,
    onBuyBuffHp: 1,
    costReductionAmount: 1,
  },
};
