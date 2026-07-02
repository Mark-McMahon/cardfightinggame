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
    // Phase 3 LIFETIME-death scaling additions
    graveEmperorDeathThreshold: number; // friendly deaths THIS combat needed for the contested double
    graveEmperorFactor: number; // permanent multiplyStats factor (capped by multiplyFactorCap)
  };
  infernals: {
    selfDamageHpCost: number;
    selfDamageBuffAtk: number;
    selfDamageBuffHp: number;
    boardAttackBuffPerTurn: number;
    sacrificeBuffAtk: number;
    sacrificeBuffHp: number;
    // Phase 3 CONSUMPTION additions
    loneVanguardBuffAtk: number; // Lone Vanguard: leftmost ally +atk this combat (go-tall payoff)
    loneVanguardBuffHp: number;
    loneVanguardAllyThreshold: number; // fires only at ≤ this many minions (alliesAtMost)
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
    // Phase 5 (decision #54) MAGNETIC merge system (reserved→live). A friendly Construct may absorb up
    // to `magneticMergeCap` magnetic units (discrete per-unit cap → breakpoint law #22; standalone play
    // is NEVER blocked, only merging beyond the cap is refused).
    magneticMergeCap: number;
    // Phase 5 (decision #55) Forgemaster: per-Forgemaster-PLAYED buff applied to every future Sentinel at
    // its combat creation (+forgemasterSentinelBuff/+forgemasterSentinelBuff × forgemastersPlayed stacks).
    forgemasterSentinelBuff: number;
    // content pointer (single-sources which summoned token the Forgemaster stack buffs; card-id refs in
    // config are the established pattern — cf. systems.techInjection.cardIds, breakpoints summonUnitId).
    forgemasterSentinelId: string;
    mechDeathTokenAtk: number;
    mechDeathTokenHp: number;
  };
  corsairs: {
    onBuyBuffAtk: number;
    onBuyBuffHp: number;
    costReductionAmount: number;
    // Phase 4 POSITIONAL aura (Vanguard Pennant, §6.4): flat +attack the LEFTMOST friendly gets.
    // `Cap` bounds the stacked total so multiple pennants stay a fixed positional utility buff, not
    // an unbounded per-unit scaler (breakpoint law #22 — not a primary scaling counter).
    leftmostAttackBuff: number;
    leftmostAttackBuffCap: number;
    // Phase 5 (decision #56) GOLD-economy cards (gold ONLY; gold/gems stay separate — the churn loop is
    // bounded because a buy(3g)/sell(≤2g) cycle strictly LOSES gold, so it cannot mint infinite money).
    bursarGold: number; // Bursar battlecry: gold delivered at the START of the next shop turn (delayed queue)
    moneylenderThreshold: number; // Moneylender end-of-turn gate: unspent gold needed to queue next-turn gold
    moneylenderGold: number; // Moneylender payoff: delayed gold queued (once — non-stacking)
    fenceSellRefund: number; // Fence: minions sell for this while a Fence is on board (overrides economy.sellRefund)
    vaultKeeperGoldCap: number; // Vault Keeper: effective gold cap while a Vault Keeper is on board
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
    // Phase 3 LIFETIME scaling: Grave Emperor's contested-condition double — exponential, but each
    // double demands surviving a near-wipe (5+ friendlies dead THIS combat). Factor capped at
    // multiplyFactorCap (=2) by applyMultiply, so the caps lint (EV-BAL-E) holds.
    graveEmperorDeathThreshold: 5,
    graveEmperorFactor: 2,
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
    // Phase 3 CONSUMPTION: Lone Vanguard concentrates a wide-enough board into one leftmost threat.
    loneVanguardBuffAtk: 4, // +4/+4 to the leftmost ally, THIS COMBAT (pure combat buff — never folds)
    loneVanguardBuffHp: 4,
    loneVanguardAllyThreshold: 4, // only at ≤4 minions (a go-tall reward; wide boards do not qualify)
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
    magneticMergeCap: 5, // a tower absorbs ≤5 merges (discrete cap; poison/Nullforge/width still counter it)
    forgemasterSentinelBuff: 1, // +1/+1 per Forgemaster played, to every future Sentinel (this game)
    forgemasterSentinelId: 'constructs_sentinel',
    mechDeathTokenAtk: 1,
    mechDeathTokenHp: 1,
  },
  corsairs: {
    onBuyBuffAtk: 1,
    onBuyBuffHp: 1,
    costReductionAmount: 1,
    leftmostAttackBuff: 2, // Vanguard Pennant: your leftmost minion has +2 attack (positional)
    leftmostAttackBuffCap: 4, // two pennants max out here — a fixed slot buff, never a runaway lever
    bursarGold: 2, // Bursar: +2 gold at the start of your next turn (delayed)
    moneylenderThreshold: 3, // Moneylender: needs ≥3 unspent gold at end of turn…
    moneylenderGold: 1, // …to queue +1 gold next turn (non-stacking)
    fenceSellRefund: 2, // Fence: your minions sell for 2 (vs base 1) — a buy(3)/sell(2) churn still loses 1g/cycle
    vaultKeeperGoldCap: 13, // Vault Keeper: effective gold cap 13 while on board (vs base 10)
  },
};
