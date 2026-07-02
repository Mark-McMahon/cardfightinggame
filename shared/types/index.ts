// ─────────────────────────────────────────────────────────────────────────────
// Core identifiers & enums (spec §6.1)
// ─────────────────────────────────────────────────────────────────────────────

export type TribeId =
  | 'wildkin'
  | 'reefkin'
  | 'infernals'
  | 'tuskers'
  | 'primordials'
  | 'sirens'
  | 'revenants'
  | 'constructs'
  | 'corsairs';

/** Slice uses: taunt, divineShield, poison, reborn, cleave. (magnetic deferred.) */
export type Keyword =
  | 'taunt'
  | 'divineShield'
  | 'poison'
  | 'reborn'
  | 'cleave'
  | 'magnetic';

export type TriggerType =
  | 'battlecry'
  | 'deathrattle'
  | 'onAttack'
  | 'onDamaged'
  | 'onShieldBreak' // this unit's own divine shield was just broken (Round-6, spec §16.3 #4)
  | 'startOfCombat'
  | 'endOfCombat' // fires for LIVING units once the fight ends (Phase 3 Grave Emperor — a survival-gated payoff)
  | 'endOfTurn' // shop-phase end
  | 'onPlayTribe'
  | 'onPurchase'
  | 'onSell' // a friendly was sold this shop turn (Pattern B: sell a body for a resource)
  | 'afterFriendlyBattlecry' // a friendly battlecry resolved (Pattern A: paid-per-cast tribe scalar)
  | 'onRefresh'
  | 'onCast'
  | 'afterFriendlyDeaths' // avenge counter (combat)
  | 'onSacrifice'
  | 'onSpend'
  | 'onSummon'
  | 'onTripleCreated';

/**
 * Manufactured-event axes (Round-6, spec §16.1). STATIC/categorical only — marks which
 * axis a card feeds, like the tribe crest. NEVER board-aware/reactive (decision #28).
 *
 * Prompt-2 content expansion adds two axes that FIGHT the existing four for board slots
 * (not orthogonal lanes): `sacrifice` (Infernals — proactively spend your own bodies for
 * burst; tensions against endure/swarm and shares the deaths counter as an aggressor) and
 * `assembly` (Constructs — leave scrap on death & reassemble; tensions against endure/deaths).
 *
 * Round-6 replayability expansion adds FOUR more competing axes, each with a distinct
 * keyword strength (so the web gains more reachable counter-homes): `spoils` (Tuskers —
 * gem greed → a capped-but-COMPOUNDING doubler that can reach thousands of stats, kept
 * beatable by poison), `elements` (Primordials — play-count → wide CLEAVE splash),
 * `spellcraft` (Sirens — a second POISON home + start-of-combat burst) and `tempo`
 * (Corsairs — on-buy aggression → sticky REBORN/divine-shield width).
 */
export type Axis =
  | 'swarm'
  | 'deaths'
  | 'battlecries'
  | 'endure'
  | 'sacrifice'
  | 'assembly'
  | 'spoils'
  | 'elements'
  | 'spellcraft'
  | 'tempo';

/** Combat-side counters an aura can gate on (spec §16.2 Pale Lich conversion). */
export type AuraCounter = 'deaths' | 'revenantDeaths';

// ─────────────────────────────────────────────────────────────────────────────
// Effect (triggered) — the declarative 90% (spec §6.2)
// ─────────────────────────────────────────────────────────────────────────────

export interface TriggerSpec {
  type: TriggerType;
  tribe?: TribeId; // onPlayTribe / filtered counts
  threshold?: number; // afterFriendlyDeaths (every N), gem-dump threshold
  everyN?: boolean; // repeat each N (true) vs fire once at N (false)
  tokensOnly?: boolean; // afterFriendlyDeaths: count only token deaths (Round-6 token floor, §16.3)
}

export type Selector =
  | 'self'
  | 'triggerSource'
  | 'leftNeighbor'
  | 'rightNeighbor'
  | 'adjacentAllies'
  | 'allAllies'
  | 'randomAlly'
  | 'newestAlly'
  | 'oldestAlly'
  | 'highestStatAlly'
  | 'lowestStatAlly'
  | 'chosenAlly' // player-targeted; resolved in shop only
  | 'leftmostAlly' // POSITIONAL board-index-0 friendly (distinct from bornTurn oldestAlly; Phase 3 Lone Vanguard)
  | 'nAllies'
  | 'randomEnemy'
  | 'frontEnemy'
  | 'highestStatEnemy' // biggest enemy by `stat` (Nullforge — anti-tall neutralize)
  | 'neighborsOfTarget'; // combat damage actions

