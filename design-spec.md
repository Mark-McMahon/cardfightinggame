# Auto-Battler — Design & Technical Specification

> A round-based, 8-player, server-authoritative auto-battler in the spirit of the genre
> (shop phase → auto-resolved combat → placement), built original and clean-room. This
> document is written so a developer — or an AI agent — can (re)build the game from it.
>
> **This is a single current-state spec.** It describes the game **as shipped** (all nine
> tribes, the breakpoint content model, the game-feel client). Earlier drafts split a "v1"
> body from a "§16 Round-6 redesign" that superseded it; that split has been collapsed.
> **One dated layer remains by design:** §16 (the 2026-07-01 counter-web audit) is an
> *applied change-log* — its 7 new cards and engine deltas are live in the data/engine and
> are already counted in §2/§6.7/§8 and described in the §6 vocabulary. §16 is retained as
> provenance, **not** a pending or superseding redesign; where a §16 number and the body
> disagree, that is a bug to fix, not two tiers to reconcile. The running *decision ledger*
> (why each choice was made) lives in `requirements.md`, referenced as `(decision #N)`.
>
> **Mechanics source of truth (functional only):** `season10_interaction_reference.xlsx`
> (9 tribes / 26 engines / 7 cross-tribe systems). Used for *functional mechanics only* —
> see the clean-room rule (§0).

---

## How to read this spec — the reproducibility contract

The game is reproducible from three tiers of artifact, in decreasing order of authority.
An agent regenerating the game should treat them accordingly:

1. **Data (frozen, canonical).** `shared/content/*` (units, tribes, keywords) and
   `shared/config/*` (economy, match, combat, triples, engines, breakpoints, systems,
   bots, sim). This data *is* the content-and-balance spec. Do not re-transcribe it into
   prose — it drifts. This document **references** it and never duplicates the rows.
2. **Engine semantics (this document + the tests).** What each trigger/selector/action
   means, keyword timing, combat resolution order, RNG discipline — the rules that make
   the data mean something. These are **not** recoverable from the data rows. They are
   pinned by §§6–8 here **and** by the fixed-seed golden tests in
   `shared/engine/*.test.ts`. Where prose and a golden disagree, decide deliberately —
   do not assume the current code is correct (see §7.6, Known divergences).
3. **Interface contract (§9.7, §13).** `resolveCombat(boardA, boardB, seed: string) →
   CombatEvent[]`, the shop operations, the intent messages, the two-channel privacy split,
   and the four invariants (§1). Any reimplementation must satisfy these boundaries. The
   exact signatures are pinned in **§9.7**; the full type unions live in `shared/types`.

**The determinism note (D4, decided).** Combat is a pure function of `(boards, seed)`:
determinism is asserted as a **property** — "same `(boards, seed)` twice → identical log"
*within* an implementation. **Cross-implementation byte-identity is explicitly not a
guarantee:** a regeneration with a different-but-valid PRNG draws a different sequence and so
produces a different (equally valid) byte log. Byte-goldens are therefore **not** carried as
tier-2 truth; they are regenerated from the corrected engine only as an intra-impl regression
guard (§7.6). A regen is judged behaviorally, by the property/invariant evals.

---

## 0. Clean-room rule (binding on all content)

Build only from the **functional mechanics** in the reference file. No card names, ability
text, flavor, hero names, art, or branding from any existing game. All tribe names, unit
names, and copy in this project are **original by construction**. The nine reference tribe
names (incl. the Warcraft-specific *Murloc/Quilboar/Naga*) are **never shipped**; they
appear here only as a left-column cross-reference. When in doubt, choose the more clearly
original option and note it.

**Original tribe map (theme: "mythic menagerie") — all nine are shipped content:**

| Reference (never ship) | Original name | Identity | Axis / keyword strength |
|---|---|---|---|
| Beasts | **Wildkin** | token swarm, go-wide | SWARM · cleave |
| Murlocs | **Reefkin** | cheap battlecry tempo | BATTLECRIES · poison/shield |
| Demons | **Infernals** | self-damage / sacrifice risk | SACRIFICE · burst |
| Quilboar | **Tuskers** | gem greed → exponential doubler | SPOILS · multiply |
| Elementals | **Primordials** | play-count → wide splash | ELEMENTS · cleave |
| Nagas | **Sirens** | spellcraft-flavored burst | SPELLCRAFT · poison |
| Undead | **Revenants** | reborn, death payoffs | DEATHS · reborn |
| Mechs | **Constructs** | assembly / reassemble | ASSEMBLY · divine shield |
| Pirates | **Corsairs** | on-buy tempo | TEMPO · reborn/shield width |

The original three-tribe vertical slice (Wildkin, Revenants, Reefkin) remains the **most
balance-validated core**; the other six shipped in two expansions (Prompt-2:
Infernals/Constructs; Round-6 replayability: Tuskers/Primordials/Sirens/Corsairs) and are
real, playable content held to the same data model.

---

## 1. Overview & design pillars

An 8-player lobby auto-battler. Each round every player privately shops (buy / sell / roll
/ freeze / position units, spend gold, raise their shop tier), then their board is paired
against another player's and **fights automatically**. You lose hero health when you lose a
fight; last player standing wins. Placement (8th → 1st) is assigned as players are
eliminated.

**Design pillars** (every decision serves these, in order):

1. **Multiplayer-first.** 8 seats, room-code lobbies, optional bot fill, designed for a
   shared match from day one — not single-player with networking bolted on.
2. **Server-authoritative & reproducible.** The server owns all state, gold, RNG, and
   combat. Combat is **seeded** and deterministic given `(boards, seed)`: same inputs →
   identical result and event log. Foundation of both fairness and balance.
3. **Construction over execution.** Combat auto-resolves; all player skill lives in
   economy, board-building, positioning, and reading opponents.
