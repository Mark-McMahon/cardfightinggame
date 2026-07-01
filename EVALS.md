# EVALS — defined eval suite + coverage manifest

**Purpose.** This is the durable source of truth for "correct" (the Phoenix principle). A
fresh agent regenerating the engine passes when **all evals here are green**. The current
`shared/engine/*` code is disposable and **not** authoritative; where an eval encodes intent
(§7.6 divergences), today's code FAILS it — that is expected and correct.

**This file DEFINES evals; it does not implement them.** No test code here. Each entry is
`{ id · interface · fixture · asserted property · layer · covers }`.

### Layers (priority order)
- **P — Property/Invariant.** Black-box, implementation- and RNG-order-independent. The
  bulk. Written against **intent**, observed at a named interface.
- **G — Determinism golden.** Thin, **intra-implementation only**. Locks byte-identical
  replay for regression. **Generated from the chosen-intent implementation after D1–D3 fix
  the ordering** (D4: cross-impl byte-identity is not required), never treated as the spec.
- **B — Balance gate.** Already exist in `sim/`; extend/complete, don't reinvent.

### Interfaces (the only surfaces an eval may observe — spec §9.7)
- **COMBAT** — `resolveCombat(a,b,seed:string): CombatEvent[]` event stream.
- **SHOP** — shop reducer ops → `OpResult` + resulting `PrivateState`.
- **INTENT** — `Match.applyIntent(seat,intent): OpResult` accept/reject (+ no-mutation-on-reject).
- **MATCH** — match outcome: hero `damageToLoser`, elimination, `placement`, `pairings` (public).
- **STATE** — the `PublicState`/`PrivateState` split.
- **SIM** — a macro-sim metric (`sim/*`).

**[DECISION-GATED]** previously marked evals awaiting a `DECISIONS-NEEDED.md` ruling. **All
of D1–D10 are now ruled** and written into `design-spec.md`; the affected evals below are
finalized, each citing its `(Dn)`.

---

## A. Combat setup & attack loop — COMBAT

| id | fixture (inputs/seed) | asserted property | layer | covers |
|---|---|---|---|---|
| EV-CMB-01 | any 2 boards, fixed seed | first event is `combatStart` with both `BoardSnapshot`s; the input `CombatBoard`s are unmutated after the call (snapshot isolation) | P | §7.1.1, purity |
| EV-CMB-02 | boards with `startOfCombat` units on both sides | start-of-combat effects fire A-then-B, left→right (event order) | P | §7.1.2 |
| EV-CMB-03 | (a) unequal minion counts; (b) equal counts, 2 seeds | more-minions side attacks first; on a tie the first attacker is a seeded `rng.bool()` (differs across the 2 seeds, stable per seed) | P | §7.1.4 |
| EV-CMB-04 | side A has a start-of-combat self-kill that drops it below B's count | first-attacker count is taken **after** step-3 deaths (outcome-affecting) | P | §7.1 note |
| EV-CMB-05 | 3-wide vs 3-wide, no deaths early | attack pointer advances left→right and wraps; each unit acts in order | P | §7.2 |
| EV-CMB-06 | (a) A clears B; (b) mutual empty; (c) two unkillable boards | winner when one side empty; tie when both empty **or** `maxCombatSteps`(400) reached | P | §7.2, §12 combat |
| EV-CMB-07 | 1v1, no keywords | attacker deals `atk` to defender; defender retaliates `atk`; both `damage` events emitted | P | §7.2.4 |
| EV-CMB-08 | Pale Lich side past its breakpoint | damage scaled by tribe `damageMultiplier`, rounded, read from live counter at strike | P | §7.5 |
| EV-CMB-09 | any decisive fight | `combatEnd` `winner`/`survivors`/`damageToLoser` agree with the final event-stream board state | P | §7.5, §9.7 |

## B. Keywords — COMBAT

