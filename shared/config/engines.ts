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
    // Exponential engine (spoils axis), reworked by decision #39: gems are a SPENDABLE wallet.
    // The persistent power comes ONLY from the PURCHASED doubler (activated ability): the owner
    // spends gems to MULTIPLY a carry by `doublerFactor` (≤ `multiplyFactorCap`) once per turn
    // per doubler, at an escalating per-GAME price (`doubleBaseCost + doubleCostStep ×
    // doublesPurchased`, shared across all doublers) — so it compounds across turns → thousands
    // of stats, but every step is paid. Kept beatable by poison (stat-agnostic).
    gemBaseValue: number; // gems a generator makes per shop turn
    gemCarryOver: boolean;
    gemAmplifierValue: number;
    gemDumpThreshold: number; // legacy gems-this-turn threshold knob (no live consumer since #39)
    gemDumpPayoffAtk: number; // Facetguard's targeted +atk/+hp payoff
    gemDumpPayoffHp: number;
    doublerFactor: number; // multiplyStats factor for the ×N carry doubler (Ivorytusk et al)
    doubleBaseCost: number; // decision #39: gem cost of the FIRST double this game
    doubleCostStep: number; // decision #39: cost increase per double already purchased (per game)
    goldgrinGems: number; // Goldgrin battlecry gem grant (decision #39: literal → knob)
    gemtitanGems: number; // Gemtitan battlecry gem grant (#39 literal→knob pass, completed #43)
    tuskmongerGems: number; // Tuskmonger onSell gem grant (#39 literal→knob pass, completed #43)
    gemwrightCost: number; // Gemwright: spend N gems → +gemwrightGold gold (the ONLY gem→gold bridge)
    gemwrightGold: number;
    facetguardCost: number; // Facetguard: spend N gems → chosen ally +gemDumpPayoff + Divine Shield
    oreseekerCost: number; // Oreseeker: spend N gems → free shop refresh (clears freeze)
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
    tokenBuffPermanent: false, // token-death floor is a THIS-COMBAT buff by design ("this combat" per card text). The knob is LIVE since decision #38 closed the writeback gap: Gorehide/Thornbeast read it into their ActionSpec.permanent, so flipping it to true would make the floor persist across combats via the §7.5 fold — a deliberate balance lever, no longer a no-op.
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
    gemDumpThreshold: 3, // legacy (pre-#39 auto-doubler gate); kept for regen compatibility, no consumer
    gemDumpPayoffAtk: 2,
    gemDumpPayoffHp: 2,
    doublerFactor: 2, // ×2 a carry — capped per-application; exponential only across PURCHASED turns
    doubleBaseCost: 4, // decision #39: first double costs 4 gems…
    doubleCostStep: 2, // …then +2 gems per double already bought this game (shared escalator)
    goldgrinGems: 2,
    gemtitanGems: 3,
    tuskmongerGems: 2,
    gemwrightCost: 3,
    gemwrightGold: 1,
    facetguardCost: 2,
    oreseekerCost: 2,
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
