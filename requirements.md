# Auto-Battler — Requirements & Design Decisions (living doc)

> Working notes captured during the `/grill-me` design interview. This is the
> decisions log + open-questions tracker. The full spec document will be written
> from these once the tree is fully resolved.

Source of truth for mechanics: `season10_interaction_reference.xlsx`
(9 tribes / 26 tribe engines, 7 cross-tribe systems). Clean-room rule applies:
build from functional mechanics only; original names/text/art throughout.

---

## Locked decisions

### Combat & engine core (Round 1)
1. **Effect data model — Hybrid (declarative data + handler escape-hatch).**
   Most units are pure config `{trigger, condition, target, action}` covering ~90%
   of effects (stat buffs, summon, grant-keyword, make-gem/spell). A registered
   handler-id with params covers the rare ~10% of bespoke behaviors. Number tuning
   never requires code changes.
2. **Targeting — Seeded-random enemy + a `Taunt` keyword override.** Attacker hits a
   random living enemy; `Taunt` units must be targeted first. RNG is seeded
   per-combat server-side → fully reproducible for replay/sim. Balance via Monte-Carlo
   over many seeds.
3. **Attack order — Alternating, side with more minions attacks first**, ties broken
   by seed. Rewards going wide.
4. **Loss damage — `playerTier + Σ(surviving enemy minions' tiers)`, capped.** All
   numbers in config. Scales as the game escalates.

