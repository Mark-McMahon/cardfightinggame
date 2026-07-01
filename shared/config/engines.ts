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
    // Round-6 exponential engine (spoils axis). Gems are a manufactured-event COUNTER, not a
    // linear per-gem stat trickle — the persistent power comes ONLY from the doubler breakpoint,
    // which MULTIPLIES a carry by `doublerFactor` (≤ `multiplyFactorCap`) each turn it fires and
    // so compounds across turns → thousands of stats. Kept beatable by poison (stat-agnostic).
    gemBaseValue: number; // gems a generator makes per shop turn
    gemCarryOver: boolean;
    gemAmplifierValue: number;
    gemDumpThreshold: number; // gems-this-turn to fire the doubler / gem-dump payoffs
    gemDumpPayoffAtk: number; // one-shot also-buff on the dump
    gemDumpPayoffHp: number;
    doublerFactor: number; // multiplyStats factor for the ×N carry doubler (Ivorytusk)
    multiplyFactorCap: number; // HARD cap on ANY multiplyStats factor (caps audit, §5)
    statSanityBound: number; // engineering seatbelt: max atk/hp a multiplyStats may produce
  };
  primordials: {
    // Elements axis — play-count → WIDE cleave splash. Payoffs are breakpoint-gated one-shots.
    elementalPlayBuffAtk: number;
    elementalPlayBuffHp: number;
    rerollSynergyAtk: number;
    rerollSynergySoftCap: number;
  };
  sirens: {
    // Spellcraft axis — a second POISON home + start-of-combat burst (declarative; no spell system).
    spellcraftBuffAtk: number;
    spellcraftBuffHp: number;
    spellpowerPerCast: number;
    burstDamage: number; // start-of-combat damage a Siren throws at the front enemy
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
    // Prompt-2 expansion (sacrifice/risk). Self-damage buys attack; sacrifice trades a body
    // for a durable self-buff. Both fire at START OF COMBAT (live), so the risk is real and
    // the payoff is countered by poison (ignores the swelled stats) and by width.
    selfDamageHpCost: 1,
    selfDamageBuffAtk: 3, // Cinderling: take 1 → gain +3 attack (a fragile tempo body)
    selfDamageBuffHp: 2,
    boardAttackBuffPerTurn: 1, // (engine 11 — reserved; not shipped in this pass)
    sacrificeBuffAtk: 3, // sacrifice a friendly → the sacrificer gains +3/+3
    sacrificeBuffHp: 3,
  },
  tuskers: {
    gemBaseValue: 1,
    gemCarryOver: true,
    gemAmplifierValue: 1,
    gemDumpThreshold: 3, // 3 gems in a turn → the doubler fires (reachable mid-game with 2 generators)
    gemDumpPayoffAtk: 2,
    gemDumpPayoffHp: 2,
    doublerFactor: 2, // ×2 a carry — capped per-application; exponential only across turns
    multiplyFactorCap: 2, // nothing may multiply stats by more than this in one application
    // Engineering seatbelt (Prompt-1 Part A), NOT a design cap. Max reachable in a real match
    // is ~base·2^maxRounds ≈ 8·2^25 ≈ 2.7e8, so 1e12 is far above any reachable state — it can
    // never be hit in a real game. It exists only to guarantee the sim can never overflow to
    // Infinity / lose float precision on a runaway multiply. If it is EVER hit, that itself
    // flags that the interruptibility/counter guard failed upstream (see Part A test).
    statSanityBound: 1e12,
  },
  primordials: {
    elementalPlayBuffAtk: 2,
    elementalPlayBuffHp: 1,
    rerollSynergyAtk: 1,
    rerollSynergySoftCap: 5,
  },
  sirens: {
    spellcraftBuffAtk: 2,
    spellcraftBuffHp: 2,
    spellpowerPerCast: 1,
    burstDamage: 3, // start-of-combat chip; with poison it becomes a stat-agnostic pick
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
