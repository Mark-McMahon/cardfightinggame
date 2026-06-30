# Auto-Battler — Design & Technical Specification (v1)

> A round-based, 8-player, server-authoritative auto-battler in the spirit of the
> genre (shop phase → auto-resolved combat → placement), built original and
> clean-room. This document is written so a developer can start building directly
> from it.
>
> **Companion file:** `requirements.md` holds the running decision ledger (29 locked
> decisions across 6 design rounds). This spec is the self-contained build document.
> **v2 redesign:** §§1–15 describe the v1 build (implemented, M0–M6). **§16 is the
> Round-6 game-feel + content-depth redesign** and **supersedes earlier UI/content scoping
> where they conflict** — read it before touching the client or content. The four engine
> invariants are unchanged.
> **Mechanics source of truth:** `season10_interaction_reference.xlsx` (9 tribes /
> 26 engines, 7 cross-tribe systems) — used for *functional mechanics only*.

---

## 0. Clean-room rule (binding on all content)

Build only from the **functional mechanics** in the reference file. No card names,
ability text, flavor, hero names, art, or branding from any existing game. All tribe
names, unit names, and copy in this project are **original by construction**. The nine
reference tribe names (incl. the Warcraft-specific *Murloc/Quilboar/Naga*) are **never
shipped**; they appear here only as a left-column cross-reference. When in doubt,
choose the more clearly-original option and note it.

**Original tribe map (theme: "mythic menagerie"):**

| Reference (never ship) | Original name | Identity |
|---|---|---|
| Beasts | **Wildkin** | token swarm, go-wide |
| Murlocs | **Reefkin** | cheap battlecry tempo, poison/shield |
| Demons | **Infernals** | self-damage risk economy |
| Quilboar | **Tuskers** | gem currency |
| Elementals | **Primordials** | play-count scaling, reroll |
| Nagas | **Sirens** | temp spellcraft |
| Undead | **Revenants** | reborn, death payoffs |
| Mechs | **Constructs** | magnetic merge |
| Pirates | **Corsairs** | on-buy tempo |

The **vertical slice uses Wildkin, Revenants, Reefkin**.

---

## 1. Overview & design pillars

An 8-player lobby auto-battler. Each round every player privately shops (buy / sell /
roll / freeze / position units, spend gold, raise their shop tier), then their board is
paired against another player's and **fights automatically**. You lose hero health when
you lose a fight; last player standing wins. Placement (8th → 1st) is assigned as
players are eliminated.

**Design pillars** (every decision serves these, in order):

1. **Multiplayer-first.** 8 seats, room-code lobbies, optional bot fill, designed for a
   shared match from day one — not single-player with networking bolted on.
2. **Server-authoritative & reproducible.** The server owns all state, gold, RNG, and
   combat. Combat is **seeded** and deterministic given (boards, seed): same inputs →
   identical result and event log. This is the foundation of both fairness and balance.
3. **Construction over execution.** Combat auto-resolves; all player skill lives in
   economy, board-building, positioning, and reading opponents. Accessible but deep.
4. **Mechanics over art.** *(v1)* Placeholder/programmer art only (colored shapes + text).
   All effort goes to systems, feel, and balance. **→ Amended by §16 (Round 6):** the
   client now targets **original *iconographic*** art (crests, keyword/axis icons, frames,
   motion) — still no produced per-card illustration and still clean-room (§0). Game-feel
   is a first-class goal *alongside* the engine, not a replacement for it.
5. **Balance is a feature.** Every gameplay number lives in config, never in logic, and
   a headless simulator runs thousands of battles/matches to surface overpowered units
   and dead builds *before* humans do.
6. **Data-driven content.** Units are data, not code. New units = new rows in a content
   file; new *behavior* is rare and isolated behind a small handler registry.

---

## 2. Goals and non-goals

**Goals (v1 / vertical slice)**
- One 8-seat room, joinable by short code, fillable with bots.
- Full shop → combat → placement loop with freeze and triple/upgrade.
- 3 original tribes (Wildkin, Revenants, Reefkin), ~18–24 units across 6 tiers,
  spanning 5–6 of the reference engines (proves the engine architecture).
- Seeded, server-authoritative combat with a client replay of a server event log.
- Heuristic, tribe-aware bots usable as both seat-fillers and simulator agents.
- Config-driven balance + a headless **combat (micro) simulator**, with the
  **full-match (macro) simulator** following immediately after.

**Non-goals (v1)**
- **No real art / audio.** Programmer art only.
- **No accounts / login / persistence.** In-memory rooms; a player is a socket +
  display name. (DB slots noted in §11.)
- **No hero powers, trinkets, or tavern spells in the slice.** Engine reserves space
  for them (§6, §13); they are deferred, not designed-out.
- **No ranked/MMR, cosmetics, monetization, friend lists, or cross-region matchmaking.**
- **No mobile-native client.** Web (React) only.

---

## 3. Player-facing flow

```
Create room ──► Lobby (share code) ──► (host fills empty seats with bots) ──► Start
   │                                                                            │
   └────────────────────────── others Join via code ───────────────────────────┘
                                                                                │
        ┌───────────────────────────── MATCH ───────────────────────────────────┘
        ▼
   Round N:  SHOP phase (timer)  ──►  PAIRING  ──►  COMBAT phase (auto)  ──►  resolve HP
        ▲                                                                        │
        └───────────── repeat until 1 player remains ◄───────────────────────────┘
                                                                                │
                                                                          Results / placement
```

- **Create room.** A player creates a room and receives a short shareable **room code**
  (the Colyseus room id, surfaced as a 4–6 char code). They become host.
- **Join.** Others enter the code to join, up to 8 seats. No account; just a display
  name. Late joins allowed until the host starts.
- **Bot fill.** Optional, host-controlled. The host may fill any empty seats with bots
  so a match can start with fewer than 8 humans. Per-room toggle; bot count = empty
  seats at start (or host-chosen).
- **Start.** Host starts; seats lock; the match begins at Round 1.
- **Per-round loop.** Shop phase (private, timed, all players simultaneously) →
  server pairs players → combat resolves per pair → losers take hero damage → next
  round. (Detailed in §4.)
- **Win/loss & placement.** A player at ≤0 HP is eliminated and assigned the next-lowest
  open placement (8th, then 7th, …). The last surviving player is 1st. Eliminated
  players may spectate remaining combats or leave freely.

---

## 4. Game loop & phases

### 4.1 Round structure
Each round = **Shop phase** then **Combat phase**. All 8 players shop concurrently
during a shared timer; when the timer ends (or all living players ready-up), the server
freezes inputs, computes pairings, and resolves all combats.

### 4.2 Shop phase — player actions (intents)
All actions are **intents** sent to the server, which validates them against the
authoritative private state. Available actions:

| Action | Effect | Cost (config) |
|---|---|---|
| `buy` | Move a shop unit to your bench (if bench has room). | `buyCost` (3) |
| `sell` | Remove a board/bench unit; refund gold. | refund `sellRefund` (1) |
| `roll` | Reroll the shop's offered units (respecting frozen ones). | `rerollCost` (1) |
| `freeze` / `unfreeze` | Lock the current shop so the same units are offered next turn. | `freezeCost` (0 = free) |
| `tierUp` | Raise shop tier, unlocking higher-tier units next roll. | escalating, see §5 |
| `playUnit` | Move a bench unit onto the board (≤ `boardCap`). Triggers **battlecry**. | — |
| `moveUnit` | Reorder units on the board (positioning). | — |
| `targetChoice` | Resolve a targeted battlecry (player picks the target). | — |
| `discoverPick` | Resolve a Discover (pick 1 of 3). | — |
| `readyUp` | Mark yourself done; combat starts early when all living players are ready. | — |

Notes:
- **Targeted battlecries resolve in the shop**, where the player makes the choice. The
  *result* (e.g., a buff) is baked into the board before combat, so **combat itself
  needs no human input** and stays deterministic. (See §7 and §15.)