| id | fixture | asserted property | layer | covers |
|---|---|---|---|---|
| EV-KW-TAUNT | enemy has taunt + non-taunt units | defender pick is restricted to taunt units while any live (`tauntOverride`) | P | taunt |
| EV-KW-DS-01 | shielded defender takes a hit | first damage instance fully negated, shield consumed, `damage.shieldBroken=true`, `onShieldBreak` fires immediately | P | divineShield |
| EV-KW-DS-02 | shielded unit hit by a poison attacker | shield blanks the poison instance; unit survives (`divineShieldNegatesPoison` behavior — **hardcoded**, §7.6 #1) | P | divineShield×poison |
| EV-KW-PSN-01 | poison attacker deals >0 unblocked | target dies after the step regardless of remaining HP | P | poison |
| EV-KW-PSN-02 | poison attacker deals 0 (fully blocked) | no poison kill (only >0 unblocked damage flags) | P | poison edge |
| EV-KW-RBN | reborn unit dies once, has buffs + is golden | returns once, own slot, **1 HP**, reborn stripped, at **base card atk (×2 if golden)**, buffs dropped, **after** its deathrattle | P | reborn |
| EV-KW-CLV | attacker with cleave, defender has L+R neighbors | neighbors take `atk·cleaveDefault`(=1.0), rounded; center takes full | P | cleave |
| EV-KW-CLV-DS | cleaving attacker breaks a defender's divine shield whose `onShieldBreak` summons/inserts a unit | **(D3ii)** cleave neighbors are computed against the **post-insert** enemy line (recomputed, not a stale index) | P | cleave×shieldBreak |
| EV-KW-MAG | any board carrying `magnetic` | `magnetic` produces **no** engine effect (reserved); asserts no shipped purchasable relies on it | P | magnetic (reserved) |

## C. Death / deathrattle / summon / avenge — COMBAT

| id | fixture | asserted property | layer | covers |
|---|---|---|---|---|
| EV-DTH-01 | lethal hit | `death` emitted, unit removed from line | P | §7.3 |
| EV-DTH-02 | death-gated payoff on same pass (Bone Colossus, Pale Lich) | `deaths`/`revenantDeaths`/token-death counters increment **before** deathrattle/avenge/amp read them | P | §6.8, §7.3 |
| EV-DTH-03 | Pallbearer dies, then another friendly dies | primed next dier fires its deathrattle **twice**, flag then cleared (once only) | P | §6.5, §7.3 |
| EV-DTH-04 | avenge card, deaths crossing N (Pack Mother N=2 everyN; Mortarch N=3 once) | `everyN` fires at every `count % N === 0`; `once` fires exactly at `count === N` and never again | P | `afterFriendlyDeaths` |
| EV-DTH-05 | 8 token deaths with Gorehide (cap 6) | +1 atk per token death, total floor bonus clamped to `tokenDeathFloorCapAtk`(6) | P | token floor |
| EV-DTH-06 | deathrattle summon into a full 7-board | summon fills dead slot / shifts right; excess over cap dropped (logged); `onSummon` fires for living friendlies; pointer stays consistent | P | §7.3, summon |
| EV-DTH-07 | pathological deathrattle→summon→death chain | death loop terminates under the guard (no infinite loop, no crash) | P | §7.3 |
| EV-DTH-08 | two units on one side die same pass; first's deathrattle would change what the second sees | **(D1)** whole batch is registered (counters + removal) before any deathrattle; deathrattles resolve against the settled board, so the second dier is unaffected by the first's deathrattle | P | §7.3, D1 |
| EV-DTH-09 | cross-side mutual kill (attacker + defender both die), both have deathrattles | **(D2)** the **attacker's side** resolves first, then the defender's; at start of combat (no attacker) side A first; left→right within a side | P | §7.3, D2 |
| EV-DTH-10 | attacker whose `onAttack` deals lethal self-damage | **(D3i)** it does **not** complete the swing — no `attack`/`damage` to the defender; its death resolves at the death step | P | §7.2, D3 |

## D. Effect-DSL semantics — COMBAT / SHOP

### Selectors (WHO)
| id | fixture | asserted property | layer | covers |
|---|---|---|---|---|
| EV-SEL-01 | two allies tied on the selected stat; a card with `stat` omitted | tie → **earliest board slot**; omitted `stat` defaults to **hp** | P | §6.8 tie-breaks |
| EV-SEL-02 | Tidecaller in shop (chosenAlly) then combat | `chosenAlly` legal only on battlecry/shop; resolved in shop; **no combat event requires input** | P | §7.4 purity |
| EV-SEL-03 | mixed-tribe board, `filterTribe`/`filterKeyword`/`excludeSelf` cards | filters and self-exclusion honored exactly | P | targeting |
| EV-SEL-04 | `randomAlly` payoff; 2 seeds (`nAllies` shares this draw method but is reserved — 0 consumers) | random targets drawn via `rng.shuffle(pool).slice(count)`; deterministic per seed | P | §6.8 RNG |
| EV-SEL-05 | Nullforge vs enemy with a buffed giant + smaller units | `highestStatEnemy` picks the biggest enemy by `stat=atk` | P | §6.3 |
| EV-SEL-06 | Sirenling vs multi-unit enemy | `frontEnemy` = enemy at the front slot | P | Sirens burst |

### Actions (WHAT)
| id | fixture | asserted property | layer | covers |
|---|---|---|---|---|
| EV-ACT-BUFF | buffStats reducing atk below 0 / hp below 1 | atk floored at 0, hp floored at 1, rounded; `permanent` flag respected | P | §6.8 clamps |
| EV-ACT-SET | (`setStats` is reserved — 0 consumers; no eval required per §6.9) | — | — | — |
| EV-ACT-MUL | Ivorytusk fires 3 turns; also a combat-fired multiply | factor clamped to `multiplyFactorCap`(2) in **both** phases; shop-fired persists+compounds; combat-fired this-combat-only; `statSanityBound` never reached | P | §6.3, Tuskers |
| EV-ACT-RST | Nullforge vs a ×N-doubled carry | target reduced to printed base stats (buffs stripped) | P | resetToBase |
| EV-ACT-GK | grantKeyword | keyword added; `keyword` event carries `gained=true`+`sourceId` | P | grantKeyword |
| EV-ACT-SUM | Tombspawn / Reclaimer deathrattle-summon; a start-of-combat / breakpoint summon | `summon` inserts the unit(s) at the owner's slot, shifting right; fires `onSummon` for living friendlies; over-`boardCap` summons dropped (full-board overflow → EV-DTH-06) | P | summon |
| EV-ACT-DMG | dealDamage to a target/self | exact amount applied as combat damage (honors shield/poison/retaliation); can kill (Cinderling self-damage, Siren burst) | P | dealDamage |
| EV-ACT-DESTROY | Hollow Priest destroys `lowestStatAlly`; variants: that ally shielded / has a deathrattle (Gravebrand) | **(D11)** target removed; **counts as a friendly death + fires its deathrattle**; **not** combat damage (no retaliation/poison/`damage` event); **bypasses divine shield — a shielded target is still destroyed, shield untouched (D11(a))** | P | destroy (promoted idiom) |
| EV-ACT-GEM | Gemsnout end-of-turn in shop | `giveGem` raises `gems` and `gemsThisTurn` by amount | SHOP | giveGem |
| EV-ACT-GOLD | (`gainGold` is reserved — 0 consumers; no eval required per §6.9) | — | — | — |
| EV-ACT-PLANT | Reefmourner plants on ally; ally later dies | planted `Effect` stored on `instance.grantedEffects`, persists, fires as a deathrattle on host death | P/SHOP | plantDeathrattle |
| EV-ACT-CUST | Bonepiper / Pallbearer | `custom` dispatches to `handlerId` in the registry; unknown id is a hard error | P | §6.5 |

### Conditions (GATE)
| id | fixture | asserted property | layer | covers |
|---|---|---|---|---|
| EV-CND-01 | a `deathsThisCombatAtLeast` effect evaluated in shop; a `battlecriesThisTurnAtLeast` in combat | wrong-phase counter reads 0/false silently (combat populates only `deathsThisCombat`; shop populates battlecries/tokens/gems) | P | §6.3 phase-scope |
| EV-CND-02 | effect with no condition / an unknown kind | evaluates **true** | P | §6.3 default |
| EV-CND-03 | each live kind at threshold−1, threshold, threshold+1 | `countAllies`, `gemsThisTurnAtLeast`, `battlecriesThisTurnAtLeast`, `tokensSummonedThisTurnAtLeast`, `deathsThisCombatAtLeast` each gate exactly at the boundary | P | conditions |

### Auras (passive modifiers)
| id | fixture | asserted property | layer | covers |
|---|---|---|---|---|
| EV-AUR-01 | 2 stacking copies vs 2 non-stacking | stacking multiply; non-stacking take the max; result rounded, `Math.max(1,·)`, then capped | P | §6.8 combine |
| EV-AUR-02 | Pale Lich; side at 2 then 3 revenant deaths | `activeWhen` inert below `threshold`(3); active at/after; amp then applies | P | §6.4, breakpoint |
| EV-AUR-03 | 2 Grovecallers / 2 Echo Choirs (non-stacking, capped) | effective multiplier never exceeds `endOfTurnTriggerMultiplierCap`/`battlecryTriggerMultiplierCap`(2) | P | §6.4 caps |
| EV-AUR-04 | Grovecaller + Gemsnout + Ivorytusk in one end-of-turn | multiplier applies **only to `summon`** end-of-turn actions, **not** `giveGem`/`multiplyStats` | P | §6.8, §16 fix |
| EV-AUR-05 | Echo Choir + a `battlecries≥2` breakpoint card, one real battlecry doubled | doubling increments `battlecriesThisTurn` by the multiplier up front, so the breakpoint sees the doubled progress | P | §6.8 |

## E. Custom handlers — COMBAT (+ determinism)

| id | fixture | asserted property | layer | covers |
|---|---|---|---|---|
| EV-HND-01 | Bonepiper adjacent to a deathrattle unit, it attacks | adjacent friendly deathrattle re-fires **without that unit dying**; `scope=adjacent`, per-attack per config | P | `replayAdjacentDeathrattle` |
| EV-HND-02 | Pallbearer + later dier (see EV-DTH-03) | one-shot double armed and honored | P | `primeNextDeathrattleDouble` |
| EV-HND-03 | fixtures for both handlers, fixed seed | byte-identical `CombatEvent[]` across runs (every `custom` handler needs a determinism test) | G | §6.5 mandate |

## F. Breakpoints — one per ⭐ card (COMBAT unless noted). Property: **payoff fires at the threshold, not below** (step-not-line), reading numbers from `breakpoints.ts`.

| id | card (counter · threshold · payoff) | interface | layer |
|---|---|---|---|
| EV-BP-01 | `wildkin_motherthorn` — tokensThisTurn≥3 → summoned token +2/+2 | SHOP+COMBAT | P |
| EV-BP-02 | `wildkin_thornwarden` — alliesAtStart≥5 once → self +2/+4 | COMBAT | P |
| EV-BP-03 | `wildkin_grovelord` — alliesAtStart≥5 → board +2/+2 (+ end-of-turn token trickle ×Grovecaller) | COMBAT | P |
| EV-BP-04 | `wildkin_packmother` — deaths≥2 everyN → board +2/+3 | COMBAT | P |
| EV-BP-05 | `wildkin_brackentide` — battlecries≥2 → summon 2 Thornpup (base 1 always) | SHOP | P |
| EV-BP-06 | `revenants_mortarch` — deaths≥3 once → board +3/+3 | COMBAT | P |
| EV-BP-07 | `revenants_palelich` — revenantDeaths≥3 → ×2 damage amp (capped) | COMBAT | P |
| EV-BP-08 | `revenants_tideclaimer` — battlecries≥2 → summon Reborn Wisp | SHOP | P |
| EV-BP-09 | `revenants_boncolossus` — deaths≥4 once → summon 2 Reborn Wraith (deathrattle) | COMBAT | P |
| EV-BP-10 | `reefkin_pearlguard` — shieldBreak≥1 once → board +1/+3 | COMBAT | P |
| EV-BP-11 | `reefkin_chorustide` — battlecries≥2 → board +3/+3 | SHOP | P |
| EV-BP-12 | `reefkin_leviathan` — battlecries≥3 → grant board Divine Shield | SHOP | P |
| EV-BP-13 | `infernals_bloodcaller` — deaths≥3 once → self +5/+3 | COMBAT | P |
| EV-BP-14 | `infernals_abysslord` — deaths≥4 once → self +8/+6 + Cleave | COMBAT | P |
| EV-BP-15 | `infernals_carrionsovereign` — deaths≥1 everyN → Infernals +2/+1 (this combat) | COMBAT | P |
| EV-BP-16 | `constructs_foundry` — deaths≥4 once → summon 6/6 Sentinel (deathrattle) | COMBAT | P |
| EV-BP-17 | `constructs_titanforge` — alliesAtStart≥5 once → summon Sentinel | COMBAT | P |
| EV-BP-18 | `constructs_aegisprime` — deaths≥1 everyN → Constructs +1/+1 (this combat) | COMBAT | P |
| EV-BP-19 | `tuskers_ivorytusk` — gemsThisTurn≥3 → multiply ×2 (compounds across turns) | SHOP | P |
| EV-BP-20 | `tuskers_ivorylord` — gemsThisTurn≥3 → multiply ×2 | SHOP | P |
| EV-BP-21 | `tuskers_gemtitan` — gemsThisTurn≥3 → multiply ×2 | SHOP | P |
| EV-BP-22 | `primordials_stormcaller` — battlecries≥2 → board +2/+1 | SHOP | P |
| EV-BP-23 | `primordials_tempest` — alliesAtStart≥5 once → board +2 atk | COMBAT | P |
| EV-BP-24 | `primordials_worldspark` — alliesAtStart≥5 once → grant board Cleave | COMBAT | P |
| EV-BP-25 | `sirens_deepchanter` — battlecries≥2 → ally Poison +2/+2 | SHOP | P |
| EV-BP-26 | `sirens_abysscantor` — battlecries≥3 → Sirens Poison | SHOP | P |
| EV-BP-27 | `sirens_leviathansong` — battlecries≥3 → board +2/+2 + random Poison | SHOP | P |
| EV-BP-28 | `corsairs_reaver` — alliesAtStart≥5 once → board +1 atk | COMBAT | P |
| EV-BP-29 | `corsairs_marauder` — alliesAtStart≥5 once → board +2/+1 | COMBAT | P |

*(29 entries = every row in `breakpoints.ts`. The breakpoint **lint** EV-BAL-C separately
asserts every ⭐ card has exactly one such row and no primary payoff scales per-unit
without a threshold.)*

## G. Economy / shop reducer — SHOP / INTENT

| id | fixture | asserted property | layer | covers |
|---|---|---|---|---|
| EV-ECO-01 | rounds 1..12 | income = `goldStart`(3) round 1, +`goldPerTurn` each round, capped at `goldCap`(10) | SHOP | income |
| EV-ECO-02 | buy with room / no room / no gold | buy costs `buyCost`(3), moves shop→bench, removes 1 pool copy; rejected (no mutation) if bench full or unaffordable | INTENT | buy |
| EV-ECO-03 | sell a non-token, non-golden | refunds `sellRefund`(1); returns a pool copy; fires `onSell` triggers | INTENT | sell, onSell |
| EV-ECO-04 | roll with/without gold | costs `rerollCost`(1); redraws non-frozen slots | INTENT | roll |
| EV-ECO-05 | freeze then next `startShopPhase` | freeze free; frozen offer set persists into next shop | SHOP | freeze |
| EV-ECO-06 | tier up now vs after skipping k turns | costs `tierUpBaseCost[tier]` minus `tierUpDiscountPerTurn`×skips (floored ≥0); discount resets on tier-up | SHOP | tier, discount |
| EV-ECO-07 | tiers 1..6 | shop offers `shopSlotsByTier[tier-1]` units | SHOP | slots |
| EV-ECO-08 | many buys of one card across players | ≤ `poolCopiesByTier[tier-1]` copies exist; rolls draw only at/below player tier; contesting depletes shared pool | SHOP | pool |
| EV-ECO-09 | play into full board / bench overflow | `boardCap`(7)/`benchCap`(10) enforced; **(D7)** both read from `economy.*` config, not literals | INTENT | caps |
| EV-ECO-10 | hold 3rd copy; cascade case; bench-full-on-Discover | 3 copies→golden ×`goldenStatMultiplier`(2)+Discover(1-of-3 from tier+`tripleDiscoverTierOffset`(1)); re-scan cascades; bench-full → Discover lost (logged); golden/token pool-exempt | SHOP | triple |
| EV-ECO-11 | play a targeted battlecry (Tidecaller) | `playUnit` fires battlecry; `chosenAlly` sets `pendingTarget`; `resolveTargetChoice` bakes result before combat | SHOP | battlecry, target |
| EV-ECO-12 | moveUnit within board | reorders; slot indices update | INTENT | positioning |
| EV-ECO-13 | discoverPick | resolves choice; options are drawn from tier+offset | SHOP | discover |
| EV-ECO-14 | Gemsnout across turns; `gemCarryOver` | `gems` accumulates and persists; `gemsThisTurn` resets each shop turn; **(D10)** persistent `gems` has **no gameplay effect** (cosmetic — no spend sink; only `gemsThisTurn` feeds the doubler) | SHOP | gems |
| EV-ECO-15 | `chosenAlly` battlecry played with no legal target; Discover from an empty tier+offset pool; `onSell` on a token | **(D5)** chosenAlly fizzles (resolves to nothing) but **still counts as a battlecry** and increments `battlecriesThisTurn`; empty Discover pool fills from the next lower tier then skips; `onSell` fires only on a **purchasable body**, not a token | SHOP/INTENT | D5 edge rules |
| EV-ECO-16 | Tidebinder on board, play a 2nd battlecry; Tuskmonger / Quartermaster on board, sell a friendly body | `afterFriendlyBattlecry` fires on each subsequent friendly battlecry (Tidebinder → Reefkin +1/+1 permanent); `onSell` fires per friendly body sold (Tuskmonger → +2 gems; Quartermaster → highest-Attack Corsair +2/+2) | SHOP/INTENT | afterFriendlyBattlecry, onSell (audit Patterns A/B) |

## H. Match loop & outcome — MATCH / STATE

| id | fixture | asserted property | layer | covers |
|---|---|---|---|---|
| EV-MTC-01 | decisive combat, known winner tier + survivor tiers | **(D6)** damage = `clamp(winnerTier·w1 + Σ survivor tiers·w2, 0, cap)` using the **winner's** tier | MATCH | §4.5 |
| EV-MTC-02 | tie result | zero hero damage both sides | MATCH | §4.5 |
| EV-MTC-03 | player to ≤0 HP | eliminated, assigned lowest open placement; last survivor = 1st | MATCH | §4.6 |
| EV-MTC-04 | two players ≤0 same round, different HP | ordered by remaining HP (`moreNegativeHpPlacesLower`) | MATCH | §4.6 |
| EV-MTC-05 | two mutually-unkillable boards to round 25 | `maxRounds`(25) → standings finalized by remaining HP; **(D9)** HP ties broken by **seat order** (lowest seat places higher) | MATCH | §4.6 |
| EV-MTC-06 | odd live count | one player vs a **ghost** = the **most-recently-eliminated** player's board, **chosen deterministically from the match seed**; no hero damage flows to ghost; `Pairing.bSeat=-1` | MATCH | §4.4 |
| EV-MTC-07 | vary max tier/gold across a round | public `timer` = `min(cap, base + maxTier·perTier + maxGold·perGold)` | STATE | §4.3 |

## I. Load-bearing invariants (cross-cutting)

| id | fixture | asserted property | layer | covers |
|---|---|---|---|---|
| EV-INV-SRV | send an illegal intent (unaffordable buy, wrong-phase, bad uid) | `applyIntent` returns `{ok:false,error}` and **mutates nothing** | INTENT | invariant 1 |
| EV-INV-DET | a fixture battery, same (boards, seed) run ×N **in this implementation** | byte-identical `CombatEvent[]` every run (intra-impl determinism; **(D4)** cross-impl byte-identity is NOT required) | G | invariant 2 |
| EV-INV-DET-SEED | same boards, different seeds | RNG-dependent choices (targeting, first-attacker tie) may differ; all draws come from the seeded PRNG (no `Math.random`) | P | invariant 2 |
| EV-INV-PRIV | inspect `PublicState` during shop | contains no `shop`/`bench`/`board`/`gold`/`gems`/`hand`/opponent combat log; private data only on the owner push | STATE | invariant 3 |
| EV-INV-CFG | lint over engine source | no §12 gameplay constant is a literal in logic; **(D7)** `boardCap`/`divineShieldNegatesPoison` sourced from config, `simultaneousDeaths`/`deathrattleOrder` honored, `attackOrderRule`/`firstAttackerTiebreak` removed; `64`/`8` loop bounds allowed as commented guards | P/meta | invariant 4 |
| EV-VOCAB-01 | lint over `units.ts` × the §6.9 catalog | **anti-idiom law:** every trigger/selector/action/condition/aura a shipped card uses is a §6.9 **live** primitive with ≥1 eval; no card uses a `[reserved]` primitive; no `dealDamage` with a "destroy" magnitude survives (must be `destroy`) | P/meta | §6.9 regeneration surface |

## J. Balance gate — SIM (extend existing `sim/`, don't reinvent)

| id | source | asserted property | layer | covers |
|---|---|---|---|---|
| EV-BAL-A | macro-sim (`sim/metrics.ts`) | single-axis stacked build win-rate lead ≤ `singleAxisMarginMax`(0.08) over multi-axis cohort | B | §11.3a |
| EV-BAL-B | macro-sim | ≥ `splashReachTargetPct`(0.5) of developed 2-tribe splashes hit ≥2 distinct breakpoints | B | §11.3b (the gate) |
| EV-BAL-C | `breakpoints.test.ts` + `sim/audit.ts` | every primary payoff is a discrete `breakpoints.ts` row; flag any per-unit scaling without a threshold; every ⭐ card ↔ exactly one row | B | §11.3c lint |
| EV-BAL-D | macro-sim | crossing a marquee threshold improves avg placement by ≥ `nonLinearityMinStepRatio`(1.5)× the sub-threshold slope | B | §11.3d |
| EV-BAL-E | `sim/audit.ts` caps lint | no multiplier value exceeds its `engines.ts` cap (`endOfTurnTriggerMultiplierCap`, `battlecryTriggerMultiplierCap`, `undeadDamageAmpCap`, `multiplyFactorCap`) | B | decision #25 |
| EV-BAL-F | `sim/web.test.ts` | anti-degeneracy floor holds (every scaling line has a reachable counter that connects) | B | §16 gate |
| EV-BAL-G | macro-sim | fraction of combats hitting `maxCombatSteps` (stale combat) below a flag threshold | B | §11.3 outputs |

## K. Determinism goldens (thin, intra-impl) — G, generated after D1–D3 (D4: not cross-impl)

| id | fixture | asserted property | layer |
|---|---|---|---|
| EV-GLD-01..08 | one fixed (boards, seed) each spanning: swarm mirror; poison-vs-shield; reborn chain; Pale-Lich amp crossing; Tusker doubler across turns; cleave with neighbors; Bonepiper replay; Pallbearer double | byte-identical `CombatEvent[]` (the reference log). **Regenerated from the chosen-intent engine; the log is a lock, never the spec.** | G |

---

# Coverage manifest

Every card / keyword / breakpoint counter / economy rule / invariant → the eval(s) that
**fail if it breaks**. Anything with none is **UNPROVEN** (listed at the end).

## Keywords (6)
| keyword | fails-if-broken |
|---|---|
| taunt | EV-KW-TAUNT |
| divineShield | EV-KW-DS-01, EV-KW-DS-02 |
| poison | EV-KW-PSN-01, EV-KW-PSN-02, EV-KW-DS-02 |
| reborn | EV-KW-RBN |
| cleave | EV-KW-CLV, EV-BP-24 (grant) |
| magnetic (reserved) | EV-KW-MAG |

## Breakpoint counters (7)
| counter | fails-if-broken |
|---|---|
| deaths | EV-DTH-02/04, EV-BP-04/06/09/13/14/15/16/18 |
| revenantDeaths | EV-BP-07, EV-AUR-02 |
| tokensThisTurn | EV-BP-01, EV-CND-03 |
| battlecries | EV-BP-05/08/11/12/22/25/26/27, EV-AUR-05, EV-CND-03 |
| gemsThisTurn | EV-BP-19/20/21, EV-ACT-GEM, EV-CND-01/03 |
| alliesAtStart | EV-BP-02/03/17/23/24/28/29 |
| shieldBreak | EV-BP-10, EV-KW-DS-01 |

## Cards (90) — by coverage mechanism
- **29 ⭐ breakpoint cards** → their `EV-BP-01..29` (1:1).
- **2 handler cards** (Bonepiper, Pallbearer) → EV-HND-01/02, EV-DTH-03.
- **Vanilla-keyword bodies** (Thornpup, Grave Wisp, Reborn Wisp/Wraith, Scrapling, Sentinel,
  Lurefish, Gustling, Cinderwing, Swab, Ironclad, Grubtusk, …) → the keyword evals (§B) +
  EV-CMB-07 (basic trade). Their stats/tribe/tier are data (frozen); no behavior beyond keywords.
- **Battlecry buff/grant cards** (Tidecaller, Brineling, Coral Warden, Deepsinger, Tide Prophet,
  Sparkling, Tideling, Thunderhead, Deckhand, Cutthroat, Stormrider, Sea Queen, Dreadnought,
  Reefwitch, Goldgrin, …) → EV-ECO-11 + EV-ACT-BUFF/EV-ACT-GK + EV-SEL-02/03.
- **Deathrattle cards** (Cryptling, Gravewing, Tombspawn, Graverobber, Dirgecaller, Cogling,
  Bulwark, Reclaimer, Shield Drone, Warhoard, Dreadmaw, Gravebrand, Spinefish, Venomsong, …) →
  EV-DTH-01/03/06 + EV-ACT-SUM/EV-ACT-GK/EV-ACT-BUFF.
- **Start-of-combat cards** (Cinderling, Hollow Priest, Pyrewalker, Nullforge, Sirenling,
  Tempestsinger, Maelstrom Cantor) → EV-CMB-02 + EV-ACT-DMG/EV-ACT-RST/EV-SEL-05/06 + EV-DTH
  (sacrifice self-kill). Nullforge → EV-ACT-RST/EV-SEL-05.
- **Aura cards** (Grovecaller, Echo Choir) → EV-AUR-03/04/05.
- **Gem generators** (Gemsnout, Tuskhoarder, Grubtusk, Warhoard) → EV-ACT-GEM, EV-ECO-14.
- **onSell / afterFriendlyBattlecry Pattern cards** (Tuskmonger, Quartermaster, Tidebinder) →
  EV-ECO-03 (onSell fires) + EV-ECO-16 (Pattern A/B trigger firing + payoffs) + EV-ACT-BUFF/GEM.
- **plantDeathrattle bridge** (Reefmourner) → EV-ACT-PLANT.
- **Token-floor carriers** (Gorehide, Thornbeast) → EV-DTH-05.

## Economy rules
income EV-ECO-01 · buy EV-ECO-02 · sell/onSell EV-ECO-03 · roll EV-ECO-04 · freeze EV-ECO-05 ·
tierUp+discount EV-ECO-06 · slots EV-ECO-07 · pool EV-ECO-08 · caps EV-ECO-09 · triple/golden/
discover EV-ECO-10/13 · positioning EV-ECO-12 · gems EV-ECO-14 · timer EV-MTC-07 · loss damage
EV-MTC-01 · placement EV-MTC-03/04 · maxRounds EV-MTC-05 · pairing/ghost EV-MTC-06.

## Invariants (4)
1 server-authoritative → EV-INV-SRV · 2 determinism → EV-INV-DET/-SEED, EV-HND-03, EV-GLD-* ·
3 privacy → EV-INV-PRIV · 4 config-driven → EV-INV-CFG, EV-BAL-C/E.

---

# UNPROVEN (no failing-if-broken eval — must be closed)

With **D1–D10 ruled** and written into `design-spec.md`, the ten previously-gated items are now
pinned: EV-DTH-08 (D1), EV-DTH-09 (D2), EV-DTH-10 + EV-KW-CLV-DS (D3), determinism reframed by
D4, EV-INV-CFG (D7), EV-MTC-06 (D8), EV-MTC-05 (D9), EV-ECO-14 (D10), EV-ECO-15 (D5), EV-MTC-01
(D6), EV-ECO-09 (D7). **Two items remain unproven — neither is a combat/shop correctness gap:**

1. **`avoidImmediateRematch` ("where possible").** A soft pairing constraint; only weakly
   assertable (no immediate rematch when an alternative pairing exists). Needs a precise
   tie-break rule to become a hard eval — a small **open sub-decision**, not a correctness risk.
2. **Reconnect grace + bot-takeover (§9.5).** Stateful/timed *server* behavior, not observable
   at the pure engine/shop interfaces; needs a server integration harness, not a property eval.
   Out of scope for the round-1 engine regeneration.

**Determinism (was UNPROVEN) is resolved by D4:** it is asserted as a **property** —
EV-INV-DET-SEED (all randomness from the seeded PRNG, no `Math.random`) + EV-INV-DET (same-seed
→ same-log *within* an implementation). Cross-implementation byte-identity is deliberately
**not** required, so it is no longer an unproven gap — it is a dropped guarantee. `EV-GLD-*` are
an intra-impl regression guard generated from the corrected engine after D1–D3, never the spec.

**Success-gate status: MET for the engine's pure-interface surface.** Every decided normative
claim maps to ≥1 eval at a named interface, and the coverage manifest names a failing-if-broken
eval for each card / keyword / breakpoint counter / economy rule / invariant. The two residual
items above are (1) a soft pairing sub-rule and (2) server-only reconnect — both outside the
combat / shop / match-outcome surface the regeneration targets. **The suite is ready to hand to
a code-gen agent** (the §7.6-encoding evals — EV-DTH-08/09/10, EV-KW-CLV-DS, EV-INV-CFG — will
be RED against today's `combat.ts` by design, as will EV-VOCAB-01's anti-idiom clause until
D11 promotes the four `dealDamage:999` rows to `destroy`; that RED validates them).