export interface TargetSpec {
  selector: Selector;
  count?: number;
  filterTribe?: TribeId;
  filterKeyword?: Keyword;
  stat?: 'atk' | 'hp'; // for highest/lowest selectors
  excludeSelf?: boolean;
}

export type ActionType =
  | 'buffStats'
  | 'setStats'
  | 'multiplyStats' // MULTIPLY current stats by `factor` (capped); the exponential lever (§Round-6 Tuskers)
  | 'resetToBase' // strip buffs: reduce a target's atk/hp DOWN to its printed stats (Nullforge anti-tall)
  | 'grantKeyword'
  | 'summon'
  | 'dealDamage'
  | 'destroy' // D11: remove a target (NOT combat damage) — counts as a friendly death + fires its
  // deathrattle; bypasses divine shield (D11(a) ruling). Promoted from the `dealDamage:999` idiom.
  | 'destroyAlly' // Phase 3 (shop-phase): destroy a CHOSEN friendly — removes it, increments the
  // persistent lifetimeFriendlyDeaths counter, fires no combat/deathrattle (there is no shop combat).
  | 'absorbStats' // Phase 3 (shop-phase): the SOURCE permanently gains the TARGET's CURRENT atk/hp
  // (reads live instance stats — a golden target contributes its doubled stats). Keywords NOT transferred.
  | 'giveGem'
  | 'makeSpell'
  | 'gainGold' // LIVE in the activated-ability resolver only (decision #39): gold clamped to goldCap
  | 'refreshShop' // LIVE in the activated-ability resolver only (decision #39): free reroll (clears freeze)
  | 'discover'
  | 'plantDeathrattle' // attach a deathrattle Effect to a target (Round-6 bridge, §16.3 #5)
  | 'custom';

export interface ActionSpec {
  type: ActionType;
  atk?: number;
  hp?: number;
  permanent?: boolean; // buffStats/setStats
  /**
   * multiplyStats: multiply each target's CURRENT atk/hp by this factor (rounded), clamped to
   * the tribe's `multiplyFactorCap` (Round-6 §caps). Per-application factor is capped — the
   * exponential reach comes from applying it across TURNS (shop-fired, so it persists and
   * compounds), never from an uncapped single multiply. Kept beatable by poison (stat-agnostic).
   */
  factor?: number;
  keyword?: Keyword; // grantKeyword
  summonUnitId?: string;
  summonCount?: number; // summon
  amount?: number; // dealDamage / giveGem / gainGold
  discoverFromTierOffset?: number; // discover
  planted?: Effect; // plantDeathrattle: the deathrattle Effect to attach
  handlerId?: string;
  params?: Record<string, unknown>; // custom escape-hatch
}

export interface ConditionSpec {
  kind:
    | 'hasTribe'
    | 'hasKeyword'
    | 'countAllies'
    | 'goldAtLeast'
    | 'tierAtLeast'
    | 'isGolden'
    | 'gemsThisTurnAtLeast'
    | 'isToken'
    // Round-6 manufactured-event breakpoints (spec §16.3):
    | 'battlecriesThisTurnAtLeast' // shop counter; Echo Choir's doubled triggers count
    | 'tokensSummonedThisTurnAtLeast' // shop counter; SWARM (Mother Thorn)
    | 'deathsThisCombatAtLeast' // combat counter; DEATHS (Bone Colossus)
    | 'alliesAtMost' // Phase 3: true iff the controller has ≤ value minions (Lone Vanguard — a go-tall gate)
    | 'lifetimeDeathsAtLeast'; // Phase 3: persistent per-player friendly-death total (Ossuary Titan; combat reads the CombatBoard scalar)
  value?: number;
  tribe?: TribeId;
  keyword?: Keyword;
}

export interface Effect {
  trigger: TriggerSpec; // WHEN
  condition?: ConditionSpec; // optional gate
  target: TargetSpec; // WHO
  actions: ActionSpec[]; // WHAT (one or more)
}

