# PROMPT 1 — RIGOROUS REBUILD: a GENERATED adversarial sampler + Part A / Part B gates

> This section **supersedes** the fixture-based floor described further down. The earlier
> pass closed the web with **hand-authored board fixtures whose stats were hardcoded**
> (`atk: 640`, a `tall-titan` picked at `40/60`, …) — exactly the "hand-tune a small fixture
> set until the cycle closes" the prompt forbids. This rebuild replaces that with a
> **broad, adversarial, GENERATED sampler** and adds the two mandated gates (Part A Tusker
> containment, Part B coherence). All nine tribes; **130/130 vitest green, deterministic ×2;
> sim+shared typecheck clean; §16.7 macro gate CLEAR (no new OP flag).**

## The core fix — the sampler (load-bearing). `sim/sampler.ts`

The anti-degeneracy floor is only as strong as the diversity of the opponents it samples, so
the sample is **generated from real play**, never hand-authored:

- **`matchPlayPool()`** runs full **8-bot matches** (the same `Match` + `BotAgent` the server
  and macro sim use), rotating committed tribes so **all nine appear as mono stacks and as
  cross-tribe splashes**, and harvests the **exact boards that fought** from each combat's
  `combatStart` snapshot. Every stat on every board is what the real shop path produced —
  battlecry chains, Mother Thorn buffs, end-of-turn token summons, the Tusker doubler,
  everything — at realistic tech density. 28 matches → **~1000 boards** spanning every tribe
  and every tech tag (poison / shield / cleave / reborn / wide / tall / baseline).
