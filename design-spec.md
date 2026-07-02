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
| Quilboar | **Tuskers** | gem greed → PURCHASED exponential doubler (#39) | SPOILS · multiply |
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
- **Nine original tribes; 110 unit definitions** (104 purchasable + 6 tokens) across tiers
  1–6, exercising all **6 live keywords** (`taunt`/`divineShield`/`poison`/`reborn`/`cleave`/
  `magnetic` — the last un-deferred by the Phase-5 Constructs merge, decision #54) and the
  breakpoint content model (§6.6). The design law of "breakpoints over linear stacking"
  (§6.6, decision #22) is the through-line. (Per-tribe breakdown in §8.)
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
- ~~**`magnetic` keyword is reserved**~~ **RESOLVED (Phase 5, decision #54):** the Constructs
  MERGE system is live — a Magnetic minion may merge into a friendly Construct in the shop (§4.2,
  §5, §8). Constructs also still ship death/assembly breakpoints; merge is an additional go-tall line —
  and, since **Phase 6 (decision #68)**, a BOARD-WIDE one too: **Magnaforge** (T6) reads the total merges
  across your board (`boardMerges`) as a TIERED breakpoint (3/6/9) that pumps your whole Construct board,
  turning single-carry consolidation into a wide scaler. Two smaller magnetic FODDER units (Rivetling T1,
  Coilcore T3) fill the merge ladder so the archetype is reachable earlier (§8, §16.5).

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
| `merge` | **(Phase 5, #54)** MERGE a MAGNETIC bench unit into a friendly Construct on the board: the tower permanently gains the magnetic unit's stats + keywords; the magnetic unit is consumed (no pool return). Optional — standalone `playUnit` is always allowed. | — |
| `targetChoice` | Resolve a pending targeted battlecry **or targeted activated ability** (player picks the target). | — |
| `discoverPick` | Resolve a Discover (pick 1 of 3). | — |
| `activate` | Buy a board unit's **activated ability** with gems (decision #39, §6.6a). Once per turn per minion; board units only. | gem cost per card (§6.6a) |
| `readyUp` | Mark done; combat starts early when all living players are ready. | — |

Notes:
- **Targeted battlecries (`chosenAlly`) resolve in the shop**, where the player chooses.
  The *result* is baked into the board before combat, so **combat needs no human input**
  and stays a pure function (§7.4).
- **Triple/upgrade:** holding a 3rd copy (`copiesForTriple` = 3) of the same base unit
  auto-merges the three into a **golden** and grants a **Discover** — pick 1 of 3 units from
  `tripleDiscoverTierOffset` (1) tier above your current tier. A merge re-scans for cascade
  triples. If the bench is full when a Discover would be granted, the Discover is lost
  (logged). Golden/token units are pool-exempt.
  - **Golden stats COMBINE the three copies (decision #69):** the golden's atk/hp =
    `base × goldenStatMultiplier` (2) **+ Σ of the buffs on all three consumed copies**, where a
    copy's buff is its live `atk`/`hp` beyond print (magnetic merges §6.3, folded permanent
    combat write-backs §7.5, battlecry stat-chains). Config-driven form (no hardcoded constant,
    invariant 4): `Σ(copy stats) + base × (goldenStatMultiplier − copiesForTriple)`. A
    **fully-vanilla** triple therefore lands at exactly `base × goldenStatMultiplier` (the Σbuffs
    term is 0 — this is the "double stats" of §4.7/decision #11, not a contradiction), while a
    buffed board **keeps** its accumulated stats through the merge instead of resetting to 2×base.
    Result is floored (atk 0 / hp 1) and bounded by `statSanityBound` per the §6.8 clamps.
    Keywords and planted deathrattles are **not** combined (the golden carries base keywords only).
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
- **No ghost available → a bye, never a phantom fight (decision #63, 2026-07-02):** the ghost
  branch is taken only when `ghostsEnabled` is true **and** a ghost actually exists. If ghosts are
  disabled, or the roster is odd **before anyone has been eliminated** (an odd seat count with
  bot-fill off — the shipped 8-player bot-filled match always has a ghost by its first odd round),
  the solo seat gets a **bye**: `Pairing{ghost:false, bye:true, bSeat:-1}`. A bye is **not a fight**
  — no combat runs, no hero damage, no writeback accrual, empty combat log. This closes a latent
  bug where the solo seat fought a phantom **empty** board: a free "win" that also let its own
  combat-fired permanents accrue writeback buffs every odd round. `ghostsEnabled` is now honored
  (it was previously dead config).
- **Pairing timing (decision #42, 2026-07-01):** the round's pairing is computed **at the start
  of the shop phase** (`Match.startRound`), not at combat start, so the public `pairings` list
  **previews the actual upcoming opponent** for the whole shop — the client's "vs" label +
  highlight must never show last round's stale pairing. Combat **reuses that exact list**
  (`ensurePairings` is idempotent per shop; `resolveCombatPhase` consumes it). This is
  byte-identical to pairing at combat-start — the inputs (alive set, `lastOpponent`, most-recent
  ghost) can't change during the shop (no one dies mid-shop) — so sim reproducibility is
  unaffected.
- A `pairings` list is public state (`Pairing{aSeat, bSeat, ghost, ghostName, bye}`, `bSeat=-1`
  for a ghost or a bye). It is populated from the start of each shop phase (above), so it is never
  empty or stale while a round is in progress.

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
- **`gems` is a SPENDABLE wallet (decision #39, 2026-07-01 — SUPERSEDES D10).** D10's "cosmetic
  lifetime total" ruling is retired: `gemCarryOver` now accrues a real, private, **uncapped**
  currency spent through the `activate` intent (activated abilities, §6.6a — the purchased
  Tusker doubles and the three gem sinks). `gemsThisTurn` remains the derived per-turn counter
  for `gemsThisTurnAtLeast` conditions (0 card consumers today, §6.9). An activated
  `chosenAlly` ability left unresolved at end of turn fizzles (the gems are spent — the D5
  "count the act" family); bots always resolve immediately. Hoarding is watched by a **sim
  diagnostic** (§11.3 outputs), never an engine cap.

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

**Tech-pool injection guarantee (decision #49).** From round `systems.techInjection.fromRound`
(=5) onward, every **fresh** roll is guaranteed to offer at least one interaction-tech card
so a developed board can always find an ANSWER (poison / a stat-neutralizer) even under a bad
roll — this is what keeps scaling lines context-sensitive (the §16 floor). Algorithm: after a
fresh shop is drawn, if it contains no card from `systems.techInjection.cardIds`
(`{reefkin_spinefish, sirens_lurefish, reefkin_brineling, sirens_reefwitch, sirens_venomsong,
constructs_nullforge}`), replace ONE slot with a copy-weighted pool draw restricted to those
ids **at/below the shop tier**. The replaced slot is chosen **deterministically from the shop
RNG** (there is no "relevance" heuristic — none exists in this engine). **Pool accounting** is
identical to any offer: the injected copy is taken from the pool and the replaced offer
returned — net-zero, never a phantom copy; if no tech copy is available at/below tier the roll
is left as-is and logged. Applies to every fresh-roll path (`startShopPhase` non-frozen draw,
`rollShop`, Oreseeker `refreshShop`) via one `drawFreshShop` helper, so all three stay
byte-identical for the same seed+state. A **frozen** shop is not re-rolled, so it is never
injected. Deterministic (fixed draw order: tech draw, then slot pick), so it stays inside the
§9.7 pinned reducer contract (invariant 2b). Numbers live in `shared/config/systems.ts`.

**Gems — the second currency (decision #39, supersedes D10).** `gems` is a per-player,
**private-channel**, persistent, **uncapped** wallet fed only by `giveGem` effects (Tusker
generators/battlecries/onSell). It is spent only through **activated abilities** (§6.6a):
the escalating purchased doubles and the three sinks (Gemwright / Facetguard / Oreseeker).
Rules of the two-currency system:
- **Gold and gems stay separate.** No gem total ever changes a gold price (tier-up, reroll,
  buy), and no gold can buy gems.
- **One bridge, one-way:** `Gemwright` (spend `gemwrightCost` gems → gain `gemwrightGold`
  gold, clamped so gold never exceeds `goldCap`) is the ONLY gem→gold conversion. A
  gold→gem conversion is **banned** (it would let the gold economy pump the exponential
  doubler).
- **No wallet cap.** Instead the sim reports a **hoarding diagnostic** (distribution of
  unspent wallet at game end, §11.3 outputs) — pressure is added via costs if hoarding ever
  proves dominant (decision #40), never via a silent clamp.
- Cost knobs live in `engines.tuskers` (`doubleBaseCost`, `doubleCostStep`, `gemwrightCost`,
  `gemwrightGold`, `facetguardCost`, `oreseekerCost`, `goldgrinGems`).

**Corsair GOLD economy (decision #56, Phase 5) — gold ONLY, currencies stay separate.** Four
Corsair cards add gold-tempo levers; every number is a config knob in `engines.corsairs`:
- **Delayed-gold queue.** A single private accumulator `ShopSession.delayedGold`, delivered at
  the START of the next shop phase (then cleared) and clamped to the **effective** gold cap.
  **Bursar** (battlecry, action `gainGoldNextTurn`) queues `bursarGold`; multiple Bursars each
  queue their own (stacking). **Moneylender** (end-of-turn `yourEconomy`/`goldNextTurnIfRich`
  aura) queues `moneylenderGold` ONCE if unspent gold ≥ `moneylenderThreshold` (presence-based,
  non-stacking).
- **Effective gold cap.** `effectiveGoldCap(s) = max(economy.goldCap, Vault Keeper's
  vaultKeeperGoldCap)` — a query-at-read-time helper over `yourEconomy`/`goldCapSet` auras
  (**Vault Keeper**), so it reverts the instant Vault Keeper leaves the board. The income clamp
  **and every gold gain** (delayed-gold delivery + Gemwright's gem→gold bridge) use it.
- **Sell refund.** `effectiveSellRefund(s) = max(economy.sellRefund, Fence's fenceSellRefund)`
  over `yourEconomy`/`sellRefundSet` auras (**Fence**), non-stacking (max), reverts on leave.
- **The gold/gems wall holds.** These touch only GOLD; no gold→gems path is added. A
  buy(`buyCost`=3)/sell(`fenceSellRefund`=2) churn STRICTLY loses gold each cycle, so it is
  bounded (cannot mint money); the Fence+Tuskmonger loop converts gold→gems only lossily and
  self-limitingly (a spent body + net gold per cycle) — watched by the hoarding diagnostic, never
  a new bridge (the ONLY bridge stays Gemwright, gems→gold, one-way).

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
//  [live] taunt, divineShield, poison, reborn, cleave, magnetic (Phase 5 Constructs SHOP-phase merge,
//  #54 — a merge tag with no COMBAT effect; the merge itself is a shop reducer op, §4.2/§8).
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
`highestStatAlly`, `lowestStatAlly`, `chosenAlly` (shop-resolved), `leftmostAlly`
(POSITIONAL board-index-0 friendly — Phase 3 Cindermarshal; distinct from bornTurn
`oldestAlly`), `adjacentAllies` (POSITIONAL board-index ±1 friendlies — Phase 4 Last Rites
Drummer; computed against the SETTLED board at deathrattle time, §7.3), `triggerSource`,
`frontEnemy`, `highestStatEnemy` (biggest enemy by `stat` — Nullforge anti-tall neutralize).
[reserved]: `nAllies`, `leftNeighbor`, `rightNeighbor`, `newestAlly`, `oldestAlly`,
`randomEnemy`, `neighborsOfTarget` (cleave is handled directly in combat, not via a
selector). `TargetSpec` = `{ selector, count?,
filterTribe?, filterKeyword?, stat?, excludeSelf? }`. **Tie-break/default rules that are
engine logic, not data** (§6.8).

**ActionType** (WHAT):
```ts
type ActionType =
  | 'buffStats' | 'grantKeyword' | 'summon' | 'dealDamage' | 'giveGem'   // [live]
  | 'multiplyStats' | 'plantDeathrattle' | 'custom' | 'resetToBase'      // [live] (resetToBase = Nullforge strip-to-print)
  | 'destroy' | 'destroyAlly' | 'absorbStats'                            // [live] destroy = D11 combat removal; destroyAlly/absorbStats = Phase 3 shop-phase consumption
  | 'gainGold' | 'refreshShop'                                           // [live, ACTIVATED-ONLY (#39, §6.6a): legal only in activated.actions, never in a triggered Effect]
  | 'setStats' | 'makeSpell' | 'discover' | 'sacrifice';                 // [reserved / no-op in engine]
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
across *turns* (shop-fired copies persist and compound). A combat-fired `multiplyStats` is
this-combat-only UNLESS flagged `permanent:true` — the Phase-3 §7.5 writeback-multiply
extension folds the capped factor onto surviving persistent instances (Gravemonarch); an
absolute `setStats`/`resetToBase` can never be folded and stays this-combat-only.
`permanent` on a combat-fired `buffStats` is **live** (decision #38): the buff writes back
onto surviving persistent instances after combat (§7.5); on shop-fired actions it has always
meant a direct persistent mutation. `plantDeathrattle` attaches a deathrattle `Effect` to a
target (Reefmourner bridge). **Phase-3 CONSUMPTION (Infernals, shop-phase):** `destroyAlly`
destroys a chosen friendly — removes it, returns its pool copy (like a sell), fires no
combat/deathrattle, and increments the persistent `lifetimeFriendlyDeaths` (§7.5);
`absorbStats` makes the SOURCE permanently gain the TARGET's CURRENT atk/hp (a golden target
contributes its doubled stats; keywords are NOT transferred). Gorgemaw pairs them
(`absorbStats` then `destroyAlly` — absorb reads the live target, then consumes it).

**ConditionSpec** (optional gate):
```ts
kind: 'countAllies' | 'gemsThisTurnAtLeast'                                    // [live] (gemsThisTurnAtLeast: engine+eval live, 0 card consumers since #39 — see §6.9)
    | 'battlecriesThisTurnAtLeast' | 'tokensSummonedThisTurnAtLeast' | 'deathsThisCombatAtLeast' // [live] manufactured-event breaks
    | 'alliesAtMost' | 'lifetimeDeathsAtLeast' | 'boardMergesAtLeast'                             // [live] Phase 3: go-tall gate (Cindermarshal) + persistent-death breakpoint (Ossuary Titan); Phase 6: board-wide magnetic breakpoint (Magnaforge)
    | 'hasTribe' | 'hasKeyword' | 'goldAtLeast' | 'tierAtLeast' | 'isGolden' | 'isToken';        // [reserved]
value?; tribe?; keyword?;
```
**Phase-scoping (engine rule):** combat context populates `deathsThisCombat`, `countAllies`
(start-of-combat count), `lifetimeDeaths` (the fixed per-board scalar carried in on
`CombatBoard.lifetimeDeaths`, §7.5) and `boardMerges` (the derived per-board scalar — Σ of each
instance's `mergeCount` — carried in on `CombatBoard.boardMerges`); shop context populates
`battlecries/tokens/gems` and `countAllies`. `alliesAtMost` is a ≤ gate (`countAllies ≤ value`);
`lifetimeDeathsAtLeast` gates on the persistent friendly-death total; `boardMergesAtLeast` gates on
the total magnetic merges assembled across the controller's board (a board-state read, like `countAllies`). A condition evaluated in the wrong phase reads
0/false silently. A missing or unknown condition evaluates **true**.

### 6.4 Aura (passive modifier) — the multipliers

The reference's hardest patterns (trigger multiplier, battlecry doubler, tribe-wide damage
amp, cost reduction, gem/spell amps) are **not** triggers — they are passive modifiers that
change how *other* effects resolve, queried by the resolver:

```ts
interface AuraSpec {
  scope: 'selfTribeAllies' | 'yourEndOfTurn' | 'yourBattlecries' | 'leftmost'            // [live]
       | 'yourSentinels' | 'yourEconomy'                                                 // [live] Phase 5
       | 'allAllies' | 'yourGems' | 'yourSpells' | 'shopCostTribe';                      // [reserved]
  modifier: { kind: 'triggerMultiplier' | 'damageMultiplier' | 'attackBuff'              // [live]
                  | 'statBuffOnEvent'                                                     // [live] Phase 5 (Forgemaster)
                  | 'goldCapSet' | 'sellRefundSet' | 'goldNextTurnIfRich'                 // [live] Phase 5 (gold economy)
                  | 'costReduction' | 'gemValueAdd' | 'spellPowerAdd';                    // [reserved]
              value: number; tribe?: TribeId; };
  stacks?: boolean;                                    // stacking → multiply; non-stacking → max
  activeWhen?: { counter: 'deaths' | 'revenantDeaths'; threshold: number }; // combat-side breakpoint gate
}
```
**Phase 5 aura families (all query-at-read-time, so they revert when the bearer leaves).**
**`yourSentinels`/`statBuffOnEvent`** (Forgemaster, #55) is a PERSISTENT-COUNTER MARKER, not a
board-read passive: `playUnit` reads the marker to increment the private `forgemastersPlayed`
counter (never decremented — survives sale/death), which rides into combat on the
`CombatBoard.forgemastersPlayed` scalar and buffs every summoned Sentinel by `value` × stacks at
its creation (§7). **`yourEconomy`** (gold cards, #56) is a SHOP-read player-economy modifier —
`goldCapSet` (Vault Keeper → effective gold cap), `sellRefundSet` (Fence → sell refund),
`goldNextTurnIfRich` (Moneylender → end-of-turn delayed gold). All are ignored by the combat aura
queries (§5).
`activeWhen` converts an always-on multiplier into a **breakpoint** — the aura is inert
until the bearer's side reaches `threshold` of `counter`. This is how Pale Lich's damage
amp is contained (§6.6). **POSITIONAL aura (`leftmost` + `attackBuff`, decision #52).** A
`leftmost`-scoped `attackBuff` aura (Vanguard Pennant) grants +`value` ATTACK to the LEFTMOST
friendly (board index 0) on the bearer's side. It is **query-at-read-time in combat**
(`leftmostAttackBonus`, folded into the fighter's striking attack), so a reposition or the
leftmost's death moves the bonus to the new front unit with no bookkeeping. Stacked pennants
sum, capped at `engines.corsairs.leftmostAttackBuffCap`, so it is a fixed positional utility
buff, never an unbounded per-unit scaler (breakpoint law #22). All multiplier values are
additionally **capped** in `engines.ts`
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
  | 'shieldBreak'                        // this unit's own shield broke
  | 'lifetimeDeaths'                     // Phase 3: PERSISTENT per-player friendly-death total (Ossuary Titan — TIERED)
  | 'boardMerges';                       // Phase 6: total MAGNETIC merges across the board (Magnaforge — TIERED, board-wide)
```

A breakpoint row may carry a `tiers?: {threshold, atk, hp}[]` array for a **tiered** payoff:
several discrete steps on one counter whose per-step payoffs ESCALATE (each ≥ the last → a
step, not a line). **Ossuary Titan** (Phase 3) is the first tiered row — thresholds 4/8/12
on `lifetimeDeaths`, payoffs +2/+2 → +3/+3 → +5/+5, firing one cumulative this-combat buff
per crossed tier. The persistent counter accrues slowly across a whole game (every fight +
every Gorgemaw sacrifice), so the tiers are a long-horizon investment rather than a per-fight
ramp; the rising steps keep the non-linear shape (decision #45). **Magnaforge** (Phase 6,
decision #68) is the second tiered row and the first BOARD-WIDE one — thresholds 3/6/9 on
`boardMerges`, payoffs +3/+3 → +5/+5 → +8/+8 to your *Constructs* (not self), firing one
cumulative this-combat buff per crossed merge-milestone. It turns the magnetic MERGE line
(previously single-carry go-tall only, §8) into a whole-board scaler: the high ceiling comes
from MANY EARNED STEPS (every merge is a bought + consumed body), never one multiply, and it
still folds to poison-that-connects (shielded/taunt poison one-shots each pumped body,
stat-agnostic), cleave, and Nullforge (which strips the permanent merged towers beneath the buff).

**Lint (decision #22, §11.3c):** a test asserts every primary payoff is expressible as a
discrete breakpoint and flags any per-unit scaling that lacks a threshold. The lint now has
**three** legal primary-payoff classes: breakpoints, spend-gated payoffs (§6.6a, decision
#39), and contested-condition payoffs (§6.6b, decision #46).

### 6.6b Contested-condition payoffs — the third legal payoff class (decision #46, #40 corollary)

**The third legal primary-payoff class.** Decision #40 permits unbounded scaling where each
step is bought with *a decision, a risk, OR a contested condition*. Breakpoints cover
board-state thresholds; spend-gated abilities cover purchases; a **contested-condition
payoff** covers the third — a payoff whose every step demands surviving a condition the
opponent actively fights against, not accrued for free from your own board. Registered in a
`contestedCondition` registry in `breakpoints.ts` (PARALLEL to `spendGated`), naming the
combat condition and its engine-knob sizing. The §11.3c lint accepts a threshold-gated
payoff WITHOUT a breakpoint row ONLY if it is registered here — a first-class classification,
not a suppression (a payoff that is none of the three still fails the lint). **Gravemonarch**
(Revenant T6, `revenants_gravemonarch`) is the first: `endOfCombat`, if 5+ friendlies died
this combat AND it survived → permanently DOUBLE its stats (via the §7.5 writeback-multiply).
Exponential, but each double is bought by surviving a near-wipe — the opponent contests it by
finishing the kill (poison the 1-hp reborn body, out-tempo). Legal by construction under
#22/#40.

### 6.6a Activated abilities — the spend-gated payoff class (decisions #39/#40)

**The second legal primary-payoff class beside breakpoints.** An *activated ability* is a
shop-phase ability the OWNER buys with **gems** (the spendable wallet, §5). Declarative like
an `Effect`, but with no trigger — the "trigger" is the player's `activate` intent:

```ts
interface ActivatedSpec {
  cost: number | 'doublerEscalating';  // gem price: flat (a config number on the card row)
                                        // or the shared escalating doubler formula
  target: TargetSpec;                   // 'self' or 'chosenAlly' (shop-resolved, §7.4)
  actions: ActionSpec[];                // same vocabulary; + activated-only gainGold/refreshShop
  prompt?: string;                      // pendingTarget/UI text for chosenAlly abilities
}
// UnitCard gains `activated?: ActivatedSpec`.
```

**Resolution — ONE shop-reducer op** (`activateAbility(session, uid) → OpResult`, pinned in
§9.7), reached only via the `activate` intent (§4.2). Validation, in order (a rejection
mutates nothing): shop phase (enforced by `Match`/room) → unit owned + **on board** (bench
rejected) → card has an `activated` spec → **not already used this shop turn** (once per
turn per *minion*; `abilityUsedThisTurn` resets in `startShopPhase`) → no pendingTarget
outstanding → wallet ≥ current cost → a `chosenAlly` ability must have a legal target
**before** the spend (an activation is a purchase: it is *rejected*, never fizzled —
contrast D5's battlecry fizzle). Then the gems are deducted and the actions resolve:
`chosenAlly` arms the same pendingTarget machinery as targeted battlecries (resolved by
`targetChoice`; stat writes are persistent-instance writes like other shop permanents);
`self` abilities resolve immediately.

**The escalating doubler formula.** The three Tusker doublers share
`cost = engines.tuskers.doubleBaseCost + doubleCostStep × session.doublesPurchased`, where
`doublesPurchased` is a **per-player per-GAME counter shared across all three doublers**
(it never resets between turns, and selling a doubler does not refund it). Each purchased
double is a `multiplyStats ×doublerFactor`, still clamped per application by
`multiplyFactorCap` and bounded by `statSanityBound` (§6.8), written to the persistent
instance — the exponential reach compounds only across purchases.

**Activated-only actions.** `gainGold` (gold += amount, **clamped to `goldCap`** — the
Gemwright bridge; activating at the cap wastes the gems, a player choice the bot guards
against) and `refreshShop` (a FREE reroll: identical seeded draw path to `rollShop`, no
gold charge, **clears a freeze exactly like a paid roll does**) are live only inside
`activated.actions`; a triggered `Effect` may not use them (EV-VOCAB-01).

**RNG discipline:** non-refresh activations draw NOTHING from the session RNG (the roll
stream is unperturbed); `refreshShop` advances it exactly as a paid roll would (EV-ABL-08).

**Privacy:** the wallet, `doublesPurchased`, per-minion used-this-turn state and the current
cost are PRIVATE-channel only (`PrivateState.abilities: ActivatedAbilityState[]`, §9.3).

**The design-law corollary (decision #40):** exponential/unbounded scaling is legal **only**
where each step is purchased with a decision, a risk, or a contested condition. Every card
with an activated ability must have a row in the **spend-gated registry**
(`shared/config/breakpoints.ts` `spendGated: { card, currency:'gems', costKnobs[] }[]`),
and the §11.3c lint verifies the registry ↔ catalog 1:1 and that every cost knob is a real
positive number in `engines[<tribe>]`. When a payoff looks too strong, **add a cost, not a
bigger number**.

### 6.7 Unit / instance / tribe / keyword schemas

```ts
interface UnitCard {
  id: string; name: string; tribe: TribeId; tier: number; atk: number; hp: number;
  keywords: Keyword[]; effects: Effect[]; auras?: AuraSpec[];
  activated?: ActivatedSpec; // spend-gated activated ability (decision #39, §6.6a)
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
carry a keyword. Canonical content: `shared/content/units.ts` (the 99 rows),
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
  (`=== threshold`). **Echo Choir counting (decision #50):** a played battlecry counts as
  EXACTLY ONE toward `battlecriesThisTurn`, regardless of the doubler. Echo Choir amplifies
  OUTPUT — every battlecry EFFECT and `afterFriendlyBattlecry` resolves `multiplier` times —
  but the ECHOED copy does NOT increment the counter that gates OTHER battlecry payoffs (so a
  single play can never reach a ≥2 gate from the echo alone; closes the double-dip).
- **POSITIONAL attack read (decision #52):** a fighter that is CURRENTLY the leftmost of its
  side adds the side's `leftmost`-aura `attackBuff` total (capped) to its striking attack,
  recomputed live at every strike — so the bonus tracks the front slot through repositions and
  the leftmost's death (Vanguard Pennant, §6.4).
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

The regenerable contract is **not the 99 cards** — it is the finite set of primitives they
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

- **Triggers — live (11):** `battlecry`(29) · `startOfCombat`(21) · `deathrattle`(19) ·
  `afterFriendlyDeaths`(8) · `endOfTurn`(6) · `onSell`(2) · `onAttack`(1) · `onShieldBreak`(1) ·
  `onSummon`(1) · `afterFriendlyBattlecry`(1) · `endOfCombat`(1 — Phase 3 Gravemonarch, fires
  for LIVING units at fight end). *Reserved (0):* `onPurchase`, `onDamaged`, `onPlayTribe`,
  `onRefresh`, `onCast`, `onSacrifice`, `onSpend`, `onTripleCreated`.
- **Selectors — live (11), triggered effects:** `self`(33) · `allAllies`(29) · `chosenAlly`(12) ·
  `randomAlly`(5) · `lowestStatAlly`(4) · `highestStatAlly`(2) · `frontEnemy`(2) ·
  `leftmostAlly`(1 — Phase 3 positional index-0) · `adjacentAllies`(1 — Phase 4 positional ±1,
  Last Rites Drummer) · `highestStatEnemy`(1) · `triggerSource`(1). **Activated surface (§6.6a):**
  `self`(5) · `chosenAlly`(1). *Reserved:* `leftNeighbor`, `rightNeighbor`, `newestAlly`,
  `oldestAlly`, `nAllies`, `randomEnemy`, `neighborsOfTarget` (cleave neighbors are computed in
  combat, not via a selector).
- **Actions — live, triggered effects:** `buffStats`(45) · `grantKeyword`(17) · `summon`(13) ·
  `giveGem`(7) · `destroy`(4) · `dealDamage`(3) · `custom`(2) · `plantDeathrattle`(1) ·
  `resetToBase`(1) · `multiplyStats`(1 — Phase 3 Gravemonarch's `permanent:true` double, §7.5)
  · **`destroyAlly`(1)** · **`absorbStats`(1)** — Phase 3 shop-phase CONSUMPTION (Gorgemaw)
  · **`gainGoldNextTurn`(1 — Phase 5 Bursar):** a triggered SHOP action queuing gold for the START
  of the next shop phase (delayed queue, §5); no combat effect.
  **`destroy` is PROMOTED from the `dealDamage: 999` idiom, see D11.** **Activated surface
  (§6.6a):** `multiplyStats`(3 — the purchased doubles) · `buffStats`(1) · `grantKeyword`(1) ·
  `gainGold`(1) · `refreshShop`(1). `gainGold`/`refreshShop` are **activated-only** — a
  triggered Effect may never use them (EV-VOCAB-01). *Reserved:* `setStats`, `makeSpell`,
  `discover`. *(`sacrifice` folded into `destroy`.)*
- **Conditions — live (7):** `battlecriesThisTurnAtLeast`(9) · `countAllies`(7) ·
  `deathsThisCombatAtLeast`(3) · `tokensSummonedThisTurnAtLeast`(1) · `alliesAtMost`(1 — Phase 3
  go-tall gate) · `lifetimeDeathsAtLeast`(1 — Phase 3 persistent-death breakpoint) ·
  `gemsThisTurnAtLeast`(0 — **status note, #39:** the doubler conditions became purchased
  activations, so the card count is 0; kept LIVE deliberately because the `gemsThisTurn` counter
  + condition remain implemented and pinned by EV-CND-01/03).
  *Reserved:* `hasTribe`, `hasKeyword`, `goldAtLeast`, `tierAtLeast`, `isGolden`, `isToken`.
- **Auras — live (8 (scope,modifier) shapes):** `(selfTribeAllies, damageMultiplier)`
  +`activeWhen` (Pale Lich) · `(yourBattlecries, triggerMultiplier)` (Echo Choir) ·
  `(yourEndOfTurn, triggerMultiplier)` summon-scoped §6.8 (Grovecaller) · `(leftmost, attackBuff)`
  POSITIONAL, Phase 4 (Vanguard Pennant — leftmost friendly +atk, query-at-read-time, capped) ·
  **`(yourSentinels, statBuffOnEvent)` Phase 5 (Forgemaster — persistent-counter marker, §6.4)** ·
  **`(yourEconomy, goldCapSet)` Phase 5 (Vault Keeper)** · **`(yourEconomy, sellRefundSet)` Phase 5
  (Fence)** · **`(yourEconomy, goldNextTurnIfRich)` Phase 5 (Moneylender)** — the three `yourEconomy`
  shapes are SHOP-read economy modifiers (§5), ignored by combat aura queries.
  *Reserved scopes:* `allAllies`, `yourGems`, `yourSpells`, `shopCostTribe`. *Reserved modifiers:*
  `costReduction`, `gemValueAdd`, `spellPowerAdd`.

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
   - **`adjacentAllies` (positional, Phase 4 Last Rites Drummer):** because the batch is
     already removed, the dier's ±1 neighbors are the units flanking its **settled slot** (its
     anchor index against the post-removal board) — i.e. the living units that closed the gap.
     Last Rites Drummer grants them Reborn; a unit two slots away is not adjacent.
4. **Reborn:** a unit with reborn returns once, in its own slot, with **1 HP** and reborn
   stripped, at **base card attack** (×2 if golden) — buffs dropped — *after* its deathrattle.
5. **Avenge** (`afterFriendlyDeaths`, non-token) and the **token-death floor** (token deaths
   only, capped) fire on the batch's death count.
6. **Summons** occupy the dead unit's slot, shifting others right; if the board is at the
   config board cap (`economy.boardCap`), excess summons are dropped (logged). Each summon
   fires `onSummon` for living friendlies. The attack pointer stays consistent across
   removals/insertions.
   - **Forgemaster Sentinel buff (Phase 5, #55):** at CREATION, a summoned Sentinel (cardId =
     `engines.constructs.forgemasterSentinelId`) gains +`forgemasterSentinelBuff`/+`forgemasterSentinelBuff`
     × the controller's `forgemastersPlayed` count (read from the `CombatBoard.forgemastersPlayed`
     scalar carried IN, never ambient). All three Sentinel summon sites (Foundry deathrattle,
     Titanforge start-of-combat, Aegis Prime deathrattle) are IN COMBAT, so this is where the
     stack applies; a combat-only stat bump on a token (not a §7.5 permanent — tokens don't persist).

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
  | { t:'stats'; unitId; atk; hp; sourceId?; permanent?; dAtk?; dHp?; permanentFactor? } // sourceId links a buff to its cause; dAtk/dHp XOR permanentFactor (Phase 3)
  | { t:'death'; unitId } | { t:'deathrattle'; unitId }
  | { t:'summon'; ownerId; unitIds:string[]; slot }
  | { t:'combatEnd'; winner:'a'|'b'|'tie'; survivors:string[]; damageToLoser;
      survivorsA?:string[]; survivorsB?:string[]; deathsA?; deathsB? };  // deathsA/B (Phase 3): friendly-death totals per side
```
`stats.sourceId` and `keyword.gained`/`sourceId` are additive and consumed by the replay
for causality links. **Phase 3 additions** (all additive; pre-existing logs byte-stable):
`combatEnd.deathsA`/`deathsB` are each side's friendly-death totals (incl. tokens), folded
by `Match` into the persistent per-player `lifetimeFriendlyDeaths` (§7.5 lifetime block).
`CombatBoard` gains an optional `lifetimeDeaths` scalar — the controller's lifetime total
carried IN on the snapshot so combat can gate `lifetimeDeathsAtLeast` payoffs (Ossuary
Titan) with no ambient state (invariant 1b). A new `endOfCombat` trigger fires for LIVING
units at fight end (survival-gated by construction — a dead unit does not fire), used by
Gravemonarch's contested-condition double.

**Combat→board writeback (decision #38, 2026-07-01 — closes the §7.6 #5 gap).**
`stats.permanent` is **live**: a combat-fired `buffStats` whose ActionSpec has
`permanent:true` emits `permanent:true` **plus the additive delta fields `dAtk`/`dHp`** —
the post-clamp contribution that buff applied. The deltas exist because the event's
`atk`/`hp` are post-buff **absolutes** (they mix in combat-only buffs and damage) and can
never be folded back directly; all other stat changes (combat-only buffs, reborn resets)
omit all three fields, keeping pre-#38 logs byte-identical. `combatEnd` gains additive
`survivorsA`/`survivorsB` — living uids **per side** at combat end (`survivors` stays
winner-only; a step-cap tie leaves both sides alive, so per-side lists are required).

**Combat stays pure** — `resolveCombat` only *emits*. After it returns,
`Match.resolveCombatPhase` runs the deterministic fold
`foldPermanentBuffs(log, persistentBoard, survivorsForThatSide, side)`
(`shared/engine/combatWriteback.ts`) for each **live** side. Each side folds only its own
events (unit→side ownership is derived from the log itself: the `combatStart` snapshots
seed both lines, summons inherit the summoner's side), so an enemy's permanent buff is
never mistaken for a friendly token no-op. Fold rules:

- **Survivors only.** A unit dead at combat end accrues nothing. A **Reborn resurrection
  counts as surviving**: the reborn unit keeps its persistent uid (the same Fighter is
  re-inserted) and is listed in `survivorsA/B`; buffs it received before dying fold
  normally, and the in-combat reborn stat reset is not a buff and is never folded.
- **The persistent `UnitInstance.uid` is the writeback key.** `CombatUnit.uid` carries the
  seat-scoped uid (`'${seat}u${seq}'`) through combat unchanged — no extra id plumbing
  exists or is needed (an audit finding; the original plan assumed an id had to be added).
- **Combat-summoned tokens** (per-fight `sum#N` uids) have no persistent instance: a
  permanent buff targeting one is a **defined, logged no-op** — a session-log line, never a
  crash and never a new `CombatEvent`.
- **Ghost boards never accrue** — the fold is simply not run for a dead player's snapshot
  side; the stored ghost `CombatBoard` and the dead player's session board stay frozen.
- **`buffStats` and (since Phase 3) `multiplyStats` participate.** A combat-fired
  `multiplyStats` flagged `permanent:true` emits `permanent:true` + the additive
  `permanentFactor` (the CAPPED factor); the fold multiplies the surviving persistent
  instance by it through the same §6.8 `applyMultiply` clamps (`multiplyFactorCap` +
  `statSanityBound`), NOT the combat-inflated absolutes — so it compounds across combats
  like the buff fold (a permanent event is EITHER a `dAtk`/`dHp` buff OR a `permanentFactor`
  multiply, never both). `permanent` on `setStats`/`resetToBase` is still **ignored** (an
  absolute write can't be disentangled from combat damage); those stay this-combat-only.
  `grantKeyword` permanence is likewise **still reserved** — the `keyword` event carries no
  permanence seam and keyword grants remain this-combat-only.
- **Deltas fold under the §6.8 stat clamps.** The fold replays each `dAtk`/`dHp` through
  the same `applyBuff` clamps combat's `buffStats` uses (atk floored at 0, hp at 1,
  rounded). This matters for permanent **debuffs**: the emitted delta is post-clamp
  against the unit's *in-combat* stats (which may be riding combat-only buffs), so a raw
  `atk += dAtk; hp += dHp` fold could write `atk<0`/`hp≤0` onto the persistent board —
  the clamps forbid that; a folded survivor always re-enters play with `atk≥0, hp≥1`.
- The fold reads the log and **never rewrites it**, and shop-phase permanents (which
  mutate the persistent instance directly and emit no combat events) can never
  double-apply through it.

Pinned by `EV-WBK-01..10` (`shared/engine/combatWriteback.test.ts`) + goldens `EV-GLD-09`
(buff seam) / `EV-GLD-12` (Gravemonarch multiply). Content note: the #38 audit gave every
combat-fired `buffStats` an explicit `permanent:false` (EV-WBK-08 lints this); the sole
`permanent:true` combat consumer is now **Gravemonarch's `endOfCombat` `multiplyStats`**
(a contested-condition double, §6.6b). Mother Thorn keeps `permanent:true` on its `onSummon`
buff, but that effect's `tokensSummonedThisTurnAtLeast` condition is **shop-scoped** (reads
0 in combat), so it can never fire in combat — the EV-WBK-08 lint encodes exactly this
shop-gated exemption for `buffStats`.

**Persistent lifetime friendly deaths (Phase 3, decision #44).** `ShopSession` carries a
per-player `lifetimeFriendlyDeaths` (private; NEVER reset between turns/rounds). **Counting
rule:** the combat-scoped `deaths`/`revenantDeaths` counters stay per-fight; a shop sacrifice
does NOT touch them; `lifetimeFriendlyDeaths` is the ONLY counter that both a shop-phase
`destroyAlly` (Gorgemaw) AND combat friendly deaths increment. `Match.resolveCombatPhase`
folds `combatEnd.deathsA`/`deathsB` into each LIVE player's total (GHOST boards never
accrue). The value rides into the next combat on `CombatBoard.lifetimeDeaths` for
`lifetimeDeathsAtLeast` gates (Ossuary Titan). Pinned by `EV-LFT-01..03` / `EV-OSS-*` /
`EV-GRM-*` (`shared/engine/revenant-lifetime.test.ts`) + `EV-CON-*`
(`shared/engine/consumption.test.ts`).

### 7.6 Resolved combat rules — divergence ledger (items 1–3, 5, 6 resolved in code)

§§7.1–7.3 now state the **decided** rules (rulings D1–D4, D7 in `DECISIONS-NEEDED.md`). The
numbered items below are kept as the **historical record** of the divergences found in the
2026-07-01 audit. **Status (2026-07-01): items 1–3, 5 and 6 are implemented and green**
(items 1–3/6 in `combat.ts`, pinned by `EV-DTH-08/09a/09b/10` in
`shared/engine/death.test.ts` and `EV-INV-CFG` in `shared/engine/invariants.test.ts`;
item 5 by the §7.5 writeback fold, pinned by `EV-WBK-01..10`); item 4 is a decided stance,
not a code item. The "*pre-fix code*" notes describe the audited code, not today's:

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
5. **Writeback gap — RESOLVED IN CODE (decision #38, 2026-07-01; was tracked as §15 #3).**
   *Pre-fix code:* combat-fired "permanent" buffs were not reconciled onto the persistent
   board; `stats.permanent` was a reserved seam nothing read or wrote. *Now:* combat emits
   `permanent:true` + `dAtk`/`dHp` for flagged `buffStats`, and `Match.resolveCombatPhase`
   folds those deltas onto **surviving** persistent instances via
   `shared/engine/combatWriteback.ts` (rules in §7.5: survivors only, reborn counts as
   surviving, ghosts never accrue, token targets are logged no-ops, the persistent uid is
   the key, deltas fold under the §6.8 clamps). Every existing combat-fired buff was pinned
   `permanent:false` in the same change (sole shop-gated exemption: Mother Thorn — §7.5),
   so no card silently gained persistence.
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
engine, per D4. Item 5 (writeback) is closed by decision #38 — pinned by `EV-WBK-01..10`
(`shared/engine/combatWriteback.test.ts`) and golden `EV-GLD-09`; §15 risk #3 is resolved.

---

## 8. Mechanics ↔ reference mapping

The architecture (§6) expresses every reference engine. All **nine** tribes ship. "H" =
needs a `custom` handler (only 2 of 26 engines do); everything else is declarative
data + engine vocabulary.

| Tribe (orig.) | Reference engine family | Primitive used |
|---|---|---|
| Wildkin | token gen + amplifier, avenge, cleave, mid-combat deathrattle replay | `endOfTurn`→`summon`, `onSummon`+cond→`buffStats`, `afterFriendlyDeaths`, keyword `cleave`, **H** `replayAdjacentDeathrattle` |
| Reefkin | battlecry chain/doubler, poison+shield carriers, single-target megabuff, plant | `battlecry`→`buffStats` (`chosenAlly`), aura `triggerMultiplier`, `grantKeyword`, `plantDeathrattle` |
| Revenants | reborn stacking, death payoffs, tribe damage amp, deathrattle-double, positional reborn | keyword `reborn` + `deathrattle`, aura `damageMultiplier`+`activeWhen`, `adjacentAllies` deathrattle (Last Rites Drummer), **H** `primeNextDeathrattleDouble` |
| Infernals | self-damage / sacrifice for burst | `startOfCombat`→`dealDamage(self)`+`buffStats`, deaths breakpoints |
| Tuskers | gem greed → PURCHASED exponential doubler + gem sinks (#39) | `giveGem` wallet + activated abilities (§6.6a): escalating `multiplyStats` doubles (capped), `gainGold` bridge, `refreshShop`, chosenAlly shield |
| Primordials | play-count → wide cleave splash | `battlecries`/`alliesAtStart` breakpoints → `buffStats` / grant `cleave` |
| Sirens | poison home + start-of-combat burst | `startOfCombat`→`dealDamage`, `battlecries` breakpoints, board `poison` |
| Constructs | assembly / reassemble + **MAGNETIC merge** (single-carry *and* board-wide) | `deaths`/`alliesAtStart` breakpoints → `summon`; **`merge` intent** (magnetic bench unit → Construct tower, #54); **Magnaforge** `boardMerges` TIERED board-wide breakpoint (#68); **Forgemaster** `yourSentinels` persistent Sentinel-stack (#55) |
| Corsairs | on-buy tempo, sticky reborn/shield width, positional front-buff, **gold economy** | `alliesAtStart` breakpoints, reborn/divine-shield width, `leftmost` positional aura (Vanguard Pennant); **gold cards** (#56): `gainGoldNextTurn` (Bursar) + `yourEconomy` auras (Fence/Moneylender/Vault Keeper) |

Marquee ⭐ breakpoint cards per tribe live in `config/breakpoints.ts` (e.g. Mortarch
`deaths≥3 once`, Pale Lich `revenantDeaths≥3 amp`, Chorus Tide `battlecries≥2`); the Tusker
doublers are **spend-gated** rows in the same file's `spendGated` registry (#39, §6.6a).
The full **110-row** roster is `shared/content/units.ts`;
per-tribe counts (verified against the catalog): **Constructs 17**, Revenants 16, **Corsairs 15**,
Reefkin 12, **Tuskers 12**, Wildkin 11, Infernals 10, Sirens 9, Primordials 8 (= 110; 104
purchasable + 6 tokens). The **+3 over the Phase-5 catalog are the Phase-6 magnetic-scaling cards
(decision #68):** Constructs **Rivetling (T1)** + **Coilcore (T3)** (magnetic merge fodder) +
**Magnaforge (T6)** (the board-wide `boardMerges` capstone). The +8 before those were the Phase-5
cards: Constructs **Boltfitter (T2), Alloy Rig (T4), Omega Chassis (T5)** (magnetic merge sources, #54) +
**Forgemaster (T4)** (#55); Corsairs **Bursar (T2), Fence (T3), Moneylender (T3), Vault Keeper
(T4)** (gold economy, #56). The +2 before those were the Phase-4 POSITIONAL cards:
Corsairs **Vanguard Pennant (T2, `leftmost` aura)** + Revenants **Last Rites Drummer (T3,
`adjacentAllies` deathrattle)**. The +4 before those were the consumption/lifetime
cards: Infernals **Gorgemaw (T4)** + **Cindermarshal (T4)** and Revenants **Ossuary Titan
(T5)** + **Gravemonarch (T6)**. The +7 before those were the §16 cards: Reefkin Tidebinder,
Infernals Carrion Sovereign (T6), Constructs Nullforge + Aegis Prime (T6), Tuskers Tuskmonger,
Sirens Maelstrom Cantor, Corsairs Quartermaster; and +3 the decision-#39 Tusker gem sinks
**Gemwright (T3), Facetguard (T3), Oreseeker (T2)** (normal pool copy counts).

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
  rerollCost, shop, frozen, bench, board, gems, abilities, discover, pendingTarget,
  lastCombatLog, log`. `gems` is the spendable wallet and `abilities` the activated-ability
  state (`{uid, cardId, cost, used}` per board unit — who can activate, used-this-turn, the
  CURRENT escalated doubler price), both decision #39 — private-channel only, like the
  session's `doublesPurchased` escalator which never syncs at all. **No opponent private
  info ever leaves the server** — shop/hand scouting is impossible by construction.

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
  `CombatOutcome`, so outcome is observable from the event stream alone — plus the additive
  per-side `survivorsA`/`survivorsB` (§7.5, decision #38). Seed is a **string**;
  RNG is derived FNV-1a → mulberry32 (`shared/engine/rng.ts`, methods `next/int/bool/pick/shuffle`).
- **Writeback fold (pure helper):** `foldPermanentBuffs(log, persistentBoard,
  survivorsForThatSide, side): WritebackResult` (`shared/engine/combatWriteback.ts`, §7.5) —
  run by `Match.resolveCombatPhase` per live side; reads the log, never rewrites it.
- **Combat event schema:** the `CombatEvent` union in §7.5 (canonical in `shared/types`). This
  is the primary black-box observation surface for combat evals.
- **Shop reducer:** the exported ops in `shared/engine/shop.ts` — `buyUnit, sellUnit, rollShop,
  freezeShop, unfreezeShop, tierUp, playUnit, moveUnit, mergeUnit, activateAbility, resolveTargetChoice,
  resolveDiscoverPick, startShopPhase, endOfTurnPhase, boardToCombat` — each returning
  `OpResult = { ok: boolean; error?: string; triples?: string[] }`. *(`activateAbility` +
  the `activate` intent member are the decision-#39 ADDITIVE extension of this pinned
  contract; the cost helper `activatedCost(session, card)` is exported beside it. `mergeUnit` +
  the `merge` intent member are the decision-#54 ADDITIVE extension; `effectiveGoldCap(session)`
  is exported beside it for the decision-#56 gold-cap plumbing.)*
- **Intent application (accept/reject):** `Match.applyIntent(seat: number, intent: Intent):
  OpResult` (`shared/engine/match.ts`). A rejected intent returns `{ ok:false, error }` and
  mutates nothing — the observation surface for all validation evals.
- **Intent schema:** the `Intent` union in §4.2 (canonical in `shared/types`).
- **State schemas (privacy contract):** `PublicState` (synced to all) vs `PrivateState`
  (owner-only push) per §9.3 — the two-channel split is itself an asserted invariant.
- **Server→client messages:** §9.4 (`state`, `privateState`, `combatLog`, `ToastEvent`, `error`).

**9.8 Deployment — single service (decision #41).** The game ships as **one process on one
port**: the Colyseus server (`server/index.ts`) also serves the built React client
(`client/dist`) over HTTP via an Express request listener handed to `WebSocketTransport({
server })`. Colyseus's `attachMatchMakingRoutes` wraps that listener so `/matchmake/*` HTTP
requests are handled by matchmaking, all other paths fall through to Express static + an
`index.html` SPA fallback, and WebSocket upgrades ride the same socket. Consequences that any
regeneration must preserve:
- **Bind `0.0.0.0:$PORT`.** The port comes from `process.env.PORT` (host-assigned in prod;
  falls back to 2567 in dev). No other port is hardcoded server-side.
- **Same-origin client.** With no `VITE_SERVER_URL` build override, the prod client connects
  to `wss://<same-host>` (no `:2567` suffix); dev keeps `ws://<host>:2567` because Vite (5173)
  and the server (2567) are distinct origins (§10, `client/src/net/game.ts`).
- **Container is source-run, not dist-run.** The server executes TypeScript via `tsx` and
  imports `shared` as raw `.ts`, so the runtime image keeps the full pnpm install + sources
  (see `Dockerfile`); there is no server compile step to reproduce.
- **Stateful, single-instance by default.** Rooms live in process memory (§9.2), so horizontal
  scaling would require a Colyseus presence/driver (Redis) + sticky WebSocket routing — out of
  scope for v1; one instance is the assumed deployment.

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

**Shop scene — a tabletop, not stacked panels (game-feel).** The shop phase renders as one
continuous **table** (`client/src/scenes/Shop.tsx` + `styles.css`) — a **dusk-toned war-camp
surface** in the shared Dusk Battlefield palette (the "Battlefield" reskin below), not a column of
bordered `SHOP`/`BOARD`/`BENCH` zones: a **tavern shelf** across the top you drag a minion *down*
from (it doubles as the sell target), the **board as the focal felt** in the middle, and a **hero
dock + fanned hand** along the bottom. The board is laid on a shallow **arc** (each slot lifted by
its distance from the row centre) and every token casts a ground shadow so units "stand on" the
surface; the **hand** overlaps its cards in a rotated **fan** that straightens and lifts on hover.
The tavern shelf's **control bar** across the top is the econ deck — sited nearest the shop you spend
into: the **wallet** (a coin count and the gem pill, the latter shown only when a consumer is owned,
decision #27/#39) reads beside the shop title, and the shop/commit actions cluster on the right —
**Tier-Up**, **Freeze**, **Refresh** (roll), and a glowing **Ready**. The **hero dock** at the bottom
is then a compact identity plate: the owner's seat crest and their own **HP as a glossy orb**
(previously only in the standings rail) — health reading at the bottom, the spend controls at the top.
The 8-player standings stay a slim ladder rail. This is **client presentation only**: it renders the same private state and sends
the same intents (invariant #1) — drag-and-drop still maps onto the existing op set (below), and the
combat engine is untouched. Every tabletop *magnitude* (the arc rise, the fan angle/lift/overlap, the
felt/shelf tones, the token shadow, the HP-orb colour) is a **single-sourced CSS token** beside
`--card-scale` (never a magic number strewn through markup), and the whole tabletop shrinks uniformly
off `--card-scale` at narrower widths so a full 7-wide board never wraps or overflows. Hidden hover
tooltips use `display:none` (not `visibility:hidden`) so a right-edge card's tip can't silently widen
the page into a horizontal scrollbar; the hand's tips open leftward for the same reason.

**Battlefield — the dusk arena (§10 reskin).** The combat overlay renders as a **battlefield at
dusk**: a full twilight sky (deep-indigo zenith grading down through a violet band to a burning
**ember horizon**), a distant ridge silhouette, and an earthen field with drifting ambient embers —
a complete visual departure from the between-rounds shop, though **both reskin off the one "Dusk
Battlefield" token set** (the single-sourced `styles.css` `:root`), so the whole app reads as a
single world. Both armies share the one
field, split by a lit **clash seam** with a small **⚔ marker** on it (the player-vs-player identity
now lives in the command bar, below, not on the seam). One clean **left→right battle line per side,
no wrapping**; **leftmost = next-to-act and first-targeted** (adjacency matters for cleave +
Bonepiper), so the ordering stays semantically meaningful and the line is deliberately **not**
centred. The **enemy army sits set back near the horizon and the viewer's army is grounded in the
foreground** — but that depth is **atmosphere only** (a haze veil + slight desaturation on the far
line), **never a CSS `transform: scale`**: the strike choreography measures each `.bl-slot`'s rect
*relative to the field* and applies the lunge as a translate on an inner `.fx` layer, so rescaling a
side's coordinate space would desync the measured lunge from the sprite (a **correctness** constraint,
not just feel — the same class of bug as a beat-start drain). The segmented causal beats, the measured
strike geometry, and the link overlay are otherwise unchanged; the scenery layers are
`pointer-events:none` and carry no `.bl-slot`, so they never perturb the vectors.

**Who you're fighting — the VS command bar.** The player identity now leads with a **VS command bar**
across the top of the overlay: **you** on the left in cool **steel-teal**, the **paired player** on
the right in **rust-crimson**, each a seat-coloured **crest medallion** (the display-name initial),
the **display name**, an ownership tag (a `BOT` pin for bots, `Ghost` for a ghost fight), and a
**live HP bar** (fraction of `startingHealth`, green→amber→red), with a round sigil + the contextual
deaths counter between them. This is the direct answer to "see the name of the player you're fighting"
— it surfaces the opponent's name and standing that were previously only a small row label. The
ownership pair (**you = teal / foe = rust**) is a **semantic colour kept separate from the ember-gold
accent** and is reused on a small per-row tag so each line's owner also reads at the ranks (a
secondary cue, not the old prominent banner). The combat log is identity-free (invariant #2, §7.3),
so **name, HP, side, and bot/ghost flags are all resolved client-side from the already-synced public
schema** — nothing new is plumbed through the log. Resolution stays a **single shared helper**
(`resolveOpponent` in `client/src/components.tsx`, returning `{seat, name, ghost}`) used by **both**
the shop-phase "vs" preview (§4.4) and this bar, so the two screens never disagree; HP/`isBot` come
from `players[]` by seat, assembled in `App.CombatScene` into the presenter's **optional `header`
prop** (the dev `ReplayLab`, which has no match context, omits it and the bar falls back to
"You vs \<opponent\>", no HP). A ghost bye shows the same `ghostName` in the shop
("vs \<name\> · ghost", no living row highlighted) as in the fight.
**Which line is "You" is likewise read from the pairing, not from the board** (`sideForSeat`,
same module, decision #65): `resolveCombatPhase` always resolves `aSeat`'s board as side `a` and
`bSeat`'s as side `b` (and the live player is side `a` in a ghost fight), so the viewer's side is
`a` iff they are the pairing's `aSeat`. Inferring the side from the viewer's own board uids breaks
for an **empty or fully-wiped board** (no uid matches either side → it silently defaulted to `a`),
which **mirrored the replay and inverted the Victory/Defeat banner** for that player; deriving it
from the synced pairing is board-independent and correct. The pairing-derived side is a **required**
prop of the presenter (`CombatReplay`) — there is deliberately **no board-uid fallback** to silently
default to; if the pairing has not synced yet (`sideForSeat` → null) the scene **withholds the replay**
("Resolving combat…") rather than guess a side (decision #66). The end-of-combat **caption is
personalized in the presenter** from that side — "You win" / "\<opponent\> wins" / "Draw" — since
the shared beat captions are side-agnostic (`captionOf` emits a neutral "Side A/B wins" that must
never reach a player).

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
now **backed by live data** (`stats.permanent`, §7.5 writeback — decision #38): the replay
may distinguish a persisting buff from a this-combat one. The current build does not yet
render the cue (no shipped card emits combat-fired permanence); reinstate it alongside the
first persistent scaler card.

> A dev-only workbench (`client/src/scenes/ReplayLab.tsx`, gated behind the `#replay-lab` URL hash,
> lazy-loaded so it is code-split out of the shipped bundle) renders `CombatReplay` against real
> `resolveCombat` logs for a set of canned matchups (cleave / shields / deaths-and-reborn / brawl),
> so this game-feel layer can be audited in isolation without driving a full match to reach combat.

> A shipped, browsable **card catalog** (`client/src/scenes/CardCatalog.tsx`, gated behind the
> `#cards` URL hash, lazy-loaded/code-split, linked from the Landing screen) is a **read-only** view
> of the whole pool: it imports the same `PURCHASABLE_UNITS`/`UNITS` (+ `TRIBES`/`KEYWORDS`) the
> engine plays from and renders each entry with the same `<Card>` token used in the shop, plus that
> card's config-interpolated rules `text`, so it **cannot drift** from live content/tuning — there is
> no separately-maintained list. Filters (tribe / tier / keyword / text search / show-tokens) are
> pure client state; no room connection is needed to view it. Routing is a minimal hash switch in
> `client/src/main.tsx` (`Root` re-renders on `hashchange`), so the game `<App>` and the hash pages
> (`#cards`, `#replay-lab`) navigate without a full reload.

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
through `combat` to refresh it; the scheduled window-end callback still owns the actual phase
transition.

**Results are revealed at the END of the replay, not its start (decision #64).** Combat resolves
server-side the instant the shop closes (`resolveCombatPhase` applies loss damage, eliminations and
placement in-place), but publishing that outcome immediately would spoil the fight: the standings
would show the new HP — and move an eliminated player to the dead list — while the replay is still
on its first beat. So `MatchRoom` **freezes the public player rows** (`hp`/`alive`/`placement`, and
`winnerSeat`) at a **pre-combat snapshot** for the whole `combat` window, pushes each watcher their
private `combatLog` so the replay can play, and only on the window-end callback (`revealResults`)
clears the snapshot — publishing the real post-combat standings and emitting the combat-result /
elimination toasts as the standings tick over. The private board (with §7.5 writeback) still updates
at resolve so the replay has its `myBoard`; only the *public* outcome is deferred.

**The deciding round plays its replay before Results.** The lifecycle is `(round: shop → combat)* →
finished` (§9.1): the match-ending combat is a combat like any other and must be *shown*. So the
window-end callback — not `resolveCombatPhase` — owns the `finished` transition: even when
`isFinished()` is true the server enters `combat`, holds for the sized window so the winner (and the
just-eliminated loser) watch the final fight, then flips to `finished` (revealing `winnerSeat` and
routing clients to Results). Entering `finished` directly at resolve would skip the last combat
entirely — the client would jump straight to the results screen. The continuing case instead calls
`beginShop` from the same callback.

**Contextual counters (decision #27).** Show a manufactured-event counter (deaths / tokens
/ battlecries / gems) **only when you own a card that consumes it** — never an always-on
panel.

**Shop — drag-and-drop (decision #28).** Drag tavern-shelf→board (buy-then-play),
board/bench→tavern to sell (the shelf doubles as the sell target), reorder on the board, and
board↔hand. Buttons/clicks remain a fallback. Maps onto existing intents; no server change. (The
zones are now the tabletop's tavern shelf / board felt / fanned hand — see "Shop scene" above — but
the drop→intent mapping is unchanged.) The board drop handlers (`onDragOver`/`onDrop`) are wired to
the **whole `.board-felt` surface**, not the inner card row: the felt is `flex:1 1 auto` and grows to
fill the table, so wiring the drop to the short bottom-pinned `.board-row` left most of the visible
board silently rejecting drops (the taller the window, the larger the dead band — up to ~78% on a
maximized display). Per-unit **magnetic-merge** drops (decision #54) still take priority via
`stopPropagation` on the target `.arc-slot`. Covered by the Playwright DnD e2e (`e2e/`, `pnpm test:e2e`).

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
- **Bot payoff coverage (so the macro sim actually EXERCISES marquee mechanics):** the bot
  (`server/bots/BotAgent.ts`) values four primary-payoff classes so it buys, keeps, plays and
  hunts them instead of dumping them as raw-stat chaff — breakpoints, spend-gated (#39),
  contested-condition (#46), and **consumption** (#47: a `destroyAlly` card such as Gorgemaw;
  it also refuses to play a consumer into an empty board, else the eat fizzles). **Known
  coverage limitation (decision #47):** a **go-tall** payoff gated on `alliesAtMost` (fixed
  conditional buff — Cindermarshal) is *unreachable* by any rational bot, because deploying
  WIDE dominates in the current engine (empirically: 0 narrow deployments in 200 matches even
  with the buff raised). Its EFFECT is validated by the deterministic EV-CON evals and its 4/5
  body is measured normally; making the narrow line a *winning* choice depends on the Phase-4
  board-shape / anti-wide tech, so the go-tall line is deferred there rather than exercised by
  a speculative (inert) bot heuristic today. **Phase-4 status:** the board-shape work shipped
  (the `alliesAtStart` 5/6/7 gate-spread, decision #48) diversified WIDTH but did NOT change the
  bot's fill-to-`boardCap` policy, so `alliesAtMost≤4` is still unreached in the macro sim.
  **ACCEPTED (#62):** the balance pass's final validation converts the rolling #47b deferral into a
  PERMANENT documented sim-coverage gap — the effect is EV-CON-pinned, the bot fills to `boardCap` 7,
  and forcing bot go-tall play is unmodeled/out-of-scope; it is no longer an open TODO. **Phase-5 status (decision #54/#55/#58):** the
  **MAGNETIC merge tower** IS exercised — the bot's deterministic `bestMerge` consolidates a magnetic
  bench unit onto a Construct tower, and an assembled tower (`mergeCount>0`) is credited toward the
  reachability gate (§11.3b) as a primary payoff, mirroring the #39 spend-gated precedent (116/1600
  player-games on the canonical `run` seed, per-unit cap=5 reached). **RATIFIED (#60):** the final
  validation confirmed the merge tower is a legitimate assembled go-tall payoff (same class as #39),
  not a goalpost move — the credit is KEPT. The **Forgemaster Sentinel-stack (#55)** is a SECOND
  documented coverage gap: bots buy the 3/5 body but its deliberately-small valuation (a payoff bump
  would crowd real breakpoints off splash builds and break EV-BAL-B, #57) leaves it benched and sold,
  so `forgemastersPlayed>0` fires in only ~1/1600 macro player-games. It is therefore NOT credited to
  reachability (a credit would be vacuous — 0.00pp effect); its combat scalar is pinned by the
  EV-FRG-01..03 + EV-GLD-16 determinism/property evals. **ACCEPTED (#61):** it is a documented
  unit-test-only card — the macro non-coverage is a permanent documented gap, not number-tuned away
  (forcing it onto board is the exact move that broke EV-BAL-B in #57's interim).

**11.3 Breakpoint balance-gate metrics (decision #29).** Thresholds in
`shared/config/sim.ts`; the macro-sim asserts:
- **(a) Single-axis margin** — no single-axis stacked build may exceed the multi-axis
  cohort's win-rate by more than `singleAxisMarginMax` (0.08). Watch list: Grovecaller+
  Grovelord, Echo Choir, Pale Lich.
- **(b) Reachability (the gate)** — ≥ `splashReachTargetPct` (0.5) of *developed* 2-tribe
  splashes must hit two distinct breakpoints; else breakpoints are tuned too high and
  everyone mono-stacks.
- **(c) Breakpoint lint** — every primary payoff must be a discrete config breakpoint, **a
  registered SPEND-GATED payoff (decision #39/#40, §6.6a)**, or **a registered
  CONTESTED-CONDITION payoff (decision #46, §6.6b)**: a card whose primary payoff is a
  purchased activated ability is legal iff it has a `spendGated` row whose cost knobs resolve
  to positive config numbers (each step is bought); a card whose primary payoff is a
  survive-the-contest double is legal iff it has a `contestedCondition` row naming the
  condition and its positive engine-knob sizing (each step is a risk). Flag per-unit scaling
  without a threshold, stat-growing activated abilities missing from the registry, and
  registry/catalog drift. Note `alliesAtMost` is a go-tall GATE on a fixed conditional buff
  (Cindermarshal), not a scaling counter, so it needs no row.
- **(d) Non-linearity** — crossing a marquee threshold must improve placement by ≥
  `nonLinearityMinStepRatio` (1.5×) the sub-threshold slope: a step, not a line.

**11.3 outputs:** CLI → CSV/JSON + console; auto-flags overpowered / dead / dominant-build
/ stale-combat (hitting `maxCombatSteps`). Also the **hoarding diagnostic (decision #39;
output only, never a gate):** the distribution of UNSPENT gem wallet at game end (mean /
p50 / p90 / max, `sim/metrics.ts hoardingDiagnostic`) — the wallet is uncapped by design,
and this readout is what would justify adding cost pressure if banking gems ever proved
dominant. Monte-Carlo over seeds washes out targeting
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
  `Hp`, Tuskers `doublerFactor`/`multiplyFactorCap`, Sirens `burstDamage`, etc.), the
  decision-#39 activated-ability price knobs (Tuskers `doubleBaseCost`, `doubleCostStep`,
  `goldgrinGems`, `gemwrightCost`, `gemwrightGold`, `facetguardCost`, `oreseekerCost`), and
  the Phase-3 knobs (Infernals `loneVanguardBuffAtk`/`Hp`/`loneVanguardAllyThreshold`;
  Revenants `graveEmperorDeathThreshold`/`graveEmperorFactor`), the Phase-4 POSITIONAL
  knobs (Corsairs `leftmostAttackBuff`/`leftmostAttackBuffCap` — Vanguard Pennant's `leftmost`
  aura, decision #52), and the **Phase-5 knobs** (Constructs `magneticMergeCap` (#54),
  `forgemasterSentinelBuff`/`forgemasterSentinelId` (#55); Corsairs `bursarGold`,
  `moneylenderThreshold`/`moneylenderGold`, `fenceSellRefund`, `vaultKeeperGoldCap` (#56)).
- **`breakpoints.ts`** — the `{ card, counter, threshold, once?, tiers?, ...payoff }` list;
  the authoritative source for every ⭐ payoff's numbers (§6.6; `tiers?` = Ossuary Titan's
  escalating steps). Also the **`spendGated` registry** (`{ card, currency, costKnobs[] }`,
  decision #39/#40, §6.6a) and the **`contestedCondition` registry** (`{ card, condition,
  thresholdKnobs[] }`, decision #46, §6.6b) — the second and third legal primary-payoff
  classes the §11.3c lint accepts.
- **`sim.ts`** — the balance-gate thresholds for §11.3 (a)/(b)/(d).
- **`systems.ts`** — `freezeIsFree` (active); **`techInjection` `{ fromRound, cardIds[] }`**
  (Phase-4 tech-pool injection guarantee, decision #49, §5); **DEFERRED stubs**: trinket*,
  tavernSpell*, heroPower*.
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
│  ├─ content/                  # units.ts (99 rows), tribes.ts, keywords.ts  ← new units = new rows
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
3. **Writeback gap (§7.6 #5) — RESOLVED (decision #38, 2026-07-01).** Combat-fired
   `permanent:true` buffs now fold onto surviving persistent instances after combat (§7.5,
   `shared/engine/combatWriteback.ts`; pinned by `EV-WBK-01..10` + `EV-GLD-09`/`EV-GLD-12`).
   The seam is now USED in shipped content: Gravemonarch (Phase 3, #46) is the sole
   `permanent:true` combat consumer — its end-of-combat contested-condition double folds a
   `permanent` `multiplyStats` (writeback-multiply extension, `EV-WBK-10`). Every other
   combat buff remains explicit `permanent:false`. Persistent scalers must pass the §11.3
   sim gate like any scaling line.
4. **Numbers need continuous tuning.** Gold curve, tier costs, pool counts, breakpoint
   thresholds are simulator-set starting points; gate content on §11.3 sim health.
5. **Nine-tribe balance.** The six expansion tribes are less validated than the core three;
   watch the single-axis margin (§11.3a) for the multiplier/doubler lines.
6. **DSL erosion.** Keep the escape-hatch rare (§6.5). Prefer new declarative vocabulary
   over handlers, but note each addition widens the engine's semantic surface (§6.8) — the
   thing a regen must reproduce.
7. **Reserved-vs-live drift.** Some DSL remains reserved scaffolding (§6). Either wire the
   deferred systems (spells/hero powers) or prune them, so the spec keeps describing the shipped
   game. **Progress:** gems-spend (#39), then **magnetic merge (#54)**, the **Forgemaster
   `statBuffOnEvent` marker (#55)** and the **`gainGoldNextTurn`/`yourEconomy` gold economy (#56)**
   are now LIVE with evals — the reserved set shrank accordingly (§6.9).
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
> totals (**90 units** at the time of that audit; **93** since decision #39 added the
> Tusker gem sinks) and described in the §6 vocabulary. This section is the change
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
  instance; poison-in-depth still wins). *(Superseded 2026-07-01 by decision #39: the shield
  rider moved behind **Facetguard**'s gem cost — the counterplay is still bought, now priced
  in gems; Goldgrin is a pure gem battlecry.)* (b) **Nullforge** (new Construct tech) is a *second,
  structurally-different* answer to tall: `resetToBase` strips the enemy's highest-Attack
  minion down to its printed stats — neutralize-by-deleting-size vs. poison's kill-on-any-hit.
- **Thornwarden** `alliesAtStart` **4→5** (Gate 3 — a real go-wide commitment, matching the
  other density rewards).
- **`alliesAtStart` gate-SPREAD — board-shape diversification (Phase 4, decision #48).** The seven
  `alliesAtStart` breakpoints, all threshold 5 after Gate 3, are spread into a **discrete 5/6/7
  ladder** so builds want different widths: **5** = Thornwarden, Reaver; **6** = Marauder, Tempest,
  Titanforge; **7** (full board) = Grovelord, Worldspark. Config-only (`breakpoints.ts` thresholds);
  the gate evals read `getBreakpoint(...).threshold` so they re-pin automatically. **Balance risk
  LISTED, uncompensated (rework rule):** pushing Grovelord + Worldspark to 7 nerfs two already-weak
  tribes (post-change sim: primordials/wildkin a touch worse). All §11.3 gates still PASS, but the
  gate-spread also **materially reduced the EV-BAL-B reachability headroom**: second-breakpoint
  reachability on the canonical `run` seed fell **~56% (post-Phase-3) → 50.2% (Phase-4)** — passing the
  load-bearing ≥50% floor by only **0.2pp**. The pass is robust across seeds (run 50.2 / macro 53.2 /
  alpha 53.9 / beta 51.1 / gamma 53.0% — 5/5 pass) and `run` is now the WORST-CASE default. **Flagged
  for final-validation / a future numbers pass (decision #48, #53):** any further content that tightens
  breakpoint gates could tip the `run` seed under 50% and fail the gate — this thin margin must be
  restored (loosen a 7-gate back toward 6, or add a reachability-boosting line) before shipping content
  that raises gates again. Deliberately uncompensated here per the rework "no retune" rule.
- **Reef Leviathan Divine-Shield scoped to Reefkin (Phase 4, decision #51).** The T6 capstone's
  battlecries≥3 shield grant is now `filterTribe:'reefkin'`, not whole-board — a committed-line reward.
- **Two POSITIONAL cards (Phase 4, decision #52).** Vanguard Pennant (Corsair T2): a `leftmost`
  positional aura (+atk to the front friendly, query-at-read-time). Last Rites Drummer (Revenant T3):
  the `adjacentAllies` deathrattle grants Reborn to its ±1 neighbors (settled-board timing, §7.3).
- **Tech-pool injection guarantee (Phase 4, decision #49; §5).** From round 5, a fresh roll with no
  interaction-tech card gets one slot swapped for a copy-weighted tech draw at/below tier — so the
  §16 counter-web floor stays reachable even under an unlucky shop.
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