// ─────────────────────────────────────────────────────────────────────────────
// Activated ability (spend-gated, decision #39; spec §6.6a)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A shop-phase ability the OWNER buys with gems (the spendable wallet, decision #39).
 * Declarative like an Effect, but there is no trigger: the "trigger" is the player's
 * `activate` intent, validated + resolved by the shop reducer op `activateAbility`
 * (once per turn per minion, board units only, wallet ≥ cost). `chosenAlly` targets
 * reuse the pendingTarget machinery (§7.4). Costs are config numbers on the card row
 * (never literals in logic) or the shared escalating doubler formula:
 * `engines.tuskers.doubleBaseCost + doubleCostStep × session.doublesPurchased`
 * (doublesPurchased is per-player per-GAME, shared across all doublers, never resets).
 */
export interface ActivatedSpec {
  cost: number | 'doublerEscalating'; // gem price (flat, from config) or the escalating doubler formula
  target: TargetSpec;
  actions: ActionSpec[];
  prompt?: string; // pendingTarget/UI description for chosenAlly abilities
}

// ─────────────────────────────────────────────────────────────────────────────
// Aura (passive modifier) — the multipliers (spec §6.3)
// ─────────────────────────────────────────────────────────────────────────────

export interface AuraSpec {
  scope:
    | 'selfTribeAllies'
    | 'allAllies'
    | 'yourBattlecries'
    | 'yourEndOfTurn'
    | 'yourGems'
    | 'yourSpells'
    | 'shopCostTribe';
  modifier: {
    kind:
      | 'triggerMultiplier'
      | 'damageMultiplier'
      | 'costReduction'
      | 'gemValueAdd'
      | 'spellPowerAdd'
      | 'statBuffOnEvent';
    value: number;
    tribe?: TribeId;
  };
  stacks?: boolean; // multiple copies stack vs not
  /**
   * Round-6 (spec §16.2): gate the aura on a combat-side breakpoint. Inactive until the
   * bearer's side reaches `threshold` of `counter`. Used to convert Pale Lich's always-on
   * damage amp into a DEATHS breakpoint.
   */
  activeWhen?: { counter: AuraCounter; threshold: number };
}

// ─────────────────────────────────────────────────────────────────────────────
// Unit / tribe / keyword definitions (spec §6.4, §6.5)
// ─────────────────────────────────────────────────────────────────────────────

export interface UnitCard {
  id: string; // stable catalog key, e.g. 'wildkin_brambleling'
  name: string; // original display name
  tribe: TribeId;
  tier: number; // 1..6
  atk: number;
  hp: number;
  keywords: Keyword[];
  effects: Effect[];
  auras?: AuraSpec[];
  activated?: ActivatedSpec; // spend-gated activated ability (decision #39, §6.6a)
  isToken?: boolean; // pool-exempt, not directly purchasable
  goldenOf?: string; // base id, if this is a golden form
  text?: string; // human-readable rules text (placeholder UI)
  axis?: Axis[]; // Round-6 static axis glyph(s) this card feeds (categorical only, §16.6)
}

export interface TribeDef {
  id: TribeId;
  name: string;
  colorHex: string;
  blurb: string;
}