4. **Game-feel alongside the engine.** Client art is **original iconographic + runtime
   procedural SVG** (tribe crests, keyword/axis icons, per-card procedural avatars, causal
   combat replay). Still clean-room (§0): **no produced per-card illustration, no asset
   files** — every avatar is original geometry generated at runtime. Game-feel is a
   first-class goal, not a replacement for systems/balance. (decisions #21, #26–28, #30)
5. **Balance is a feature.** Every gameplay number lives in config, never in logic, and a
   headless simulator runs thousands of battles/matches to surface overpowered units and
   dead builds *before* humans do.
6. **Data-driven content.** Units are data, not code. New units = new rows in a content
   file; new *behavior* is rare and isolated behind a small handler registry.

**The four load-bearing invariants** (unchanged across all content; violating any breaks
the design): (1) server-authoritative — clients send intents only; (2) seeded determinism
— combat is a pure function of `(boards, seed)`; (3) two-channel state privacy — no
opponent private info leaves the server; (4) config-driven balance — no gameplay constant
hardcoded in logic. §7.6 records where the current code falls short of (2) and (4).

---

## 2. Goals and non-goals

**Goals**
- One 8-seat room, joinable by short code, fillable with bots.
- Full shop → combat → placement loop with freeze and triple/upgrade.
- **Nine original tribes; 90 unit definitions** (84 purchasable + 6 tokens) across tiers
  1–6, exercising 5 live keywords (`taunt`/`divineShield`/`poison`/`reborn`/`cleave`;
  `magnetic` reserved) and the breakpoint content model (§6.6). The design law of
  "breakpoints over linear stacking" (§6.6, decision #22) is the through-line. (Count
  includes the 7 cards added by the §16 audit; per-tribe breakdown in §8.)
- Seeded, server-authoritative combat with a client replay of a server event log.
- Heuristic, tribe- and axis-aware bots usable as both seat-fillers and simulator agents.
- Config-driven balance + a headless **micro (combat)** and **macro (full-match)**
  simulator, including the breakpoint balance-gate metrics (§11.3).
- Original iconographic client with a **causal, beat-based combat replay** (§10).

**Non-goals**
- **No produced per-card art / audio.** Runtime procedural SVG + icons only (§10);
  clean-room §0 binds.
- **No accounts / login / persistence.** In-memory rooms; a player is a socket + display
  name. (DB slot noted in §11.4.)
- **No hero powers, trinkets, or tavern spells.** The data model and config **reserve**
  space for them (§6.7, §12.6); they are deferred, not designed-out.
- **No ranked/MMR, cosmetics, monetization, friend lists, or cross-region matchmaking.**
- **No mobile-native client.** Web (React + Vite) only.
- **`magnetic` keyword is reserved** (Constructs' merge) but not yet resolved by the
  engine; Constructs currently ship via death/assembly breakpoints, not merge.

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
  (the Colyseus room id). They become host.
- **Join.** Others enter the code to join, up to 8 seats. No account; just a display name.
  Late joins allowed until the host starts.
- **Bot fill.** Optional, host-controlled. The host may fill empty seats with bots so a
  match can start with fewer than 8 humans.
- **Start.** Host starts; seats lock; the match begins at Round 1.
- **Per-round loop.** Shop phase (private, timed, all players simultaneously) → server
  pairs players → combat resolves per pair → losers take hero damage → next round.
- **Win/loss & placement.** A player at ≤0 HP is eliminated and assigned the next-lowest
  open placement (8th, then 7th, …). The last survivor is 1st. Eliminated players may
  spectate or leave.

---

## 4. Game loop & phases

### 4.1 Round structure
Each round = **Shop phase** then **Combat phase**. All players shop concurrently during a
shared timer; when it ends (or all living players ready-up), the server freezes inputs,
computes pairings, and resolves all combats.

### 4.2 Shop phase — player actions (intents)
All actions are **intents** sent to the server, validated against authoritative private
state (afford check, legality, phase check) before applying; illegal intents are rejected
with a reason. The intent set (`shared/types` `Intent`):

| Intent | Effect | Cost (config) |
|---|---|---|
| `buy` | Move a shop unit to your bench (if bench has room). | `buyCost` (3) |
| `sell` | Remove a board/bench unit; refund gold. | `sellRefund` (1) |
| `roll` | Reroll the shop's offered units (respecting a freeze). | `rerollCost` (1) |
| `freeze` / `unfreeze` | Lock the current shop so the same units are offered next turn. | `freezeCost` (0) |
| `tierUp` | Raise shop tier, unlocking higher-tier units next roll. | escalating, see §5 |
| `playUnit` | Move a bench unit onto the board (≤ `boardCap`). Triggers **battlecry**. | — |
| `moveUnit` | Reorder units on the board (positioning). | — |
| `targetChoice` | Resolve a pending targeted battlecry (player picks the target). | — |
| `discoverPick` | Resolve a Discover (pick 1 of 3). | — |
| `readyUp` | Mark done; combat starts early when all living players are ready. | — |

Notes:
- **Targeted battlecries (`chosenAlly`) resolve in the shop**, where the player chooses.
  The *result* is baked into the board before combat, so **combat needs no human input**
  and stays a pure function (§7.4).
- **Triple/upgrade:** holding a 3rd copy (`copiesForTriple` = 3) of the same base unit
  auto-merges the three into a **golden** (stats × `goldenStatMultiplier` = 2) and grants
  a **Discover** — pick 1 of 3 units from `tripleDiscoverTierOffset` (1) tier above your
  current tier. A merge re-scans for cascade triples. If the bench is full when a Discover
  would be granted, the Discover is lost (logged). Golden/token units are pool-exempt.
- **Drag-and-drop (client-only, decision #28):** drag shop→board (buy + place at slot),
  board→sell-zone, board reorder, board↔bench. Buttons remain a fallback. **No server
  change** — it maps onto the existing `buy`/`sell`/`playUnit`/`moveUnit` intents.

### 4.3 Turn timer
A **single shared clock** per shop phase, sized to the wealthiest living player so the
busiest player isn't rushed:
`shopTimer = min(shopTimerCap, shopTimerBase + maxTier·shopTimerPerTier + maxGold·shopTimerPerGold)`
(defaults 90 cap, 40 base, 5/tier, 2/gold). Any living player may `readyUp`; when all
living players are ready the phase ends early.

### 4.4 Pairing (8 players)
- Each round, living players are paired into 1v1s **randomly, avoiding an immediate
  rematch** where possible (`avoidImmediateRematch`).
- **Odd live count:** one player is paired against a **ghost** — a snapshot of the
  **most-recently-eliminated** player's final board (`ghostsEnabled`); no hero damage flows
  *to* the ghost. Keeps everyone fighting every round. **(D8, decided):** the ghost source is
  the most-recently-eliminated player, and the pick is **deterministic from the match seed**
  (required for sim reproducibility).
- A `pairings` list is public state (`Pairing{aSeat, bSeat, ghost, ghostName}`, `bSeat=-1`
  for a ghost).

### 4.5 Combat phase
Boards fight automatically (full rules §7). Per pair:
- **Winner** = the side with ≥1 unit alive when the other is empty. **Tie** = both empty or
  the step cap is reached.
- **Loser hero damage** = `clamp(winnerTier·lossBaseTierWeight + Σ(surviving winner minion
  tiers)·survivorTierWeight, 0, lossDamageCap)`. Defaults: weights 1/1, cap 15. **(D6,
  decided):** the base term uses the **winner's** tier (matches genre convention and the
  current `combat.ts clampDamage`); the stale `match.ts` "playerTier" comment should be
  corrected to say winner-tier. Ties deal no damage.

### 4.6 Elimination & placement
HP ≤ 0 → eliminated → assigned the lowest open placement. Match ends when one player
remains (1st), or when `maxRounds` (25) is reached, in which case standings are finalized
by remaining HP (guards against two mutually-unkillable boards). Simultaneous eliminations
are ordered by remaining HP (`simultaneousEliminationRule = moreNegativeHpPlacesLower`).
**(D9, decided):** if survivors are tied on remaining HP at the `maxRounds` cutoff, the
tiebreak is **seat order** (lowest seat places higher) — fully deterministic, no extra
tracking. (An ultra-rare edge; simplicity over cleverness.)

### 4.7 Edge-case & reserved-system rulings
- **Fizzle rules (D5, decided) — principle: "count the act, not the resolution."** A
  `chosenAlly` battlecry with **no legal target** fizzles (resolves to nothing) but **still
  counts as a battlecry played** and still increments `battlecriesThisTurn`. An
  Echo-Choir-**doubled** battlecry fires `afterFriendlyBattlecry` **twice** (doubled triggers
  count, consistent with the battlecry counter). A **Discover** from an empty/insufficient
  tier+offset pool **fills from the next lower tier, then skips** if still empty. `onSell`
  fires only when selling a **purchasable body**, not a token.
- **`gems` is cosmetic (D10, decided).** `gemCarryOver` accrues a persistent lifetime `gems`
  total, but no spend sink ships — only the per-turn `gemsThisTurn` counter feeds the Tusker
  doubler. The persistent total has **no gameplay effect** (a display of greed); a spend
  action is future work (the reserved `onSpend` / gems-as-currency system).

---

## 5. Economy

All values are **config parameters** (`shared/config/economy.ts`, `match.ts`,
`triples.ts`). Current values (tuned by the simulator, not final law):

| Parameter | Value | Notes |
|---|---|---|
| `goldStart` | 3 | Gold on round 1. |
| `goldPerTurn` | +1 | Base income increment each round. |
| `goldCap` | 10 | Max base income. |
| `buyCost` / `sellRefund` / `rerollCost` / `freezeCost` | 3 / 1 / 1 / 0 | Freeze is free. |
| `tierUpBaseCost[curTier]` | `[0,5,7,8,9,10]` | Cost to advance FROM the given tier (index 0 unused, 6 = maxed). |
| `tierUpDiscountPerTurn` | 1 | Each round you don't tier up, next cost drops by this (floored). |
| `shopSlotsByTier` | `[3,4,4,5,5,6]` | Units offered per roll, by (tier−1). |
| `poolCopiesByTier` | `[15,13,11,9,7,6]` | Shared-pool copies per unit, by (tier−1). |
| `boardCap` / `benchCap` / `tierCount` | 7 / 10 / 6 | |
| `startingHealth` | 30 | Brisk pacing. |
| `maxSeats` / `maxRounds` | 8 / 25 | |

**Tier-up tension (decision):** escalating base cost with a per-turn discount — skip
tiering and next round's cost drops. Recreates the "ramp now vs tempo now" decision every
turn. Both "stay low & go wide" and "rush high tier" must remain viable (verified by the
macro-sim, §11).

**Shared finite pool (decision):** all players draw from one pool. Buying removes a copy;
selling returns it; rolls draw from what's left at/below your tier. Contesting a tribe
thins it for everyone. Token and golden units are pool-exempt.

---

## 6. Card / unit data model

The core of pillar #6. **Hybrid model:** ~90% of effects are pure declarative data; a small
**handler registry** (§6.5) is the escape-hatch for the rare bespoke effect. New units are
data; new *behaviors* are rare and isolated.

> **Regeneration note — the DSL is wider than the content uses.** The vocabularies below
> are the full declarative surface. Roughly **half of the defined primitives are currently
> unused scaffolding** reserved for deferred systems (spells, gold, gems-as-spend,
> magnetic, hero powers). Each vocabulary marks **[live]** (exercised by shipped content /
> engine) vs **[reserved]** (defined, no current consumer). A minimal regeneration of the
> shipped game needs only the [live] set; the [reserved] entries are forward-compat and may
> be dropped if the deferred systems are cut. Canonical enums live in `shared/types`.

### 6.1 Identifiers & enums

```ts
type TribeId = 'wildkin' | 'reefkin' | 'infernals' | 'tuskers' | 'primordials'
             | 'sirens' | 'revenants' | 'constructs' | 'corsairs';   // all nine shipped

type Keyword = 'taunt' | 'divineShield' | 'poison' | 'reborn' | 'cleave' | 'magnetic';
//  [live] taunt, divineShield, poison, reborn, cleave.   [reserved] magnetic (Constructs merge).
```

**`Axis`** — the static, categorical "which manufactured-event lane a card feeds" glyph
(§6.6). Sortable like a tribe crest; **never board-aware/reactive** (decision #28):
```ts
type Axis = 'swarm' | 'deaths' | 'battlecries' | 'endure'          // original four
          | 'sacrifice' | 'assembly'                               // Prompt-2
          | 'spoils' | 'elements' | 'spellcraft' | 'tempo';        // Round-6
```

### 6.2 Trigger types

```ts
type TriggerType =
  | 'battlecry' | 'deathrattle' | 'startOfCombat' | 'endOfTurn'   // [live] — end = shop-phase end
  | 'onAttack' | 'onSummon' | 'onShieldBreak'                     // [live] combat hooks
  | 'afterFriendlyDeaths'                                         // [live] avenge / token-floor counter
  | 'onSell'                                                      // [live] shop hook (audit Pattern-B)
  | 'afterFriendlyBattlecry'                                      // [live] audit Pattern-A: a friendly battlecry resolved
  | 'onPurchase' | 'onDamaged' | 'onPlayTribe'                    // [reserved] (onPurchase: 0 consumers)
  | 'onRefresh' | 'onCast' | 'onSacrifice' | 'onSpend' | 'onTripleCreated'; // [reserved]
```
`onShieldBreak` (a unit reacts to its own divine shield breaking) and `onSummon` (fires for
living friendlies when a unit is summoned; the summoned unit is the trigger source) are
live combat hooks. `afterFriendlyDeaths` carries `threshold`, `everyN` (repeat every N vs
fire once at N), and `tokensOnly` (count only token deaths — the Wildkin token floor).

### 6.3 Effect (triggered) — the declarative 90%

```ts
interface Effect { trigger: TriggerSpec; condition?: ConditionSpec; target: TargetSpec; actions: ActionSpec[]; }
interface TriggerSpec { type: TriggerType; tribe?: TribeId; threshold?: number; everyN?: boolean; tokensOnly?: boolean; }
```

**Selector** (WHO). [live]: `self`, `allAllies`, `randomAlly`,
`highestStatAlly`, `lowestStatAlly`, `chosenAlly` (shop-resolved), `triggerSource`,
`frontEnemy`, `highestStatEnemy` (biggest enemy by `stat` — Nullforge anti-tall neutralize).
[reserved]: `nAllies`, `leftNeighbor`, `rightNeighbor`, `adjacentAllies`, `newestAlly`,
`oldestAlly`, `randomEnemy`, `neighborsOfTarget` (cleave is handled directly in combat, not
via this selector). `TargetSpec` = `{ selector, count?, filterTribe?, filterKeyword?,
stat?, excludeSelf? }`. **Tie-break/default rules that are engine logic, not data** (§6.8).

**ActionType** (WHAT):
```ts
type ActionType =
  | 'buffStats' | 'grantKeyword' | 'summon' | 'dealDamage' | 'giveGem'   // [live]
  | 'multiplyStats' | 'plantDeathrattle' | 'custom' | 'resetToBase'      // [live] (resetToBase = Nullforge strip-to-print)
  | 'setStats' | 'gainGold' | 'makeSpell' | 'discover' | 'sacrifice';    // [reserved / no-op in engine]
interface ActionSpec {
  type: ActionType;
  atk?; hp?; permanent?;          // buffStats / setStats
  factor?;                        // multiplyStats — multiply CURRENT stats, clamped to multiplyFactorCap
  keyword?;                       // grantKeyword
  summonUnitId?; summonCount?;    // summon
  amount?;                        // dealDamage / giveGem / gainGold
  discoverFromTierOffset?;        // discover [reserved]
  planted?: Effect;               // plantDeathrattle — the deathrattle to attach
  handlerId?; params?;            // custom escape-hatch
}
```
`multiplyStats` is the exponential lever (Tuskers): per-application `factor` is hard-capped
by `engines.tuskers.multiplyFactorCap`; the exponential reach comes only from applying it
across *turns* (shop-fired copies persist and compound; combat-fired copies are
this-combat-only — the "writeback gap", §7.6). `plantDeathrattle` attaches a deathrattle
`Effect` to a target (Reefmourner bridge).

**ConditionSpec** (optional gate):
```ts
kind: 'countAllies' | 'gemsThisTurnAtLeast'                                    // [live]
    | 'battlecriesThisTurnAtLeast' | 'tokensSummonedThisTurnAtLeast' | 'deathsThisCombatAtLeast' // [live] manufactured-event breaks
    | 'hasTribe' | 'hasKeyword' | 'goldAtLeast' | 'tierAtLeast' | 'isGolden' | 'isToken';        // [reserved]
value?; tribe?; keyword?;
```
**Phase-scoping (engine rule):** combat context populates only `deathsThisCombat`; shop
context populates `battlecries/tokens/gems`. A condition evaluated in the wrong phase reads
0/false silently. A missing or unknown condition evaluates **true**.

### 6.4 Aura (passive modifier) — the multipliers

The reference's hardest patterns (trigger multiplier, battlecry doubler, tribe-wide damage
amp, cost reduction, gem/spell amps) are **not** triggers — they are passive modifiers that
change how *other* effects resolve, queried by the resolver:

```ts
interface AuraSpec {
  scope: 'selfTribeAllies' | 'yourEndOfTurn' | 'yourBattlecries'          // [live]
       | 'allAllies' | 'yourGems' | 'yourSpells' | 'shopCostTribe';       // [reserved]
  modifier: { kind: 'triggerMultiplier' | 'damageMultiplier'              // [live]
                  | 'costReduction' | 'gemValueAdd' | 'spellPowerAdd' | 'statBuffOnEvent'; // [reserved]
              value: number; tribe?: TribeId; };
  stacks?: boolean;                                    // stacking → multiply; non-stacking → max
  activeWhen?: { counter: 'deaths' | 'revenantDeaths'; threshold: number }; // combat-side breakpoint gate
}
```
`activeWhen` converts an always-on multiplier into a **breakpoint** — the aura is inert
until the bearer's side reaches `threshold` of `counter`. This is how Pale Lich's damage
amp is contained (§6.6). All multiplier values are additionally **capped** in `engines.ts`
(`endOfTurnTriggerMultiplierCap`, `battlecryTriggerMultiplierCap`, `undeadDamageAmpCap`) —
no uncapped multiplier enters the sim (decision #25).

### 6.5 Custom handler registry (the escape-hatch)

The deliberate ~10% bespoke behavior. **Exactly two handlers ship** (`shared/engine/handlers/`):

| Handler | Card | Why it can't be data |
|---|---|---|
| `replayAdjacentDeathrattle` | Bonepiper (Wildkin) | Re-fires another unit's full deathrattle mid-combat *without it dying* — no declarative "run another unit's trigger". |
| `primeNextDeathrattleDouble` | Pallbearer (Revenants) | Arms a one-shot, cross-unit combat flag ("next dier's deathrattle fires twice") the death loop honors — no declarative "modify a future unit's resolution". |

Guard the ratio: any new `custom` handler needs a determinism test and a note on why it
can't be declarative (§15). **Note:** rather than adding handlers, the two content
expansions widened the *declarative* vocabulary instead (new triggers `onSummon`/
`onShieldBreak`/`afterFriendlyDeaths`, actions `multiplyStats`/`plantDeathrattle`,
conditions for the manufactured-event breaks, the `activeWhen` aura gate, and the
breakpoint counters). That keeps handlers rare but means "the mechanics" live substantially
in the engine, not the rows — see §6.8.

### 6.6 Breakpoint content model — the design law (decision #22)

**Primary build-around payoffs trigger at thresholds on _manufactured events_, never on
"N of tribe X on board."** Banned: any *primary* payoff that grows per-unit (`+1/+1 for
each …`) — that collapses the optimal line to "buy more of the same," the mono-tribe
gradient this game exists to avoid.

- **Breakpoints, not continuous** — e.g. "at 3+ friendly deaths this combat: +N/+N board."
  Thresholds create real shop decisions and legible combat swings.
- **Key off manufactured events** the player *makes happen* (deaths, tokens summoned,
  battlecries cast, minions at start, gems this turn, shield breaks) — these are
  **reachable across tribes**, which is what enables *splashing* instead of stacking.
- **Competing axes** demand conflicting board construction so they fight for the same 7
  slots. A 2-tribe splash hits two breaks; a mono stack over-hits one and is punished by
  the sim margin check (§11.3).
- **Thin continuous floor allowed, never dominant** — a small below-breakpoint trickle
  (Wildkin token-death floor, capped) so a near-miss turn isn't fully dead.

Every ⭐ primary payoff is a discrete config row in **`shared/config/breakpoints.ts`**:
`{ card, counter, threshold, once?, ...payoff }`. The counters:

```ts
type BreakpointCounter =
  | 'deaths' | 'revenantDeaths'          // combat: friendly / revenant deaths this combat
  | 'tokensThisTurn' | 'battlecries' | 'gemsThisTurn'  // shop: this-turn manufactured events
  | 'alliesAtStart'                      // minions controlled at start of combat
  | 'shieldBreak';                       // this unit's own shield broke
```

**Lint (decision #22, §11.3c):** a test asserts every primary payoff is expressible as a
discrete breakpoint and flags any per-unit scaling that lacks a threshold.

### 6.7 Unit / instance / tribe / keyword schemas

```ts
interface UnitCard {
  id: string; name: string; tribe: TribeId; tier: number; atk: number; hp: number;
  keywords: Keyword[]; effects: Effect[]; auras?: AuraSpec[];
  isToken?: boolean;      // pool-exempt, not directly purchasable
  goldenOf?: string;      // base id, if a golden form
  text?: string;          // human-readable rules text (UI/tooltip)
  axis?: Axis[];          // static glyph(s) this card feeds (categorical, §6.6)
}
interface UnitInstance {  // live owned object; uid !== cardId
  uid; cardId; golden; atk; hp; keywords; bornTurn;
  grantedEffects?: Effect[];  // deathrattles planted by Reefmourner (persist on the instance)
}
interface TribeDef   { id; name; colorHex; blurb; }
interface KeywordDef { id; name; rulesText; }        // engine reads keyword *timing*, not this text
// DEFERRED stub: TavernSpell { id; name; cost; tier; effects; permanent; }
```
Keyword *timing* lives in the combat engine (§7), not in data — data only tags which units
carry a keyword. Canonical content: `shared/content/units.ts` (the 90 rows),
`tribes.ts`, `keywords.ts`.

### 6.8 Code-only semantics (not derivable from the data rows)

These rules make the data mean something and **must be specified + tested**, because no
data row states them. An agent regenerating from `units.ts` alone would not reproduce them.

- **Selector tie-breaks:** `highest/lowestStatAlly` tie → earliest board slot; default
  `stat` when omitted = `hp`; `newest/oldestAlly` sort by `bornTurn` then slot.
- **RNG draw method & discipline:** random targets use `rng.shuffle(pool).slice(count)`;
  the defender pick uses `rng.pick(pool)`; the first-attacker tie uses `rng.bool()`. The
  PRNG is a seeded mulberry32/FNV-1a with Fisher–Yates shuffle (`shared/engine/rng.ts`).
  Determinism depends on the **order and count** of these draws, not just the outcomes.
- **Stat clamps:** `buffStats`/`multiplyStats` floor atk at 0, hp at 1 (multiply) and
  round; `multiplyStats` factor clamped to `multiplyFactorCap` in *both* phases.
- **Counter/breakpoint math:** death counters increment **before** the dead unit's
  deathrattle/avenge fire, so death-gated conditions (Bone Colossus) and the Pale Lich amp
  see the death. Avenge `everyN` defaults true (`deathCount % threshold === 0`) vs once
  (`=== threshold`). Echo Choir's doubling increments `battlecriesThisTurn` by the
  multiplier up front so BATTLECRY breaks see the doubled progress.
- **Aura combination:** stacking auras multiply, non-stacking take the max; trigger counts
  are rounded, `Math.max(1, …)`, then hard-capped.
- **`yourEndOfTurn` trigger multiplier is summon-scoped (audit §16).** Grovecaller's
  `triggerMultiplier` multiplies **only `summon` end-of-turn actions**, not `giveGem` or
  `multiplyStats` — a code-only restriction (there is no `endOfTurnPhase` aura scope in the
  type; the scope value is still `yourEndOfTurn`). Documented here because no data row states
  it and it is load-bearing (it prevents Grovecaller × the Tusker doubler compounding).
- **Token-death floor cap** (`tokenDeathFloorCapAtk`) is enforced in the engine, invisible
  in the Gorehide/Thornbeast rows.

### 6.9 Live vocabulary catalog — the regeneration surface (authoritative)

The regenerable contract is **not the 90 cards** — it is the finite set of primitives they
compose. A fresh engine that implements every **live** primitive below (with §6.8 semantics)
reproduces all declarative content for free; it needs card-specific code only for the 2
handlers (§6.5). This is why "the agent doesn't need to know the cards" is true — *provided*
the vocabulary is complete and pinned.

**Two governing rules (the anti-idiom law):**
1. **Every live primitive has a pinned semantic (§6.8) + ≥1 eval (`EVALS.md`, lint EV-VOCAB-01).**
   A `[reserved]` primitive has **no consumer and no eval** and may be pruned.
2. **A card may only use a live primitive. A new behavior must be _promoted to a named
   primitive first_ (spec + eval), never smuggled in as an idiom** — a composition whose meaning
   isn't stated by its parts (e.g. `dealDamage: 999` = "destroy"). Idioms are what make a regen
   silently wrong: the agent can implement each part correctly and still miss the whole.

Counts are actual usage across `units.ts` — a **drift tripwire**: a live count hitting 0 means
it silently became reserved; a card needing something not listed means *stop and promote it*.

- **Triggers — live (10):** `battlecry`(29) · `deathrattle`(19) · `startOfCombat`(19) ·
  `endOfTurn`(9) · `afterFriendlyDeaths`(8) · `onSell`(2) · `onAttack`(1) · `onShieldBreak`(1) ·
  `onSummon`(1) · `afterFriendlyBattlecry`(1).
  *Reserved (0):* `onPurchase`, `onDamaged`, `onPlayTribe`, `onRefresh`, `onCast`,
  `onSacrifice`, `onSpend`, `onTripleCreated`. (`onPurchase` has 0 consumers — reserved in §6.2.)
- **Selectors — live (9):** `self`(34) · `allAllies`(29) · `chosenAlly`(12) · `randomAlly`(5) ·
  `lowestStatAlly`(4) · `highestStatAlly`(2) · `frontEnemy`(2) · `highestStatEnemy`(1) ·
  `triggerSource`(1). *Reserved:* `leftNeighbor`, `rightNeighbor`, `adjacentAllies`,
  `newestAlly`, `oldestAlly`, `nAllies`, `randomEnemy`, `neighborsOfTarget` (cleave neighbors
  are computed in combat, not via a selector).
- **Actions — live (8 + custom):** `buffStats`(44) · `grantKeyword`(17) · `summon`(13) ·
  `dealDamage`(7) · `giveGem`(7) · `multiplyStats`(3) · `plantDeathrattle`(1) · `resetToBase`(1)
  · `custom`(2) · **`destroy` — PROMOTED from the `dealDamage: 999` idiom (4 uses), see D11.**
  *Reserved:* `setStats`, `gainGold`, `makeSpell`, `discover`. *(`sacrifice` folded into `destroy`.)*
- **Conditions — live (5):** `countAllies`(7) · `battlecriesThisTurnAtLeast`(9) ·
  `gemsThisTurnAtLeast`(3) · `deathsThisCombatAtLeast`(2) · `tokensSummonedThisTurnAtLeast`(1).
  *Reserved:* `hasTribe`, `hasKeyword`, `goldAtLeast`, `tierAtLeast`, `isGolden`, `isToken`.
- **Auras — live (exactly 3 (scope,modifier) shapes):** `(selfTribeAllies, damageMultiplier)`
  +`activeWhen` (Pale Lich) · `(yourBattlecries, triggerMultiplier)` (Echo Choir) ·
  `(yourEndOfTurn, triggerMultiplier)` summon-scoped §6.8 (Grovecaller). *Reserved scopes:*
  `allAllies`, `yourGems`, `yourSpells`, `shopCostTribe`. *Reserved modifiers:* `costReduction`,
  `gemValueAdd`, `spellPowerAdd`, `statBuffOnEvent`.

**`destroy` (the one promotion in current content — pins the load-bearing semantics the
`dealDamage: 999` idiom hid; D11):** removes the target; **counts as a friendly death and fires
its deathrattle** (the Infernals sacrifice→`deaths`-breakpoint engine and Gravebrand/Dreadmaw
depend on this); is **not** combat damage (no retaliation, no poison flag). **Divine shield does
NOT save the target — `destroy` bypasses it (D11(a), decided 2026-07-01):** it is removal, not
damage, so a shielded ally is destroyed and its shield is untouched.

---

## 7. Combat resolution

Deterministic given `(boardA, boardB, seed)`: same inputs → identical `CombatEvent[]`.
**Seeded PRNG** seeded from the match/round/pairing; **all** combat randomness draws from
it. Entry point: `resolveCombat(boardA, boardB, seed) → CombatEvent[]`
(`shared/engine/combat.ts`). Config: `shared/config/combat.ts`.

### 7.1 Setup
1. Snapshot both boards into self-describing combat units (combat never mutates shop/bench
   state). Emit `combatStart`.
2. Fire `startOfCombat` effects in board order (**A then B, left→right**).
3. **Resolve deaths** (§7.3) — start-of-combat effects (sacrifice/burst/poison) can kill.
   There is no attacker yet, so cross-side simultaneous deaths here resolve in **global board
   order, side A then side B, left→right** (the D2 start-of-combat fallback).
4. **First attacker** = side with more minions; tie → seeded coin flip (`rng.bool()`).
   *(Deaths in step 3 resolve before this count — an outcome-affecting ordering rule.)*

### 7.2 Attack loop
Each side has an **attack pointer** advancing left→right and wrapping. On a side's turn:
1. Attacker = the unit at that side's pointer.
2. Fire the attacker's `onAttack` effects (custom handlers, e.g. Bonepiper, run here).
   **(D3i, decided):** resolve any deaths this causes now; if the attacker died to its own
   `onAttack` (HP ≤ 0), it does **not** complete the swing — skip steps 3–4 (deaths resolve
   at step 5).
3. Choose the **defender**: if `tauntOverride` and the enemy has taunt units → pick among
   taunts; else the full enemy line. `targetingMode` = `random` (default) picks via
   `rng.pick`; `deterministic` picks the front unit. Emit `attack`; advance the pointer
   past the attacker.
4. **Trade damage** (each hit scaled by the tribe damage multiplier, §7.5, and rounded):
   - Attacker deals `atk` to the defender.
   - **Cleave** (attacker keyword): also deal `atk·cleaveDefault` (default 100%) to the
     defender's immediate left/right neighbors. **(D3ii, decided):** cleave neighbor
     positions are computed against the **current** enemy line at cleave time — if breaking
     the defender's shield (below) inserted a unit, recompute; don't reuse a stale index.
   - Defender deals `atk` back to the attacker (retaliation).
   - **Divine shield** negates the *next* damage instance entirely (including poison) and
     is consumed; breaking it fires the victim's `onShieldBreak` immediately.
   - **Poison** flags any unit it deals >0 unblocked damage to, to die after the step.
5. **Resolve deaths** (§7.3). Hand the turn to the other side; repeat.

Combat ends when a side has no living units, or `maxCombatSteps` (400) is hit (→ tie).

### 7.3 Death, deathrattle, reborn, summon timing
Deaths are **simultaneous (D1)**. On each resolution pass:
1. **Collect & snapshot** every unit at HP ≤ 0 or poison-flagged.
2. **Register the whole batch before any deathrattle fires:** for each, emit `death`, remove
   it, and increment the death counters (`deaths`, token deaths, revenant deaths). Because the
   batch registers first, a deathrattle condition (Bone Colossus) and the Pale Lich amp see
   **all** of this pass's deaths, not a partial count.
3. **Resolve deathrattles** against that settled board, in the **D2 order** — attacker's side
   first (side A first at start of combat), board left→right within a side. If Pallbearer
   primed the double, that dier's deathrattle fires twice, then the flag clears.
4. **Reborn:** a unit with reborn returns once, in its own slot, with **1 HP** and reborn
   stripped, at **base card attack** (×2 if golden) — buffs dropped — *after* its deathrattle.
5. **Avenge** (`afterFriendlyDeaths`, non-token) and the **token-death floor** (token deaths
   only, capped) fire on the batch's death count.
6. **Summons** occupy the dead unit's slot, shifting others right; if the board is at the
   config board cap (`economy.boardCap`), excess summons are dropped (logged). Each summon
   fires `onSummon` for living friendlies. The attack pointer stays consistent across
   removals/insertions.

Loop until a pass finds no further deaths (guarded at 64 iterations against pathological
deathrattle chains).

### 7.4 Targeted effects & combat purity
`chosenAlly` selectors are legal only on `battlecry`/shop-time effects and are resolved by
the player during the shop phase. **No combat action requires human input**, so combat is a
pure function of `(boards, seed)`.

### 7.5 Combat event log & tribe damage multiplier
The server resolves the whole fight and emits an ordered log; the client replays it (§10)
and the simulator reads it. Damage from a unit is scaled by its side's tribe
`damageMultiplier` auras (Pale Lich), gated by `activeWhen`, read from the live counters at
strike time.

```ts
type CombatEvent =
  | { t:'combatStart'; seed; a:BoardSnapshot; b:BoardSnapshot }
  | { t:'attack'; side:'a'|'b'; attackerId; defenderId }
  | { t:'damage'; sourceId; targetId; amount; shieldBroken? }
  | { t:'keyword'; unitId; keyword; gained?; sourceId? }   // gained+sourceId ⇒ unit GAINED an ability
  | { t:'stats'; unitId; atk; hp; sourceId?; permanent? }  // sourceId links a buff to its cause (replay)
  | { t:'death'; unitId } | { t:'deathrattle'; unitId }
  | { t:'summon'; ownerId; unitIds:string[]; slot }
  | { t:'combatEnd'; winner:'a'|'b'|'tie'; survivors:string[]; damageToLoser };
```
`stats.permanent` is **reserved** (see §7.6 writeback gap): combat-fired buffs are never
written back to the persistent board, so all combat `stats` events currently carry
`permanent:false` and nothing consumes the field. `stats.sourceId` and `keyword.gained`/
`sourceId` are additive and consumed by the replay for causality links.

### 7.6 Resolved combat rules — divergence ledger (items 1–3, 6 resolved in code; item 5 open)

§§7.1–7.3 now state the **decided** rules (rulings D1–D4, D7 in `DECISIONS-NEEDED.md`). The
numbered items below are kept as the **historical record** of the divergences found in the
2026-07-01 audit. **Status (2026-07-01): items 1–3 and 6 are implemented in `combat.ts` and
green** (pinned by `EV-DTH-08/09a/09b/10` in `shared/engine/death.test.ts` and `EV-INV-CFG`
in `shared/engine/invariants.test.ts`); item 4 is a decided stance, not a code item; **item 5
(the writeback gap) is the one open divergence.** The "*pre-fix code*" notes describe the
audited code, not today's:

1. **Deaths are simultaneous (D1).** Collect the whole batch, register it, then resolve
   deathrattles into the settled board. *Pre-fix code* removed-and-fired sequentially and
   ignored the `simultaneousDeaths`/`deathrattleOrder` config flags (at audit only 4 of the 7
   combat knobs were read — `targetingMode`, `tauntOverride`, `cleaveDefault`, `maxCombatSteps`;
   the two dead knobs `attackOrderRule`/`firstAttackerTiebreak` are deleted per D7).
2. **Cross-side order = attacker's side first (D2)**, side A first at start of combat,
   left→right within a side. *Pre-fix code* did all-of-A-then-all-of-B unconditionally (a
   fixed side-A advantage).
3. **A unit dead to its own `onAttack` does not swing; cleave recomputes after a shield-break
   insert (D3).** *Pre-fix code* did neither.
4. **Determinism is a property, not a cross-build byte guarantee (D4).** A regen must satisfy
   "same `(boards, seed)` twice → identical log" *within its own implementation*; it need
   **not** reproduce this repo's exact byte log (a different-but-valid PRNG draws a different
   sequence — see §6.8, the determinism note). Byte-goldens are therefore **not** carried as
   tier-2 truth; `EV-GLD-*` are regenerated *from the corrected engine* only as an intra-impl
   regression guard, after D1–D3 fix the ordering.
5. **Writeback gap** (tracked as §15 #3): combat-fired "permanent" buffs are not reconciled
   onto the persistent board; `stats.permanent` is the reserved seam.
6. **Config repair (D7):** wire `boardCap` and `divineShieldNegatesPoison` to config; honor
   `simultaneousDeaths`/`deathrattleOrder` (per D1/D2); **delete** the single-valued
   `attackOrderRule`/`firstAttackerTiebreak` knobs (behavior is fixed, they aren't real
   knobs); keep the `64`/`8` loop bounds as commented safety guards.

**Eval status (2026-07-01):** `EV-DTH-08/09a/09b/10` and `EV-INV-CFG` encode the decided
rules above and are **green against today's `combat.ts`** — items 1–3 and 6 are closed.
One honest residue on item 6: `combat.ts` does not literally branch on
`simultaneousDeaths`/`deathrattleOrder`; behavior is hardcoded to their single legal values,
which `EV-INV-CFG` explicitly accepts ("implemented as behavior rather than necessarily
referenced by name"). The `EV-GLD-*` determinism goldens were regenerated from the corrected
engine, per D4. Item 5 (writeback) remains open and is tracked as §15 risk #3.

---

## 8. Mechanics ↔ reference mapping

The architecture (§6) expresses every reference engine. All **nine** tribes ship. "H" =
needs a `custom` handler (only 2 of 26 engines do); everything else is declarative
data + engine vocabulary.

| Tribe (orig.) | Reference engine family | Primitive used |
|---|---|---|
| Wildkin | token gen + amplifier, avenge, cleave, mid-combat deathrattle replay | `endOfTurn`→`summon`, `onSummon`+cond→`buffStats`, `afterFriendlyDeaths`, keyword `cleave`, **H** `replayAdjacentDeathrattle` |
| Reefkin | battlecry chain/doubler, poison+shield carriers, single-target megabuff, plant | `battlecry`→`buffStats` (`chosenAlly`), aura `triggerMultiplier`, `grantKeyword`, `plantDeathrattle` |
| Revenants | reborn stacking, death payoffs, tribe damage amp, deathrattle-double | keyword `reborn` + `deathrattle`, aura `damageMultiplier`+`activeWhen`, **H** `primeNextDeathrattleDouble` |
| Infernals | self-damage / sacrifice for burst | `startOfCombat`→`dealDamage(self)`+`buffStats`, deaths breakpoints |
| Tuskers | gem greed → exponential doubler | `giveGem` + `gemsThisTurn` breakpoint → `multiplyStats` (capped) |
| Primordials | play-count → wide cleave splash | `battlecries`/`alliesAtStart` breakpoints → `buffStats` / grant `cleave` |
| Sirens | poison home + start-of-combat burst | `startOfCombat`→`dealDamage`, `battlecries` breakpoints, board `poison` |
| Constructs | assembly / reassemble | `deaths`/`alliesAtStart` breakpoints → `summon` (magnetic reserved) |
| Corsairs | on-buy tempo, sticky reborn/shield width | `alliesAtStart` breakpoints, reborn/divine-shield width |

Marquee ⭐ breakpoint cards per tribe live in `config/breakpoints.ts` (e.g. Mortarch
`deaths≥3 once`, Pale Lich `revenantDeaths≥3 amp`, Chorus Tide `battlecries≥2`, the Tusker
doublers `gemsThisTurn≥3 factor 2`). The full **90-row** roster is `shared/content/units.ts`;
per-tribe counts (verified against the catalog): Wildkin 11, Revenants 13, Reefkin 12,
Corsairs 10, Constructs 10, Tuskers 9, Primordials 8, Sirens 9, Infernals 8 (= 90; 84
purchasable + 6 tokens). The +7 over the pre-audit slice are the §16 cards: Reefkin
Tidebinder, Infernals Carrion Sovereign (T6), Constructs Nullforge + Aegis Prime (T6),
Tuskers Tuskmonger, Sirens Maelstrom Cantor, Corsairs Quartermaster.

---

## 9. Multiplayer architecture

**Framework: Colyseus** (TS-native authoritative rooms; `@colyseus/schema` delta sync; room
ids as join codes; reconnection tokens).

**9.1 Room lifecycle:** `created → lobby → starting → (round: shop → combat)* → finished →
disposed`. One room = one match (≤8 seats).

**9.2 Server authority:** the server owns gold, shop contents, the shared pool, all
RNG/seeds, combat resolution, HP, pairings, placement. **Clients send intents only** and
render state; every intent is validated before applying.

**9.3 State sync — two-channel (decision):**
- **Public schema** (all clients): per-player `{seat, name, hp, tier, alive, placement,
  isBot, connected, ready}`, plus `roomCode, phase, round, timer, pairings, hostSeat,
  botFill, winnerSeat`.
- **Private per-client push** (owner only): `gold, baseIncome, tier, tierUpCost,
  rerollCost, shop, frozen, bench, board, gems, discover, pendingTarget, lastCombatLog,
  log`. **No opponent private info ever leaves the server** — shop/hand scouting is
  impossible by construction.

**9.4 Messages:** client→server = the `Intent` union (§4.2) + lobby (`createRoom, joinRoom,
setBotFill, startMatch`). server→client = public `state` patches, private `privateState`
pushes, `combatLog` (event array §7.5), `ToastEvent` (triple/eliminated/placement/info/
combatResult), `error` (rejected intent + reason).

**9.5 Reconnection (decision):** on disconnect the board persists and keeps fighting; a
token permits rejoin within `reconnectGraceSeconds` (60). If they don't return, a **bot
takes over** so the match never stalls. Reconnecting resyncs the private channel.

**9.6 Where bots plug in:** a bot is a server-side agent implementing the same intent
interface as a human (`server/bots/BotAgent.ts`). The room can't tell them apart — which is
what lets the **simulator reuse the exact bot + engine** (§11).

**9.7 Interface contracts (pinned — stable across regeneration).** The exact boundaries any
reimplementation must satisfy. The full type unions live in `shared/types/index.ts` (do not
transcribe — reference them); these are the *signatures*, which are the eval surfaces (§EVALS):

- **Combat (pure):** `resolveCombat(boardA: CombatBoard, boardB: CombatBoard, seed: string):
  CombatEvent[]` (`shared/engine/combat.ts`). The `combatEnd` event carries
  `{ winner:'a'|'b'|'tie', survivors:string[], damageToLoser:number }` — the same data as
  `CombatOutcome`, so outcome is observable from the event stream alone. Seed is a **string**;
  RNG is derived FNV-1a → mulberry32 (`shared/engine/rng.ts`, methods `next/int/bool/pick/shuffle`).
- **Combat event schema:** the `CombatEvent` union in §7.5 (canonical in `shared/types`). This
  is the primary black-box observation surface for combat evals.
- **Shop reducer:** the exported ops in `shared/engine/shop.ts` — `buyUnit, sellUnit, rollShop,
  freezeShop, unfreezeShop, tierUp, playUnit, moveUnit, resolveTargetChoice, resolveDiscoverPick,
  startShopPhase, endOfTurnPhase, boardToCombat` — each returning
  `OpResult = { ok: boolean; error?: string; triples?: string[] }`.
- **Intent application (accept/reject):** `Match.applyIntent(seat: number, intent: Intent):
  OpResult` (`shared/engine/match.ts`). A rejected intent returns `{ ok:false, error }` and
  mutates nothing — the observation surface for all validation evals.
- **Intent schema:** the `Intent` union in §4.2 (canonical in `shared/types`).
- **State schemas (privacy contract):** `PublicState` (synced to all) vs `PrivateState`
  (owner-only push) per §9.3 — the two-channel split is itself an asserted invariant.
- **Server→client messages:** §9.4 (`state`, `privateState`, `combatLog`, `ToastEvent`, `error`).

---

## 10. Client & game-feel (decisions #21, #26–28, #30)

React + Vite, original iconographic art, no asset files. See `WEB-FRAMEWORK.md` for the
front-end architecture.

**Card anatomy (procedural, clean-room).** The face leads with a **tribe-themed procedural
SVG avatar** — a per-tribe face system with a unique per-card recipe (`client/src/
cardArt.ts`, a pure `string→SVG` function; no assets, no IO, no state). Overlaid: tier
badge, icon-only keyword chips, large Atk/HP, and the **static axis glyph** (§6.6). Bridge
cards carry a faint colour *tint* of the tribe they reach into. Keyword icons are toxin/guard
metaphors kept off the death glyphs (poison = 🧪, not a skull — ☠️/💀 collide with the Deaths
axis 💀 and the Revenants crest 🪦). Hover tooltip = keywords **named in full** (a granted
keyword — e.g. a poison buff applied in the shop — is listed under a separate **Added this
game** block, since the face chip alone doesn't say which effects were granted vs printed),
full ability text, and base-vs-buffed stats. Triggers (battlecry/deathrattle) stay text-only
(no face icon): they read in the ability text, not as another death-adjacent glyph.

**Battlefield.** One clean **left→right battle line per side, no wrapping**. Leftmost =
next-to-act and first-targeted; adjacency is visually obvious (matters for cleave +
Bonepiper). The engine is already single-line — this is client-only.

**Combat replay — choreographed causal beats.** The event stream is segmented into **causal
beats** (never all-at-once) in a render-free, unit-tested module. That module is **pure and lives
in the shared engine** (`shared/engine/combatReplay.ts`) — not the client — because both the
client (which animates the beats via `CombatReplay.tsx` + Framer Motion) and the **server**
(which sizes the combat-phase window from the same pacing math, below) consume it; a single
source of truth keeps them from drifting. `client/src/scenes/combatBeats.ts` re-exports it so
the scene keeps a stable local path.

The load-bearing rule is **presentation is decoupled from simulation**: the presenter plays beats
**one at a time**, each as *entry → hold → exit*, and only advances once the current beat's
choreography has had its full dwell — driven by a **frame-rate-independent rAF clock**
(`useBeatClock`), never a drifting `setTimeout` chain. All *sub-beat* feel-timing (the lunge
wind-up/travel/recoil, the contact instant, the health-bar drain, the death 0-HP hold + crumble,
the buff flash + number tick, the float rise) is single-sourced in **one `TIMING` config**
(`client/src/scenes/replayTiming.ts`, presentation-only) with a global **`combatSpeed`** knob —
which is the shared `COMBAT_SPEED`, so the server window is sized from the same tempo. Each
choreography is **fitted to its beat's dwell** so a compressed (monster-board) replay still lands
cleanly. The legibility wins:

(1) **who hits whom (asymmetric telegraph)** — a strike is **directional motion only the attacker
makes**, so the initiator reads *pre-attentively*, without decoding the colour legend (colour is
secondary reinforcement, never the initiative signal). It is **sequenced so the eye lands on the
attacker before it acts**: the attacker first **glows and scales up in place** (a stationary
*highlight* hold) while **the rest of the board dims**, then **winds up** (a short pull-back *away*
from the defender — the anticipation "tell"), then **thrusts** into the struck defender (an
*accelerating* lunge that visibly pokes in — a committed travel, not a nudge), holds at contact,
and finally **recoils** back to its slot and settles as the glow lifts. The attacker **never
shakes and is never knocked back by its own blow**. The **defender only reacts**: on impact it is
**knocked back away from the attacker** (a quick shove, then an ease back to its slot) — it **never
travels toward the attacker and never lunges**. The rule is *whatever the attacker does, the
defender does the opposite or nothing*, so the lunge — which belongs to exactly one card — is the
"who started it" signal even when both units take damage. The struck defender's damage payoff is
**bound to the impact keyframe, never to beat-start**: the attacker's lunge fires an **`onImpact`**
callback at the frame its translate reaches the defender (`TIMING.strike.impactFraction` of full
thrust extension), and *that* is what drains the **health bar** (tweened, never snapped) and ticks
the HP number down. Until impact the struck card **holds its pre-damage HP** — bar full, number
un-ticked — so slowing the replay (or a longer lunge) keeps HP full through the wind-up/travel and
drains it **only when the sprite actually lands**; the drain can never precede the blow. (This is a
correctness contract, not just feel: a beat-start drain — the classic bug — reads as HP falling
*before* the attacker arrives, and a regen must fire the drain off the lunge's impact, not a timer
measured from the beat opening.) At that same instant the defender flashes, its damage number
rises-and-fades, a small **screen shake** punctuates the blow, and a popped divine shield throws a
shatter ring. A **cleave** splashes each neighbour with a gentle shove *away from the attacker*
(never a competing shake) and staggered **amber** numbers (vs. the defender's red) so the wide hit
reads as a left→right sweep. All of this sub-beat timing (highlight → wind-up → thrust → impact →
recoil, the impact-bound drain/tick, plus the defender's knockback/settle) is single-sourced in the
`TIMING.strike` config (`replayTiming.ts`); a strike's dwell **weight**
(`shared/engine/combatReplay.ts`) is sized so that choreography plays uncompressed on a normal fight.

(2) **the death cadence (strict, non-overlapping)** — damage number pops → the health bar drains →
the card **HOLDS visibly at 0 HP** → it **crumbles** (shrink + tip + desaturate) → **only then** is
it removed and the line **reflows** as neighbours slide in → and **only then** does its deathrattle
play, as **its own beat**. A death and its deathrattle are never the same beat, and a deathrattle
never fires during the death animation or the next strike.

(3) **honest deathrattle labelling** — the resolver emits a `deathrattle` **marker event for every
death** (a per-death marker, not proof of a deathrattle). The beat layer is therefore
**content-aware**: it consults the card catalog (`UNIT_BY_ID`, resolving summoned-token cardIds
from their owner best-effort) and gives a **its-own beat only to a REAL deathrattle**; a marker for
a unit that has no deathrattle is **absorbed silently** into the death beat and never labels the
card — so "X's deathrattle" only ever names a card that actually has one.

(4) **visible buffs, as their own beat** — a buff flashes a **gold** ring on the recipient, floats a
gold `+atk/+hp` chip, and the stat number **ticks up** (counts, with a bounce) rather than silently
changing; the buff is slotted as its own beat (never overlapping a strike), and a link is drawn
back to `stats.sourceId`.

(5) **clean floating text** — every popup shares **one anchored stack above the card** (scale-in →
rise → fade over a fixed duration); two texts on one card **stack, never overlap**; colours are
consistent (**red** damage, **gold** buff, **green** keyword-gain).

(6) **pacing by impact + controls** — each beat's dwell scales with a computed weight (trivial
strikes batch; board-wide buffs / key deaths / deathrattles / breakpoints hold), with step (◀/▶),
scrub and speed controls, plus **Skip ✕ which dismisses the whole combat window** (the frozen shop
shows behind it) instead of jumping to the end and still waiting. **The revealed shop is an inert
preview, not yet live:** the server still owns the combat hold, so the client gates every intent on
the real public `phase` (buys during `combat` would bounce with `not shop phase`). Skipping the
replay does **not** shorten that hold — the next shop doesn't exist until `beginShop` runs — so the
locked state must be **unmistakable**, not merely a greyed shop (a greyed shop with
`pointer-events:none` reads as *broken* because a click produces no feedback at all). The frozen
shop therefore shows a **prominent "Shop locked — combat is still resolving" banner with a live
countdown** (the seconds tick down from the public `timer`, below) plus a **"🔒 locked"** label on
the shop-zone header, and only the zone *contents* dim (headers stay bright) so the reason and the
reopen time land where the eye/pointer is — not only in a strip up top. Skip is thus honest about
inputs not being live yet rather than presenting a buyable-looking shop that silently rejects buys.
A permanent/temporary cue is
**reserved** pending the writeback gap (§7.6) — currently all combat buffs read as this-combat.

> A dev-only workbench (`client/src/scenes/ReplayLab.tsx`, gated behind the `#replay-lab` URL hash,
> lazy-loaded so it is code-split out of the shipped bundle) renders `CombatReplay` against real
> `resolveCombat` logs for a set of canned matchups (cleave / shields / deaths-and-reborn / brawl),
> so this game-feel layer can be audited in isolation without driving a full match to reach combat.

**Replay window sized to the fight (never truncated).** The server holds the `combat` phase
for `combatWindowMs(logs)` — the longest natural replay across the round's *watched* fights
(bots don't watch), padded by `REPLAY_TAIL_PAD_MS` and clamped to
`[REPLAY_WINDOW_MIN_MS, REPLAY_WINDOW_CAP_MS]` — **not** a fixed hold. A fixed hold (formerly
6.5s) truncated any non-trivial fight mid-combat; sizing to the actual log guarantees the
replay always plays through to the result banner. A fight whose natural playback exceeds the
cap is **compressed client-side** (the replay auto-scales its dwell) to finish inside the
window. The pacing constants (`REPLAY_BASE_STEP_MS`, `COMBAT_SPEED`, cap, floor, pad) are
**presentation, not balance** — they live beside the beat logic in
`shared/engine/combatReplay.ts` and drive both the client dwell and the server window (so the
`combatSpeed` tempo knob can never desync them). Pinned by `shared/engine/combatReplay.test.ts`.
During the hold the server also publishes the remaining seconds in the public `timer` field (which
means "seconds left in the current timed phase" — the shop budget during `shop`, the time until the
next shop during `combat`; it was formerly hard-zeroed in `combat`), so a client that skipped its
replay sees a live countdown to when the frozen shop reopens. `MatchRoom` keeps its tick running
through `combat` to refresh it; the scheduled `beginShop` still owns the actual phase transition.

**Contextual counters (decision #27).** Show a manufactured-event counter (deaths / tokens
/ battlecries / gems) **only when you own a card that consumes it** — never an always-on
panel.

**Shop — drag-and-drop (decision #28).** Drag shop→board, board→sell-zone, reorder,
board↔bench. Buttons remain a fallback. Maps onto existing intents; no server change.

---

## 11. Balance framework

**11.1 Config-driven tuning (pillar #5).** Every gameplay number lives in
`shared/config/*` (typed TS, imported by server, client, and sim). Changing balance = edit
config + re-run the simulator; no logic edits. §7.6 lists the current hardcoded exceptions
to repair.

**11.2 Headless simulator — micro + macro.** Imports the **same** `shared` engine and
`server` bots (never re-implements them).
- **Micro (combat) sim:** two fixed boards + N seeds → win/tie/loss %, avg surviving stats,
  avg hero damage. Exactly reproducible because combat is pure. (`sim/micro.ts`)
- **Macro (full-match) sim:** 8 bot configs + M matches → per unit/build/tribe pick rate,
  avg placement, win rate, "assembled the combo?" rate. (`sim/macro.ts`, `sim/metrics.ts`)

**11.3 Breakpoint balance-gate metrics (decision #29).** Thresholds in
`shared/config/sim.ts`; the macro-sim asserts:
- **(a) Single-axis margin** — no single-axis stacked build may exceed the multi-axis
  cohort's win-rate by more than `singleAxisMarginMax` (0.08). Watch list: Grovecaller+
  Grovelord, Echo Choir, Pale Lich.
- **(b) Reachability (the gate)** — ≥ `splashReachTargetPct` (0.5) of *developed* 2-tribe
  splashes must hit two distinct breakpoints; else breakpoints are tuned too high and
  everyone mono-stacks.
- **(c) Breakpoint lint** — every primary payoff must be a discrete config breakpoint; flag
  per-unit scaling without a threshold.
- **(d) Non-linearity** — crossing a marquee threshold must improve placement by ≥
  `nonLinearityMinStepRatio` (1.5×) the sub-threshold slope: a step, not a line.

**11.3 outputs:** CLI → CSV/JSON + console; auto-flags overpowered / dead / dominant-build
/ stale-combat (hitting `maxCombatSteps`). Monte-Carlo over seeds washes out targeting
variance. Additional harnesses: `sim/audit.ts`, `sim/web*.ts` (see `sim/`).

**11.4 Database (later).** None required (in-memory rooms). Future: a `server/persistence`
adapter for match history + unit telemetry; config catalog and sim outputs are already
DB-ready shapes.

---

## 12. Config parameter catalog

Every tuning knob is a named, editable parameter under `shared/config/`. **These files are
the canonical balance spec — this section indexes the modules, it does not restate their
values** (that is what drifted before). Read the files for current numbers.

- **`economy.ts`** — `goldStart, goldPerTurn, goldCap, buyCost, sellRefund, rerollCost,
  freezeCost, freezePartialAllowed, tierUpBaseCost[], tierUpDiscountPerTurn,
  shopSlotsByTier[], poolCopiesByTier[], boardCap, benchCap, tierCount`.
- **`match.ts`** — `startingHealth, lossBaseTierWeight, survivorTierWeight, lossDamageCap,
  simultaneousEliminationRule, shopTimerBase, shopTimerPerTier, shopTimerPerGold,
  shopTimerCap, reconnectGraceSeconds, ghostsEnabled, avoidImmediateRematch, maxSeats,
  maxRounds`.
- **`combat.ts`** — `targetingMode, tauntOverride, maxCombatSteps, divineShieldNegatesPoison,
  cleaveDefault, simultaneousDeaths, deathrattleOrder`. **(D7, decided):** a regen **honors**
  `simultaneousDeaths`/`deathrattleOrder` (per D1/D2) and `divineShieldNegatesPoison`, and
  **drops** the old single-valued `attackOrderRule`/`firstAttackerTiebreak` knobs (behavior is
  fixed). Today's code reads only 4 of these — see §7.6.
- **`triples.ts`** — `tripleRewardType, tripleDiscoverTierOffset, tripleRewardScalesByTier,
  goldenStatMultiplier, copiesForTriple`.
- **`engines.ts`** — one block per tribe (the per-tribe knob sets), including the Round-6
  cap knobs (`endOfTurnTriggerMultiplierCap`, `battlecryTriggerMultiplierCap`,
  `undeadDamageAmpCap`/`Threshold`, `tokenDeathFloorAtk`/`CapAtk`, `plantedDeathrattleAtk`/
  `Hp`, Tuskers `doublerFactor`/`multiplyFactorCap`, Sirens `burstDamage`, etc.).
- **`breakpoints.ts`** — the `{ card, counter, threshold, once?, ...payoff }` list; the
  authoritative source for every ⭐ payoff's numbers (§6.6).
- **`sim.ts`** — the balance-gate thresholds for §11.3 (a)/(b)/(d).
- **`systems.ts`** — `freezeIsFree` (active); **DEFERRED stubs**: trinket*, tavernSpell*,
  heroPower*.
- **`bots.ts`** — difficulty presets (`easy/medium/hard`) as `BotWeights` bundles
  (`greed, rollAggression, tribeCommitTurn, synergyValue, rerollThreshold, tierUpEagerness`
  + axis/bridge/breakpoint awareness: `axisValue, bridgeValue, breakpointValue,
  splashBalanceBonus, breakpointHuntTarget, breakpointHuntMaxRolls`).

---

## 13. Tech stack & project structure

**TypeScript everywhere; pnpm workspaces monorepo.** `shared` is the single source of truth
imported by the other three.

```
cardfightinggame/
├─ shared/                      # imported by server, client, AND sim
│  ├─ types/index.ts            # UnitCard, Effect, AuraSpec, CombatEvent, state, intents
│  ├─ config/                   # economy match combat triples engines breakpoints sim systems bots
│  ├─ content/                  # units.ts (90 rows), tribes.ts, keywords.ts  ← new units = new rows
│  └─ engine/                   # PURE, no IO:
│     ├─ rng.ts                 #   seeded PRNG (mulberry32/FNV-1a, Fisher–Yates)
│     ├─ combat.ts              #   resolveCombat(boardA,boardB,seed) -> CombatEvent[]
│     ├─ shop.ts                #   buy/sell/roll/tier/freeze/triple/pool ops
│     ├─ effects.ts             #   declarative trigger/target/condition/action resolver
│     ├─ auras.ts               #   passive modifier queries (multipliers, caps, activeWhen)
│     ├─ breakpoints.ts (+.test)#   breakpoint lookup + lint
│     ├─ instances.ts, state.ts, pool.ts, match.ts
│     ├─ combatReplay.ts (+.test)#   pure causal-beat segmentation + replay pacing (client render + server window)
│     └─ handlers/index.ts      #   custom escape-hatch (the 2 handlers)
├─ server/                      # Colyseus: rooms/MatchRoom.ts, bots/BotAgent.ts, pairing, reconnect
├─ client/                      # React + Vite: src/cardArt.ts, scenes/ (Shop, CombatReplay; combatBeats re-exports shared/engine/combatReplay), components, icons, styles
├─ sim/                         # micro.ts, macro.ts, metrics.ts, audit.ts, web*.ts, report
└─ e2e/                         # Playwright
```

**Scripts:** `pnpm dev:server`, `pnpm dev:client`, `pnpm sim:micro`, `pnpm sim:macro`,
`pnpm typecheck`, `pnpm test` (Vitest). **Determinism test is first-class:** same
`(boards, seed)` → byte-identical `CombatEvent[]` (`shared/engine/combat.test.ts`), plus
keyword-timing and breakpoint cases.

---

## 14. Current state & build order

**Status:** the monorepo is built and playable end-to-end (M0–M6 complete: skeleton →
shop loop → combat engine → full round loop → content + triples → micro-sim → macro-sim +
bot polish + reconnection). Content has since expanded from the 3-tribe slice to **all nine
tribes** (Prompt-2: Infernals/Constructs; Round-6 replayability: Tuskers/Primordials/
Sirens/Corsairs), and the client was rebuilt for game-feel (procedural cards, causal-beat
replay, drag-and-drop shop).

**Redesign gate (decisions #25, #29), still binding on new content:** the three multipliers
(Grovecaller, Echo Choir, Pale Lich) must have config caps, Pale Lich must be a breakpoint
(via `activeWhen`), and the reachability metric (§11.3b) must exist **before** new content
ships. Validate content/numbers (config + sim) before animating cards.

**Regeneration build order (if rebuilding from this spec):**
1. **Data + schema** — the `types`, the `config/*` and `content/*` data (tiers 1 of the
   reproducibility contract). Content is data; adding units = adding rows.
2. **Engine + goldens** — the pure engine (§§6–8), *with* the fixed-seed determinism,
   keyword-timing, and breakpoint golden tests. **Pin the combat ordering (§7.3) against
   intent, not against legacy behavior** (§7.6).
3. **Server** — Colyseus rooms, two-channel state, bots, pairing, reconnect (§9).
4. **Sim** — micro then macro, then the §11.3 balance-gate metrics.
5. **Client** — procedural cards, single battle line, causal-beat replay, drag-and-drop.

---

## 15. Open questions / risks

1. **Combat ordering is under-specified and partly wrong (§7.6).** Simultaneous-death
   semantics and cross-side order must be decided and locked with goldens before they can
   be called correct. Highest-priority correctness item.
2. **Determinism is entangled with RNG draw order.** Byte-identical replay is not
   reproducible from prose — it survives a regen only via the golden logs or an explicit
   RNG-draw contract (§6.8, reproducibility note).
3. **Writeback gap (§7.6 #5).** "Permanent" combat buffs don't persist across combats;
   close it or keep the seam explicit so content/UI don't over-promise.
4. **Numbers need continuous tuning.** Gold curve, tier costs, pool counts, breakpoint
   thresholds are simulator-set starting points; gate content on §11.3 sim health.
5. **Nine-tribe balance.** The six expansion tribes are less validated than the core three;
   watch the single-axis margin (§11.3a) for the multiplier/doubler lines.
6. **DSL erosion.** Keep the escape-hatch rare (§6.5). Prefer new declarative vocabulary
   over handlers, but note each addition widens the engine's semantic surface (§6.8) — the
   thing a regen must reproduce.
7. **Reserved-vs-live drift.** ~half the DSL is reserved scaffolding (§6). Either wire the
   deferred systems (spells/gold/gems-spend/magnetic/hero powers) or prune them, so the
   spec keeps describing the shipped game.
8. **Colyseus state size.** Keep the public schema lean; push heavy/private data on the
   direct channel.
9. **Clean-room discipline (§0).** All names/text reviewed before any public build; the
   nine reference tribe names never leave this repo's left-column tables.

---

## 16. Counter-web audit revision (2026-07-01)

A card-level audit against the single design law — *every scaling line climbs arbitrarily
high, but every line has a reachable counter that connects in combat; power is earned per
increment, never granted free* — produced the following shipped changes. All are config /
content / declarative-engine; the balance gate (`sim/web.test.ts` anti-degeneracy floor,
`sim/coherence.ts`, `sim/audit.ts` caps lint, `breakpoints.test.ts`) stays green (135 tests).

> **Status: applied and folded into current state.** The 7 new cards below (Tidebinder,
> Maelstrom Cantor, Tuskmonger, Carrion Sovereign, Quartermaster, Aegis Prime, Nullforge)
> and the engine deltas (`afterFriendlyBattlecry`, `onSell`, `highestStatEnemy`,
> `resetToBase`, the summon-scoped `yourEndOfTurn` multiplier) are live in
> `units.ts`/`engines.ts`/`breakpoints.ts`/the engine and are counted in the §2/§6.7/§8
> totals (**90 units**) and described in the §6 vocabulary. This section is the change
> *rationale/provenance*, not a separate content tier.

**Fixes.**
- **Mother Thorn (Gate 1 — free permanence).** Removed the end-of-turn whole-board `+3/+3`
  (permanent) slab — met forever by one Brambleling, it granted free per-turn permanent
  power. Only the per-token buff remains; its `tokensThisTurn` gate is raised **2→3** so it
  costs a real over-summon. Each `+2/+2` now rides a token that *entered play*.
- **Grovecaller (multiplier compounding).** Its end-of-turn trigger multiplier now applies
  **only to `summon` effects** (`endOfTurnPhase`). It no longer doubles gem income or the
  Tusker `multiplyStats` doubler — that fired the capped ×2 doubler *twice* (=×4/turn),
  compounding two of the three §11.3-capped multipliers into an unbounded exponential.
- **Tall counter-web (Gate 2).** (a) **Goldgrin** now also grants **Divine Shield** to the
  buffed carry, so Tuskers can *buy* poison counterplay (a shield blanks the first poison
  instance; poison-in-depth still wins). (b) **Nullforge** (new Construct tech) is a *second,
  structurally-different* answer to tall: `resetToBase` strips the enemy's highest-Attack
  minion down to its printed stats — neutralize-by-deleting-size vs. poison's kill-on-any-hit.
- **Thornwarden** `alliesAtStart` **4→5** (Gate 3 — a real go-wide commitment, matching the
  other density rewards).
- **Cap consistency (Gate 4).** Ruling: hard numeric caps are permitted **only** on
  multiplicative effects (no organic ceiling exists) **and** the token thin-floor (in-combat
  token summoning makes its organic bound unreliable, so the cap keeps it "never dominant").
  Every additive/summon payoff uses an organic ceiling or a breakpoint step; `(once)` is a
  breakpoint step, not a cap. The token-floor cap is **kept** (its removal would fight the
  audit's own "capped thin floor" exemption).

**New build-arounds** (Endorsed Patterns A = paid-per-increment tribal scalar, B = sacrifice/
sell a body for a resource). Each folds to a reachable counter; each increment is paid:
- **Tidebinder** (Reefkin T4) — Pattern A: after another battlecry, `+1/+1` to your Reefkin
  (paid per card). Counter: poison / cleave. New trigger `afterFriendlyBattlecry`.
- **Maelstrom Cantor** (Sirens T5) — Pattern B: start of combat, destroy your lowest-Attack
  minion → arm your Sirens with Poison this combat (combat-only, re-costs a body each fight).
  Counter: divine-shield walls.
- **Tuskmonger** (Tuskers T3) — Pattern B: sell another friendly → +2 gems (feeds the
  doubler; each proc costs a whole body). New trigger `onSell`. Counter: poison / tempo.
- **Carrion Sovereign** (Infernals **T6**, fills the missing top-end) — Pattern A: each
  friendly death pumps your Infernals `+2/+1` this combat (deaths are the manufactured fuel).
  Counter: poison / width.
- **Quartermaster** (Corsairs T4) — Pattern B: sell another friendly → `+2/+2` to your
  biggest Corsair (paid a body + the buy gold). Counter: poison / cleave.
- **Aegis Prime** (Constructs **T6**, fills the missing top-end) — Pattern A: each friendly
  death pumps your Constructs `+1/+1` this combat (the redeploy loop is the fuel); deathrattle
  rebuilds a Sentinel. Counter: poison / tall.

**Engine deltas** (all small, additive): `afterFriendlyBattlecry` reactive trigger; `onSell`
wired in `sellUnit`; `highestStatEnemy` selector; `resetToBase` action; `endOfTurnPhase`
multiplier scoped to summons. New `⭐` scalars (`carrionsovereign`, `aegisprime`) are
registered as `deaths`-threshold-1 breakpoints so the anti-linear lint bounds them.

**Recommended follow-up (not done here — needs sim tuning, §11.3):** wire the six new
build-arounds + Nullforge into the `sim/web.ts` `COMMITTED` scaling/tech rosters and re-run
`sim:macro` to tune numbers against the reachability metric. They currently satisfy the floor
via the bot-generated pool, not as curated committed lines.

**Subsection-anchor compatibility map.** The pre-consolidation spec numbered §16 into
subsections (§16.1–§16.7); some `shared/*` code comments still cite those numbers. They were
folded into the current sections as follows — a regen resolving a `§16.x` comment reads here:
`§16.1` (manufactured-event axes) → **§6.1 / §6.6 / §11.3a**; `§16.2` (multiplier caps + Pale
Lich `activeWhen`) → **§6.4 / §6.6**; `§16.3` (new triggers/bridges — `onShieldBreak`,
`plantDeathrattle`, planted deathrattle) → **§6.2 / §6.3 / §6.5**; `§16.4` (breakpoint config)
→ **§6.6** + `config/breakpoints.ts`; `§16.5` (Round-6 catalog) → **§8** + `content/units.ts`;
`§16.6` (static/categorical axis glyph) → **§6.6 / §10** (decision #28); `§16.7`/`a`/`b`/`c`
(reachability + balance-gate metrics & lints) → **§11.3 (a/b/c/d)**.

---

*Decision ledger: `requirements.md` (why each choice was made). Mechanics source:
`season10_interaction_reference.xlsx` (functional reference only). Canonical content &
balance: `shared/content/*` and `shared/config/*`. Engine semantics: this document + the
`shared/engine/*.test.ts` goldens.*