- **Triple/upgrade:** holding a 3rd copy of the same unit auto-merges the three into a
  **golden** version (double stats; effects may also fire/scale) and grants a
  **Discover** reward — choose 1 of 3 units revealed from **one tier above** your
  current shop tier. (Config: `tripleRewardType`, `tripleDiscoverTierOffset`,
  `tripleRewardScalesByTier`.) Golden and token units do **not** draw from / return to
  the shared pool.

### 4.3 Turn timer (defaulted)
`shopTimer = min(shopTimerCap, shopTimerBase + tier * shopTimerPerTier)`. Any living
player may `readyUp`; when all living players are ready the phase ends early. Combat then
auto-plays from the server log (clients animate it; see §7).

### 4.4 Pairing (8 players)
- Each round, living players are paired into 1v1s **randomly, avoiding an immediate
  rematch** of the previous round where possible.
- **Odd live count** (after eliminations): one player is paired against a **ghost** — a
  snapshot of a recently-eliminated player's final board (no hero damage flows *to* the
  ghost). This keeps everyone fighting every round.
- A `pairings` list is part of public state so clients can show "you vs X".

### 4.5 Combat phase
Boards fight automatically (full rules in §7). Outcome per pair:
- **Winner** = the side with ≥1 unit alive when the other is empty. **Tie** = both empty
  (or step cap reached).
- **Loser hero damage** = `clamp(playerTier + Σ(surviving enemy minions' tiers),
  0, lossDamageCap)`. Config weights: `lossBaseTierWeight`, `survivorTierWeight`,
  `lossDamageCap`. Ties deal no damage.

### 4.6 Elimination & placement
HP ≤ 0 → eliminated → assigned the lowest open placement. Match ends when one player
remains (1st). If multiple players would hit 0 in the same round, they are ordered by
remaining HP (more negative = lower placement; exact tiebreak in config
`simultaneousEliminationRule`).

---

## 5. Economy

All values are **config parameters** (see §12 for the full catalog). Defaults below are
BG-derived starting points to be tuned by the simulator.

| Parameter | Default | Notes |
|---|---|---|
| `goldStart` | 3 | Gold on round 1. |
| `goldPerTurn` | +1 | Base income increment each round. |
| `goldCap` | 10 | Max base income. |
| `buyCost` | 3 | Per unit. |
| `sellRefund` | 1 | Per unit sold. |
| `rerollCost` | 1 | Per shop reroll. |
| `freezeCost` | 0 | Freeze is free. |
| `tierUpBaseCost[tier]` | `[—,5,7,8,9,10]` | Cost to enter tier T (index by current tier). |
| `tierUpDiscountPerTurn` | 1 | Each round you **don't** tier up, next tier-up cost drops by this (floored). |
| `shopSlotsByTier` | `[3,4,4,5,5,6]` | Units offered per roll by tier. |
| `poolCopiesByTier` | `[15,13,11,9,7,6]` | Shared-pool copies per unit by tier. |
| `boardCap` | 7 | Max units on board. |
| `benchCap` | 10 | Max units held off-board. |
| `tierCount` | 6 | Number of shop tiers. |
| `startingHealth` | 30 | Brisk pacing (~10–14 rounds). |

**Tier-up tension (decision):** escalating base cost with a **per-turn discount** — if
you skip tiering, next round's cost is reduced by `tierUpDiscountPerTurn`. This recreates
the signature "ramp now vs tempo now, and tier *before* the discount resets" decision
every turn. Both "stay low & go wide" and "rush high tier" must remain viable — verified
via the macro-simulator (§10).

**Shared finite pool (decision):** all players draw from one pool. Buying removes a copy;
selling returns it; rolls draw from what's left at/below your tier. Contesting a tribe
thins it for everyone (self-balancing scarcity + a real "who else is on my tribe" read).
Token and golden units are pool-exempt.

---

## 6. Card / unit data model

The core of pillar #6. **Hybrid model:** ~90% of effects are pure declarative data; a
small **handler registry** is the escape-hatch for the rare bespoke effect. New units are
data; new *behaviors* are rare and isolated.

### 6.1 Identifiers & enums

```ts
type TribeId   = 'wildkin' | 'reefkin' | 'infernals' | 'tuskers'
               | 'primordials' | 'sirens' | 'revenants' | 'constructs' | 'corsairs';

type Keyword   = 'taunt' | 'divineShield' | 'poison' | 'reborn' | 'cleave' | 'magnetic';
//  Slice uses: taunt, divineShield, poison, reborn, cleave.  (magnetic = Constructs, deferred.)

type TriggerType =
  | 'battlecry' | 'deathrattle' | 'onAttack' | 'onDamaged' | 'startOfCombat'
  | 'endOfTurn'                                   // shop-phase end
  | 'onPlayTribe' | 'onPurchase' | 'onSell' | 'onRefresh' | 'onCast'
  | 'afterFriendlyDeaths'                         // avenge counter (combat)
  | 'onSacrifice' | 'onSpend' | 'onSummon' | 'onTripleCreated';
```

### 6.2 Effect (triggered) — the declarative 90%

```ts
interface Effect {
  trigger:   TriggerSpec;       // WHEN
  condition?: ConditionSpec;    // optional gate
  target:    TargetSpec;        // WHO
  actions:   ActionSpec[];      // WHAT (one or more)
}

interface TriggerSpec {
  type: TriggerType;
  tribe?: TribeId;              // onPlayTribe / filtered counts
  threshold?: number;          // afterFriendlyDeaths (every N), gem-dump threshold
  everyN?: boolean;            // repeat each N (true) vs fire once at N (false)
}

type Selector =
  | 'self' | 'triggerSource'
  | 'leftNeighbor' | 'rightNeighbor' | 'adjacentAllies'
  | 'allAllies' | 'randomAlly' | 'newestAlly' | 'oldestAlly'
  | 'highestStatAlly' | 'lowestStatAlly'
  | 'chosenAlly'               // player-targeted; resolved in shop only
  | 'nAllies'
  | 'randomEnemy' | 'frontEnemy' | 'neighborsOfTarget';  // combat damage actions

interface TargetSpec {
  selector: Selector;
  count?: number;
  filterTribe?: TribeId;
  filterKeyword?: Keyword;
  stat?: 'atk' | 'hp';         // for highest/lowest selectors
}

type ActionType =
  | 'buffStats' | 'setStats' | 'grantKeyword' | 'summon' | 'dealDamage'
  | 'giveGem' | 'makeSpell' | 'gainGold' | 'discover' | 'sacrifice' | 'custom';

interface ActionSpec {
  type: ActionType;
  atk?: number; hp?: number; permanent?: boolean;   // buffStats/setStats
  keyword?: Keyword;                                // grantKeyword
  summonUnitId?: string; summonCount?: number;      // summon
  amount?: number;                                  // dealDamage / giveGem / gainGold
  discoverFromTierOffset?: number;                  // discover
  handlerId?: string; params?: Record<string, unknown>;  // custom escape-hatch
}

interface ConditionSpec {
  kind: 'hasTribe' | 'hasKeyword' | 'countAllies' | 'goldAtLeast'
      | 'tierAtLeast' | 'isGolden' | 'gemsThisTurnAtLeast' | 'isToken';
  value?: number; tribe?: TribeId; keyword?: Keyword;
}
```

### 6.3 Aura (passive modifier) — the multipliers

The reference's hardest patterns ("trigger multiplier", "battlecry doubler", "cost
reduction", "tribe-wide damage amplifier", "gem-size amplifier", "spellpower") are **not
triggers** — they are passive modifiers that change how *other* effects resolve. Modeled
separately so the resolver can query them.

```ts
interface AuraSpec {
  scope: 'selfTribeAllies' | 'allAllies' | 'yourBattlecries' | 'yourEndOfTurn'
       | 'yourGems' | 'yourSpells' | 'shopCostTribe';
  modifier: {
    kind: 'triggerMultiplier' | 'damageMultiplier' | 'costReduction'
        | 'gemValueAdd' | 'spellPowerAdd' | 'statBuffOnEvent';
    value: number;
    tribe?: TribeId;
  };
  stacks?: boolean;            // multiple copies stack vs not
}
```