export interface KeywordDef {
  id: Keyword;
  name: string;
  rulesText: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Unit instances (live objects owned by a player; uid !== cardId)
// ─────────────────────────────────────────────────────────────────────────────

export interface UnitInstance {
  uid: string; // unique per live instance
  cardId: string; // catalog id (base card; effects/auras read from here)
  golden: boolean;
  atk: number; // current persistent attack (base + permanent buffs + golden)
  hp: number; // current persistent health
  keywords: Keyword[]; // current keyword set (base + granted-permanent)
  bornTurn: number; // for newest/oldest ordering
  grantedEffects?: Effect[]; // Round-6: deathrattles planted by Reefmourner (permanent, §16.3 #5)
}

// ─────────────────────────────────────────────────────────────────────────────
// Combat (spec §7)
// ─────────────────────────────────────────────────────────────────────────────

/** Fully self-describing combat unit — combat engine needs no catalog lookups. */
export interface CombatUnit {
  uid: string;
  cardId: string;
  name: string;
  tribe: TribeId;
  tier: number;
  atk: number;
  hp: number;
  keywords: Keyword[];
  golden: boolean;
  isToken: boolean;
  effects: Effect[];
  auras: AuraSpec[];
}

export interface CombatBoard {
  units: CombatUnit[];
  playerTier: number;
  /**
   * Phase 3: the controller's PERSISTENT lifetime friendly-death total, carried IN on the board
   * snapshot (never via ambient state — invariant 1b). A fixed per-board scalar the combat engine
   * reads for `lifetimeDeathsAtLeast` gates (Ossuary Titan); defaults to 0 when absent. Determinism
   * holds: same (boards, seed) — including this scalar — → identical log.
   */
  lifetimeDeaths?: number;
}

export interface BoardSnapshot {
  playerTier: number;
  units: Array<{
    uid: string;
    cardId: string;
    name: string;
    tribe: TribeId;
    tier: number;
    atk: number;
    hp: number;
    keywords: Keyword[];
    golden: boolean;
  }>;
}

export type CombatEvent =
  | { t: 'combatStart'; seed: string; a: BoardSnapshot; b: BoardSnapshot }
  | { t: 'attack'; side: 'a' | 'b'; attackerId: string; defenderId: string }
  | {
      t: 'damage';
      sourceId: string;
      targetId: string;
      amount: number;
      shieldBroken?: boolean;
    }
  | {
      // `gained` marks that the unit GAINED this keyword as an ability (e.g. Spinefish's
      // deathrattle granting Poison), with `sourceId` = the granter — so the replay can show
      // WHICH card got the ability. Plain affliction / shield-break events omit `gained`.
      t: 'keyword';
      unitId: string;
      keyword: Keyword;
      gained?: boolean;
      sourceId?: string;
    }
  | {
      // Round-6 replay legibility: a stat change carries WHO caused it (`sourceId`). `sourceId`
      // is consumed by the replay (links a buff to its source). All optional fields are additive
      // so determinism logs stay stable.
      // `permanent`: LIVE (decision #38, spec §7.5). Combat stays a pure function, but a
      // combat-fired `buffStats` whose ActionSpec has `permanent:true` emits `permanent:true`
      // plus `dAtk`/`dHp` — the post-clamp DELTA that buff applied. `atk`/`hp` are post-buff
      // ABSOLUTES (they include combat-only buffs and are useless for persistence), so the
      // delta fields are what `foldPermanentBuffs` (combatWriteback.ts) replays onto the
      // surviving persistent instances after combat. Non-permanent stat changes (the default,
      // incl. combat damage/reborn resets — those are never buffs) omit all three fields.
      t: 'stats';
      unitId: string;
      atk: number;
      hp: number;
      sourceId?: string;
      permanent?: boolean;
      dAtk?: number; // present iff permanent:true AND the source was a buffStats — the applied attack delta (post-clamp)
      dHp?: number; // present iff permanent:true AND the source was a buffStats — the applied health delta (post-clamp)
      // Phase 3 writeback-multiply extension (additive; §7.5, decision #38 seam extension): present
      // iff permanent:true AND the source was a combat-fired multiplyStats. The CAPPED factor applied
      // (≤ multiplyFactorCap). The fold multiplies the surviving persistent instance by this factor
      // (through the same §6.8 applyMultiply clamps), instead of folding an atk/hp delta (Grave Emperor).
      permanentFactor?: number;
    }
  | { t: 'death'; unitId: string }
  | { t: 'deathrattle'; unitId: string }
  | { t: 'summon'; ownerId: string; unitIds: string[]; slot: number }
  | {
      t: 'combatEnd';
      winner: 'a' | 'b' | 'tie';
      survivors: string[];
      damageToLoser: number;
      // Additive (decision #38, spec §7.5): living uids PER SIDE at combat end, regardless of
      // winner. `survivors` (above) stays winner-side-only for compatibility; the per-side lists
      // exist because a step-cap tie leaves BOTH sides alive (survivors=[] there) and the
      // writeback fold needs each side's survivor set. A reborn-returned unit keeps its uid and
      // appears here (it counts as surviving).
      survivorsA?: string[];
      survivorsB?: string[];
      // Phase 3 (additive): total FRIENDLY deaths per side this combat (incl. tokens/summons), as the
      // engine counted them. Match folds these into each LIVE player's persistent lifetimeFriendlyDeaths
      // (ghosts do not accrue). Derived deterministically; never re-derived from the event stream.
      deathsA?: number;
      deathsB?: number;
    };

export type CombatWinner = 'a' | 'b' | 'tie';

export interface CombatOutcome {
  winner: CombatWinner;
  survivors: string[]; // uids on winning side
  survivorTierSum: number;
  damageToLoser: number;
  steps: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Player intents (client → server) (spec §4.2, §9.4)
// ─────────────────────────────────────────────────────────────────────────────

export type Intent =
  | { type: 'buy'; shopIndex: number }
  | { type: 'sell'; unitUid: string }
  | { type: 'roll' }
  | { type: 'freeze' }
  | { type: 'unfreeze' }
  | { type: 'tierUp' }
  | { type: 'playUnit'; unitUid: string; toSlot?: number } // bench → board
  | { type: 'moveUnit'; unitUid: string; toSlot: number } // reorder on board
  | { type: 'targetChoice'; targetUid: string } // resolve pending targeted battlecry / activated ability
  | { type: 'discoverPick'; optionIndex: number }
  | { type: 'activate'; unitUid: string } // buy a board unit's activated ability with gems (decision #39)
  | { type: 'readyUp' };

export type IntentType = Intent['type'];

// ─────────────────────────────────────────────────────────────────────────────
// State — public (synced to all) and private (owner-only) (spec §9.3)
// ─────────────────────────────────────────────────────────────────────────────

export type MatchPhase = 'lobby' | 'starting' | 'shop' | 'combat' | 'finished';

export interface PublicPlayer {
  seat: number;
  name: string;
  hp: number;
  tier: number;
  alive: boolean;
  placement: number; // 0 = not yet placed
  isBot: boolean;
  connected: boolean;
  ready: boolean;
}

export interface Pairing {
  aSeat: number;
  bSeat: number; // -1 if ghost
  ghost: boolean;
  ghostName?: string;
}

export interface PublicState {
  roomCode: string;
  phase: MatchPhase;
  round: number;
  timer: number; // seconds remaining in current phase
  players: PublicPlayer[];
  pairings: Pairing[];
  hostSeat: number;
  botFill: boolean;
  winnerSeat: number; // -1 until finished
}

/** A unit instance enriched with catalog display data for the owning client. */
export interface ClientUnit extends UnitInstance {
  name: string;
  tribe: TribeId;
  tier: number;
  isToken: boolean;
  text?: string;
}

export interface ShopOffer {
  cardId: string;
  name: string;
  tribe: TribeId;
  tier: number;
  atk: number;
  hp: number;
  keywords: Keyword[];
  text?: string;
}

export interface DiscoverState {
  reason: string; // e.g. "triple reward"
  options: ShopOffer[];
}

export interface PendingTarget {
  sourceUid: string;
  sourceName: string;
  legalTargets: string[]; // uids on the board the player may pick
  description: string;
}

/** Owner-only view of one board unit's activated ability (decision #39). PRIVATE channel only. */
export interface ActivatedAbilityState {
  uid: string; // board unit instance
  cardId: string;
  cost: number; // CURRENT gem cost (escalated for the shared doubler formula)
  used: boolean; // already activated this shop turn (once per turn per minion)
}

export interface PrivateState {
  seat: number;
  gold: number;
  baseIncome: number;
  tier: number;
  tierUpCost: number; // current cost to advance (after discounts), -1 if maxed
  rerollCost: number;
  shop: ShopOffer[];
  frozen: boolean;
  bench: ClientUnit[];
  board: ClientUnit[];
  gems: number; // the SPENDABLE gem wallet (decision #39, supersedes D10's cosmetic total)
  abilities: ActivatedAbilityState[]; // board units with an activated ability (decision #39)
  discover: DiscoverState | null;
  pendingTarget: PendingTarget | null;
  lastCombatLog: CombatEvent[] | null;
  log: string[]; // human-readable feed
}

// ─────────────────────────────────────────────────────────────────────────────
// Server → client message envelope
// ─────────────────────────────────────────────────────────────────────────────

export interface ToastEvent {
  kind: 'triple' | 'eliminated' | 'placement' | 'info' | 'combatResult';
  message: string;
  seat?: number;
}
