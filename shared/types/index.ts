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
  | 'giveGem'
  | 'makeSpell'
  | 'gainGold'
  | 'discover'
  | 'sacrifice'
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
    | 'deathsThisCombatAtLeast'; // combat counter; DEATHS (Bone Colossus)
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
      // is consumed by the replay (links a buff to its source). Both fields are optional/additive
      // so determinism logs stay stable.
      // `permanent`: RESERVED. Combat is a pure function and combat-fired stat changes are never
      // written back to the persistent board (the "writeback gap"), so in-combat permanence is not
      // a real mechanic — all combat buffs are this-combat-only and emit `permanent: false`. The
      // field is kept as the seam to restore a perm/temp distinction IF the writeback gap is ever
      // closed; until then nothing reads it (the replay's perm/temp UI was removed).
      t: 'stats';
      unitId: string;
      atk: number;
      hp: number;
      sourceId?: string;
      permanent?: boolean;
    }
  | { t: 'death'; unitId: string }
  | { t: 'deathrattle'; unitId: string }
  | { t: 'summon'; ownerId: string; unitIds: string[]; slot: number }
  | {
      t: 'combatEnd';
      winner: 'a' | 'b' | 'tie';
      survivors: string[];
      damageToLoser: number;
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
  | { type: 'targetChoice'; targetUid: string } // resolve pending targeted battlecry
  | { type: 'discoverPick'; optionIndex: number }
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
  gems: number;
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