> Keyword set now includes at least: poison, divine shield, reborn, cleave,
> magnetic, **taunt** (added by decision #2).

### Scope & identity (Round 2)
5. **Vertical-slice systems** — tier-up economy + auto-combat (always) **+ freeze +
   triple/upgrade**. Deferred past slice: hero powers, trinkets, tavern spells.
6. **Slice breadth — 3 tribes / ~5–6 engines**: Wildkin (Beasts), Revenants (Undead),
   Reefkin (Murlocs). Engines: token-gen+amplifier & cleave (Wildkin); reborn &
   tribe damage-aura (Revenants); battlecry stat-chain & poison+divine-shield (Reefkin).
   Proves summon, end-of-turn, deathrattle, battlecry, passive auras, keyword grants,
   and a go-wide / go-tall / poison RPS.
7. **Clean-room identity — rename all 9 tribes** under a **"mythic menagerie"** theme.

### Economy & match (Round 3)
8. **Tier-up pricing — escalating base cost with a per-turn discount** when you don't
   tier up (BG-style). Numbers in config.
9. **Starting hero health 30** (brisk, ~10–14 rounds); config value. Loss damage per
   decision 4.
10. **Pairing — random each round, avoid immediate rematch; ghosts** (snapshot of a
    recently-eliminated player's final board) fill odd live counts. Elimination at 0 HP;
    placement assigned 8th→1st as players die; match ends at 1 survivor.
11. **Triple — merge 3 copies → golden** (double stats; effects may scale) **+ a Discover
    reward** (pick 1 of 3 units from one tier above current shop). Discover is a reusable
    server action.

### Architecture (Round 4)
12. **Networking — Colyseus.** Authoritative rooms; `@colyseus/schema` delta sync; room
    IDs double as join codes; built-in reconnection tokens; matchmaking hooks.
13. **State privacy — two-channel.** Public room schema (every player's HP, tier,
    alive/placement, current pairings) synced to all; private per-player state (shop,
    hand, board, gold, current combat log) pushed only to that client. No opponent
    private info ever leaves the server.
14. **Combat visualization — server event-log replay.** Server resolves the whole fight
    and emits an ordered event list (attack, damage, death, summon, keyword-trigger,
    buff). Client animates the log with placeholder shapes; the same log powers simulator
    readouts and debug replays.
15. **Simulator — micro + macro.** (a) Micro: two fixed boards × N seeded fights →
    win/tie/loss%. (b) Macro: 8 bots play full headless matches → placement, pick rate,
    win rate by unit/build/tribe, outlier flags. Build micro first; macro reuses bot AI.
16. **Turn timer (defaulted) — scaling + ready-up.** Shop timer = base + small per-tier
    increase (capped); any player may ready-up to end the phase early; combat auto-plays
    from the event log. base / per-tier / cap in config. *(Veto for fixed-length turns.)*

### Pool, bots, infra (Round 5)
17. **Unit pool — shared finite.** All players draw from one pool; copies per unit scale
    down by tier; sold units return. Counts in config. Tokens & golden copies don't draw
    from / return to the pool. Self-balancing scarcity + a contesting layer.
18. **Bot AI — heuristic, tunable, tribe-aware.** Scored buy/sell/roll/tier (board power +
    curve + tribe synergy); positions by keyword rules (taunt front, fragile carry
    protected); commits to its rolled tribe; difficulty knobs (greed, reroll aggression).
    Same bot powers the macro-simulator.
19. **Disconnect — grace window then bot takeover.** Board persists and keeps fighting;
    reconnection token allows rejoin within a grace window; a bot assumes the seat if the
    player doesn't return, so the match never stalls.
20. **Project structure — monorepo workspaces.** `/shared` (types + data/config + combat
    engine), `/server` (Colyseus), `/client` (React+Vite), `/sim` (headless; imports the
    SAME engine + bots). Single source of truth for cards/units/keywords/config.

### Game-feel & content depth (Round 6) — post-v1, drives `design-spec.md` §16
> Triggered after a first playable implementation read as "an engine, not a game":
> plain UI, illegible combat, one-dimensional cards. These decisions retarget the
> client and content **without touching the four engine invariants** (server-authority,
> seeded determinism, two-channel privacy, config-driven balance).

21. **Center of gravity — game-feel is a first-class goal alongside the engine.** Amends
    pillar #4: **original *iconographic* art** (tribe crests, keyword + axis icons, card
    frames, motion) — **not** produced per-card illustration. Clean-room §0 still binds
    (no existing-game names/art/branding). Engine invariants unchanged.
22. **Payoff law — breakpoints over linear stacking.** Primary build-around payoffs fire
    at **thresholds on manufactured events** (deaths, tokens summoned, battlecries cast,
    hits survived) — **never "N of tribe X on board."** Linear per-unit primary scaling is
    **banned** (it collapses the optimal line to "buy more of the same," the exact
    mono-tribe gradient this game avoids). A thin continuous *floor* is allowed but must
    never be the dominant scaling. Rare high-tier capstones for run variety. Four
    **competing axes** — **SWARM, DEATHS, BATTLECRIES, ENDURE** — each cross-tribe
    reachable, fighting for the same 7 board slots (e.g. DEATHS wants fragile dying bodies;
    ENDURE/SWARM-survive want durable living ones — you can't max both).
23. **Cross-tribe synergy — bridge cards** (not neutral connectors, not shared mechanics).
    Each tribe stays a coherent archetype; a few **bridge** cards belong to one tribe but
    trigger on a *second* tribe's events, enabling 2-tribe splashes without mushing
    identity. All three pairings covered.
24. **Slice stays 3 tribes, deepened.** No new tribes. Pool grows modestly **24 → ~34**.
    **No new keywords**; depth comes from effects/conditions/auras (data) + minimal engine
    plumbing (event counters + trigger/condition wiring — no new keyword timing).
25. **Multiplier containment (gate on this before content ships).** The three existing
    multipliers each get a **config cap**: Grovecaller (`endOfTurnTriggerMultiplier`),
    Echo Choir (`battlecryTriggerMultiplier`), Pale Lich (`undeadDamageAmp`). **Pale Lich
    converts to a DEATHS breakpoint** ("at 3+ Revenant deaths this combat, Revenants deal
    2× — capped"). **Echo Choir's doubled battlecry triggers must count toward battlecry
    breakpoints** — that second-order interaction must be *visible to the sim*.
    Grovecaller + Grovelord (6 tokens/turn) is the **#1 single-axis margin target**.
26. **Combat readability — animated single battle line, highlights only.** One clean
    left→right line per side (**no wrap**; leftmost = next-to-act and first-targeted),
    **Framer Motion** beat-based replay (lunge / damage tick / death-shatter / summon
    slide). **Brief highlights only — no effect labels** (players know their own cards).
    Engine stays single-line; this is a client-only change.
    - **Amendment (legibility rework).** Playtesting found the highlights-only replay
      illegible: you couldn't tell who hit whom, what got buffed or by what, or permanent
      vs temporary, and it ran too fast with no sense of cause→effect. The replay was
      re-architected (see design-spec §16.6) into **causal beats**: attacker↔defender
      pairing (tracer + reticle + *dim the rest — later reversed, see #31*), buff `source` + `permanent/temporary`
      surfaced (gold/🔒 vs blue/⏳), **impact-weighted pacing** with manual step/scrub +
      speed, and cause→effect ordering. This **reverses #26's "no effect labels"** for the
      source/permanence cues specifically (still clean-room). Required one **additive**
      engine change — `stats` events now carry `sourceId` + `permanent` (`combatBeats.ts`
      holds the render-free, unit-tested segmentation). *Known gap surfaced:* combat is a
      pure function, so `permanent` is intent only — buffs aren't yet written back to the
      board across combats (`match.ts`); flagged, not fixed. **(Gap closed 2026-07-01 by
      decision #38: `stats.permanent` is now live — combat-fired permanent buffs fold back
      onto surviving persistent units after combat, spec §7.5.)**
27. **Counters — contextual only.** A manufactured-event counter (deaths / tokens /
    battlecries) is shown **only when you own a card that consumes it**; hidden otherwise.
    No always-on synergy panel.
28. **Shop — full drag-and-drop.** Drag shop→board (buy+place), board→sell zone, reorder,
    board↔bench; buttons remain as fallback; existing intents unchanged. The per-card
    **axis glyph is static/categorical only** — it marks which axis a card *feeds*
    (sortable, like the tribe crest) and must **never** become board-aware/reactive (that
    would re-introduce the synergy-panel hand-holding we cut).
29. **Sim adds a reachability metric.** The single-axis margin check catches "one axis too
    strong." It is blind to the opposite failure — breakpoints tuned so high that
    splashing is never worth it and everyone mono-stacks anyway. Add a metric confirming a
    **2-tribe splash can realistically hit two breakpoints**. **Both** failure modes in the
    report, plus a breakpoint lint (every primary payoff expressible as a config
    breakpoint) and a non-linear commitment-curve check.
30. **Per-card procedural portraits — reverses #21's "iconographic only, no per-card art."**
    (2026-06-30.) Each card now shows a **tribe-themed procedural SVG avatar** on its face: one
    per-tribe "face system" (Wildkin critter / Revenant skull-and-wisp / Reefkin fish) plus a
    **unique per-card recipe** (ears/horns/fins, eyes, mouth, top decor, signature accessory)
    so a card reads as *its tribe* at a glance yet stays individually distinct — the legibility
    win #21 wanted, but it turned out per-card *art* (not just icons) is what makes a board read
    as a menagerie rather than a spreadsheet. **Clean-room §0 is satisfied by construction:**
    every avatar is original geometry composed at runtime — no card/hero name, art, flavor, or
    branding from any existing game, and bridge cards only carry a faint colour *tint* of the
    tribe they reach into. **Scope is client-only** (`client/src/cardArt.ts` — a pure
    string→SVG generator; no IO, no state, no new asset files): the four engine invariants are
    untouched. On the card the portrait replaces the old tier *stripe*; the tier badge and the
    (still icon-only) keyword chips now **overlay** the art, and the face is framed `meet`
    (contain) so no top-of-head signature is cropped. The earlier icon-only/"text-first" card
    face (§16.6) is **superseded** for the face specifically; the hover tooltip (full ability
    text, base-vs-buffed stats) is unchanged. Tokens get their own (plainer) recipes; any
    non-catalog combat summon falls back to a generic tribe face. Deferred tribes reuse the
    generic-blob fallback until they get bespoke recipes.

### Replay legibility & pacing (Round 7) — post-playtest fixes, client + phase-window only
> Playtesting (Playwright-driven, with live per-frame DOM measurement) surfaced two concrete
> defects in the causal-beat replay from #26/#16.6. Both fixes touch only presentation (client
> render) and the server's non-gameplay *phase timing* — **the four engine invariants are
> untouched** (combat is still the same pure `resolveCombat`; same `CombatEvent[]`).

31. **Replay never grays a card — present or gone (reverses #26's "dim the rest"). (2026-07-01.)**
    The spotlight approach dimmed every non-participant (~80–90% of the board) each beat, and
    kept **dead units on the board as grayed corpses** — measured live at `opacity 0.32–0.48`,
    `grayscale(0.7)`. Verdict: a card is only ever **fully present (opacity 1, full color)** or
    **removed the instant it dies** — no dimmed/grayed in-between, ever. Legibility now comes from
    **positive cues only**: attacker/target/source glow, tracer line, damage/buff floats, and a
    brief green death cue on the exact beat a unit falls (then it's gone). Client-only
    (`CombatReplay.tsx` + `styles.css`).
32. **Combat phase window is sized to the fight, never a fixed hold. (2026-07-01.)** The server
    formerly held `combat` for a fixed **6.5 s**, which truncated any real fight: a 4v4 replay
    (~18 s) showed ~21% of its beats and a 7v7 (~29 s) ~12% before snapping to the next shop
    mid-death. The server now holds for **`combatWindowMs(logs)`** — the longest natural replay
    across the round's *watched* fights (bots don't watch), padded and clamped to
    `[REPLAY_WINDOW_MIN_MS, REPLAY_WINDOW_CAP_MS]` — so the replay always plays through to the
    result banner. A fight exceeding the cap is **compressed client-side** (dwell auto-scaled) to
    finish inside the window. This required moving the render-free beat/pacing logic from the
    client into the **pure shared engine** (`shared/engine/combatReplay.ts`) so client dwell and
    server window are computed from one source; pinned by `combatReplay.test.ts`. Replay pacing
    constants are **presentation, not balance** (they may live beside the logic, single-sourced).

### Combat feel & choreography (Round 8) — post-playtest, presentation/sequencing/timing only
> A second game-feel pass. Combat was *logically* correct but *read* as simultaneous: beats
> overlapped, the initiator was unclear, deaths snapped, buffs happened silently, and "deathrattle"
> mislabelled cards that have none. Root cause: presentation was coupled to the simulation (many
> things on one frame). Fix = choreograph discrete, non-overlapping beats. **The pure `resolveCombat`
> and its `CombatEvent[]` are untouched — the four engine invariants hold.** Audited with Playwright
> (video + timestamped `[beat]` console logs, before/after) via the `#replay-lab` workbench.

33. **Asymmetric strike telegraph — a TARGETED, TRANSIENT dim (revises #31). (2026-07-01.)** #31
    removed dimming because the old spotlight dimmed ~80–90% of the board **every** beat and left
    **grayed corpses** — an ambient, always-on gray-out that hurt legibility. This restores dimming
    but narrowly: only during a **strike** beat, only **non-participants** (never the attacker /
    target / cleave-splash), at `opacity ~0.42`, and it **fades back** the instant the strike ends.
    The attacker also glows, scales ~1.05, and **lunges** to the defender; the defender **only
    reacts** (knockback away + shake) and never lunges. That asymmetry is the clearest "who started
    it" signal — the direct fix for the playtest complaint that the initiator was unreadable. Cards
    are still full-present/full-colour except during the swing they are party to. Client-only.
34. **Choreographed death cadence — 0-HP hold → crumble → removal → deathrattle as its own beat
    (revises #31's "removed the instant it dies"). (2026-07-01.)** A death now plays as a brief,
    discrete sequence: damage pops → the **health bar drains** → the card **holds at 0 HP** (~200 ms)
    → **crumbles** (~380 ms, shrink + tip + desaturate) → is removed and the row reflows → and **only
    then** does its deathrattle play, as a **separate beat**. The "in-between" #31 forbade was a
    *persistent grayed corpse*; this is a sub-second animated crumble, not a lingering state. The
    pure beat engine now segments `death` and (real) `deathrattle` into distinct beats; a deathrattle
    never fires during the death animation or the next strike. Beat-layer + client only.
35. **Content-aware deathrattle labelling. (2026-07-01.)** `resolveCombat` emits a `deathrattle`
    **marker event for every death** (a per-death marker, *not* proof of a deathrattle); the old
    caption trusted it and printed "X's deathrattle" for cards with none (measured live:
    Thornbeast / Pale Lich / Pearlguard / Gorehide …). The **pure beat layer** now consults the card
    catalog (`UNIT_BY_ID`, resolving summoned-token cardIds from their owner best-effort) and gives
    a labelled beat **only to a real deathrattle**; a marker for a non-deathrattle unit is absorbed
    silently. **No engine/event change** — the resolver's output is byte-identical; only the
    (pure, tested) labelling moved. Pinned by `combatBeats.test.ts`.
36. **rAF beat clock, one TIMING config, health bars + ticking stats + gold buffs, Skip dismisses.
    (2026-07-01.)** The presenter advances on a single **frame-rate-independent rAF clock**
    (`useBeatClock`, not a drifting `setTimeout`), one beat at a time, only after the beat's dwell.
    All sub-beat feel-timing lives in **one `TIMING` config** with a global **`combatSpeed`** — the
    shared `COMBAT_SPEED`, so the server window stays in lockstep and can't desync. Combat cards gain
    a **tweened health bar** and **ticking stat numbers**; buffs read **gold** (flash + counting
    number), slotted as their own beat. Floating text shares **one non-overlapping anchored stack**
    (red damage / gold buff / green keyword). **Skip now dismisses the whole combat overlay** (the
    frozen shop shows behind) instead of jumping to the last beat and still waiting on the phase
    timer. Client + beat-layer only.
37. **Skip reveals an HONEST frozen shop — inert + "next shop" countdown (refines #36, #32).
    (2026-07-01.)** #36 let Skip reveal the frozen shop behind the replay, but that shop looked
    live while the server still held the combat window (#32): clicking a card sent a `buy` that
    bounced with `not shop phase`, so a player who skipped "couldn't buy anything for a few seconds"
    with no explanation. Fix, two parts: (a) the client **gates every shop intent on the real public
    `phase`** (buy/sell/roll/tier/drag/drop are no-ops unless `phase==='shop'`) and dims the frozen
    zones so they read as not-yet-live; (b) the server **publishes the combat-hold remaining seconds
    in the public `timer`** (formerly hard-zeroed during `combat`; `MatchRoom` keeps its tick running
    through the hold), and the frozen shop surfaces it as a **"next shop in Ns"** banner. `timer` now
    uniformly means "seconds left in the current timed phase." The scheduled `beginShop` still owns
    the transition; a lone skipper still waits out the shared window (sized to the longest *watched*
    fight, #32) — this makes the wait **legible**, not shorter. Server + client only; no engine change.

### Multi-lane scaling rework (Round 9) — engine writeback
> Phase 1 of the multi-lane scaling rework: before new persistent scalers can ship, the
> engine needs a REAL permanence mechanic. This closes design-spec §7.6 item 5 / §15 risk
> #3 (the "writeback gap" flagged in #26's amendment) without breaking combat purity.

38. **Combat-fired permanent buffs write back to the persistent board — combat stays pure.
    (2026-07-01.)** Closes the writeback gap (§7.6 #5; amends #26's "flagged, not fixed").
    Mechanism: `resolveCombat` is unchanged as a pure `(boards, seed) → CombatEvent[]`
    function — it only **emits**. A combat-fired `buffStats` with `permanent:true` emits
    `permanent:true` plus **additive** delta fields `dAtk`/`dHp` on the `stats` event (the
    event's `atk`/`hp` are post-buff absolutes that mix in combat damage and combat-only
    buffs, so a delta is the only foldable representation); `combatEnd` gains additive
    `survivorsA`/`survivorsB` (per-side living uids — needed because `survivors` is
    winner-only and a step-cap tie leaves both sides alive). After combat,
    `Match.resolveCombatPhase` runs the deterministic fold `foldPermanentBuffs`
    (`shared/engine/combatWriteback.ts`) per live side. **Rules:** (a) buffs apply to
    **survivors only** — the dead accrue nothing; (b) a **Reborn resurrection counts as
    surviving** — the reborn unit keeps its persistent uid and appears in the survivor
    list; the in-combat reborn stat reset is not a buff and never folds; (c) **ghost
    boards do not accrue** — the fold is never run for a dead player's snapshot side;
    (d) a permanent buff targeting a **combat-summoned token** (per-fight `sum#N` uid) is
    a **defined, logged no-op** — a session-log line, never a crash or a new CombatEvent;
    (e) the **persistent `UnitInstance.uid` is the writeback key** — audit finding: it
    already flows through `CombatUnit.uid` unchanged, so the originally-planned extra id
    plumbing is unnecessary; (f) in combat only `buffStats` honors `permanent`
    (set/multiply/reset stay this-combat-only) and **keyword permanence stays reserved**
    (stats only in this phase); (g) the fold reads the log, never rewrites it; (h) **deltas
    fold under the §6.8 stat clamps** — each `dAtk`/`dHp` replays through the same
    `applyBuff` clamps combat's `buffStats` uses (atk floored at 0, hp at 1, rounded), so a
    permanent DEBUFF emitted against in-combat stats riding combat-only buffs can never
    write `atk<0`/`hp<1` onto the persistent board (a raw `+=` fold would). **Content
    audit in the same change:** every combat-fired `buffStats` on shipped cards was given
    an explicit `permanent:false` (Gorehide/Thornbeast read it from
    `engines.wildkin.tokenBuffPermanent`, making that knob real), with **one deliberate
    shop-gated exemption**: `wildkin_motherthorn` keeps `permanent:true` on its `onSummon`
    buff — `onSummon` also fires in combat, but the effect's `tokensSummonedThisTurnAtLeast`
    condition is shop-scoped (the counter reads 0 in combat) so it can never fire there;
    the EV-WBK-08 lint encodes exactly this exemption, not a blanket "permanent:false
    everywhere" — **no existing card was silently upgraded to persistent**; shop-phase
    permanents (Chorus Tide, Quartermaster, …) already mutate the instance directly, emit
    no combat events, and cannot double-apply. Pinned by `EV-WBK-01..09` (clamps:
    EV-WBK-09) + golden `EV-GLD-09`; this knowingly rewrites the old `EV-ACT-BUFF` pin
    "combat-fired stat changes are never written back."

### Multi-lane scaling rework (Round 9, cont.) — spendable gems & the purchased doubler
> Phase 2 of the rework: the Tusker lane's scaling becomes a stream of PURCHASED decisions
> instead of an autopilot end-of-turn engine, and gems become a real second currency with
> real sinks. Engine invariants untouched (server-authoritative intents, seeded RNG,
> two-channel privacy, config-driven numbers).

39. **Gems are a SPENDABLE wallet; the Tusker doublers are PURCHASED activated abilities;
    three gem sinks ship. (2026-07-01 — SUPERSEDES D10.)** D10 ruled the persistent `gems`
    total cosmetic; that ruling is retired. **Wallet:** `gems` is a private, persistent,
    **uncapped** currency (hoarding is watched by a sim **diagnostic** — distribution of
    unspent wallet at game end — never an engine cap); `gemsThisTurn` stays as the derived
    per-turn counter (0 card consumers today; the condition stays live engine vocabulary).
    **Activated abilities (spec §6.6a):** a new declarative `activated` field on `UnitCard`
    (`{cost, target, actions, prompt?}`), resolved by ONE new shop-reducer op
    `activateAbility` behind a new `{type:'activate', unitUid}` intent (both ADDITIVE
    extensions of the §9.7 pinned contracts). Server-validated: shop phase, owned + on
    board, has an ability, once per turn per minion (reset each shop turn), wallet ≥ cost;
    a `chosenAlly` ability must have a legal target BEFORE the spend (rejected, never
    fizzled — an activation is a purchase; contrast D5). `chosenAlly` reuses the
    pendingTarget machinery. **Doubler rework:** Ivorytusk/Ivorylord/Gemtitan lose their
    `endOfTurn gemsThisTurn≥3` auto-double rows (and their breakpoint rows); instead the
    owner buys each ×2 (`multiplyStats`, still capped by `multiplyFactorCap` +
    `statSanityBound`) at `doubleBaseCost(4) + doubleCostStep(2) × doublesPurchased`, where
    `doublesPurchased` is per-player per-GAME and SHARED across all three doublers (never
    resets; selling a doubler refunds nothing). **Sinks (all Tuskers, clean-room-checked):**
    *Gemwright* (T3 3/3): once/turn spend `gemwrightCost(3)` gems → `gemwrightGold(1)` gold,
    clamped to `goldCap` — THE only gem→gold bridge, one-way forever (gold→gem is banned: it
    would let the gold economy pump the exponential lane); *Facetguard* (T3 2/5 Taunt):
    once/turn spend `facetguardCost(2)` gems → chosen friendly +`gemDumpPayoff`(2/2)
    permanent + Divine Shield (takes over Goldgrin's old free rider — Goldgrin becomes a
    pure `goldgrinGems(2)` battlecry); *Oreseeker* (T2 2/3, renamed from the generic
    "Prospector" for clean-room clarity): once/turn spend `oreseekerCost(2)` gems → FREE
    shop refresh (same seeded draw path as a paid roll; clears a freeze exactly like a
    roll). New actions `gainGold`/`refreshShop` are **activated-only** vocabulary. All
    ability state (wallet, current cost, used-this-turn) is PRIVATE-channel
    (`PrivateState.abilities`). Bots get a deterministic greedy policy (double whenever
    affordable, biggest doubler first; then Facetguard/Gemwright/Oreseeker by simple
    guards). Rationale: the auto-doubler was the last "free" exponential — reachable by
    passively holding generators — and made the lane binary (hit 3 gems or do nothing);
    pricing each step creates a real every-turn decision (double now vs bank vs buy
    tempo/defense), gives gems a market, and keeps the thousands-of-stats ceiling reachable
    only for an ALL-IN commitment (sim-verified: all-in ≈2000+ atk by late game; a
    Facetguard-split line lands under half that). Pinned by the EV-ABL family + reworked
    sim Part A; EV-BP-19/20/21 retired; EV-ECO-14 rewritten (knowingly supersedes its D10
    pin).
40. **Design-law corollary — exponential scaling must be purchased (2026-07-01; extends
    #22, spec §6.6/§6.6a/§11.3c).** Exponential/unbounded scaling is legal ONLY where each
    step is bought with a decision, a risk, or a contested condition — never accrued free
    from static board state. The §11.3c lint's vocabulary gains a first-class SPEND-GATED
    payoff classification: the `spendGated` registry in `shared/config/breakpoints.ts`
    (`{card, currency:'gems', costKnobs[]}`). A threshold-free primary payoff passes the
    lint iff its card is registered there, carries an `activated` ability, and every cost
    knob resolves to a positive finite number in `engines[<tribe>]` (registry ↔ catalog is
    1:1, enforced by `lintBreakpoints` + `sim/audit.ts`). Tuning rule of thumb: **when in
    doubt, add a cost — not a bigger number.** This is a lint-vocabulary extension, not a
    suppression: the anti-linear scanner still bans ungated per-turn stat growth.

### Deployment (Round 10) — hosting topology, no gameplay change

41. **Single-service deployment: the server serves the client; same-origin WebSocket.
    (2026-07-01, spec §9.8.)** The app deploys as **one container / one service on one port**,
    not a split static-site + API. The Colyseus process (`server/index.ts`) mounts Express
    static hosting of the built client (`client/dist`) on the http.Server it hands to
    `WebSocketTransport({ server })`; Colyseus's own matchmaking wrapper keeps `/matchmake/*`
    HTTP for itself and lets every other path fall through to Express (static + `index.html`
    SPA fallback). The client (`client/src/net/game.ts`) therefore connects **same-origin**
    (`wss://<host>`, no `:2567`) in prod, keeps `ws://<host>:2567` in dev (Vite and the server
    are separate origins there), and still honors a `VITE_SERVER_URL` build override for a
    split host. Packaging is a `Dockerfile` (pnpm-workspace-aware, builds the client then runs
    the server via `tsx` — no server compile step, matching the raw-`.ts` runtime). The server
    binds `0.0.0.0:$PORT`. Rationale: one domain, no CORS, and the least config for a single
    Cloudflare domain in front of Railway. **Non-goal:** horizontal scaling — rooms are
    in-process (§9.2), so multi-instance would need a Redis presence/driver + sticky WS
    routing; v1 is single-instance. No engine invariant is touched (this is transport/hosting,
    not rules); no eval changes.

### Matchmaking display fix (Round 11) — pairing timing, no combat-outcome change

42. **Pairing is computed at the START of the shop phase, not at combat start; the public
    `pairings` list is the upcoming opponent, never last round's. (2026-07-01, spec §4.4/§10.
    Refines #10.)** Symptom this fixes: during the shop the client's "vs" label and standings
    highlight were reading a **stale** `state.pairings` (only ever written inside
    `resolveCombatPhase`), so they showed the **previous** round's opponent — and, because
    that opponent could have been eliminated in the intervening combat, they showed a **dead**
    player's name with **no living row highlighted** (round 1's shop showed nothing at all,
    since `pairings` was still empty). Fix: `Match.startRound` now computes the round's pairing
    up front via an idempotent `ensurePairings()`; `resolveCombatPhase` **reuses** that exact
    list and consumes it (so a bare resolve with no preceding `startRound` — the round-0 engine
    tests, the ghost driver in `combatWriteback.test` — still re-pairs against the current alive
    set). **This changes no combat outcome and is byte-identical for the sim:** the pairing
    inputs (alive set, `lastOpponent`, most-recent ghost) cannot change during a shop (no one
    dies mid-shop), and `computePairings` draws from its own `:pair:<round>` RNG, so no other
    random stream shifts — all 215 evals unchanged. Client corollary: the two ad-hoc opponent
    resolvers (`Shop.opponentSeat`, `App.opponentName`) collapse into one shared
    `resolveOpponent(pub, seat) → {seat, name, ghost}` (`client/src/components.tsx`) used by
    both the shop preview and the combat label, so a **ghost bye** now renders consistently as
    "vs \<name\> · ghost" in the shop (no living row highlighted) instead of the shop showing
    blank while the fight showed a name. **Not addressed here (logged, gameplay-affecting):** the
    `ghostsEnabled` config flag is still never read (ghosts always fill odd counts), and an odd
    roster with no eliminations yet still fights an empty board (a free win) — both are latent
    and unreachable under 8-player bot-fill, deferred to a separate decision.

### Multi-lane scaling rework (Round 9, cont.) — Phase 2 review fixes

43. **`playUnit` rejects while a target choice is outstanding; Gemtitan/Tuskmonger gem grants
    become config knobs. (2026-07-02; completes #39, upholds its §6.6a invariant.)** Two
    adversarial-review fixes on the shipped spendable-gems work (#39). (a) **Bug:** `fireBattlecry`
    (via `playUnit`) unconditionally overwrote `s.pendingTarget`, so playing a chosenAlly battlecry
    while a **paid** activation's target was armed silently discarded that pending **and the spent
    gems** — violating #39's "an activation is a purchase, never fizzled" rule. Fix: `playUnit` now
    returns `{ok:false, error:'resolve pending target first'}` when a target is outstanding — the same
    guard `activateAbility` already had, so any target choice must be resolved before a new one is
    armed. Behavior change to a shop intent (previously accepted-then-voided; now rejected, mutates
    nothing), pinned by a new EV-ABL regression test. (b) **Config-driven balance (invariant #4):**
    Gemtitan's battlecry `+3 gems` and Tuskmonger's onSell `+2 gems` were hardcoded literals (and
    duplicated in card text) while every sibling generator used a knob; the #39 literal→knob pass
    missed them. Now `engines.tuskers.gemtitanGems`/`tuskmongerGems`, single-sourced into both the
    effect and the interpolated text. No combat/determinism/privacy change; all evals green.

## Tribe name map (clean-room — never ship the reference names)
| Reference (do NOT ship) | Original name | Identity |
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

*Slice uses **Wildkin, Revenants, Reefkin**.*

## Proposed config defaults (BG-derived; veto to change; simulator tunes them)
- **Gold:** start 3, +1 per turn, cap 10.
- **Costs:** buy 3, reroll 1, sell refund 1, **freeze free**.
- **Shop slots by tier:** T1 3 · T2 4 · T3 4 · T4 5 · T5 5 · T6 6.
- **Caps:** board 7 units; bench/hand ~10; tiers 1–6.

## Spec-detail defaults (I'll specify these directly; veto any to revisit)
- **Slice keyword set:** taunt, divine shield, poison, reborn, cleave, magnetic.
  *(No extra-attack / windfury in v1.)*
- **Keyword timing:** deathrattles resolve in board order (left→right); simultaneous
  deaths each trigger; a summon takes the dead unit's slot; divine shield negates the next
  damage instance entirely (incl. poison); poison kills any unshielded minion it deals >0
  damage to; cleave hits target + both neighbors; reborn returns the unit once at 1 HP
  after death; magnetic merges in shop (stats + keywords) with a per-unit cap.
- **Shared-pool copy counts:** ~15 at T1 decreasing to ~6 at T6 (exact in config).
- **Heroes in slice:** identical no-power avatars; hero powers post-slice.
- **Spectate-after-death:** eliminated players may spectate or leave freely.

---

## Open questions (grill queue)

- [x] ~~Scope of vertical slice~~ — locked (decisions 5–6).
- [x] ~~Clean-room identity~~ — locked (decision 7 + tribe map).
- [x] ~~Triple/upgrade reward~~ — locked (decision 11).
- [x] ~~Tier-up pricing model~~ — locked (decision 8).
- [x] ~~Match length / starting health~~ — locked (decision 9).
- [x] ~~Pairing, ghosts, elimination, placement~~ — locked (decision 10).
- [x] ~~Networking, state privacy, combat visualization~~ — locked (decisions 12–14).
- [x] ~~Simulator scope~~ — locked (decision 15).
- [x] ~~Turn timer~~ — defaulted (decision 16; veto to change).
- [x] ~~Unit pool model~~ — locked: shared finite (decision 17).
- [x] ~~Bot AI~~ — locked (decision 18).
- [x] ~~Reconnection~~ — locked (decision 19).
- [x] ~~Project structure~~ — locked (decision 20).
- [x] ~~Spectate-after-death~~ — defaulted (spec-detail defaults).

**All major branches resolved (40 decisions across 9 rounds; #30 = per-card procedural art;
#31–32 = replay never-gray + fight-sized combat window; #33–36 = combat choreography —
asymmetric strike telegraph, death cadence, honest deathrattle labels, rAF beat clock;
#38 = combat→board writeback; #39–40 = spendable gems / purchased doubler / spend-gated
payoff law, superseding D10).**

✅ **Full spec written → [`design-spec.md`](./design-spec.md)** (16 sections, developer-ready).
✅ **v1 implemented** (M0–M6 — see `README.md`).
🔜 **Round-6 redesign spec → [`design-spec.md` §16](./design-spec.md)** — game-feel + content
   depth; ready for a fresh agent to implement. Build order in §16.8; the multiplier-cap +
   reachability-metric gate (decisions 25/29) must clear before content ships.