- **`assemble()`** grows a **chosen roster** (a player's strategic commitment) through the
  **real** shop path (`playUnit` battlecries + the real `endOfTurnPhase`) for the extreme
  ceilings a 12-round bot game rarely reaches — a fully-doubled Tusker carry, a saturated
  poison spread, a maxed shield wall, a titan. The player picks the roster; the **engine
  computes the stats** (nothing is stat-tuned — the doubler reaches 1536/2048 by 9 turns of
  the real `endOfTurnPhase`, not a literal).
- **Diversity selection** (`selectRealPeaks`/`selectBaselines`) is algorithmic: bucket by
  `(dominant tribe × primary tech tag)` and keep the **strongest** board per bucket (the
  adversarial peak of each region) plus the genuine low-tech baselines. A line that loses to
  nothing in *this* sample is a degeneracy, not a pass.

**Sampler integrity is itself a test** (`web.test.ts §6`): the pool must be large (≥400),
span every tech tag, cover ≥8 tribes as a dominant, and be **byte-reproducible** under fixed
seeds. And the floor is **proven to bite**: strip every poison unit from the sample and the
floor immediately flags the exponential doubler as a **universal winner** (its only structural
counter is gone).

## The meta-tests — now over the generated panel (`sim/web.test.ts`, 38 tests)

1. **Primitive determinism (P0–P7)** — Layer-1 locked specs, unchanged (built inline, no
   fixtures). See the table below.
2. **No context-free dominance** — over the **generated 63-board panel** (real peaks +
   reachable commitments + baselines): **no universal winner**, and **every board has a
   reachable counter**. Cross-table is a deterministic constant (fixed seeds).
3. **Context-sensitivity** — every committed scaling line **beats a real low-tech baseline**
   AND **loses to ≥1 sampled board**. Winning regardless = fail.
4. **Anti-linear** & **5. Caps** — the static catalog lints (`audit.ts`), unchanged + still
   bite their synthetic controls.
6. **Sampler integrity** — diversity + reproducibility (above).
7. **Structural edges** — the four headline relationships pinned as robust primitive-driven
   claims (poison kills the doubled carry; cleave cracks the shield wall; shield out-lasts
   poison; tall out-sizes wide reborn).

## PART A — Tusker compounding containment (`sim/tuskers.test.ts`, 19 tests)

The doubler's ceiling is uncapped **by design**; the cap is the **cost of assembling it**,
paid in board weakness (an opponent can't interfere during setup). Verified end-to-end through
the real shop/`endOfTurnPhase` path:

- **A1 assembly cost** — the doubler ALONE never fires (no gem generators ⇒ never reaches the
  gem breakpoint ⇒ stays 3/4 forever). Sustained doubling needs **3 gem generators + the
  doubler** = 4 of 7 slots, so the combat board is thin.
- **A2 tempo cost** — a greedy doubler **loses 100%** (margin −1) to a developed tempo board
  at turns 1–3; it only flips to winning at turn ~5 once the carry is 96/128+. You cannot
  assemble the engine *and* keep a competitive early board — so it is not too cheap.
- **A3 the counter connects** — a fully-doubled carry (thousands of stats) is **reliably killed
  by saturated poison** at every size (turns 5/7/9/12), and a lone tiny poison body kills a
  maxed body outright (P1 ignores size — structural, not a numeric race).
- **A4 doubler-shield degeneracy (the whole ballgame)** — a doubled carry can be **granted
  divine shields** via a Reefkin/Corsairs/Constructs splash, and "shield negates poison" (P2)
  is a locked primitive, so a shielded carry poison can't strip would be unkillable. **RESULT:
  a saturated poison package OUT-NUMBERS the shields** — a doubled carry holding **+1, +2, or
  even +3 divine shields still loses ~99–100%** to saturated poison (each shield pops on a
  poison body the carry then kills; the surplus poison bodies land the stat-agnostic kill). A
  **thin** (2-body) poison board does **not** break through 3 shields — so the reachable
  counter is specifically **saturated** poison, which the pool provides (Sirens home).
- **A5 shield-realistic reachability** — the counter is tested against **shielded doubled AND
  shielded tall** carries, not clean no-shield fixtures; poison connects on both.
- **A6 engineering sanity bound** — a config seatbelt `engines.tuskers.statSanityBound = 1e12`
  clamps `multiplyStats` in `combat.ts` + `shop.ts`. Reachable ceiling is ~`base·2^maxRounds`
  ≈ 2.7e8, so **it is never hit in a real match** (a 30-turn carry = 3.2e9, still far below);
  it exists only so the sim can never overflow to Infinity/lose precision, and if it were ever
  hit that itself flags the counter guard failed upstream. Combat with a maxed carry always
  terminates in `combatEnd` with no NaN/Infinity.
- **A7 gem economy determinism** — same roster + turns → **identical gem count → identical
  doublings**, byte-for-byte, twice; three generators reach the ≥3 threshold **every** turn
  deterministically. Why gems can't be purely declarative: the breakpoint reads a
  **per-shop-turn running total** (`gemsThisTurn`) that accumulates across many effects within
  a turn and resets at `startShopPhase` — cross-effect turn state on `PlayerState`, not
  expressible in one stateless declarative effect.

## PART B — coherence gate on developed boards (`sim/coherence.ts` + test, 13 tests)

Static over the catalog, modelling a **developed board** (2–4 slots occupied ⇒ 3 free slots):

- **B1 cap-truncation**, **B2 losing-only**, **B3 self-contradiction**, **B5 tier-weight** —
  the shipped catalog is **clean** on all four; each scanner bites its synthetic control **and**
  the reference failure (the pre-rework Grovelord).
- **B4 board-count family** — every "if you control N+ minions" card (`countAllies`/
  `alliesAtStart`) is enumerated with a **recorded per-card decision**; a new unreviewed
  passive board-state payoff cannot ship. **Call: grandfather all as intentional density
  rewards** (each ≥ threshold 4, buffs existing bodies / fizzles gracefully, board-counterable):
  Thornwarden, Titanforge, Tempest, Worldspark, Reaver, Marauder, + the reworked Grovelord.
- **B6 shield density** — census confirms **poison stays viable in a shield-heavy meta**: 9
  poison sources across 2 tribes; the biggest single-tribe poison package (Sirens, 7) strictly
  **out-numbers** the shields a splash can pile on one carry (2) — the Part-A resolution as a
  catalog invariant, so "shield negates poison" never crowds poison out against tall/doubled lines.

## Flagged cards — full list, with rework (before → after)

Across the floor, Part A, and Part B, the audit surfaced **exactly one shipped-content
failure** — the prompt's named reference case — plus one engine seatbelt:

| Card | Rule violated | Before | After (rework) |
|---|---|---|---|
| **Grovelord** (Wildkin T6) | B1 cap-truncation · B2 losing-only · B3 self-contradiction · B5 tier-weight | `End of turn: summon 6 Thornpups (×Grovecaller = 12)`. On a SWARM board (always near-full) the summon was silently eaten by the 7-wide cap and paid off **most when behind** (empty slots); with Grovecaller it summoned 12 onto ≤6 slots even when empty. | `End of turn: summon 2 Thornpups (graceful, ×Grovecaller). Start of combat: if you control 5+ minions, give your minions +2/+2.` A real capstone whose payoff **survives a full board** (buffs the tokens you already have), is best when **ahead/wide** (not behind), is breakpoint-gated (`alliesAtStart ≥ 5`, config) and one-shot (not linear). New breakpoint added; `wildkin_motherthorn` shop test updated to the new count. |

*(Config seatbelt added, not a card:* `engines.tuskers.statSanityBound = 1e12` *+ the clamp in
both `multiplyStats` sites — the engineering seatbelt, never hit in a reachable game.)*

No other card failed any floor / Part-A / Part-B check. The pre-existing macro OP flags
(**Pearlguard, Pack Mother**) are unchanged and remain **board-level counterable** (accepted
since the first pass); no new OP flag appeared after the Grovelord rework.

## Locked primitive specs (Layer 1) — deterministic, identical every run

| ID | Primitive | Spec |
|---|---|---|
| **P0** | Determinism | Same `(boards, seed)` → byte-identical `CombatEvent[]`. |
| **P1** | Poison | Any poison damage instance **> 0 destroys its target regardless of HP**, unless the instance is negated by a shield. |
| **P2** | Divine shield | Absorbs **exactly one** damage instance — the first poison instance included — then is consumed; the unit survives that instance; the next lands. |
| **P3** | Reborn | Returns the unit **exactly once**, at **1 HP**, with `reborn` stripped. |
| **P4** | Avenge (everyN) | `afterFriendlyDeaths` fires at each **Nth** friendly death. |
| **P5** | Cleave | A cleaving attack damages the **defender AND both neighbours**. |
| **P6** | Token-death floor | **+`tokenDeathFloorAtk`** per friendly token death, **capped**. |
| **P7** | `multiplyStats` | Multiplies by the **capped** factor (≤ `multiplyFactorCap`); exponential reach is **compounding across applications**, never an uncapped single multiply; **clamped to the sanity bound**. |

## Exit bar — status ✅

- ✅ All meta-tests + both gates in the suite and passing — **130/130 vitest, deterministic ×2**.
- ✅ Sampler is broad/adversarial/**generated** (not hand-tuned) and reproducible; the floor is
  proven to bite (remove poison → the doubler is flagged a universal winner).
- ✅ No line wins across all sampled opposing tech (no universal winner; every board has a
  reachable counter); each scaling line is context-sensitive.
- ✅ No doubled/tall line is unkillable under reachable tech — the poison counter **connects at
  combat through realistic shield density** (doubler + up to 3 shields still dies to saturated
  poison).
- ✅ The Tusker engine is genuinely costly to assemble (weak early board, loses 100% early)
  rather than artificially capped; gem economy is deterministic; the seatbelt is never hit.
- ✅ Every coherence check passes on developed boards; the one flagged card (Grovelord) reworked.
- ✅ Sim + shared typecheck clean; **§16.7 macro gate CLEAR**, no new OP flag.

---

# (Historical) The Web — board-level anti-degeneracy framework (Prompt 1, fixture-based)

> Superseded by the rebuild above. Retained for the primitive specs / web reasoning trail.

**Goal:** strategic reading wins, not mechanical execution or stat-stacking. Encoded as
**five enforced meta-tests** on the Wildkin / Revenants / Reefkin slice, all fixed-seed and
byte-deterministic. This document is the readable trail: the locked primitive specs, the
web structure, and every card/config change with rationale.

## What was added

| File | Role |
|---|---|
| `sim/web.ts` | The **arena**: board fixtures (the web nodes) + pure, deterministic cross-table analysis (`runMatchup`, `crossTable`, `countersOf`, `universalWinners`, `beats`/`losesTo`). |
| `sim/audit.ts` | Static **catalog audits**: `linearStackingViolations` (anti-linear) + `multiplierCapViolations`/`configCapViolations`/`runtimeClampViolations` (caps). |
| `sim/web.test.ts` | The **five meta-tests** (20 assertions). Fixed-seed, deterministic. |
| `sim/web-report.ts` | Human-readable cross-table + floor + context-sensitivity trail. `pnpm sim:web` (`--seeds=N`). |
| `sim/web-probe.ts` | One board vs the whole web (`pnpm --filter @cardgame/sim web:probe <board>`). |

Run: `pnpm test` (all 74 unit tests incl. the 20 meta-tests), `pnpm sim:web` (inspect the web).

## The two layers (kept strictly distinct)

- **Layer 1 — mechanical primitives.** Deterministic, spec'd, identical every run. Tested
  directly against `resolveCombat`.
- **Layer 2 — board outcomes.** Who wins a full fight. **Explored, never pinned.** The only
  thing asserted is the **anti-degeneracy floor**: no line wins regardless of the opposing
  tech. The tests never assert "poison beats tall" as a law — only that *a counter exists*.

## The five test classes

1. **Primitive determinism** — locked Layer-1 specs (below), each asserted + shown to
   reproduce byte-for-byte.
2. **No context-free dominance** — over the full board set, **no universal winner** and
   **every board has ≥1 reachable counter**. (If any line beat every sampled tech → fail.)
3. **Context-sensitivity of scaling** — every scaling line **beats a low-tech baseline**
   *and* **loses to ≥1 tech board**. Winning regardless = fail.
4. **Anti-linear** — the catalog has **zero** unbounded per-unit/per-event stat stacking; a
   synthetic linear card is flagged (proves the scanner is not vacuous).
5. **Caps** — every multiplier aura is **non-compounding and ≤ its config cap**, config caps
   are finite/positive, and the **runtime clamps hold** even against adversarially
   over-stacked multipliers; a synthetic uncapped/compounding aura is flagged.

The tests assert Layer 1 + the Layer-2 floor only. Board matchups are explored (see
`pnpm sim:web`), never pinned as passing conditions.

## Locked primitive specs (Layer 1)

Deterministic; identical every run. Specs I chose and locked (`sim/web.test.ts` §1):

| ID | Primitive | Spec |
|---|---|---|
| **P0** | Determinism | Same `(boards, seed)` → byte-identical `CombatEvent[]`. |
| **P1** | Poison | Any poison damage instance **> 0 destroys its target regardless of HP**, unless the instance is negated by a shield. |
| **P2** | Divine shield | Absorbs **exactly one** damage instance — **the first poison instance included** — then is consumed; the unit **survives that instance**; the next instance lands. |
| **P3** | Reborn | Returns the unit **exactly once**, at **1 HP**, with `reborn` stripped. |
| **P4** | Avenge (`afterFriendlyDeaths`, everyN) | Fires at each **Nth** friendly death (N = `engines.wildkin.avengeDeathThreshold`). |
| **P5** | Cleave | A cleaving attack damages the **defender AND both neighbours**. |
| **P6** | Token-death floor | **+`tokenDeathFloorAtk`** per friendly **token** death, **capped** at `tokenDeathFloorCapAtk` total — a thin floor, never the spine. |

These match the engine (`shared/engine/combat.ts`) and config (`shared/config/combat.ts`,
`engines.ts`). `divineShieldNegatesPoison` and the exact-one-instance rule are load-bearing
for the web below.

## The web (Layer 2) — reachable boards spanning the field of pressures

Nodes are developed mid/late-game boards. **Shop-phase persistent buffs** (battlecry chains,
megabuffs, Mother Thorn's end-of-turn board buff) are baked into starting stats;
**combat-phase payoffs** (Mortarch, Pale Lich, avenge, Pearlguard, deathrattles, reborn,
token floor) fire **live** — exactly the engine's writeback split. Each fixture's `note`
records its provenance.

**Scaling lines:** `swarm-wide`, `deaths-resummon`, `deaths-palelich`, `battlecry-tall`,
`endure-shield`. **Tech counters:** `poison-wide`, `cleave-wide`, `shield-wall`,
`tall-bigstat`. **Baselines:** `vanilla-wide`, `vanilla-few`.

The web closes into a genuine cycle (every node has ≥1 reachable counter, no universal
winner), load-bearing on the primitives:

- **poison** ignores stat size → beats `tall-bigstat` and the deathball's fat, Mortarch-buffed survivors (`deaths-resummon`, `deaths-palelich`).
- **shield-wall** — divine shield **negates poison** (P2); a *wider* shield wall out-lasts poison → poison's counter.
- **cleave** splash strips shields + mows wide boards → beats `shield-wall`, `swarm-wide`, `endure-shield`.
- **deaths-resummon** feeds on aggression (every kill triggers a death payoff) → beats cleave/tall/swarm; its one reachable counter is **poison** (amp-agnostic).
- **tall** survives fragile wide boards but folds to poison; **swarm** goes wide but folds to cleave/poison/tall.

Notably robust: uncapping Pale Lich's damage amp (a stress test) does **not** create a
degeneracy — poison still counters it, because poison kills the revenants regardless of how
hard they hit. The counter is structural, not numeric.

## Card / config audit — findings & changes

The harness surfaced the same culprits the macro sim independently flags, and I fixed each
so every line stays beatable.

### Shipped-code change (exactly one)

- **Pearlguard payoff `+2/+3 → +1/+3`** (`shared/config/breakpoints.ts`).
  - **Finding:** Pearlguard's `onShieldBreak → whole-board +2/+3` fires on a **guaranteed**
    trigger (taunt + shield ⇒ its shield always breaks), snowballing a wide divine-shield
    board past every counter. The macro sim flagged Pearlguard as the **lone OP unit**; the
    web showed the `endure-shield` / `shield-wall` region as context-free dominant.
  - **Fix rationale:** the board-wide buff on a guaranteed trigger is the snowball engine.
    `+1/+3` keeps a real ENDURE payoff (reward for surviving the shield hit) while removing
    the snowball. It **removes Pearlguard's macro OP flag** (avgP → 2.72, in-band), keeps
    the macro gate CLEAR (single-axis margin 6.9pp < 8pp at 400 matches), and yields a
    healthier web (the shield tech gains 3 board-level counters instead of 1).

### Faithful test-fixture tuning (no gameplay change)

These were fixture-honesty corrections, not card nerfs — the earlier fixtures
mis-represented the regions:

- **`endure-shield` / `shield-wall`: base stats, not inflated stats.** ENDURE has no
  raw-stat engine; a shield's value is the absorption, not the body. Inflating shield bodies
  to 3/4–6/6 made them win post-shield trades and read as unbeatable. Faithful shield boards
  carry **low base stats + shields + the live Pearlguard buff**.
- **`poison-wide`: a *developed* tech, not 2/1 chaff.** Real poison survives to connect
  (Coral Warden / Reef Leviathan grant shields; a shielded attacker's *own* poison still
  lands). Tuned to **4 divine shields** — enough to poison-kill the deathball's fat pieces,
  while a *wider* `shield-wall` (7 shields > poison's attackers) still out-lasts it.
- **`shield-wall`: widened to 7** so it out-shields poison (the "shield negates poison"
  counter) yet folds to burst/cleave.

### Anti-linear audit (test 4)

**Zero violations** in the shipped catalog. The Round-6 redesign already routes all power
through breakpoints/one-shots: onSummon/endOfTurn buffs are breakpoint-gated (Mother Thorn),
avenge is a config breakpoint (Pack Mother) or a capped token floor (Gorehide/Thornbeast),
and all deathrattle/battlecry buffs are one-shots. The scanner (`linearStackingViolations`)
flags any repeatable-trigger stat buff lacking a gate or cap; a synthetic linear card
confirms it bites.

### Caps audit (test 5)

**Zero violations.** All three multipliers — Grovecaller (`endOfTurnTriggerMultiplier`),
Echo Choir (`battlecryTriggerMultiplier`), Pale Lich (`undeadDamageAmp`) — are
**non-stacking** and **≤ their config caps**, config caps are finite/positive, and the
runtime clamps hold even when four huge copies are stacked. A synthetic uncapped, compounding
aura confirms the scanner bites.

## Known macro watch items (non-gating; board-level counterable)

- **Pale Lich** carries a ~+20pp single-axis *watch* lead (mono-revenants is the strongest
  tribe). This is a **lobby** power signal, not a board-level degeneracy: `deaths-palelich`
  loses to poison at the board level (robust ≥ 30pp), and the amp is capped. Pre-existing and
  accepted by the §16.7 gate (aggregate margin passes).
- **Pack Mother** shows as the tier-relative OP flag at 400 matches (a **lateral** move — the
  baseline config flagged Pearlguard instead; the gate CLEARS either way). `swarm-wide` has
  three board-level counters (poison, cleave, tall), so it is not a degeneracy.

## Exit bar — status

- ✅ All five test classes pass on the slice with fixed seeds (74/74 unit tests green, twice).
- ✅ Primitive specs locked & documented (P0–P6).
- ✅ Card audit applied with this written trail; one shipped change (Pearlguard) + faithful
  fixtures.
- ✅ Nothing in the slice wins across all sampled opposing tech (no universal winner; every
  board has a reachable counter). Proven to bite: removing a counter fails tests (2) & (3).
- ✅ Existing suite green; typecheck clean; §16.7 macro gate CLEAR.

---

# Prompt-2 — content expansion (Infernals + Constructs) on top of the proven web

**Goal:** add new tribes/cards on the now-proven web, keeping the SAME suite green. The two
layers, the anti-degeneracy floor, and the locked primitives (P0–P6) all hold **unchanged** —
every new card respects them; nothing unconditionally correct ships. The web stayed OPEN: each
new line got a reachable counter that is itself beatable, and each went into the meta-tests.

## Two new tribes (clean-room originals; reference engines 10/12 & 24)

| Tribe | Axis (NEW) | Identity | Tensions against | New web edge |
|---|---|---|---|---|
| **Infernals** | `sacrifice` | Risk engine — spend your own bodies/HP at start of combat for a live burst; ends NARROW. | ENDURE (spend vs preserve), SWARM (eats tokens for height); bridges DEATHS as an aggressor. | **sacrifice-carry** (few big bodies) → answered by **poison** (ignores the swelled stat) and width. |
| **Constructs** | `assembly` | Graceful degradation — leave Scrap on death & reassemble; hard to fully clear. | ENDURE (Reefkin shields) & DEATHS (Revenants) for the durability/dying slots. | **construct-redeploy** (sticky wall) → answered by **cleave** (area splash out-clears the rebuild + strips its 2 shields). Poison ≈ even, so cleave — not poison — is the answer. |

Two axes added to the `Axis` union (`sacrifice`, `assembly`), wired through `AXIS_GLYPH`/
`AXIS_LABEL` (client) and `TRIBE_HOME_AXIS` (bot). No new keyword and **no new handler** — both
tribes are 100% declarative (start-of-combat + deathrattle + a keyword-grant trickle).

## New cards (13 catalog entries)

**Infernals (7):** `cinderling` (T1, self-damage→+atk), `gravebrand` (T2, DR board +atk — sacrifice
fuel + DEATHS bridge), `hollowpriest` (T2, sacrifice→+3/+3), `pyrewalker` (T3, 2nd sacrificer),
`bloodcaller` (T3 ⭐ deaths≥3 → self +5/+3), `dreadmaw` (T4, sacrifice + DR board +2/+2), `abysslord`
(T5 ⭐ deaths≥4 → self +8/+6 **and Cleave**).

**Constructs (6 + 2 tokens):** `scrapling` (T1 token 2/1), `sentinel` (T4 token 6/6 taunt — the
assembled guardian), `cogling` (T1, DR→Scrapling), `bulwark` (T2 taunt+DS, DR→Scrapling),
`reclaimer` (T3, DR→2 Scraplings), `shielddrone` (T3 DS, DR→hand a shield forward), `foundry`
(T4 ⭐ deaths≥4 → Sentinel), `titanforge` (T5 ⭐ allies≥5 → Sentinel).

## New breakpoints (config; reuse existing valid counters)

All four reuse the **combat** `deaths` counter or `alliesAtStart` — no new counter, so the
metrics exhaustive switches and the §16.7c lint stay intact:

| Card | Counter | Threshold | Payoff |
|---|---|---|---|
| `infernals_bloodcaller` | `deaths` | 3 (once) | self +5/+3 |
| `infernals_abysslord` | `deaths` | 4 (once) | self +8/+6 (+ Cleave, granted in-card) |
| `constructs_foundry` | `deaths` | 4 (once) | summon a Sentinel |
| `constructs_titanforge` | `alliesAtStart` | 5 (once) | summon a Sentinel |

## New relationships — each conditional, each counter beatable (test class 6)

The two new SCALING lines fold into tests (2) & (3) automatically (they're in `SCALING_LINES`/
`WEB`), so those already prove *each has a reachable counter and loses to some tech*. A new
describe block **(6)** pins the two structural edges the expansion introduced (both resolve at
~−100pp, robust not knife-edge):

- **sacrifice-carry beats low-tech, loses to poison** — a few-big-bodies glass cannon dies to a
  stat-agnostic chip. *(Rule: a scaling payoff ships only if a splashable counter is present —
  poison is.)*
- **construct-redeploy beats low-tech, loses to cleave** — area burst cracks the sticky rebuild
  and strips its shields; **cleave's reason-to-exist widens** from anti-swarm/anti-shield to
  anti-redeploy. *(Rule: a new counter must itself stay beatable — cleave still folds to poison
  and a lone tall body.)*
- And the invariant the prompt names — "adding a counter obligates leaving it beatable" — is
  re-asserted: every board these edges rely on (poison, cleave, and the two new lines) still has
  a reachable counter (no orphan introduced).

The full web closed with **no universal winner** and **every one of the 13 boards countered**
(see `pnpm sim:web`). sacrifice-carry is the strongest new line (beats 9/12) but has **two**
reachable counters (poison, cleave); construct-redeploy has two (cleave, sacrifice-carry).

## Edits to existing content (logged — with the rule each serves)

- **`engines.infernals.selfDamageBuffAtk` 2 → 3** — so Cinderling's "take 1 → +N attack" is a
  worthwhile risk. *(Serves: risk economy must pay, or the axis is a trap — §16.7a.)* This is
  the only gameplay-number change; **no existing card's behavior was altered** (the expansion is
  purely additive on the catalog side).
- **Macro harness (sim-only, not gameplay):** `SEAT_STYLES` expanded from a 3-tribe (3 mono / 4
  splash / 1 dup) mix to a **5-tribe** mix (5 mono incl. Infernals/Constructs + 3 splash incl. an
  `infernals+constructs` cross-splash), the tribe-viability list now lists all five, and the
  default `--matches` **400 → 800**. *(Serves: with 5 tribes each axis is a smaller slice of a
  bigger pool, so the rarely-developed SWARM axis — Mother Thorn `tokensThisTurn≥2` reaches ~2% —
  needs more matches for the non-linearity (d) metric to clear its ≥3-samples-per-bucket floor;
  400 is sample-starved on swarm now, ≥700 is stable. This is a sample artifact, not a balance
  regression: every new-tribe breakpoint reaches 99–100%.)*

## Anti-linear & caps (tests 4 & 5) — still clean, auto-covered

The scanners run over the whole catalog, so the 13 new cards are covered with no test edits.
**Zero violations:** every new stat payoff is either a one-shot trigger (startOfCombat /
deathrattle — not repeatable) or a config **breakpoint** (bloodcaller/abysslord). No new auras/
multipliers, so caps are untouched.

## Lobby-level validation (§16.7 macro, 800 matches, 5-tribe mix) — GATE CLEAR

- **All four gate metrics PASS** (single-axis margin, splash reachability, breakpoint lint,
  non-linearity).
- **New tribes land in a healthy band:** Infernals avg placement **4.44** (≈ neutral 4.5),
  Constructs **3.56** (≈ Reefkin 3.60). Neither degenerate nor dead.
- **No new-tribe card flags OP** — the only OP flags are the pre-existing **Pearlguard** &
  **Pack Mother** (unchanged from Prompt 1, board-level counterable). New breakpoints reach
  99–100%; the `infernals+constructs` splash hits reachability (68% ≥ 50% target).

## Prompt-2 exit bar — status

- ✅ Full counter-web suite passes on the expanded pool — **79/79** vitest (was 74; +2 scaling
  lines fold into test 3, +3 new-relationship assertions in test 6), run deterministically twice.
- ✅ No new card or line wins regardless of lobby tech — board-level (web floor: every new line
  countered) **and** lobby-level (macro: no new-tribe OP).
- ✅ Every new relationship is conditional and tested (folded into 2 & 3; pinned in 6).
- ✅ Changelog written (this section); primitives P0–P6 and the two layers unchanged.
- ✅ Typecheck clean ×4 workspaces; §16.7 macro gate CLEAR (5-tribe, 800 matches).

---

# Round-6 replayability expansion — four tribes, an exponential engine, richer web

**Goal (this pass):** keep the framing of Prompts 1 & 2 exactly — the two layers, the
anti-degeneracy floor, the locked primitives, capped multipliers, breakpoints-not-linear,
clean-room names — while **adding depth for replayability**: the pool goes from 5 tribes to
all **nine**, each new tribe carries a distinct **keyword strength**, the game can now scale
to **thousands of stats**, and some scaling is **exponential**. Nothing unconditionally
correct ships: every new line has a reachable counter, and the exponential is kept honest by
poison. The suite grew from 89 → **97** vitest and stays green (run deterministically twice);
typecheck clean ×4; the §16.7 macro gate **CLEAR** at 400 matches on a 9-tribe pool.

## The headline — an EXPONENTIAL engine that reaches thousands of stats (Tuskers)

The user ask was "scale to thousands of stats, exponential in some cases." The framework's
answer is a new **capped-but-COMPOUNDING** mechanic, not an uncapped multiplier:

- **New action `multiplyStats { factor }`** (`shared/types`, applied in both `engine/combat.ts`
  and `engine/shop.ts`). It multiplies a target's *current* atk/hp by `factor`, **clamped to
  `engines.tuskers.multiplyFactorCap` (= 2)**. Per-application it is capped; the **exponential
  reach comes from applying it across TURNS** — the shop-fired copy writes to the persistent
  instance, so it **compounds**. A committed Tusker doubler goes 6 → 12 → 24 → … → **12,288 /
  16,384 by turn 12** (verified end-to-end through the real `endOfTurnPhase` shop path).
- **Why this is inside the rules, not a violation of them:** (a) it is **breakpoint-gated** —
  the doubler only fires when you generated `gemsThisTurn ≥ gemDumpThreshold` (a manufactured
  event, exactly like SWARM/DEATHS), never passively; (b) the **per-application factor is a
  capped config knob** (≤ 2), the same discipline as Grovecaller/Echo Choir/Pale Lich; (c) it
  has a **reachable counter that no amount of stats escapes** — poison (P1) kills the swelled
  carry regardless of its size, and a lone huge body is out-actioned by width.
- **New breakpoint counter `gemsThisTurn`** (already tracked on `PlayerState`) wired through
  `PeakCounters`/`peakFor`/`VALID_COUNTERS`/`breakpointAxis` and the macro capture — so the
  doubler participates in the reachability/lint metrics like every other breakpoint.

## Four new tribes — each a distinct keyword strength, each with a reachable counter

| Tribe | Axis (NEW) | Keyword strength | Web line | Reachable counter (tech) |
|---|---|---|---|---|
| **Tuskers** | `spoils` | tall/**exponential** (taunt) | `tusk-exponential` | **poison** (ignores stat size) |
| **Primordials** | `elements` | **cleave** (wide splash) | `primordial-cleave` | **tall-titan** (one-shots glass cleavers, wastes their splash) |
| **Sirens** | `spellcraft` | **poison** (2nd home) + start-of-combat burst | `siren-poison` | **shield-wall** (P2 blanks the poison) |
| **Corsairs** | `tempo` | **reborn** + divine shield (sticky width) | `corsair-aggro` | **tall-titan** (out-sizes the reborn width) |

Four axes added to the `Axis` union (`spoils`/`elements`/`spellcraft`/`tempo`), wired through
`AXIS_GLYPH`/`AXIS_LABEL` (client) and `TRIBE_HOME_AXIS` (bot). Keyword strengths are spread so
poison, cleave, divine shield and reborn each now have **multiple tribe homes** — which enriches
the web (more reachable counter boards). **No new keyword and no new handler** — all 33 new cards
are declarative (start-of-combat / battlecry / deathrattle + the gated `multiplyStats`).

**33 new cards** across tiers 1–6 (8–9 per tribe). Catalog: 44 → **77 purchasable** (83 incl.
tokens). Tier distribution is a proper auto-battler pyramid — T1 12, T2 17, **T3 20** (peak),
T4 12, T5 9, T6 7 — each tribe 1–2 per tier, capstones rare.

## A new tech archetype — `tall-titan` — and why the web needed it

The two wide-aggressive lines (all-cleave, reborn-width) genuinely beat the original four
tech boards: cleave splash kills poison's neighbours for free, and reborn defeats poison's
one-shot. Rather than force-tune them into fragility, the honest counter to **overwhelming
width** is **overwhelming per-body stats** — a few gigantic taunt bodies that one-shot any
single attacker regardless of the enemy's count and soak the wide chip. So `tall-titan` joins
`TECH_BOARDS`. Critically it is **itself beatable** — like every stat line it folds to poison
(P1), so no orphan is introduced. This is exactly the prompt's rule: *inventing a counter
obligates leaving that counter beatable.* The web closes into a genuine cycle:

`corsair-aggro / primordial-cleave → tall-titan → poison → (shield-wall, corsair-aggro) → …`

The full cross-table (`pnpm sim:web`) closes with **no universal winner** and **every one of
the 17 boards countered**.

## New meta-test coverage (kept strictly in the two-layer discipline)

- **Primitive P7 (Layer 1, locked):** `multiplyStats` multiplies by the **capped** factor; a
  requested ×99 clamps to the cap, and three compounding applications give ×cap³ — byte-identical
  on re-run. The exponential lever is now a locked primitive.
- **Caps (test 5):** the scanner extends to `multiplyStats` actions (factor ≤ `multiplyFactorCap`,
  cap finite & positive) and a synthetic ×99 doubler proves it bites.
- **Anti-linear (test 4):** an **ungated repeatable** `multiplyStats` is the exponential redline —
  a synthetic ungated doubler is flagged; every shipped doubler is breakpoint-gated, so the
  catalog stays clean.
- **New relationship block (7):** pins the four structural edges above (each new line beats
  low-tech AND loses to its designated tech) plus the invariant that `tall-titan` stays beatable.
  Board matchups remain **explored, not pinned** — the block asserts Layer-1 primitives and the
  Layer-2 floor only, never "X beats Y" as a law.

## Content / config changes (logged — with the rule each serves)

- **`multiplyFactorCap = 2`, `doublerFactor = 2`, `gemDumpThreshold = 3`** (new Tusker knobs) —
  the exponential is a capped, gated commitment. *(Serves: multipliers stay capped config knobs;
  power comes through a breakpoint engine — §16.1/§16.2.)*
- **`corsairs_reaver` breakpoint 4→5 threshold, +2→+1 atk** and **`primordials_thunderhead`
  battlecry +2/+1 → +1/+1** — both surfaced as tier-relative **OP** flags at 400 matches; the
  nerfs remove both flags. *(Serves: a payoff must be a real commitment, not trivially-on — §16.7a.)*
- **Macro harness (sim-only):** `SEAT_STYLES` rotated to a 9-tribe mix whose **mono cohort
  stresses the Tusker exponential alongside the poison tribes** (Reefkin/Sirens) that answer it,
  so the single-axis margin measures the exponential against its lobby counter; tribe-viability
  list extended to all nine. *(Serves: the margin metric must actually see the strongest new axis
  contested.)*

## Lobby-level validation (§16.7 macro, 400 matches, 9-tribe pool) — GATE CLEAR

- **All four gate metrics PASS** — single-axis margin **−3.4pp** (mono does NOT out-win multi;
  limit 8pp), splash reachability **64.8%** (≥ 50%), breakpoint lint, non-linearity.
- **New tribes land in a healthy band:** Tuskers **4.56**, Primordials **3.90**, Sirens **4.61**,
  Corsairs **4.08** (neutral = 4.5) — none degenerate, none dead.
- **No new-tribe OP flag** after the two nerfs; the only OP flags remain the pre-existing,
  board-counterable **Pearlguard** & **Pack Mother** (accepted since Prompt 1). The exponential
  Tusker doubler is a *watch* region (mono-Tuskers 4.56 ≈ neutral) — its board-level poison
  counter is robust and the amp is capped, so it is a lobby signal, not a degeneracy.

## Round-6 exit bar — status

- ✅ Framing of Prompts 1 & 2 preserved — two layers, anti-degeneracy floor, capped multipliers,
  breakpoints-not-linear, clean-room names all unchanged; primitives P0–P6 untouched, P7 added.
- ✅ **Thousands of stats, exponential** — the Tusker doubler compounds ×2/turn to tens of
  thousands, verified end-to-end, and stays beatable (poison ignores size).
- ✅ Nine tribes, distinct keyword strengths, sensible tier pyramid; 33 new cards, no new
  handler.
- ✅ Nothing wins regardless of lobby tech — board-level (web floor: all 17 boards countered,
  no universal winner) **and** lobby-level (macro: no new-tribe OP, all tribes in-band).
- ✅ **97/97** vitest green (twice), typecheck clean ×4, §16.7 macro gate CLEAR.