### 6.4 Unit card

```ts
interface UnitCard {
  id: string;                  // stable key, e.g. 'wildkin_brambleling'
  name: string;                // original display name
  tribe: TribeId;
  tier: number;                // 1..6
  atk: number; hp: number;
  keywords: Keyword[];
  effects: Effect[];           // triggered
  auras?: AuraSpec[];          // passive
  isToken?: boolean;           // pool-exempt, not directly purchasable
  goldenOf?: string;           // base id, if this is a golden form
}
```

### 6.5 Tribe, keyword, spell schemas

```ts
interface TribeDef    { id: TribeId; name: string; colorHex: string; blurb: string; }
interface KeywordDef  { id: Keyword; name: string; rulesText: string; }       // engine reads these
interface TavernSpell { id: string; name: string; cost: number; tier: number;  // DEFERRED (stub schema)
                        effects: Effect[]; permanent: boolean; }
```

Tribes carry only id/name/color/blurb (placeholder art = a colored shape + label).
Keyword behavior lives in the combat engine (§7), not in data, because keyword *timing*
is logic; the data only tags which units have them.

---

## 7. Combat resolution

Deterministic given `(boardA, boardB, seed)`. **Seeded PRNG** (e.g., a small
splitmix64/xorshift) seeded with `hash(matchId, round, pairingId)`; **all** combat
randomness (target choice, first-attacker tie) draws from it, so a combat is fully
reproducible for replays, debugging, and the simulator.

### 7.1 Setup
1. Snapshot both boards (units, stats, keywords, deathrattle/effect data). Combat never
   mutates shop/bench state.
2. Seed the PRNG.
3. Fire `startOfCombat` effects in board order (A then B, left→right).
4. **First attacker** = side with more minions; tie → PRNG coin flip.

### 7.2 Attack loop
Each side has an **attack pointer** advancing left→right and wrapping. On a side's turn:
1. Select the **attacker** = next living unit from that side's pointer.
2. Select the **defender**:
   - If the enemy has any **taunt** units → pick a random taunt unit (PRNG).
   - Else → pick a random living enemy (PRNG).  *(decision: seeded-random + taunt.)*
3. Fire the attacker's `onAttack` effects (e.g., cleave is applied here; see below).
4. **Trade damage:** attacker deals `atk` to defender; defender deals `atk` to attacker.
   - **Divine shield** negates the *next* instance of damage to that unit entirely
     (including poison) and is then consumed.
   - **Poison** flags any unit it deals >0 unblocked damage to for death after the step.
   - **Cleave** (attacker keyword): the attacker also deals its `atk` to the defender's
     immediate left/right neighbors (`cleavePercent` of atk, default 100%).
5. **Resolve deaths** (see 7.3).
6. Hand the turn to the other side; repeat.

Combat ends when a side has no living units, or `maxCombatSteps` is hit (→ tie; guards
against no-damage stalemates).

### 7.3 Death, deathrattle, reborn, summon timing
- After a damage step, collect all units at HP ≤ 0 or poison-flagged.
- They die **simultaneously**; each fires its `deathrattle` effects (and increments the
  bearer side's `afterFriendlyDeaths` avenge counter).
- **Resolution order:** by board position, **left → right** (deterministic).
- **Reborn:** a unit with reborn returns once, in its **own slot**, with 1 HP and reborn
  removed, *after* its deathrattle resolves.
- **Summons** (deathrattle or otherwise) occupy the dead unit's slot, shifting others
  right; if the board is full (`boardCap`), excess summons are dropped (logged).
- Newly-summoned units are eligible to attack when the pointer reaches them.

### 7.4 Targeted effects & combat purity
`chosenAlly` selectors are only legal on `battlecry`/shop-time effects and are resolved
by the player during the shop phase. **No combat action requires human input**, so
combat is a pure function of `(boards, seed)`.

### 7.5 Combat event log (server → client)
The server resolves the whole fight and emits an ordered, timestamped log; the client
**replays/animates** it (placeholder shapes), and the **simulator** reads the same log.

```ts
type CombatEvent =
  | { t:'combatStart'; seed:string; a:BoardSnapshot; b:BoardSnapshot }
  | { t:'attack'; side:'a'|'b'; attackerId:string; defenderId:string }
  | { t:'damage'; sourceId:string; targetId:string; amount:number; shieldBroken?:boolean }
  | { t:'keyword'; unitId:string; keyword:Keyword }
  | { t:'stats'; unitId:string; atk:number; hp:number }
  | { t:'death'; unitId:string }
  | { t:'deathrattle'; unitId:string }
  | { t:'summon'; ownerId:string; unitIds:string[]; slot:number }
  | { t:'combatEnd'; winner:'a'|'b'|'tie'; survivors:string[]; damageToLoser:number };
```

---

## 8. Mechanics / engine support — mapping to the reference

The table proves the architecture (§6) expresses **every** reference engine. "Primitive"
shows the data construct used; **H** = needs a `custom` handler (the deliberate ~10%).

| # | Tribe (orig.) | Reference engine | Primitive used |
|---|---|---|---|
| 1 | Wildkin | Token generator + amplifier | `endOfTurn`→`summon` **+** `onSummon`+cond`isToken`→`buffStats` |
| 2 | Wildkin | End-of-turn trigger multiplier | Aura `yourEndOfTurn` `triggerMultiplier` |
| 3 | Wildkin | Death-count scaling (avenge) | `afterFriendlyDeaths{threshold}`→`buffStats` |
| 4 | Wildkin | Mid-combat deathrattle replay | **H** `custom: replayAdjacentDeathrattle` |
| 5 | Wildkin | Cleave stat-stick | keyword `cleave` (resolved in `onAttack`) |
| 6 | Reefkin | Battlecry stat-chain | `battlecry`→`buffStats` (`randomAlly`/`chosenAlly`) |
| 7 | Reefkin | Battlecry doubler | Aura `yourBattlecries` `triggerMultiplier` |
| 8 | Reefkin | Poison + divine shield carriers | keywords + `grantKeyword` actions |
| 9 | Reefkin | Single-target megabuff | `battlecry`+`chosenAlly`→`buffStats{permanent}` |
| 10 | Infernals | Self-damage for scaling | `battlecry`→`dealDamage(self/ally)` + `buffStats` |
| 11 | Infernals | Whole-board attack buff | `endOfTurn`→`allAllies`→`buffStats{atk}` |
| 12 | Infernals | Sacrifice payoff | `onSacrifice`→`buffStats` / **H** if complex |
| 13 | Tuskers | Spendable resource gems | `battlecry`→`giveGem`; spend = shop action |
| 14 | Tuskers | Gem-size amplifier | Aura `yourGems` `gemValueAdd` |
| 15 | Tuskers | Gem-dump payoff | `onSpend{threshold}`→`buffStats` |
| 16 | Primordials | Play-count scaling | `onPlayTribe`→`buffStats` |
| 17 | Primordials | Hand/shop buffer | `onPurchase`/`endOfTurn`→buff future buys (**H** for "future" queue) |
| 18 | Primordials | Reroll synergy | `onRefresh`→`buffStats` (soft cap via condition) |
| 19 | Sirens | Temp buff spells (spellcraft) | `makeSpell`; spell = one-use `Effect` |
| 20 | Sirens | Spell-count / spellpower | Aura `yourSpells` `spellPowerAdd` |
| 21 | Revenants | Reborn stacking | keyword `reborn` + death-trigger payoffs |
| 22 | Revenants | Tribe-wide damage amplifier | Aura `selfTribeAllies` `damageMultiplier` |
| 23 | Constructs | Magnetic stacking | keyword `magnetic` (`battlecry` attach; **H** for merge) |
| 24 | Constructs | Divine shield + DR redeploy | keyword + `deathrattle`→`summon` |
| 25 | Corsairs | On-buy buffs | `onPurchase`→`buffStats` |
| 26 | Corsairs | Cheap-cost flooders | Aura `shopCostTribe` `costReduction` |

Only **3 of 26** need a handler, and each is an isolated, well-scoped function — the
hybrid model holds.

### 8.1 Worked original example units (slice)

Shown as **data**, to prove new units need no new code. (Numbers reference §12 config
keys; literals are illustrative defaults.)

```ts
// — Wildkin: token generator + amplifier split across tiers (engines 1) —
const Brambleling: UnitCard = {
  id:'wildkin_brambleling', name:'Brambleling', tribe:'wildkin', tier:1, atk:1, hp:2,
  keywords:[],
  effects:[{ trigger:{type:'endOfTurn'}, target:{selector:'self'},
             actions:[{type:'summon', summonUnitId:'wildkin_thornpup', summonCount:/*tokensPerTurn*/1}] }],
};
const Thornpup: UnitCard = {
  id:'wildkin_thornpup', name:'Thornpup', tribe:'wildkin', tier:1, atk:1, hp:1,
  keywords:[], effects:[], isToken:true,
};
const MotherThorn: UnitCard = {                 // the amplifier — a deliberate chase target
  id:'wildkin_motherthorn', name:'Mother Thorn', tribe:'wildkin', tier:3, atk:3, hp:4,
  keywords:[],
  effects:[{ trigger:{type:'onSummon'}, condition:{kind:'isToken'},
             target:{selector:'triggerSource'},
             actions:[{type:'buffStats', atk:/*buffPerToken*/1, hp:/*buffPerToken*/1, permanent:true}] }],
};

// — Revenants: reborn + death payoff (engine 21) —
const Gravewing: UnitCard = {
  id:'revenants_gravewing', name:'Gravewing', tribe:'revenants', tier:2, atk:2, hp:1,
  keywords:['reborn'],
  effects:[{ trigger:{type:'deathrattle'},
             target:{selector:'highestStatAlly', stat:'hp', filterTribe:'revenants'},
             actions:[{type:'buffStats', hp:2, permanent:true}] }],
};

// — Revenants: tribe-wide damage amplifier (engine 22, passive aura) —
const PaleLich: UnitCard = {
  id:'revenants_palelich', name:'Pale Lich', tribe:'revenants', tier:5, atk:4, hp:6,
  keywords:[], effects:[],
  auras:[{ scope:'selfTribeAllies',
           modifier:{kind:'damageMultiplier', value:/*undeadDamageAmp*/2, tribe:'revenants'}, stacks:false }],
};

// — Reefkin: battlecry stat-chain (engine 6) —
const TidecallerInitiate: UnitCard = {
  id:'reefkin_tidecaller', name:'Tidecaller Initiate', tribe:'reefkin', tier:1, atk:2, hp:1,
  keywords:[],
  effects:[{ trigger:{type:'battlecry'},
             target:{selector:'chosenAlly', filterTribe:'reefkin'},
             actions:[{type:'buffStats', atk:/*battlecryChainBuff*/1, hp:1, permanent:true}] }],
};

// — Reefkin: keyword-grant carry protection (engines 8/9) —
const CoralWarden: UnitCard = {
  id:'reefkin_coralwarden', name:'Coral Warden', tribe:'reefkin', tier:3, atk:2, hp:3,
  keywords:[],
  effects:[{ trigger:{type:'battlecry'}, target:{selector:'chosenAlly'},
             actions:[{type:'grantKeyword', keyword:'divineShield'},
                      {type:'grantKeyword', keyword:'taunt'}] }],
};

// — Reefkin: battlecry doubler (engine 7, passive aura — the build-defining find) —
const EchoChoir: UnitCard = {
  id:'reefkin_echochoir', name:'Echo Choir', tribe:'reefkin', tier:4, atk:3, hp:5,
  keywords:[], effects:[],
  auras:[{ scope:'yourBattlecries',
           modifier:{kind:'triggerMultiplier', value:/*battlecryTriggerMultiplier*/2}, stacks:false }],
};

// — Handler escape-hatch example (engine 4, post-slice pattern) —
const Bonepiper: UnitCard = {
  id:'wildkin_bonepiper', name:'Bonepiper', tribe:'wildkin', tier:4, atk:3, hp:3,
  keywords:[],
  effects:[{ trigger:{type:'onAttack'}, target:{selector:'self'},
             actions:[{type:'custom', handlerId:'replayAdjacentDeathrattle',
                       params:{ scope:'adjacent', repeats:1 }}] }],
};
```

These span: summon, end-of-turn, on-summon condition, deathrattle, reborn keyword, a
passive damage aura, battlecry chain, multi-action keyword grant, a passive trigger
multiplier, and the `custom` handler — i.e., the full primitive set.

---

## 9. Multiplayer architecture

**Framework: Colyseus** (TS-native authoritative rooms; `@colyseus/schema` delta sync;
room ids as join codes; reconnection tokens; matchmaking hooks).

### 9.1 Room lifecycle
`created → lobby → starting → (round: shop → combat)* → finished → disposed`. One room =
one match (≤8 seats). Room id surfaced as the **join code**.

### 9.2 Server authority
The server owns: gold, shop contents, the shared pool, all RNG/seeds, combat resolution,
HP, pairings, placement. **Clients send intents only** and render state. Every intent is
validated against authoritative private state (afford check, legality, phase check)
before applying; illegal intents are rejected with a reason.

### 9.3 State sync — two-channel (decision)
- **Public room schema** (synced to all via `@colyseus/schema`): per-player `{seat,
  name, hp, tier, alive, placement, isBot, connected}`, plus `round`, `phase`, `timer`,
  `pairings`.
- **Private per-client push** (direct messages to the owning client only): `shop`,
  `bench`, `board`, `gold`, `frozen`, `discoverOptions`, and that player's
  `combatLog`. **No opponent private info ever leaves the server**, eliminating shop/hand
  scouting and most cheats by construction.

### 9.4 Messages

**Client → server (intents):** `buy, sell, roll, freeze, unfreeze, tierUp, playUnit,
moveUnit, targetChoice, discoverPick, readyUp`. Lobby: `createRoom, joinRoom,
setBotFill, startMatch`.

**Server → client:** public `state` patches (automatic); private `privateState` pushes;
`combatLog` (event array, §7.5); `event` (toast: triple created, eliminated, placement);
`error` (rejected intent + reason).

### 9.5 Reconnection (decision)
On disconnect the player's board persists and **keeps fighting**. A reconnection token
permits rejoin within `reconnectGraceSeconds`. If they don't return, a **bot takes over
the seat** so the match never stalls or hands out a free win. Reconnecting before the
window restores the private channel and resyncs.

### 9.6 Where bots plug in
A bot is a **server-side agent implementing the same intent interface** as a human
client. The room cannot tell a bot from a human; this is what lets the **simulator reuse
the exact bot + engine** (§10). Empty seats at start (or after a failed reconnection)
are driven by bots.

---

## 10. Bot AI

**Heuristic, tunable, tribe-aware** (decision) — good enough to fill seats *and* to give
the macro-simulator trustworthy signal, without the cost of search/rollouts.

**Per shop-phase decision loop** (greedy with light planning), each option scored by a
weighted utility (weights in config → difficulty knobs):
1. **Economy vs power:** estimate current board combat power (a cheap heuristic: Σ
   effective stats + keyword/synergy bonuses) vs gold; decide whether to `tierUp`,
   `roll`, or spend on bodies. Weights: `botGreed` (econ bias), `botRollAggression`.
2. **Tribe commitment:** track the tribe the bot is investing in; bias `buy`/`roll`
   toward it; value synergy pieces (amplifiers, doublers) above raw stats.
3. **Buy/sell:** buy units that raise scored power or advance a triple; sell units below
   a replacement threshold or off-tribe filler when bench-locked.
4. **Positioning:** rule-based — taunt/tanky units front, fragile carries and key
   deathrattles protected, cleave attacker placed to hit clusters.
5. **Freeze:** freeze when the shop holds ≥1 high-value/on-tribe unit it can't yet
   afford.
6. **Targeted battlecries / Discover:** pick the on-tribe / highest-scored option.

Difficulty presets = weight bundles (`easy/medium/hard`) in config. The same module
drives both live seat-fill and the macro-simulator.

---

## 11. Balance framework

### 11.1 Config-driven tuning (pillar #5)
Every gameplay number lives in `/shared/config/*` (typed TS objects, importable by
server, client, and sim — single source of truth). **No gameplay constant is hardcoded
in logic.** Changing balance = editing config + re-running the simulator; no logic edits.
Full catalog in §12.

### 11.2 Headless simulator — micro + macro (decision)
Imports the **same** `/shared` engine and `/server` bot logic (no re-implementation).

- **Micro (combat) sim — build first.** Input: two fixed boards + N seeds. Runs N seeded
  combats; outputs win / tie / loss %, average surviving stats, avg hero damage. Used to
  tune unit stat lines, keyword strength, and specific matchups fast. Because combat is a
  pure seeded function, results are exactly reproducible.
- **Macro (full-match) sim.** Input: 8 bot configs (tribe/difficulty mixes) + M matches.
  Bots play complete headless matches. Outputs per unit/build/tribe: pick rate, avg
  placement, win rate, gold efficiency, "assembled the combo?" rate. Validates the
  economy/curve and that both go-wide and rush-tier lines place well.

### 11.3 Outputs & outlier flags
CLI (`pnpm sim:micro`, `pnpm sim:macro`) → CSV/JSON + console summary. Auto-flags:
- **Overpowered:** unit win-rate or avg-placement far above mean (configurable σ).
- **Dead unit:** pick rate ≈ 0 or avg placement far below mean.
- **Dominant build:** a tribe/line exceeding a placement threshold across many seeds.
- **Stale combat:** combats hitting `maxCombatSteps` (tuning smell).

Monte-Carlo over seeds is how randomness (targeting) is balanced: average many seeds so
variance washes out and true power shows.

### 11.4 Where a database would slot in later
None required for v1 (in-memory rooms). Future: a `/server/persistence` adapter for match
history, unit telemetry from real games (feeding §11.3), and accounts/MMR. The config
catalog and sim outputs are already DB-ready shapes.

---

## 12. Config parameter catalog

Every reference **"Tuning knob"** captured as a named, editable parameter. Grouped by
config module under `/shared/config/`.

### 12.1 `economy.ts`
`goldStart, goldPerTurn, goldCap, buyCost, sellRefund, rerollCost, freezeCost,
freezePartialAllowed, tierUpBaseCost[], tierUpDiscountPerTurn, shopSlotsByTier[],
poolCopiesByTier[], boardCap, benchCap, tierCount`.

### 12.2 `match.ts`
`startingHealth, lossBaseTierWeight, survivorTierWeight, lossDamageCap,
simultaneousEliminationRule, shopTimerBase, shopTimerPerTier, shopTimerCap,
reconnectGraceSeconds, ghostsEnabled, avoidImmediateRematch`.

### 12.3 `combat.ts`
`targetingMode (random|deterministic), tauntOverride, attackOrderRule
(moreMinionsFirst), firstAttackerTiebreak (seed), maxCombatSteps,
divineShieldNegatesPoison (true), cleaveDefault, simultaneousDeaths (true),
deathrattleOrder (boardLeftToRight)`.

### 12.4 `triples.ts`
`tripleRewardType (golden+discover), tripleDiscoverTierOffset (1),
tripleRewardScalesByTier, goldenStatMultiplier (2)`.

### 12.5 `engines.ts` — one block per reference engine (the 26 knob sets)
```
wildkin:  tokensPerTurn, buffPerToken, tokenBuffPermanent,
          endOfTurnTriggerMultiplier, eotEnablerPoolCount,
          avengeDeathThreshold, avengePayoff, avengeTarget,
          deathrattleReplayScope, deathrattleReplayFrequency, cleavePercent
reefkin:  battlecryChainBuff, battlecryChainSpread, enablerCost,
          battlecryTriggerMultiplier, battlecryDoublerStacks, battlecryDoublerTier,
          poisonSpreadRate, divineShieldRefreshSources,
          megabuffMagnitude, megabuffPersists
infernals: selfDamageHpCost, selfDamageBuff, selfDamageCostScales,
          boardAttackBuffPerTurn, boardBuffBothStats,
          sacrificeCost, sacrificeRepeatable
tuskers:  gemBaseValue, gemCarryOver,
          gemAmplifierType, gemAmplifierValue, gemAmplifierStacks,
          gemDumpThreshold, gemDumpPayoffCurve
primordials: elementalPlayBuff, elementalPlayTarget,
          shopBufferBuff, shopBufferPersistence,
          rerollSynergyValue, rerollSynergySoftCap
sirens:   spellcraftBuff, spellcraftPersistence,
          spellpowerPerCast, spellpowerMakesPermanent
revenants: rebornStats, rebornDeathCountsToward,
          undeadDamageAmp, undeadDamageAmpStacks
constructs: magneticStatsCarried, magneticKeywordsStack, magneticCapPerUnit,
          mechDeathTokenSize, mechShieldFrequency
corsairs: onBuyBuff, onBuyNeedsEnabler,
          costReductionAmount, costReductionAppliesTo
```

### 12.6 `systems.ts` — cross-tribe (incl. deferred stubs)
`tierUp* (see economy), freezeCost/freezePartialAllowed, targetingMode (see combat);
DEFERRED stubs: trinketOfferTurns[], trinketTribeWeighting, trinketPowerBands;
tavernSpellShopRarity, tavernSpellCost, tavernSpellPermanent;
heroPowerCost, heroPowerBias`.

### 12.7 `bots.ts`
`botGreed, botRollAggression, botTribeCommitTurn, botPositioningRules,
difficultyPresets {easy,medium,hard}`.

---

## 13. Tech stack & project structure

**TypeScript everywhere; pnpm workspaces monorepo** (decision). Single source of truth
for types, content, and the engine.

```
auto-battler/
├─ package.json                 # workspaces: shared, server, client, sim
├─ pnpm-workspace.yaml
├─ shared/                      # imported by server, client, AND sim
│  ├─ types/                    # UnitCard, Effect, CombatEvent, state schemas
│  ├─ config/                   # economy.ts match.ts combat.ts triples.ts engines.ts systems.ts bots.ts
│  ├─ content/                  # units.ts (data), tribes.ts, keywords.ts  ← new units = new rows
│  ├─ engine/                   # PURE, no IO:
│  │  ├─ rng.ts                 #   seeded PRNG
│  │  ├─ combat.ts              #   resolve(boardA,boardB,seed) -> CombatEvent[]
│  │  ├─ shop.ts                #   buy/sell/roll/tier/freeze/pool ops
│  │  ├─ effects.ts             #   declarative trigger/target/action resolver
│  │  ├─ auras.ts               #   passive modifier queries
│  │  └─ handlers/              #   custom escape-hatch registry (e.g. replayAdjacentDeathrattle)
│  └─ index.ts
├─ server/                      # Colyseus
│  ├─ rooms/MatchRoom.ts        #   lifecycle, phases, intents, two-channel state
│  ├─ bots/BotAgent.ts          #   intent-emitting agent (reused by sim)
│  ├─ pairing.ts, reconnect.ts
│  └─ index.ts
├─ client/                      # React + Vite, plain CSS, placeholder art
│  ├─ src/net/                  #   Colyseus client, intent senders, state hooks
│  ├─ src/scenes/               #   Lobby, Shop, CombatReplay, Results
│  ├─ src/components/           #   UnitShape, ShopRow, BoardSlot, HpBar, CombatLogPlayer
│  └─ main.tsx
└─ sim/                         # headless harness
   ├─ micro.ts                  #   board-vs-board × N seeds
   ├─ macro.ts                  #   8 bots × M matches (imports shared engine + server bots)
   └─ report.ts                 #   CSV/JSON + outlier flags
```

**Build/run (scripts):** `pnpm dev:server` (Colyseus), `pnpm dev:client` (Vite),
`pnpm sim:micro`, `pnpm sim:macro`, `pnpm typecheck`, `pnpm test` (engine unit tests:
combat determinism via fixed seeds, keyword-timing cases). **Determinism test** is
first-class: same `(boards, seed)` → byte-identical `CombatEvent[]`.

---

## 14. MVP / vertical slice + milestones

### 14.1 Vertical slice (smallest playable)
- **One 8-seat room**, join by code, **host bot-fill** for empty seats.
- **Loop:** shop (buy/sell/roll/freeze/tierUp/position/play) → pairing+ghosts → seeded
  combat → hero damage → placement, to a winner.
- **Systems:** tier-up economy, freeze, **triple → golden + Discover**, auto-combat.
- **Content:** 3 tribes — **Wildkin, Revenants, Reefkin** — ~18–24 units across tiers
  1–6, spanning engines: token gen+amplifier & cleave (Wildkin); reborn & tribe
  damage-aura (Revenants); battlecry chain, poison/divine-shield & battlecry-doubler
  (Reefkin). Keywords: taunt, divine shield, poison, reborn, cleave.
- **Combat:** server event-log + client replay with placeholder shapes.
- **Balance:** full config + **micro-simulator**; macro-sim immediately after.
- Heroes are identical no-power avatars (hero powers deferred).

### 14.2 Milestones
- **M0 — Skeleton.** Monorepo, shared types/config, seeded PRNG, Colyseus room that
  seats 8 + bot-fill, lobby→start. *Exit:* 8 seats reach Round 1.
- **M1 — Shop loop (single player vs bots).** Pool, shop ops, gold, tier-up, freeze,
  bench/board, positioning. *Exit:* a human can build a board over rounds.
- **M2 — Combat engine.** Declarative resolver, auras, keywords, death/deathrattle/
  reborn/summon, event log; determinism tests green. *Exit:* two fixed boards resolve
  identically across runs at a fixed seed.
- **M3 — Full round loop.** Pairing+ghosts, hero damage, elimination, placement, timer +
  ready-up, client combat replay. *Exit:* an 8-bot match plays to a winner end-to-end.
- **M4 — Content + triples.** ~18–24 units across 3 tribes, triple→golden+Discover.
  *Exit:* each target engine assembles and visibly snowballs in play.
- **M5 — Micro-sim + tuning.** Combat sim, outlier flags, first balance pass from data.
  *Exit:* no unit flagged as hard-OP/dead in micro runs.
- **M6 — Macro-sim + bots polish + reconnection.** Full-match sim, difficulty presets,
  disconnect→grace→bot-takeover. *Exit:* both go-wide and rush-tier lines place
  competitively across many simulated matches.
- **Post-slice:** add tribes (Infernals/Tuskers/Primordials/Sirens/Constructs/Corsairs),
  hero powers, trinkets, tavern spells, magnetic — all already reserved in schema/config.

---

## 15. Open questions / risks

1. **Numbers need empirical tuning.** Gold curve, tier-up costs, pool counts, and
   loss-damage weights are *starting points*; the sim (M5/M6) sets the real values. Risk:
   shipping un-tuned config feels swingy — mitigate by gating M6 exit on sim health.
2. **Targeting randomness vs balance.** Seeded-random + taunt keeps genre feel but adds
   variance; we balance via Monte-Carlo over seeds, not by removing it. If variance feels
   unfair in playtests, `targetingMode` can flip toward deterministic per-config without
   code changes.
3. **No-damage stalemates.** Two boards that can't kill each other → `maxCombatSteps`
   tie. Confirm the cap and whether ties should deal chip damage to both (config).
4. **Shared-pool edge cases.** Golden/token exemption, returns on sell, and "contested
   tribe bricks a player" — tune `poolCopiesByTier` (soft vs hard contest) via macro-sim.
5. **Bot quality ceiling.** Heuristic bots may misvalue combo builds, biasing macro-sim.
   Mitigate with per-build "did it assemble?" metrics and spot-checks; upgrade to light
   rollouts only if signal is poor.
6. **Colyseus state size with 8 players.** Keep the public schema lean (no nested
   per-unit data); push heavy/private data on the direct channel. Watch patch sizes.
7. **Handler sprawl.** Guard the ~10% escape-hatch: any new `custom` handler needs a
   determinism test and a note on why it can't be declarative, so the data model doesn't
   erode.
8. **Reconnection correctness.** Bot-takeover mid-match must hand back cleanly on
   reconnect within the window; define behavior if a player reconnects *during* a combat
   (resume replay from current event index).
9. **Clean-room discipline.** All names/text reviewed against the rule in §0 before any
   public build; tribe reference names never leave this repo's left-column tables.

---

## 16. V2 — Game-feel & content-depth redesign (Round 6)

> **Why:** the v1 build (M0–M6) is mechanically complete but reads as *an engine, not a
> game* — plain UI, illegible combat, and one-dimensional cards (~9 of 24 are pure
> stat-sticks; payoffs are linear intra-tribe stacking). This section retargets the
> **client and content** to fix that. **The four engine invariants (server-authority,
> seeded determinism, two-channel privacy, config-driven balance) are unchanged**, and the
> hybrid data model (§6) is unchanged — depth is added as *data + small, isolated engine
> plumbing*, never as hardcoded logic. Where this section conflicts with §§4/6/7/8/12, **§16
> wins for v2.** Source decisions: `requirements.md` Round 6 (#21–29).

### 16.1 Design law — breakpoints over linear stacking (decision #22)

Primary build-around payoffs **trigger at thresholds on manufactured events**, never on
"N of tribe X on board." **Banned:** any *primary* payoff that grows per-unit
(`+1/+1 for each …`) — that collapses the optimal line to "buy more of the same," the
mono-tribe gradient this game exists to avoid.

- **Breakpoints, not continuous.** e.g. *"at 3+ friendly deaths this combat: +6/+6 to your
  board."* Thresholds create real shop decisions ("can I reach the next break this turn, or
  take tempo?") and legible combat swings.
- **Key off manufactured events/conditions, not board-count.** Count things the player
  *makes happen* — deaths, tokens summoned, battlecries cast, hits survived. Event-keyed
  breaks are **reachable across tribes**, which is what enables splashing instead of
  stacking.
- **Multiple competing axes.** Ship breakpoint payoffs that demand *conflicting* board
  construction so they fight for the same 7 slots. The core decision becomes "which axes
  can I realistically hit, given what I give up."
- **Thin continuous floor allowed, never dominant.** A small below-breakpoint trickle so a
  near-miss turn isn't fully dead — but it must never be the main scaling spine.
- **Rare high-tier capstones** as chase cards for run-to-run variety.

**The four axes** (manufactured-event counters; each has a home tribe but is cross-tribe
reachable):

| Axis | Glyph (semantic) | Home | Counter | Wants |
|---|---|---|---|---|
| **SWARM** | 🐾 | Wildkin | `tokensSummonedThisCombat` | many tokens summoned/kept |
| **DEATHS** | 💀 | Revenants | `deathCount` *(exists — avenge)* | friendly units to die |
| **BATTLECRIES** | 🗣 | Reefkin | `battlecriesThisTurn` *(shop)* | many battlecries sequenced |
| **ENDURE** | 🛡 | cross | shields/taunt/reborn surviving to a break | durable, living bodies |

**Designed tensions (fight for the same slots):** DEATHS (fragile, dying) ↔ ENDURE /
SWARM-survive (durable, living); SWARM (many weak) ↔ TALL (few megabuffed: Deepsinger,
Pale Lich); BATTLECRIES (battlecry bodies replayed from hand) ↔ deathrattle bodies you
want left *on* the board. A 2-tribe splash hits **two** breaks; a mono stack over-hits one
and is punished by the sim margin check (§16.7).

### 16.2 Multiplier containment (decision #25 — GATE before content ships)

Multipliers compound with everything and are what break a self-balancing sim, so they are
contained explicitly. All three already exist as config knobs in `engines.ts`; the work is
**caps + the Pale Lich conversion + making the battlecry counter see doubled triggers**.

| Card | Knob | Action |
|---|---|---|
| **Grovecaller** | `endOfTurnTriggerMultiplier` | Keep as a **capped** config multiplier (not hardcoded ×2). **#1 single-axis margin target** — Grovecaller+Grovelord = 6 tokens/turn before any buff. |
| **Echo Choir** | `battlecryTriggerMultiplier` | Keep as a **capped** config knob. **Second-order:** each doubled battlecry trigger must also **increment `battlecriesThisTurn`**, so Echo Choir doubles progress toward BATTLECRY breaks (Chorus Tide / Reef Leviathan / Tideclaimer / Brackentide). This interaction MUST be visible to the sim. |
| **Pale Lich** | `undeadDamageAmp` | **Convert to a DEATHS breakpoint:** *"At 3+ Revenant deaths this combat, your other Revenants deal `undeadDamageAmp`× damage for the rest of combat."* Multiplier value still **capped** in config; no uncapped damage multiplier enters the sim. |

### 16.3 New engine plumbing (each needs a determinism test; no new keywords)

All small and isolated — counters and trigger/condition wiring, never keyword timing
(decision #24). Each gets a fixed-seed determinism test (spec §13 priority test).

1. **`tokensSummonedThisCombat`** per side (combat). → Mother Thorn, Brackentide. (`deathCount` already exists.)
2. **`battlecriesThisTurn`** per player, per shop turn — counts *resolved* battlecry triggers, so Echo Choir's doubling multiplies it (§16.2). → Chorus Tide, Tideclaimer, Reef Leviathan, Brackentide.
3. **Wire `countAllies` condition into `startOfCombat`** (the `ConditionSpec` kind already exists in §6.2, just unused at start-of-combat). → Thornwarden.
4. **Shield-break / `onDamaged` payoff hook** — the `{t:'keyword',keyword:'divineShield'}` break event is already emitted (§7.5); add a trigger so a unit can react to *its own* shield breaking. → Pearlguard.
5. **New action `plantDeathrattle`** — attach an `Effect` (a deathrattle) to a target unit for the rest of combat. One new `ActionType`; small and declarative. → Reefmourner.

### 16.4 Breakpoint config model (decision #22, #29)

Add a **`breakpoints.ts`** config module (or a `breakpoints` block per tribe in
`engines.ts`): every ⭐ primary payoff is a named `{ counter, threshold, payoff }` entry,
e.g. `revenants.mortarch = { counter:'deaths', threshold:3, atk:4, hp:4 }`. **Lint:** a
sim/test assertion that *every* primary payoff is expressible as a discrete config
breakpoint; flag any effect whose value grows per-unit without a threshold (§16.7c).

### 16.5 Redesigned catalog (~34 cards, decisions #22–24)

🔶 bridge · ⭐ breakpoint payoff · ✏️ redesign of a v1 vanilla · 🐾💀🗣🛡 axis fed. All
numbers are config; effect text is the intended behavior.

**Wildkin — SWARM (tokens dying also feed DEATHS):**

| Tier | Name | Stats | Effect | Axis |
|---|---|---|---|---|
| 1 | Brambleling | 1/3 | End of turn: summon a Thornpup. | 🐾 |
| 1 | Thornpup *(token)* | 1/1 | — *(vanilla bodies reserved for tokens)* | 🐾 |
| 2 | ✏️ Gorehide | 2/4 | Cleave. *Floor:* +1 Atk this combat each time a friendly token dies (cap in config). | 🐾💀 |
| 2 | Thornwarden | 2/3 | ⭐ Taunt. Start of combat: if you control **4+ minions**, gain +0/+3. | 🐾🛡 |
| 3 | ✏️ Mother Thorn | 3/4 | ⭐ **Once you've summoned 3+ tokens this turn**, summoned tokens get +1/+1 and your board gets +2/+2 (end of turn). *(No per-token floor — fully a breakpoint, reads like Mortarch/Chorus Tide; decision #25 redline.)* | 🐾 |
| 3 | Pack Mother | 2/4 | ⭐ After **every 2 friendly deaths** in combat: board +2/+2. | 💀 |
| 3 | 🔶 Brackentide | 2/2 | Battlecry: summon a Thornpup. If this is your **3rd+ battlecry** this turn, summon 3. *(bridge → Reefkin)* | 🐾🗣 |
| 4 | Grovecaller | 3/3 | Your end-of-turn effects trigger `endOfTurnTriggerMultiplier`× *(capped — §16.2)*. | 🐾 |
| 4 | Bonepiper | 3/3 | After it attacks, re-trigger an adjacent friendly deathrattle (handler `replayAdjacentDeathrattle`). | 💀 |
| 5 | ✏️ Thornbeast | 5/7 | Taunt, Cleave. *Floor:* +1 Atk each time a friendly token dies (cap in config). | 🐾💀 |
| 6 | Grovelord | 8/9 | End of turn: summon 3 Thornpups (×Grovecaller). SWARM capstone — **margin watch (§16.2).** | 🐾 |

**Revenants — DEATHS (reborn bodies straddle ENDURE):**

| Tier | Name | Stats | Effect | Axis |
|---|---|---|---|---|
| 1 | ✏️ Cryptling | 1/1 | Reborn. Deathrattle: a random friendly Revenant +1/+1. | 💀 |
| 1 | Grave Wisp *(token)* | 1/1 | — | 💀 |
| 1 | Pallbearer | 2/2 | Deathrattle: the **next** friendly to die this combat triggers its deathrattle twice. | 💀 |
| 2 | Gravewing | 2/1 | Reborn. Deathrattle: your highest-HP Revenant +2 HP. | 💀 |
| 2 | Tombspawn | 1/2 | Deathrattle: summon two Grave Wisps. *(the death engine)* | 💀 |
| 3 | Graverobber | 3/3 | Deathrattle: your Revenants +1/+1 *(one-shot — not per-unit scaling)*. | 💀 |
| 3 | ⭐ Mortarch | 3/3 | At **3+ friendly deaths** this combat: board +4/+4 (once). *(marquee DEATHS break)* | 💀 |
| 4 | Dirgecaller | 3/4 | Reborn. Deathrattle: board +1/+1. | 💀🛡 |
| 4 | 🔶 Tideclaimer | 3/3 | Battlecry: if you've played **2+ other battlecries** this turn, summon a 2/2 Reborn Wisp. *(bridge → Reefkin)* | 💀🗣 |
| 5 | ✏️ Pale Lich | 4/6 | ⭐ At **3+ Revenant deaths** this combat, your other Revenants deal `undeadDamageAmp`× damage (capped) for the rest of combat. *(was an uncapped aura — §16.2)* | 💀 |
| 6 | ✏️ Bone Colossus | 5/7 | Taunt, Reborn. Deathrattle: if **4+ friendlies died** this combat, summon two 4/4 Reborn Wraiths. *(DEATHS capstone)* | 💀🛡 |

**Reefkin — BATTLECRIES (shields straddle ENDURE):**

| Tier | Name | Stats | Effect | Axis |
|---|---|---|---|---|
| 1 | Tidecaller Initiate | 2/1 | Battlecry: a friendly Reefkin +1/+1. | 🗣 |
| 1 | ✏️ Spinefish | 2/1 | Poison. Deathrattle: a random friendly minion gains Poison. *(poison spreads via DEATHS)* | 🗣💀 |
| 2 | ✏️ Pearlguard | 2/3 | ⭐ Divine Shield, Taunt. When its shield breaks: board +0/+2 (once). | 🛡 |
| 2 | Brineling | 2/2 | Battlecry: give a friendly minion Poison. | 🗣 |
| 3 | Coral Warden | 2/3 | Battlecry: give a friendly minion Divine Shield + Taunt. | 🗣🛡 |
| 3 | Deepsinger | 2/2 | Battlecry: a friendly minion +4/+4 *(TALL payoff)*. | 🗣 |
| 3 | ⭐ Chorus Tide | 2/3 | Battlecry: if this is your **3rd+ battlecry** this turn, board +2/+2. *(marquee BATTLECRY break)* | 🗣 |
| 4 | Echo Choir | 3/5 | Your battlecries trigger `battlecryTriggerMultiplier`× *(capped; doubled triggers count toward breaks — §16.2)*. | 🗣 |
| 4 | 🔶 Reefmourner | 3/4 | Battlecry: give a friendly minion "Deathrattle: board +1/+1" (`plantDeathrattle`). *(bridge → Revenants)* | 🗣💀 |
| 5 | Tide Prophet | 5/5 | Battlecry: your Reefkin +2/+2 *(one-shot)*. | 🗣 |
| 6 | ✏️ Reef Leviathan | 6/6 | ⭐ Divine Shield, Taunt. Battlecry: if you've played **4+ battlecries** this turn, give your whole board Divine Shield. *(ENDURE capstone gated on BATTLECRY)* | 🗣🛡 |

**Bridge coverage (decision #23):** Wildkin↔Reefkin = **Brackentide**; Revenants↔Reefkin =
**Tideclaimer** + **Reefmourner**; Wildkin↔Revenants = structural (every Wildkin token
death feeds Pack Mother / Mortarch / Bone Colossus — no dedicated card needed).

### 16.6 Visual & interaction spec (decisions #21, #26–28)

**Card anatomy (iconographic, original/clean-room):** tribe crest + color, tier pip,
keyword icons, large Atk/HP, and a **static axis glyph** (🐾💀🗣🛡). The glyph marks which
axis a card *feeds* — a **sortable, categorical property like the tribe crest**. It must
**never become board-aware/reactive** (no "lights up because it combos with what you own
now") — that re-introduces the synergy-panel hand-holding we cut (decision #28).

**Amendment — per-card procedural portraits (decision #30, revises #21's "iconographic only,
no per-card art").** The card face now leads with a **tribe-themed procedural SVG avatar**: a
per-tribe face system (Wildkin critter / Revenant skull-and-wisp / Reefkin fish) with a unique
per-card recipe, so the board reads as a menagerie, not a spreadsheet. **Still clean-room §0**
— every avatar is *original geometry generated at runtime* (`client/src/cardArt.ts`, a pure
string→SVG function; no asset files, no IO, no state), and bridge cards only carry a faint
colour *tint* of the tribe they reach into. The portrait **replaces the tier stripe**; the tier
badge + (still icon-only) keyword chips **overlay** it; the face is framed `meet` (contain) so
top-of-head signatures (antlers, crowns, fins) are never cropped. This **supersedes the
icon-only / "text-first" card face** for the face specifically — the hover tooltip (full ability
text + base-vs-buffed stats) is unchanged, and the engine invariants are untouched (client-only).

**Battlefield (decision #26):** one clean **left→right battle line per side, no wrapping**
(replaces the `flex-wrap` rows). Leftmost = **next-to-act and first-targeted**; adjacency
is visually obvious (it matters for cleave + Bonepiper). The combat *engine* is already
single-line — this is **client-only**.

**Combat replay — re-architected for legibility (revises #26's "highlights only"):** the
v1 player stepped a flat event list at a fixed rate. The current player segments the event
stream into **causal beats** — *never* all-at-once — in a render-free, unit-tested module
(`client/src/scenes/combatBeats.ts`) consumed by `CombatReplay.tsx` (Framer Motion). The
five legibility wins, each a tracked failure of the old replay:
1. **Who hits whom** — the attacker lunges, an SVG tracer flies to the *specific* defender,
   the defender wears a target reticle, and every non-participant **dims** for the exchange.
2. **What got buffed, by what** — the changed stat **pops**, a `+atk/+hp` chip floats off
   the unit, and a link is drawn back to the **source** (engine now emits `stats.sourceId`).
3. **Permanent vs temporary** — driven by `stats.permanent` (design intent): permanent
   growth reads **gold/🔒**, this-combat buffs read **blue/⏳**, with a header legend.
4. **Pacing by impact** — each beat's dwell scales with a computed `weight` (trivial events
   batch into one beat; a board-wide buff / key death / breakpoint **holds**). Manual
   **step (◀/▶) + scrub slider + speed toggle** for working through a confusing fight.
5. **Causality** — a strike, the deaths it caused, and the buffs those deaths triggered are
   **separate ordered beats** (cause → effect), captioned with the cause (e.g. a deathrattle).

This intentionally supersedes #26's "brief highlights only — no effect labels": surfacing
the *source* and the *permanent/temporary* distinction is now required (still original/
clean-room — no existing-game text). **Caveat (writeback gap):** combat is a pure function;
`stats.permanent` reflects *intent* but the buff is not yet reconciled onto the persistent
board in `match.ts`, so "permanent" combat buffs don't actually carry to the next combat.

**Contextual counters (decision #27):** show a manufactured-event counter (deaths / tokens
/ battlecries) **only when you own a card that consumes it** — e.g. owning Mortarch or Pack
Mother surfaces a "deaths" tally during your combat. Never an always-on panel.

**Shop — full drag-and-drop (decision #28):** drag shop→board (buy + place at slot),
board→a **sell zone**, drag to **reorder**, board↔bench to stash. Buttons remain as a
fallback; hover shows full card text. **No server change** — the `buy`/`sell`/`playUnit`/
`moveUnit` intents already exist (§4.2, §9.4).

**Art boundary:** original abstract/iconographic only — no produced per-card illustration,
and clean-room §0 still binds (no existing-game names, art, or branding; never the nine
reference tribe names).

### 16.7 Simulator metrics (decision #29 — extends §11.3)

The macro-sim must report **both** balance failure modes, plus the discipline lints:

- **(a) Single-axis margin.** No single-axis stacked build (one tribe / one counter) may
  exceed multi-axis builds' win-rate by more than a **configurable margin**; if it does,
  the payoff curve is too linear. **Watch list: Grovecaller+Grovelord, Echo Choir, Pale
  Lich.**
- **(b) Reachability (new).** Confirm a **2-tribe splash can realistically hit two
  breakpoints** in a normal game. Catches the failure the margin check is blind to —
  breakpoints tuned so high that splashing is never worth it and everyone mono-stacks.
- **(c) Breakpoint lint.** Every primary payoff must be expressible as a discrete config
  breakpoint; flag any effect whose value grows per-unit without a threshold.
- **(d) Non-linearity.** Win-rate-vs-commitment must show **step gains at thresholds**, not
  a straight line.

### 16.8 Build order (implementation sequence)

1. **Content + config + engine plumbing.** The §16.5 catalog as data; §16.4 breakpoint
   config; the five §16.3 counters/triggers **with determinism tests**; the §16.2
   multiplier caps + Pale Lich→breakpoint conversion + battlecry-counter-sees-doubling.
2. **Sim rebalance.** Encode breakpoints; run `sim:macro`; add the §16.7 assertions
   (margin, reachability, lint, non-linearity); tune **numbers only** (zero logic changes).
3. **Combat client rewrite.** Framer Motion, single battle line, beat-based replay,
   contextual counters, highlights-only.
4. **Shop client rewrite.** Drag-and-drop + iconographic cards (with the static axis glyph)
   + hover full-text.
5. **Polish.** Keyword/tribe icons, lunge/shatter/slide motion.

> **Gate (decisions #25, #29):** step 1 ships only after the three multipliers have config
> caps **and** the reachability metric exists. Validate content/numbers (steps 1–2) before
> animating cards (steps 3–4) whose stats are about to move.

---

*End of spec. Decision ledger: `requirements.md`. Mechanics source:
`season10_interaction_reference.xlsx` (functional reference only).*
