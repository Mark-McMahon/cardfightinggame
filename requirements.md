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
    breakpoints** — that second-order interaction must be *visible to the sim*. *(This last
    clause was later SUPERSEDED by #50 (2026-07-02): the doubler amplifies OUTPUT and an
    echoed play counts as exactly one toward the gate; the sim-visibility requirement stands.)*
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
    blank while the fight showed a name. **Deferred here, now resolved in #63 (gameplay-affecting):** the
    `ghostsEnabled` config flag was still never read (ghosts always filled odd counts), and an odd
    roster with no eliminations yet fought an empty board (a free win + phantom writeback accrual) —
    both latent and unreachable under 8-player bot-fill; #63 replaces them with a proper bye.

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

### Multi-lane scaling rework (Round 9, cont.) — Phase 3: Infernal consumption + Revenant lifetime scaling

44. **Persistent `lifetimeFriendlyDeaths` counter; consumption vocabulary (`destroyAlly` /
    `absorbStats` / `alliesAtMost` / `leftmostAlly`); two Infernal bodies. (2026-07-02.)** Adds a
    PERSISTENT per-player friendly-death total to `ShopSession` (private; NEVER reset between
    turns/rounds). **Counting rule (recorded):** the combat-scoped `deaths`/`revenantDeaths` counters
    stay per-fight by construction; a shop-phase sacrifice does NOT touch them; `lifetimeFriendlyDeaths`
    is the ONLY counter that BOTH a shop sacrifice AND combat deaths increment. It is incremented by
    (a) shop-phase `destroyAlly` (Gorgemaw) and (b) friendly deaths counted from each combat log —
    carried out of `resolveCombat` as additive `combatEnd.deathsA`/`deathsB` (incl. tokens/summons),
    folded in `Match.resolveCombatPhase` for both LIVE boards; GHOST boards do not accrue. For combat
    visibility the lifetime value rides IN on a new `CombatBoard.lifetimeDeaths` per-board SCALAR (NOT
    the `resolveCombat(boardA,boardB,seed)` signature — invariant 1b holds; determinism holds).
    **`destroyAlly` vs the existing `destroy` (settled):** `destroyAlly` is a NEW, distinct ActionType,
    not `destroy` targeting a chosenAlly — the two are genuinely different operations. `destroy` (D11)
    is a COMBAT removal that fires deathrattles and bypasses divine shield; `destroyAlly` is a
    SHOP-phase chosen-ally removal that fires no combat/deathrattle (there is no shop combat), returns
    the body's pool copy (like a sell), and increments `lifetimeFriendlyDeaths`. Reusing `destroy`
    would have forced phase-branching inside one action; two names keep each phase's semantics honest.
    `absorbStats`: the SOURCE permanently gains the TARGET's CURRENT atk/hp (reads live instance stats
    — a golden target contributes its DOUBLED stats); keywords are NOT transferred. `alliesAtMost`
    (≤N minions, a go-tall gate) and `leftmostAlly` (POSITIONAL board-index-0, distinct from bornTurn
    `oldestAlly`) are new live condition/selector primitives. Cards: **Gorgemaw** (Infernal T4 3/3;
    battlecry chosenAlly: `absorbStats` then `destroyAlly` — authored absorb-BEFORE-destroy so the
    absorb reads the live target and the pair is re-entrancy-safe under an Echo-Choir double; identical
    outcome to "destroy then absorb"; no legal target → D5 fizzle) and **Cindermarshal** (Infernal T4
    4/5; startOfCombat, `alliesAtMost` ≤4 → leftmostAlly +4/+4 and Taunt, THIS COMBAT ONLY,
    `permanent:false` — the §7.5 writeback deliberately does NOT pick it up). **Clean-room (§0):** both
    renamed from working titles ("Gluttonous Maw" / "Lone Vanguard") to the clearly-original compounds
    **Gorgemaw** / **Cindermarshal**. Numbers are `engines.infernals` knobs.

45. **Ossuary Titan — LINEAR primary scaling reworked to DISCRETE, ESCALATING lifetime breakpoints.
    (2026-07-02; upholds #22/#40.)** Its original "+1/+1 per 2 lifetime deaths this combat" is banned
    linear per-unit scaling (#22). Reworked to a TIERED `breakpoints.ts` row on the new `lifetimeDeaths`
    counter (a `tiers[]` field on `Breakpoint`): thresholds **4/8/12** with per-step payoffs **+2/+2 →
    +3/+3 → +5/+5**, this-combat only (`permanent:false`). The card fires one cumulative startOfCombat
    self-buff per crossed tier (three `lifetimeDeathsAtLeast`-gated Effects). **Sizing rationale:**
    lifetime deaths accrue slowly across a whole game (every fight + every Gorgemaw sacrifice), so the
    thresholds are a long-horizon investment, not a per-fight ramp; the step payoffs RISE (marginal
    reward per crossed tier increases, top step = 2.5× the first) so the shape is a step, not a line —
    the anti-linear intent of EV-BAL-D. The combat evaluation reads the FIXED per-board scalar carried
    in on `CombatBoard.lifetimeDeaths`, not an event-accumulated count. Registered as ONE breakpoint
    row (`revenants_ossuarytitan`), so the EV-BAL-C lint covers it.

46. **Writeback-multiply extension; Gravemonarch's contested-condition double; a first-class
    CONTESTED-CONDITION payoff class for the §11.3c lint. (2026-07-02; extends #38, corollary to #40.)**
    (a) **Writeback-multiply (a Phase-1 seam extension, additive):** `combatWriteback.foldPermanentBuffs`
    now also folds a combat-fired `multiplyStats` flagged `permanent:true`. Combat emits `permanent:true`
    + a new additive `permanentFactor` (the CAPPED factor) on the `stats` event (existing `dAtk`/`dHp`
    unchanged; a permanent event is EITHER a buff OR a multiply, never both); the fold multiplies the
    SURVIVING persistent instance by that factor through the same §6.8 `applyMultiply` clamps
    (`multiplyFactorCap` + `statSanityBound`), NOT the combat-inflated absolutes — so it compounds
    across combats exactly like the buff fold. `setStats`/`resetToBase` stay this-combat-only.
    (b) **Gravemonarch** (Revenant T6 6/7 Reborn; renamed clean-room from "Grave Emperor"): a new
    `endOfCombat` trigger fires for LIVING units at fight end; if `deathsThisCombatAtLeast`
    (5, config) it permanently DOUBLES its stats (×`graveEmperorFactor`=2, capped) via the
    writeback-multiply. Exponential, but each double is BOUGHT by surviving a near-wipe (a CONTESTED
    CONDITION — the opponent fights it by finishing the kill; legal under #22/#40). **Reborn edge:** a
    Reborn RETURN counts as surviving (it is in `survivorsA/B` under its persistent uid); the double
    folds onto the PERSISTENT instance (its post-reborn 1-hp combat state is irrelevant to the
    persistent write). (c) **Contested-condition classification:** EV-BAL-C flagged Gravemonarch as an
    unclassified primary payoff (its `deathsThisCombatAtLeast` gate reads as a breakpoint condition, but
    it is deliberately NOT a breakpoint and NOT spend-gated). Rather than suppress the flag, a THIRD
    first-class legal primary-payoff class was added — `contestedCondition` in `breakpoints.ts` (a
    registry PARALLEL to Phase-2's `spendGated`), naming the contested combat CONDITION and its
    engine-knob sizing; the lint (`lintBreakpoints` + `sim/audit.ts` coverage) now accepts a
    threshold-gated payoff registered there, and validates the registry ↔ catalog 1:1 + knob positivity.
    This encodes #40's own words ("unbounded scaling is fine only where each step is bought with a
    decision, a RISK, or a contested condition") as lint vocabulary, not a bypass.

47. **Bot consumption-payoff awareness (so the macro sim VALIDATES Gorgemaw); Cindermarshal's go-tall
    line deferred to Phase 4; §8 roster-count reconciliation. (2026-07-02; Phase-3 review-fix.)**
    (a) **Consumption is a fourth primary-payoff class *to the bot*.** `server/bots/BotAgent.ts` now
    recognises a CONSUMPTION card — one whose effects carry a `destroyAlly` action (detected from card
    DATA via `isConsumption`, no card id hardcoded) — as a primary payoff alongside breakpoints /
    spend-gated / contested-condition: it earns the `breakpointValue` weight in `scoreCard`, counts as
    "worthwhile" in `bestBuy`, and joins the payoff sets in `shouldRoll`. **Why:** pre-fix the bot valued
    Gorgemaw as a raw 3/3 body, so it dumped it as the weakest hold to free bench room and Gorgemaw
    reached combat 0× on seed `run` — the macro-sim Infernal number did NOT reflect the consumption
    rework at all. Post-fix Gorgemaw reaches combat (15 players, avgP 4.13 — mid-pack, not OP/DEAD) and
    its battlecry fires 100% of the times it is played (83/83 absorbed in instrumentation). A play-order
    guard in `chooseDevelopment` also prevents playing a consumption body into an EMPTY board (no ally to
    eat → D5 fizzle): a normal body is developed first. `bestTarget` already eats the SMALLEST spare body.
    (b) **Cindermarshal's go-tall payoff is unreachable under any rational bot policy in the current
    engine — deferred to Phase 4.** The `alliesAtMost ≤4` start-of-combat buff only fires when the
    controller deploys narrow, but deploying WIDE dominates in this engine, so a rational agent never
    holds narrow. Verified empirically: with the buff temporarily raised to +6/+6, Cindermarshal was
    deployed narrow in **0 of ~37** owner-sides across 200 matches — the swing size is not the lever. A
    speculative "go-tall restraint" bot heuristic was therefore NOT shipped (it would be inert dead code
    for a future phase). Cindermarshal remains a functional T4 4/5 body whose EFFECT correctness is
    validated by the deterministic EV-CON evals; the go-tall LINE (making narrow a real, winning choice)
    depends on the Phase-4 board-shape / anti-wide tech and is a documented known-limitation (design-spec
    §11.2 bot-coverage note), not a silent gap. This supersedes the implicit assumption in #44 that the
    sim would exercise Cindermarshal.
    (c) **§8 roster-count drift fixed.** §8 still read "93-row roster · Revenants 13 · Infernals 8" after
    Phase 3 added 4 non-token cards, contradicting §6.7 / the file tree (both already "97 rows"). §8 is
    now **97 rows · Revenants 15 · Infernals 10 · 91 purchasable + 6 tokens** (verified against
    `units.ts` by id; the tribe-field grep double-counts one aura's `tribe:'revenants'` modifier — the
    review's "Revenants 16" reflected that miscount; actual is 15). **Placement note:** the Phase-3 pool
    additions shifted zero-sum placement; primordials (avgP 5.28) and wildkin (5.83) are now the
    bottom-two and remain the explicit Phase 4/5 rebalance targets. All §11.3 gates still PASS and no
    Phase-3 card flags OP/DEAD.

48. **alliesAtStart gate-spread — board-shape diversification (2026-07-02; Phase 4).** The seven
    `alliesAtStart` breakpoints were all threshold 5 (a single "go 5-wide" shape). They are spread into a
    **discrete 5/6/7 ladder** (still config rows, breakpoint law #22 intact) so different builds want
    different widths: **5 (low-width anchor):** `wildkin_thornwarden`, `corsairs_reaver`; **6 (mid):**
    `corsairs_marauder`, `primordials_tempest`, `constructs_titanforge`; **7 (full board):**
    `wildkin_grovelord`, `primordials_worldspark`. Config-ONLY change to `breakpoints.ts` thresholds — no
    logic touched; the combat/shop gate evals read `getBreakpoint(...).threshold` so they re-pin
    automatically, and the sim web nodes were widened to the shape each payoff now wants (primordial-cleave
    → 7). **Balance risk (LISTED, not fixed — per the rework "no compensating tuning" rule):** pushing
    `wildkin_grovelord` and `primordials_worldspark` to 7 nerfs two already-bottom tribes. Post-change sim
    (seed `run`, 200 matches): primordials avgP 4.87→5.30 and wildkin 5.47→5.62 (report run) — both a touch
    WORSE, as predicted. All seven §11.3 gates still PASS (reachability held at 50.2% run / 53.2% macro).
    Flagged for a future numbers pass; deliberately uncompensated here. **See #53 — the same gate-spread
    also halved the EV-BAL-B reachability HEADROOM (razor-thin on the default seed).**
53. **EV-BAL-B reachability headroom halved by the #48 gate-spread — FLAGGED for final validation
    (2026-07-02; Phase 4).** Raising the `alliesAtStart` gates to 6/7 makes the second-breakpoint payoffs
    rarer, which directly shrinks the sim's reachability metric. Measured: second-breakpoint reachability
    on the canonical `run` seed fell **~56% (committed baseline a0d64bf, post-Phase-3) → 50.2% (Phase-4
    tree)** — i.e. it now clears the load-bearing ≥50% EV-BAL-B floor by only **0.2pp**. The pass is
    ROBUST (5/5 seeds verified: run 50.2 / macro 53.2 / alpha 53.9 / beta 51.1 / gamma 53.0%) and `run` is
    now the WORST-CASE default seed. **Not blocking** — every gate is green — but the margin on the
    reported default seed is essentially gone. **Consequence recorded for the Phase-7 final-validation
    pass:** any future content that tightens breakpoint gates further could tip the `run` seed under 50%
    and fail EV-BAL-B; before shipping any such content the margin must be restored (e.g. relax one 7-gate
    toward 6, or add a reachability-boosting line). Per the rework "no compensating tuning this PR" rule
    the gates are left as-is here; this entry is the explicit DOCUMENTED flag (not a silent gap), paired
    with the design-spec §16 audit note.
49. **Tech-pool injection guarantee (2026-07-02; Phase 4).** From round `systems.techInjection.fromRound`
    (=5) onward, a **fresh** roll that offers NO interaction-tech card has ONE slot replaced by a
    copy-weighted pool draw restricted to the tech ids AT/BELOW the shop tier
    (`{reefkin_spinefish, sirens_lurefish, reefkin_brineling, sirens_reefwitch, sirens_venomsong,
    constructs_nullforge}`). The replaced slot is chosen **deterministically from the shop RNG** (no
    "relevance" concept — none exists in this engine, and none was invented). **Pool accounting** mirrors
    any offer: the injected copy is TAKEN (`drawOneFrom`) and the replaced offer RETURNED (`returnCopy`) —
    net-zero, never a phantom copy; if no tech copy is available at/below tier the roll is left as-is and
    logged (never a crash). Hooks EVERY fresh-roll path through one `drawFreshShop` helper —
    `startShopPhase` (non-frozen), `rollShop`, and Oreseeker's `refreshShop` — so all three stay
    byte-identical for the same seed+state (preserves EV-ABL-08). A **frozen** shop is NOT re-rolled, so it
    is never injected. Draw order is fixed (tech draw, then slot pick) → deterministic (invariant 2b). This
    changes the pinned §9.7 shop reducer; goldens/tests updated (EV-TCH-01..04). Motive: guarantee a
    developed board always has access to an ANSWER (poison / stat-neutralizer), so scaling lines stay
    context-sensitive (the §16 floor) even under bad rolls.
50. **Echo Choir counting rebalance — amplify OUTPUT, not the gate COUNT (2026-07-02; Phase 4;
    SUPERSEDES the Echo Choir clause of #25).** Decision #25 required "Echo Choir's doubled battlecry
    triggers must count toward battlecry breakpoints." This decision **explicitly reverses that clause**:
    the doubler is now an OUTPUT amplifier, not a battlecry-count inflator. (#25's cap + non-stacking +
    the requirement that the interaction stay sim-visible all still hold — the interaction remains
    sim-visible, just as a ×output rather than a ×count.) Pinning golden: EV-AUR-05.
    Previously a played battlecry incremented `battlecriesThisTurn` by the Echo Choir
    MULTIPLIER up front, so one play could reach a ≥2 gate from the echoed copy alone (a double-dip:
    Chorus Tide echoed at 0 prior battlecries fired its own ≥2 payoff). Now a played battlecry counts as
    **exactly one** toward `battlecriesThisTurn`, regardless of the doubler. The doubler STILL amplifies
    OUTPUT — each battlecry EFFECT and every `afterFriendlyBattlecry` still resolves `multiplier` times
    (the ×2 cap + non-stacking are unchanged) — but the echoed copy no longer inflates the counter that
    GATES OTHER battlecry payoffs. **Knowingly rewrote the pinning golden:** EV-AUR-05 (auras-shop) asserted
    `battlecriesThisTurn===2` from one echoed play; it now asserts `===1` (no buff from the echo) AND that a
    second real battlecry crosses the gate with the ×2 OUTPUT intact. Intent: the doubler is an output
    amplifier, not a battlecry-count inflator.
51. **Reef Leviathan Divine-Shield grant scoped to Reefkin (2026-07-02; Phase 4).** The T6 capstone's
    battlecry (battlecries≥3 → grant Divine Shield) was `allAllies` (whole board — any splash body). It is
    now `allAllies` + `filterTribe:'reefkin'`, rewarding a committed Reefkin line rather than a generic
    shield-splash. Data-only change in `units.ts` (gate threshold 3 unchanged); EV-BP-12 updated to prove a
    non-Reefkin ally no longer receives the shield.
52. **Two positional cards + their vocabulary primitives (2026-07-02; Phase 4).** Board position becomes a
    lever via two clean-room-original cards (§0-checked; neither name nor text is from any reference game),
    each promoting a RESERVED/new primitive to first-class LIVE (§6.4/§6.9 — the aura vocabulary is closed,
    so this is an explicit addition + eval). (a) **Vanguard Pennant** (Corsair T2 1/4): a NEW positional
    aura scope `leftmost` + modifier `attackBuff` — "your leftmost minion has +`engines.corsairs.leftmostAttackBuff`
    (=2) attack." Query-at-read-time in combat (`leftmostAttackBonus`, folded into `strikeAtk` at every
    strike), so a reposition or the leftmost's death moves the bonus to the new front unit for free
    (verified by EV-AUR-06 + golden EV-GLD-13). Stacked pennants sum, capped at `leftmostAttackBuffCap`
    (=4) so it stays a fixed positional utility buff, not an unbounded per-unit scaler (#22). (b) **Last
    Rites Drummer** (Revenant T3 2/3): implements the RESERVED `adjacentAllies` selector for real —
    "Deathrattle: your adjacent minions gain Reborn." Neighbors are board-index ±1 computed against the
    SETTLED board at deathrattle time (D1 batch semantics — the source is already removed, so the flanks of
    its settled slot are used), shipped declaratively via a pre-computed-neighbor-uids field on the select
    context (EV-ADJ-01 + golden EV-GLD-14). Custom-handler registry stays at EXACTLY 2 (both cards are pure
    declarative data). **Note:** Cindermarshal's go-tall line (#47b) remains deferred — the gate-spread does
    not change the bot's fill-to-7 policy, so `alliesAtMost≤4` is still unreached in the macro sim.

### Multi-lane scaling rework (Round 9, cont.) — Phase 5: magnetic merge + Forgemaster + Corsair gold

54. **MAGNETIC merge system — un-deferred (reserved keyword → LIVE), NOT a new keyword (2026-07-02;
    Phase 5; refines #24).** Decision #24 ("no new keywords") RESERVED `magnetic` for the Constructs merge;
    Phase 5 promotes it to live — this is un-deferring a reserved system, **not** a new keyword. During the
    SHOP phase a Magnetic minion on the bench MAY MERGE into a friendly Construct on the board (new
    `merge` intent `{unitUid,targetUid}`) instead of being played standalone: the target Construct
    PERMANENTLY gains the magnetic unit's CURRENT stats (`magneticStatsCarried`) and keywords
    (`magneticKeywordsStack`; the `magnetic` tag itself never transfers), and the magnetic unit is
    CONSUMED — NOT a death, NOT a sell — its pool copy does NOT return (triple-merge accounting). Optional:
    standalone play is NEVER blocked. Server-authoritative validation (rejection mutates nothing): shop
    phase, no outstanding pending target, `unitUid` a magnetic BENCH unit, `targetUid` a friendly CONSTRUCT
    on the BOARD, per-unit merge cap not exceeded. **Storage model:** merged stats live in `inst.atk/hp`
    beyond print, merged keywords in `inst.keywords`, and a new `UnitInstance.mergeCount` bounds the
    per-unit cap (`engines.constructs.magneticMergeCap`=5, discrete → breakpoint law #22). **Nullforge
    ruling (verified):** `resetToBase` recomputes atk/hp from PRINTED stats, so it STRIPS the merged stats;
    it is stat-only and does NOT touch keywords, so **merged keywords PERSIST through Nullforge** (a
    documented ruling, EV-MAG-06). **Golden:** a golden magnetic unit merges its DOUBLED live stats
    (EV-MAG-02). **Poison** one-shots the merged tower regardless of size (stat-agnostic, EV-MAG-07). New
    Magnetic Constructs (clean-room §0-checked): **Boltfitter** T2 2/2, **Alloy Rig** T4 4/4 + Divine Shield
    (renamed from the working title "Plasteel Rig" — "Plasteel" is a Warhammer 40k/Dune material, avoided
    per §0), **Omega Chassis** T5 5/5 + Taunt. EV-KW-MAG (reserved-no-op pin) RETIRED → replaced by the
    EV-MAG family + golden EV-GLD-15. Custom-handler registry stays EXACTLY 2 (all declarative).

55. **Forgemaster — persistent per-player Sentinel modifier (2026-07-02; Phase 5).** New Construct T4 3/5
    (clean-room §0: a generic occupational compound, not a reference-game card/hero — cleared). "Your
    Sentinels have +`engines.constructs.forgemasterSentinelBuff`(=1)/+1, this game; stacks per Forgemaster
    played." A NEW per-player PERSISTENT counter `ShopSession.forgemastersPlayed` (private) is incremented in
    `playUnit` when a Forgemaster is played to board, and is NEVER decremented — the stack is
    lifetime-per-copy-played and SURVIVES the Forgemaster's sale/death (recorded rule; EV-FRG-02). It rides
    into combat on a new `CombatBoard.forgemastersPlayed` scalar (the Phase-3 lifetimeDeaths pattern —
    `resolveCombat` signature UNCHANGED, determinism holds). Applied at Sentinel CREATION: every summoned
    Sentinel (all three sites — Foundry deathrattle / Titanforge startOfCombat / Aegis Prime deathrattle —
    are IN COMBAT) gains +buff×stacks (EV-FRG-03, golden EV-GLD-16). **Detection is content-driven:** the
    card carries a `yourSentinels`/`statBuffOnEvent` aura MARKER (promoted reserved→live, the #52 pattern) —
    NOT a board-read passive; `playUnit` reads the marker to bump the counter. Combat identifies the buffed
    token via `engines.constructs.forgemasterSentinelId` (a config content-pointer, cf. techInjection.cardIds).

56. **Corsair GOLD-economy cards — gold ONLY, currencies stay separate (2026-07-02; Phase 5; upholds the
    gold≠gems hard rule).** Four clean-room Corsairs, every number a config knob (`engines.corsairs`).
    **Bursar** T2 2/2: battlecry queues `bursarGold`(=2) via the new `gainGoldNextTurn` action into a new
    private single-accumulator `ShopSession.delayedGold`, DELIVERED at the start of the next shop phase and
    clamped to the effective cap (EV-GOLD-01). **Fence** T3 3/3: a `yourEconomy`/`sellRefundSet` aura raises
    the sell refund to `fenceSellRefund`(=2) while on board (non-stacking: helper takes the max; reverts on
    leave; EV-GOLD-04). **Moneylender** T3 2/4: a `yourEconomy`/`goldNextTurnIfRich` aura — at end of turn,
    if unspent gold ≥ `moneylenderThreshold`(=3), queues `moneylenderGold`(=1) ONCE (presence-based,
    non-stacking; EV-GOLD-02). **Vault Keeper** T4 3/5 Taunt: a `yourEconomy`/`goldCapSet` aura raises the
    EFFECTIVE gold cap to `vaultKeeperGoldCap`(=13) while on board; reverts on leave (EV-GOLD-03).
    **Sub-decisions recorded:** (a) delayed gold is a SINGLE accumulator — multiple Bursars each queue their
    own (stacking), Moneylender adds once (non-stacking) — clamped to the (possibly Vault-Keeper-raised) cap
    at DELIVERY time. (b) One `effectiveGoldCap(s)` helper (query-at-read-time over `yourEconomy` auras) is
    used by the income clamp AND every gold gain (delayed delivery + Gemwright's gem→gold bridge), so it
    reverts automatically when Vault Keeper leaves. (c) `effectiveSellRefund(s)` mirrors it for Fence.
    **Churn-loop accounting (EV-GOLD-05):** a buy(3g)/sell(2g-with-Fence) cycle STRICTLY loses 1 gold, so it
    cannot mint infinite money (bounded by finite per-turn gold); Fence only changes a GOLD number and
    Tuskmonger only makes gems, so gold/gems stay SEPARATE — the ONLY bridge remains Gemwright (gems→gold,
    one-way). **Judgment call:** with Fence the Tuskmonger churn converts gold→gems more efficiently (1g:2
    gems) but remains lossy, self-limiting (each cycle spends a body + net gold), and bounded; gems only fuel
    the poison-beatable Tusker doubler — watched by the sim hoarding diagnostic, not a new bridge.

57. **Reachability restored by CREDITING the new payoffs (not by gate relaxation); #47b/#53 status
    (2026-07-02; Phase 5).** The 8 new pool cards diluted the EV-BAL-B reachability metric to 48.4% on the
    canonical `run` 200-match report (below the 50% floor, exactly the razor-thin margin #53 flagged). The
    #53-suggested gate relaxations (7→6 / 6→5 on `alliesAtStart` full-board cards) were tried and had ZERO
    effect — the metric is limited by breakpoint OWNERSHIP DENSITY on splash boards, not by those thresholds
    — and they flagged units OP, so they were REVERTED (Phase-4 gates unchanged). The principled fix, matching
    the #39 precedent (a purchased spend-gated ability counts toward reachability), is to CREDIT the assembled
    MAGNETIC merge tower (`mergeCount>0`) as a primary payoff in the harness — added to `breakpointsHit` as a
    synthetic id (`constructs_magnetic_merge`, never a catalog card, so it never collides with the ⭐ registry).
    Result: reachability 52.6% PASS (headroom restored above the 50.2% baseline). **CORRECTION (see #58):** the
    Forgemaster stack (`forgemastersPlayed>0`) was ALSO credited (`constructs_forgemaster_stack`) in the first
    cut, but instrumentation showed it fires in only ~1/1600 macro player-games (dead in the macro sim) so its
    credit was VACUOUS (removing it moved the gate 0.00pp — 52.59% either way); that credit was REMOVED — the
    52.6% pass rests entirely on the merge tower, which fires 116/1600. **Bot policy:** a deterministic
    `bestMerge` (committed Construct build → merge the lowest-uid magnetic bench unit into the biggest under-cap
    tower) fires the go-tall consolidation line (EV-SIM-MAG-01); the new cards get NO breakpoint-sized scoring
    bump (over-valuing them crowds real breakpoints off splash boards — the cause of an interim gate failure),
    reaching combat as ordinary on-tribe bodies. **#47(b) (Cindermarshal go-tall) NOT closed:** magnetic merge
    is a Construct-tribe consolidation tool, so it makes CONSTRUCT boards go-narrow (the anti-wide tech #47b
    pointed at now exists + is bot-exercised), but Cindermarshal is an INFERNAL card and the bot does not build
    Infernal+Construct-narrow with it deployed, so `alliesAtMost≤4` on Cindermarshal specifically stays
    unreached — the deferral MOVES to final validation as a documented sim-coverage gap (design-spec §11.2).
    **#53 CLOSED:** the flagged EV-BAL-B headroom is restored (52.6%), so the "restore the margin before
    shipping gate-tightening content" obligation is met. **Sim vs baseline:** Infernals (avgP 4.57) + Revenants
    (4.28) are NOT bottom-two (bottom-two are primordials 5.53 / wildkin 5.91, the pre-existing weak tribes);
    Constructs improved (3.70 vs 4.01 baseline — driven by the MAGNETIC MERGE line, see #58 correction, NOT
    Forgemaster synergy); Corsairs stable (4.34). Titanforge is soft-flagged OP (avgP 2.30, a diagnostic not a
    gate — its strength is its OWN on-summon Sentinel body + `alliesAtStart` payoff, NOT the near-never-played
    Forgemaster stack; poison/Nullforge/width still counter it).

58. **Forgemaster macro-sim coverage GAP + reachability-credit correction (2026-07-02; Phase 5,
    review fix — refines #55/#57).** A review of the #57 payoff-crediting found two problems, both fixed
    here WITHOUT balance number-tuning (per the standing "document drift, don't tune" rule):
    (a) **The `constructs_forgemaster_stack` reachability credit was VACUOUS.** Instrumenting a 200-match
    (1600 player-game) macro run through the real Match+BotAgent: `constructs_forgemaster` appears in shop
    in ~209 player-games and is bought/owned in ~101, yet `forgemastersPlayed>0` in only **1** player-game —
    bots buy the 3/5 body but its deliberately-small (no-payoff-bump, #57) valuation leaves it BENCHED and
    later sold, never developed to board, so the persistent counter never increments. The credit therefore
    contributed ~1 datapoint to n=656 and did nothing to validate the Forgemaster→Sentinel combat scalar.
    **FIX:** the credit is REMOVED from `sim/harness.ts` (measured 0.00pp effect — reachability is 52.59%
    with or without it); the 52.6% EV-BAL-B pass now rests ENTIRELY on the magnetic merge tower (116/1600).
    Forgemaster's combat scalar stays PINNED by the determinism + property evals (EV-FRG-01..03, EV-GLD-16),
    and its macro-sim non-coverage is now a DOCUMENTED gap (design-spec §11.2), exactly like the #47(b)
    Cindermarshal go-tall gap — NOT number-tuned away (raising its valuation to force it onto board is the
    very move that broke EV-BAL-B in #57's interim). (b) **False causal claim corrected.** The #57 report
    attributed the Constructs placement gain (4.01→3.70) and Titanforge's avgP 2.30 to "Forgemaster→Sentinel
    synergy"; with Forgemaster played in only 1/1600 games that is impossible — the gain is the MAGNETIC MERGE
    line (116/1600 towers) and Titanforge's strength is its own on-summon Sentinel body + `alliesAtStart`
    payoff. #57's text is corrected in place and this entry records the measurement. (c) **EV-SIM-P5-02
    hardened:** the coverage guard now asserts a minimum firing RATE for the merge tower (≥20/640 player-games
    on the `run` seed, vs an observed ~40) instead of the previous fragile "≥1 player ever assembled it"
    existence check (which a single event — the Gorgemaw lesson — could green-light); the Forgemaster half of
    that guard is dropped as a documented gap. (d) **Ratification flag (final validation):** the merge-tower
    reachability credit is a metric-CLASS extension that landed alongside the content it helps validate; it is
    principled (a real assembled go-tall payoff, 116/1600, cap=5 reached, mirroring the #39 spend-gated
    precedent) but a human should explicitly RATIFY at final validation that the merge tower is a legitimate
    primary payoff rather than a goalpost move. Flagged in `sim/harness.ts` + design-spec §11.2.

### Config balance-tuning pass (Round 9, cont.) — post-rework win-rate spread compression

59. **Config-only balance pass — compress the tribe win-rate spread (2026-07-02; post-rework, deferred
    from the #38–#58 rework per invariant #4 "tuning = edit config, re-run the sim, never a logic change").**
    FOUR config levers changed (all in `shared/config/*`; NO logic, NO content, NO new knobs), each applied
    ONE-AT-A-TIME with a full 8-gate re-run between: (1) `reefkin_pearlguard` shield-break board payoff **1/3→1/2**;
    (2) `wildkin_thornwarden` `alliesAtStart` payoff **2/4→3/5**; (3) `primordials_stormcaller` `battlecries`
    board payoff **2/1→3/3** (adds the hp the tribe lacked); (4) `wildkin_packmother` avenge payoff **2/2→3/3**
    (`engines.wildkin.avengePayoffAtk/Hp` + its mirrored breakpoint row). **Methodology:** the note's metric
    (tribe = `classifyBoard(peakBoard).dominantTribe`, win rate = fraction placing 1st, band = [40%,160%] of the
    mean tribe win rate) — but measured at **600 matches**, not 200: the 200-match win-rate is too noisy (tribes
    swing ±25pp run-to-run; a Wildkin buff appeared to drop Primordials 27pp, pure sampling noise), 600 stabilizes
    to ±few pp. **Result (600-match, run/macro):** the sole out-of-band tribe on either seed is now **Reefkin
    (189%/176%, down from 248%/214% baseline)**; every other tribe is inside [40,160]% on BOTH seeds
    (Constructs 145/140, Corsairs 99/105, Revenants 103/89, Sirens 83/83, Tuskers 80/86, Infernals 73/84,
    Wildkin 69/53, Primordials 59/85). Range compressed **5.8×→3.2× (run), 4.5×→3.3× (macro)**; Primordials +
    Wildkin (the two weak tribes) lifted into band; Infernals + Revenants stay MID-pack (off bottom-two, holds
    #57's floor). 269 tests green, all 8 §11.3 gates green throughout (final: A −5.8pp, B 51.4%, C 0, D 8.65,
    E 0, F UW0/unc0, G 0.00%, coherence PASS). **CONFIG-LIMITED RESIDUAL (the honest finding — some targets are
    unreachable by config alone, as anticipated):** Reefkin's ~176-189% rides on hardcoded BODIES with no config
    knob — pearlguard 2/3 DS+taunt (24% pick) + spinefish/coralwarden/brineling keyword-GRANT utility (poison/DS
    are binary keywords, not stats). Only pearlguard's board payoff is a tunable knob; a further nerf (1/3→1/1)
    shaves Reefkin to 172% but TRANSFERS the lost wins to the equally-untouchable **Constructs** (cogling 2/2
    DR-token @21% pick + bulwark 2/4 DS+taunt — its only reaching knobs are gate-B-tied `magneticMergeCap` and the
    dead-in-sim `forgemasterSentinelBuff`; `mechDeathToken*`, `spellcraftBuff*`, `spellpowerPerCast`, `buffPerToken`,
    `elementalPlayBuffHp` are all VERIFIED-DEAD knobs), pushing Constructs 133→174% (out) for zero net spread gain —
    the **zero-sum apex coupling**. So `1/2` is the sweet spot: shave Reefkin maximally WITHOUT overflowing
    Constructs. **The change that WOULD close it needs a content edit (out of scope for a config-only pass):** trim
    the pearlguard/cogling/bulwark BODY stats (e.g. pearlguard 2/3→2/2, or convert body stats to knobs). **Levers
    that DON'T reach in bot play (tried + REVERTED, byte-≈-identical output):** motherthorn threshold 3→2,
    tokenDeathFloor 1→2 / cap 6→10, chorustide 3/3→2/2, elementalPlayBuffAtk 2→3, burstDamage 3→5 — bots rarely
    satisfy shop-turn/battlecry-gated conditions or this-combat token payoffs, so only frequently-firing effects +
    on-board body payoffs move a tribe. **OP flags (goal B) — evaluated:** `corsairs_marauder` (2.0-2.3) IS
    config-nerfable (2/1→1/1) but redistributes to the untouchable Constructs → net goal-A regression → LEFT +
    documented; `tuskers_warhoard` (1.9-2.4) has NO isolated lever (5/6 taunt body + hardcoded deathrattle +2/+2 +
    SHARED `gemBaseValue`) → documented (needs a content edit); `wildkin_packmother` (2.0-2.1) is a NEW flag from
    lever (4) — the deliberate carrier that rescued Wildkin, retained as an acceptable build-around outlier
    (dialing to 3/2 drops Wildkin toward the floor, feeds the apexes, and does NOT clear the flag);
    `corsairs_seaqueen` (1.8-2.1, 600-only) is a hardcoded-body flag, no lever. **Tusker variance (goal C, optional)
    NOT pursued:** stddev run 2.265 / macro 2.313 ≈ baseline 2.245/2.277 (flat); a larger `doubleCostStep` or a soft
    doubler floor would flatten the intended high-ceiling blowout identity (#39) — the tradeoff is recorded and the
    lane's character is preserved. **No design-spec number changed** — the spec catalogs knob NAMES + thresholds;
    the canonical payoff VALUES live in `shared/config/*` (reproducibility contract), which this pass edits.

60. **RATIFY the magnetic-merge-tower reachability credit (2026-07-02; closes #58d final-validation flag).**
    Decision: **KEEP** the `constructs_magnetic_merge` credit (`mergeCount>0` → `breakpointsHit`) as a legitimate
    EV-BAL-B primary payoff. An assembled merge tower is a go-tall CONSOLIDATION win-condition PURCHASED with shop
    actions (merge N magnetic units, per-unit cap `magneticMergeCap`=5) — the same payoff CLASS as the #39
    spend-gated precedent (a purchased ability counts toward reachability), not a board-state freebie. Non-vacuous:
    116/1600 macro player-games assemble one, cap reached (vs the removed Forgemaster credit's 1/1600, #58a).
    Load-bearing but passing with headroom at the #59 config: EV-BAL-B = 51.4% (run 200) / 54.8% (run 600) / 55.2%
    (macro 600) — without it ~48% (fail). Ratified as a payoff-CLASS extension, NOT a moved goalpost: the tower is a
    real payoff a competent 2-tribe splash reaches. The `EV-SIM-P5-02` firing-RATE guard (#58c, ≥20/640 run) keeps
    it honest. The alternative (drop the credit) would FAIL the gate by mis-classifying a genuine primary payoff as
    unreachable. `sim/harness.ts` flag downgraded from "awaiting ratification" to "ratified #60".

61. **Forgemaster — ACCEPT as a documented unit-test-only card (2026-07-02; closes the #55/#58a disposition).**
    Options were (a) accept the macro-sim gap, (b) raise the bot's Forgemaster/Sentinel valuation to develop it,
    (c) re-scope the card. **Chosen: (a).** Its +`forgemasterSentinelBuff`×stacks Sentinel modifier is correct and
    PINNED by EV-FRG-01..03 + golden EV-GLD-16; it fires in ~1/1600 macro player-games (bots buy the 3/5 body but
    leave it benched), so its BALANCE is macro-unvalidated — a documented gap, not a balance risk (a benched card
    cannot be OP). (b) is rejected because forcing it onto board is the exact move that broke EV-BAL-B in #57's
    interim (over-valuing it crowds real breakpoints off splash boards) — the fix must not re-introduce that; (c) is
    rejected because the mechanic is sound and eval-pinned. No `server/bots/BotAgent.ts` change. Matches the #47(b)
    precedent. Gap retained in design-spec §11.2 + the sim note.

62. **Cindermarshal go-tall (`alliesAtMost≤4`) — ACCEPT as a documented sim-coverage gap; closes the #47b/#57/#58
    deferral chain (2026-07-02).** Same three options as #61. **Chosen: ACCEPT.** The `loneVanguard*` start-of-combat
    payoff's EFFECT correctness is pinned by the EV-CON evals; the macro bots fill to `boardCap` 7 and never build
    Infernal-narrow, so the go-tall line stays unreached (verified #47b: even with the buff temporarily raised to
    +6/+6 it was unreached — the bot policy, not the number, is the limiter). Improving bot go-tall play is unmodeled
    and out of scope for a config pass; re-scoping an otherwise-functional T4 4/5 body is unwarranted. This converts
    the rolling #47b/#57/#58 deferral into a PERMANENT documented gap (design-spec §11.2), not an open TODO.

### Matchmaking rework (Round 11, cont.) — bye semantics + config honored

63. **Odd live count with no ghost available → a BYE, not a phantom fight; `ghostsEnabled` is now honored
    (2026-07-02, spec §4.4. Resolves the two items #42 deferred.)** Two latent gameplay bugs, both from the
    ghost branch running whenever the count was odd: (a) `ghostsEnabled` was **dead config** — never read, so
    ghosts always filled odd counts regardless of the flag (violates invariant #4); (b) an odd roster **before any
    elimination** (an odd seat count with bot-fill off) had `this.ghosts` empty, so `computePairings` fell through
    to a `bBoard = {units:[], playerTier:1}` — the solo seat fought a **phantom empty board**: a guaranteed "win"
    that ALSO ran the writeback fold on its side, letting its combat-fired permanents **accrue buffs every odd
    round** for free. **Fix:** the ghost branch is taken only when `ghostsEnabled` **and** a ghost exists;
    otherwise the solo seat gets a **bye** — a new `Pairing{ghost:false, bye:true, bSeat:-1}` that runs **no
    combat, no hero damage, no writeback, empty combat log** (`resolveCombatPhase` short-circuits it before the
    normal branch, which would otherwise index `sessions[-1]`). `Pairing` gains a `bye` field (shared type +
    `PairingSchema` + `makePairing` + client `toPublic`); the client's `resolveOpponent` returns `{bye:true}` so
    the shop reads "Bye · no opponent" (no highlight) and the combat scene shows a "Bye — you take no damage"
    panel instead of a stuck "Resolving combat…" on the empty log. **Reachability:** unchanged for shipped play —
    the 8-player bot-filled match starts even and always has a ghost by its first odd round, so byes only occur if
    ghosts are config-disabled or the room is seated with an odd human count and bot-fill off. Pinned by EV-MTC-10
    (no-ghost-yet bye: no damage, no free win, empty log) and EV-MTC-11 (`ghostsEnabled=false` → bye even when a
    ghost exists). No combat-outcome change for the default config; all evals green.

### Combat-replay reveal fix (Round 12) — final combat shown + outcome revealed at replay end

64. **The combat outcome is revealed when the replay ENDS, not when it starts; and the deciding
    round plays its replay before Results. (2026-07-02, spec §9.1/§10. Refines #10, #42.)** Two
    player-reported symptoms, both from `MatchRoom.resolveRound` publishing the post-combat public
    state at combat *start*: (a) **the match's final combat was never shown** — `resolveRound` set
    `phaseState = m.isFinished() ? 'finished' : 'combat'`, so the deciding round jumped **straight to
    `finished`** and the client routed to Results without a replay ("it skips right to the end");
    (b) **deaths were spoiled on the first beat** — `resolveCombatPhase` applies loss damage +
    eliminations + placement in-place, and the immediate `syncPublic()` pushed those to every client,
    so the standings sidebar (frozen behind the replay overlay) showed the new HP and moved an
    eliminated player to the dead list before the replay had played ("shows if someone died right in
    the beginning of combat"). **Fix:** `resolveRound` now (1) snapshots the pre-combat
    `hp`/`alive`/`placement` **before** resolving; (2) **always** enters `combat` — even when
    `isFinished()` — and pushes each watcher their private `combatLog` so the replay plays; (3)
    freezes the public player rows and `winnerSeat` at the snapshot for the whole `combat` window
    (`syncPublic` writes the frozen values while a `preCombat` snapshot is set); (4) on the sized
    window-end callback `revealResults`, clears the snapshot → publishes the real post-combat
    standings, emits the combat-result / elimination toasts, and transitions to **`finished`** (final
    round) or **`beginShop`** (continuing). This makes the code match the **documented §9.1 lifecycle**
    `(shop → combat)* → finished` — combat now always precedes `finished`. **No engine / combat-outcome
    change:** `resolveCombatPhase` is byte-identical and still authoritative; only the *timing of the
    public reveal* moved (private board + writeback still update at resolve so the replay has its
    `myBoard`). The window is unchanged — `combatWindowMs` over watched logs — so a skipped or bot-only
    round still just floors at `REPLAY_WINDOW_MIN_MS`. Transport-layer only; all evals green.

### Combat-replay orientation fix (Round 12, cont.) — side from the pairing, not the board

65. **The replay's "You" side and the Victory/Defeat banner are derived from the synced pairing, not
    from the viewer's board uids. (2026-07-02, spec §10. Refines #42's `resolveOpponent`.)** Found via
    multi-player Playwright testing (real humans, no bots): a player with an **empty or fully-wiped
    board** who LOST a combat saw **"Victory"** and a **mirrored** replay (the opponent's units
    labelled "You"). Root cause: `CombatReplay` inferred the viewer's combat side with
    `mySideOf(log, myUids)`, matching the viewer's board unit uids against the two combat lines — but a
    wiped/empty board contributes **no uids**, so nothing matched side `b` and it **silently defaulted
    to `a`**; when the opponent was side `a` and won, `iWon = (winner === mySide)` came out true. **Fix:**
    a new `sideForSeat(pub, seat)` (in `components.tsx`, beside `resolveOpponent`) reads the side from
    the same synced `pairings` the opponent label already uses — `aSeat → 'a'`, `bSeat → 'b'`, bye/none
    → null — which is authoritative because `resolveCombatPhase` always resolves `aSeat` as side `a`
    and `bSeat` as side `b` (live player = `a` in a ghost fight). `App.CombatScene` passes it as the
    optional `side` prop; `CombatReplay` uses `side ?? mySideOf(...)` (the board-uid inference remained
    only as the fallback for the dev `ReplayLab`, which has no pairing — **later removed entirely in
    #66**, making `side` a required prop with no fallback to silently guess wrong). **Corollary polish:** the
    end-beat caption showed the engine-internal **"Side B wins"**; since the shared beat captions are
    side-agnostic (`captionOf`, unchanged, still emits "Side A/B wins"), the presenter now personalizes
    the `end` caption to **"You win" / "\<opponent\> wins" / "Draw"** from the corrected side. **No
    engine / combat-outcome change** (transport + client only); pinned by `client/src/components.test.ts`
    (aSeat→a, bSeat→b, ghost→a, bye/none→null, agrees with `resolveOpponent`). All 275 evals green, plus
    live 2-player browser verification (empty-board loser now sees "Defeat" + "\<winner\> wins" + its own
    empty line labelled "You").

66. **The `CombatReplay` `side` prop is now REQUIRED; the `mySideOf` board-uid fallback is removed.
    (2026-07-02, spec §10. Hardens #65.)** #65 fixed the empty-board mirror by deriving the viewer's
    side from the synced pairing (`sideForSeat`), but left `mySideOf(log, myUids)` in place as a
    fallback (`side ?? mySideOf(...)`) for the dev `ReplayLab`. That fallback was the exact defect #65
    diagnosed — it silently defaults a wiped/empty board to side `a` — kept alive one `?? ` away from
    any future caller that forgot to pass `side` (e.g. a refactor dropping the prop in `App.tsx`). A
    dormant landmine, found while re-auditing the perspective path via 2-player Playwright. **Fix:**
    delete `mySideOf` entirely and make `side: 'a' | 'b'` a **required** prop, so the type checker now
    forces every caller to supply an authoritative side — the wrong-side default is no longer
    representable. `ReplayLab` (whose `myBoard` is always the side-`a` snapshot) passes `side="a"`
    explicitly. `App.CombatScene` computes `side` from `sideForSeat`; when the pairing hasn't synced yet
    (`null`), it **withholds the replay** ("Resolving combat…") instead of guessing — strictly safer
    than a board-uid inference that can't recover the side from an empty board anyway. **No engine /
    combat-outcome change** (client-only); the side↔pairing mapping stays pinned by
    `client/src/components.test.ts`, and the required prop is enforced by `pnpm typecheck`.

### Client visual redesign (Round 13) — "Dusk Battlefield" + combat VS command bar

67. **The client is reskinned "Warm Hearth" (tavern) → "Dusk Battlefield", and combat gains a VS
    command bar naming the opponent (2026-07-02, spec §10; client-only, no engine change).** The user
    asked for a *complete* visual overhaul — "a completely different background where the cards are on
    a battlefield" — and to "see the name of the player you're fighting against" in combat.
    **Chosen direction (confirmed with the user before building): mythic battlefield at dusk, whole app
    reskinned, opponent shown as a VS header with crests + HP.** Three parts: **(a)** the `styles.css`
    `:root` palette is retuned from warm leather/ember to a **Dusk Battlefield** token set (twilight
    sky, ember horizon, earthen ground) that the *whole* app — shop, lobby, results, combat — reskins
    off, so it reads as one world; **(b)** the combat overlay becomes a full **dusk arena** (sky →
    ember horizon → field, ridge silhouette, ambient embers), enemy army set back near the horizon;
    **(c)** a new **VS command bar** leads the overlay — you (teal) vs the paired player (rust), each a
    seat-coloured crest + name + live HP, resolved from the already-synced public schema (same
    `resolveOpponent`/`sideForSeat` helpers, no new server data), passed via a new **optional `header`
    prop** on `CombatReplay` (absent ⇒ the dev `ReplayLab` fallback "You vs \<opponent\>", no HP).
    **Rationale / key constraint:** the enemy-row "set back" depth is **atmosphere only (haze +
    desaturation), never `transform: scale`** — the strike choreography measures each `.bl-slot`'s rect
    relative to the field and lunges via an inner `.fx` translate, so rescaling a side would desync the
    lunge from the sprite (the same correctness class as a beat-start HP drain). Ownership colour
    (you=teal/foe=rust) is a semantic pair kept **separate** from the ember-gold accent. **No engine /
    combat-outcome / intent change**; all e2e selectors (`.board-felt`, `.tavern`, `.hero .ctl-btn.ready`,
    `.hand-fan`, the `Skip` button) and the pinned combat semantics are preserved; verified by
    `pnpm -r typecheck`, the client unit tests, a production build, and driving a real match to shop +
    combat (Playwright) — the VS bar shows the live opponent name + HP (e.g. "Mark ♥30 vs Bot 8 ♥30").

### Endgame-scaling pass (Round 14) — board-wide magnetic + high-ceiling comps

68. **Magnetic gains a BOARD-WIDE scaling axis: the T6 `boardMerges` capstone Magnaforge + two smaller
    merge-fodder units (2026-07-02, Phase 6; spec §6.3/§6.6/§8/§16.5; content `constructs_magnaforge`,
    `constructs_rivetling`, `constructs_coilcore`).** The user wants every tribe to have a *scalable, fun*
    comp reaching very high stat totals (hundreds→thousands) through **many earned, capped steps**, staying
    balanced and counterable. Constructs was the first target: magnetic was **single-carry only** (merge into
    one tower, go-tall, per-unit cap 5; #54), with no board-wide payoff and no T6 that rewarded a magnetic
    build. **Chosen:** a new **derived per-board scalar `boardMerges`** (Σ of every instance's `mergeCount`,
    computed in `toCombatBoard`, carried on `CombatBoard.boardMerges` — the Ossuary Titan/lifetimeDeaths
    plumbing pattern, invariant 1b) + a new `boardMergesAtLeast` LIVE condition. **Magnaforge (T6, 6/8 taunt)**
    is a TIERED breakpoint on it (3/6/9 → +3/+3, +5/+5, +8/+8 to your *Constructs* this combat, escalating
    ≥1.5× — a step, not a line), so assembled merges pump the WHOLE board, not one tower. It is itself the
    ideal merge target, so the tall-tower and wide-payoff lines share one body. **Rivetling (T1 2/1)** and
    **Coilcore (T3 4/3)** are pure magnetic fodder filling the merge ladder (T1–T5) so the archetype is
    reachable earlier and the higher tiers (9 needs ≥2 towers) become attainable. **Why this respects the
    binding constraints:** the high ceiling comes from MANY BOUGHT+CONSUMED merge steps, **never** by lifting
    the ×2 `multiplyFactorCap` (magnetic is additive, not a multiply) or the per-unit cap (kept at 5 — a taller
    tower is *more* poison-vulnerable, and EV-MAG-07 stays valid). All payoff numbers live in
    `config/breakpoints.ts.tiers`; the capstone buff is `permanent:false` (re-earned each combat; the §7.5
    writeback must not fold it). **Counterability (validated):** a single merged tower still folds to *any*
    poison (EV-MAG-07, EV-MGF-04); the WIDE buffed board folds to **poison that connects** (shielded/taunt
    poison → 100% loss in a 200-seed micro), cleave, and Nullforge (strips the permanent towers beneath the
    buff). **Gate (binding, macro 200×8):** single-axis margin **−9.5pp** (limit 8; mono-Constructs stacks do
    *worse* than multi-axis), reachability **58.1%** (target 50), Magnaforge assembles in **18.2%** of its
    owners' games via the bots' real `bestMerge` policy (a live, measured payoff — not a harness credit), and
    **no new OP/dead flag** on any Construct card. Pinned by EV-MAG-09 + EV-MGF-01..04 and the existing EV-MAG
    goldens; the `magnetic` keyword rulesText (was "(Deferred.)") is corrected. **This is the template for
    rolling the same rigor across the other eight tribes (paused here for review).**

69. **A triple-merge now COMBINES the three copies' stats into the golden — buffs are kept, not
    discarded (2026-07-02; spec §4.2; `shared/engine/shop.ts` `detectTriples`).** Before this, the golden
    was built fresh at `base × goldenStatMultiplier` (2×), so any permanent buffs on the consumed copies
    (magnetic merges #54/#68, folded combat write-backs #38/#39, battlecry stat-chains) simply vanished at
    the merge — a buffed pair + a vanilla third produced the same golden as three vanilla copies. **Chosen:**
    the golden's stats = `base × goldenStatMultiplier + Σ(buffs across the 3 consumed copies)`, where a
    copy's buff is its live `atk`/`hp` beyond print. Config-driven equivalent (kept, so no constant is
    hardcoded — invariant 4): `Σ(copy stats) + base × (goldenStatMultiplier − copiesForTriple)`. **This does
    NOT override decision #11's "double stats":** a fully-vanilla triple still lands at exactly `base ×
    goldenStatMultiplier` (2×) — the Σbuffs term is 0 — so #11 is the buff-free special case, not a
    contradiction. The other literal reading (golden = raw sum of all three, i.e. 3× for vanilla) was
    **rejected** by the user as it *would* have overridden #11 and inflated every golden by 50%. Result is
    floored (atk 0 / hp 1) and bounded by `statSanityBound`, matching the §6.8 stat clamps; keywords/granted
    deathrattles are out of scope here (still base-only on the golden — a possible later follow-up). Pinned by
    the extended EV-ECO-10 (`shop-triple.test.ts`): a buffed copy among the three now yields a golden at
    `2×base + the buff`, and the fully-vanilla case still asserts `base × goldenStatMultiplier`.

### Mobile input (Round 15) — touch tap-to-inspect, no logic/engine change

70. **On a touch/no-hover pointer, a card tap INSPECTS (opens a bottom sheet) instead of buying/playing;
    the purchase moves to a deliberate Buy/Play/Sell button (2026-07-02; spec §10; client-only —
    `net/hooks.ts` `useIsTouch`, `scenes/Shop.tsx`, `components.tsx` `CardTipBody`, `styles.css`).** The
    user hit this on a phone: trying to *read* a shop card bought it, because hover (the read affordance)
    and HTML5 drag-and-drop are mouse-only, and on touch a tap fires the click *with* a sticky `:hover` —
    so tap-to-read and tap-to-buy were the same gesture. Options weighed: (a) two-tap confirm on the card
    itself — rejected, a stray double-tap still buys; (b) long-press to inspect — rejected as finicky/
    undiscoverable; (c) **tap-to-inspect + an explicit action button — chosen.** A tap opens a fixed
    **inspect sheet** rendering the *same* `CardTipBody` the desktop hover tooltip uses (single-sourced, so
    the read is identical) with the zone-appropriate action(s); the in-place hover tip is suppressed on
    touch inside the shop so it can't paint over the sheet. **Scope, deliberately minimal (user: "don't do
    a whole mobile rework"):** input model only — no layout/engine/intent change (invariant 1 intact: the
    sheet sends the same `buy`/`playUnit`/`sell` ops), desktop hover+click+drag untouched, and `pending`
    target-picking still resolves on tap (that tap *is* the deliberate act). Slot-precise placement /
    reordering still needs a mouse drag; the sheet covers the buy/play/sell that were otherwise impossible
    on touch. Detection is a `matchMedia('(hover: none), (pointer: coarse)')` subscription, so plugging in a
    mouse flips back to the desktop paths live. Verified in an emulated mobile Playwright context: a tap
    opens the sheet and spends no gold / adds no unit; the Buy button then purchases.

### Client visual redesign (Round 16) — "Cozy Tavern" reskin + one-continuous-table cohesion

71. **The client art direction is reskinned "Dusk Battlefield" → "Cozy Tavern" and the whole UI is
    rebuilt as ONE continuous candlelit table; three web fonts are now loaded (2026-07-02, spec §10;
    client-only, no engine/intent change — `styles.css` `:root` + components, `index.html`, `cardArt.ts`
    `portraitBg`).** The user asked for a committed art direction — a warm, painterly, candlelit tavern
    (wood, brass, parchment, ember) — with **cohesion as the top priority: the whole game must read as a
    single lit wooden tabletop, not a stack of skinned boxes.** This **supersedes the visual direction of
    #67 (Dusk Battlefield)** but deliberately **keeps #67's combat VS command bar and its load-bearing
    correctness constraint** (enemy depth stays atmosphere/haze only, **never** `transform: scale`, so the
    measured `.bl-slot` strike geometry is intact). **What changed:** **(a)** the `styles.css` `:root` is
    repaletted warm and EXTENDED into a **two-part token system** — the existing SEMANTIC names
    (`--bg`/`--panel`/`--accent`/…) are kept (so every component keeps working) and retuned to tavern
    values, alongside a richer **Cozy-Tavern token set** (`--brass*`/`--card-face`/`--ember`/`--attack`/
    `--health`, the warm `--sh-*`/`--recess`/`--groove` depth ladder, `--r-*`/`--s*`/`--ease-*`/`--dur-*`,
    `--font-display`/`--font-name`/`--font-num`) that components migrate onto as each is restyled — still
    the **single** theme file (invariant 4: no second token file, no hardcoded values); **(b)** zones are
    separated by **light / elevation / material / negative space — never a `border:Npx solid` outline or a
    1px `.sdiv` hairline:** each region is a raised wooden surface (`--sh-*` + a lit top edge) or a recess
    carved into the wood (`--recess`), on **one depth ladder lit from one overhead candle**, with
    continuous wood grain running under the whole table; **(c)** the **card atom (`.unit`) is rebuilt as a
    parchment face in a rim-lit double-brass frame** (engraved `--font-name` name, procedural portrait
    window, a burnt-orange **Attack coin** + blood-red **Health coin**; golden = a legendary-gold frame +
    slow ember loop, token = a subtler iron frame) and is **byte-identical in the shop, on the board, in
    the catalog, AND in combat** — the old cold `.bl-slot .unit` and per-zone card reskins are removed so
    one primitive has one look everywhere (the frame is a local `--frame` token so every combat-focus glow
    ADDS to the brass instead of replacing it); **(d)** the **combat overlay is no longer a cold modal over
    another screen** — the shop furniture recedes as the candles lower (a warm deepening vignette, never a
    `#0d0a16` scrim) and the fight resolves on a surface visibly the **same wooden table pushed in** (warm
    candle pool + continuous wood grain + brass lip), replacing the dusk sky / ember-horizon / mountain-
    ridge landscape; **(e)** three **web fonts are loaded** (Google Fonts `<link>` in `index.html`:
    **Cinzel** engraved display, **Crimson Pro** card/body serif, **Inter** tabular numerals),
    **reversing the earlier "system serifs, no web-font dependency" spec-detail default** — the user
    explicitly chose to load them for the tavern read; `--serif` is repointed at `--font-display` so
    existing headings pick it up. **No engine / combat-outcome / intent change**; all e2e selectors
    (`.board-felt`, `.tavern`, `.hero`, `.hand-fan`, `.unit`, the `Skip` button) and the pinned combat
    semantics are preserved; `pnpm --filter @cardgame/client typecheck` clean, verified by driving the real
    lobby → shop → combat and the `#cards` / `#replay-lab` workbenches (Playwright) — the card atom reads
    identically in every zone and the fight sits on the same table. **In progress (not yet done):** the 3
    signature juice moments (recruit settle, tavern-up candle flare, and strike polish beyond the existing
    lunge/flash) are the remaining Cozy-Tavern work.

72. **Primordials gains a PERSISTENT ELEMENTS scaling axis: the T6 `elementsPlayed` capstone Elderstorm
    (2026-07-10, Phase 7; spec §6.3/§6.6/§8/§16.4; content `primordials_elderstorm`).** Continuing the
    #68 program — every tribe gets a *scalable, fun* comp reaching very high stat totals through **many
    earned, capped steps**, balanced and counterable — rolled **weakest ceiling first**. Primordials had the
    **weakest ceiling of the nine**: all its payoffs were shop-turn / go-wide one-shots (Stormcaller
    `battlecries≥2`, Tempest/Worldspark `alliesAtStart`), with **no persistent axis** and no T6 that rewarded
    a committed elements build, so a developed board topped out at modest per-body buffs + a board-wide cleave
    grant. **Chosen:** a new **persistent per-player counter `elementsPlayed`** (incremented in `shop.playUnit`
    per Primordial PLAYED — cloning the `forgemastersPlayed` increment site, NOT decremented on sale/death;
    carried into combat on `CombatBoard.elementsPlayed` via the Ossuary Titan/lifetimeDeaths plumbing pattern,
    invariant 1b) + a new `elementsPlayedAtLeast` LIVE condition. **Elderstorm (T6, 6/8 cleave)** is a TIERED
    breakpoint on it (4/8/12 → +3/+3, +5/+5, +8/+8 to your *Primordials* this combat, escalating ≥1.5× — a
    step, not a line), so every element channelled over the whole game pumps the WHOLE board. **Why a PLAY
    counter, not a board read (contrast #68's `boardMerges`):** it is the natural "elements you've channelled"
    fantasy and it varies the mechanism across tribes (Constructs = board-state merge count; Primordials =
    lifetime play count) — reusing the `lifetimeDeaths` persistence plumbing, incrementing like
    `forgemastersPlayed`. **No new fodder card** was needed (unlike #68's Rivetling/Coilcore): unlike magnetic,
    the counter is fed by playing ANY Primordial, so the existing 8 units already feed it. **Why this respects
    the binding constraints:** the high ceiling comes from MANY BOUGHT+PLAYED element steps, **never** by
    lifting the ×2 `multiplyFactorCap` (the buff is additive) — payoff numbers live in
    `config/breakpoints.ts.tiers`; the capstone buff is `permanent:false` (re-earned each combat; the §7.5
    writeback must not fold it). **Counterability (validated, maxed 7-wide board = ~183 atk / ~168 hp
    aggregate, 351 total, at `elementsPlayed`=27):** it folds to **poison that connects** (a shielded/taunt
    poison wall → **0% win / 85% loss** in a 200-seed micro, stat-agnostic), while **fragile poison chaff**
    (100% win for Primordials) and **tall-without-poison** (100% win) lose to the stacked wide line — the
    Magnaforge profile (you need poison-that-connects, not just any poison). **Gate (binding, macro 200×8):**
    single-axis margin **−4.2pp** (limit 8; mono-Primordials still does *worse* than multi-axis), reachability
    **55.7%** (target 50), non-linearity **8.65×** (min 1.5), stale-combat **0.00%** (flag 1%); Elderstorm's
    tier-1 (4) assembles for **21%** of its owners via the bots' real play policy (measured via
    `ownedBreakpointMaxCounter` — the Magnaforge 16.7%/#68 precedent). **Tier retune (same PR):** an initial
    8/16/24 was lowered to **4/8/12** after the macro sim showed bots reach a *max of 5* elements (they splash
    Elderstorm as a strong 6/8 cleave body rather than committing to mono-Primordials, the weakest/least-picked
    tribe) — so 8+ was unreachable in the sim. The top tiers (8/12) stay the aspirational ceiling a dedicated
    build reaches (scratchpad-proven at 27 elements → 351 aggregate), the same top-tier macro under-coverage as
    Magnaforge's ≥2-tower step (a documented characteristic, not a gate item — the aggregate reachability gate
    passes at 55.7%). **No new OP/dead flag** on any Primordial. Pinned by new goldens EV-ELM-01..02 (the
    persistent counter: tribe-gated increment, survives sale, golden counts once, rides into combat) +
    EV-ELS-01..05 (Elderstorm's tiered board-wide payoff: silent below tier, one cumulative buff per crossed
    tier, escalating, Primordials-only via `filterTribe`, this-combat-only, poison one-shots a buffed body).

73. **Corsairs gains a GOLD spend-gated scaling lever: the T6 Prizemaster (2026-07-10, Phase 7; spec
    §6.6a/§8; content `corsairs_prizemaster`; the activated-ability system gains a `currency` field).**
    Continuing the #68 program (weakest ceilings first). Corsairs was the low-STAT-ceiling tribe: a
    TEMPO/reborn+shields identity plus a gold ECONOMY (Vault Keeper raises the gold cap; Fence/Moneylender/
    Bursar generate gold) that could only buy tempo — gold never SCALED a carry. **Chosen:** the FIRST
    `currency:'gold'` spend-gated payoff (§6.6a's second legal class; the activated-ability system spent only
    gems before this). **Prizemaster (T6, 5/7 reborn)** — once per turn, spend `engines.corsairs.prizemasterCost`
    (3) GOLD to permanently give a chosen Corsair +5/+5 (a `chosenAlly filterTribe:'corsairs'` activated
    buffStats). **Why deliberately DISTINCT from the Tuskers gem-doublers (variety, not an 8th tiered
    breakpoint):** GOLD not gems; ADDITIVE +5/+5 not a ×2 multiply (so it folds to poison and is never a
    `multiplyFactorCap` concern); a CHOSEN carry not self. **Why this respects the binding constraints:** each
    +5/+5 is BOUGHT with gold you'd otherwise spend on tempo/tiering, one per turn (a real, capped step — the
    ceiling scales with the gold ECONOMY: Vault Keeper's raised cap funds more activations), **never** by
    lifting any multiplier cap; every number is a config knob (`prizemasterCost`/`prizemasterBuffAtk`/`Hp`).
    **Engine plumbing:** `ActivatedSpec.currency?` + `ActivatedAbilityState.currency` (default 'gems'),
    `activateAbility` spends the named wallet, the bot's `bestActivation` reads the matching wallet
    (`priv.gold`) so it actually uses the lever (routed through the existing chosenAlly `target` policy), and
    `Shop.tsx` shows a 🪙 gold cost. **Sim credit is the EXISTING spend-gated path** (no harness change): a used
    ability with `hasSpendGated` is credited toward reachability. **Counterability (validated, a pumped Sea Queen
    carry reaches 65/66 after 12 activations, ~130 golden — the low hundreds):** it folds to poison-that-connects
    (a shielded/taunt poison wall → **100% loss** in a 200-seed micro, one-shots the carry regardless of size,
    stat-agnostic — EV-CGL-07) and to removal/cleave; reborn/divine-shield only buys one extra life (the wall's
    other poison bodies finish the return). A big NO-poison board loses 100% to the carry. **Gate (binding, macro 200×8):** single-axis margin **−4.2pp** (limit 8), reachability
    **55.7%** (target 50), non-linearity **8.65×**, stale **0.00%**; Prizemaster is a top-5 unit by placement
    when owned (avgP 1.00) and adds **no new OP/dead flag**. Pinned by new goldens EV-CGL-01..07 (gold not gems;
    rejection mutates nothing; once-per-turn; `filterTribe`; the buff compounds across turns + rides into combat;
    registry/lint green + `abilityStates` projects `currency:'gold'`; poison one-shots the pumped carry) and the
    updated EV-ABL-09 shape golden.

74. **Wildkin gains a SWARM↔DEATHS scaling capstone that REUSES the `lifetimeDeaths` counter: the T6 Thornqueen
    (2026-07-10, Phase 7; spec §6.6/§8; content `wildkin_thornqueen`).** Continuing the #68 program (weakest
    ceilings first) — Wildkin was the **weakest tribe** (macro avgP ~5.6): a wide board of modest tokens whose
    only board payoff (Grovelord) is a flat, width-capped `countAllies` buff, with no way for the swarm's per-body
    to scale high. **Chosen (variety + no plumbing bloat, per the audit):** instead of a fourth NEW persistent
    counter, **REUSE the existing `lifetimeDeaths`** (Ossuary Titan's counter): combat deaths — including tokens —
    feed it via `match.ts`, and a WIDE board that loses bodies every combat accrues it FAST, so it needs zero
    engine/types/sim plumbing AND auto-accrues (fixing the reachability gap Elderstorm's build-gated play counter
    hit). It extends Wildkin's existing avenge/DEATHS sub-theme (Pack Mother), NOT Revenants' identity (which uses
    `revenantDeaths` + a contested double + damage amp, never a generic board-wide buff). **Thornqueen (T6, 6/7
    reborn)** is a TIERED breakpoint on `lifetimeDeaths` (24/48/72 → +3/+3, +5/+5, +8/+8 board-wide to your
    *Wildkin* this combat, escalating ≥1.5×; reborn so the queen returns to keep leading the brood and her death
    feeds the counter). **Threshold choice (measured, not guessed):** owners reach lifetimeDeaths **min 43 / median
    63 / max 97**, so an initial 8/16/24 was a flat always-on slab (100% of all tiers); raised to **24/48/72** so it
    is a GENUINE earned ramp — tier-1 reliable at acquisition (100% of owners), tier-2 usual (95%), tier-3 the
    aspirational late-game stretch (**33%**) as the dead pile up. **Why this respects the binding constraints:** the
    ceiling comes from MANY EARNED STEPS (each fallen body is a bought+lost swarm member), **never** by lifting the
    ×2 `multiplyFactorCap` (additive) — numbers live in `breakpoints.ts.tiers`; the buff is `permanent:false`
    (re-earned each combat; the §7.5 writeback must not fold it). **Counterability (validated, maxed 7-wide brood =
    ~150 atk / ~155 hp aggregate, 304 total, at lifetimeDeaths=72):** it folds to **poison-that-connects** (a
    shielded/taunt poison wall → **100% loss** in a 200-seed micro, one-shots each pumped body, stat-agnostic),
    while fragile poison chaff and cleave-that-can't-one-shot lose to the buffed width. **Gate (binding, macro
    200×8):** single-axis margin **−5.0pp** (limit 8; Wildkin stays the *weakest* tribe even with the capstone),
    reachability **55.0%** (target 50), non-linearity **8.65×**, stale **0.00%**, and **no new OP/dead flag** (the
    pre-existing Thornpup/Brambleling token DEAD flags + the Pack Mother OP flag are unchanged from before). Pinned
    by new goldens EV-SWD-01..05 (silent below tier; one cumulative buff per crossed tier; escalating; Wildkin-only
    via `filterTribe`; this-combat-only; poison one-shots a buffed body).

75. **Infernals gains a PERSISTENT few+tall SACRIFICE carry: the T6 Soulglutton (2026-07-10, Phase 7; spec
    §6.6/§7.5/§8; content `infernals_soulglutton`; EV-WBK-08 lint allowlist).** Continuing the #68 program.
    Infernals' pre-Phase-7 SACRIFICE payoffs were ALL this-combat (Bloodcaller/Abysslord death breakpoints,
    Carrion Sovereign's per-death board buff) or one-time (Gorgemaw's single battlecry eat), so the "few+tall"
    carry could never reach a very-high TOTAL — nothing PERSISTED across combats. **Chosen (variety + no
    plumbing bloat):** the first **PERMANENT combat-fired death payoff** — reuse the existing `deaths` counter,
    but flag the buff `permanent:true` so the §7.5 writeback folds it onto the SURVIVING instance and it carries
    across combats. **Soulglutton (T6, 6/9 taunt)** — the FIRST time 3+ friendlies die in a combat (once),
    permanently gain +6/+6. Each combat where you manufacture 3+ sacrifices (Infernals spend their own width via
    Hollow Priest/Pyrewalker/Dreadmaw/Maw) adds one chunk, so the carry grows TALL over the whole game. **Why
    DISTINCT from the other Phase-7 capstones:** this-combat board-wide tiered (Primordials/Wildkin) vs a
    PERMANENT SELF carry (few+tall); and distinct from Gravemonarch's contested MULTIPLY (this is an additive
    threshold, not a survive-a-near-wipe double). **Why this respects the binding constraints:** it is a
    registered `deaths` breakpoint (bounded by the anti-linear lint); the ceiling comes from MANY EARNED STEPS
    (each death is a spent body), **never** by lifting the ×2 `multiplyFactorCap` (additive); the EV-WBK-08 lint
    (which guards against *accidental* combat-fired permanence) is updated with an explicit `intentionalPersistent`
    allowlist for it (the regeneration-currency rule — semantics changed, so the pinning lint changed in the same
    PR). **Counterability (validated, carry grows to 78/81 over 12 combats — unbounded with game length, the low
    hundreds):** as a FEW+TALL single body it folds HARD to **poison** (a shielded/connecting touch → **100% loss**
    in a 200-seed micro, one-shots the giant regardless of size, stat-agnostic); a wide board of MODEST bodies does
    not out-race it, so poison (or a poison/burst-carrying wide board) is the real answer — consistent with the
    design law that poison is the universal counter to stacking (decision #1). **Reachability:** Soulglutton fires
    for **100%** of its owners (median 8 per-combat deaths — Infernals manufacture deaths by identity). **Gate
    (binding, macro 200×8):** single-axis margin **−5.1pp** (limit 8; Infernals avgP unchanged at ~4.87 — the tribe
    is not stronger overall, only its PEAK), reachability **55.6%** (target 50), stale **0.00%**, and **no new
    OP/dead flag** (Soulglutton is neither). Pinned by new goldens EV-SAC-01..04 (silent below the gate; fires once
    with a permanent folding delta; COMPOUNDS across combats via the real §7.5 writeback; poison one-shots the
    grown carry) and the updated EV-WBK-08 allowlist.

76. **Tuskers / Revenants / Reefkin — VERIFIED already-high-ceiling; no Phase-7 content change (2026-07-10;
    verification only, no code change).** The #68 program's audit classed these three as *already* having a
    scalable, high-ceiling, counterable comp, so the Phase-7 pass (weakest ceilings first) deliberately did NOT
    add content to them — only confirmed (a) their ceilings are intact after the Primordials/Corsairs/Wildkin/
    Infernals additions and (b) they still fold to poison (the stat-agnostic equalizer, decision #1). **Measured
    ceilings (throwaway scratchpad + `pnpm sim:micro`, each vs a saturated poison-that-connects wall = 100% loss):**
    **Tuskers** — the purchased ×2 gem-doubler (Ivorytusk) grows to **96/128** over 18 turns and compounds toward
    THOUSANDS across a long game (spend-gated, #39); **Revenants** — Gravemonarch's contested ×2 (survive a
    5+-death near-wipe, #46) reaches **1536/1792** over 8 near-wipes (2^N → thousands); **Reefkin** — Tidebinder's
    per-battlecry permanent board buff, DOUBLED by Echo Choir (#50), reaches **109/110** after 14 battlecry plays
    (hundreds, scaling with plays). All three are pinned by existing goldens (EV-ABL Tuskers doubler, Gravemonarch
    contested-double, EV-AUR Echo Choir, Tidebinder) and remain balanced in the macro gate (single-axis margin
    **−5.1pp**, reachability **55.6%**). **Why no touch:** adding scaling to an already-covered, macro-strong tribe
    (Reefkin was the top out-of-band tribe pre-#59; Tuskers' Warhoard is OP-flagged) risks the single-axis margin
    for zero coverage gain — the litmus is "does every tribe HAVE a high-ceiling comp," which these already pass.

77. **Sirens gains a STAT-AGNOSTIC poison-COVERAGE capstone: the T6 Venomtide (2026-07-10, Phase 7; spec §6.5/
    §8; content `sirens_venomtide`).** The final Phase-7 tribe, and the one deliberately kept DIFFERENT: per the
    session's locked **decision #1**, Sirens' scaling is measured in poison **COVERAGE/REACH — more CONNECTING
    poison bodies — NOT stat totals** (poison is the counter to everyone else's stacking, so Sirens must never
    get big stats). Sirens' problem was reach: its poison gets blanked by divine shields and its fragile bodies
    struggle to connect. **Chosen (reuses primitives, no plumbing):** at a WIDE board (`alliesAtStart≥6`),
    Venomtide grants your Sirens **Cleave** this combat — and because a poison attacker's cleave carries POISON to
    the splashed neighbours (combat `attackerPoison`), a wide poison board (innate poison + Abysscantor's
    board-poison) poisons the WHOLE enemy row per swing, REACHING past the shielded front to the bodies beside it.
    Coverage scales with the number of poison bodies (each becomes a 3-wide poison-cleaver), **never** with stats.
    **Why same primitive as Worldspark but not a dupe:** identical mechanism (`alliesAtStart`→board `cleave`),
    different PURPOSE — poison DELIVERY, not damage splash; this-combat only (a combat `grantKeyword` never
    persists). **Counterability (validated, decision #1 counter UNCHANGED):** a maxed wide poison-cleave board (7
    low-stat poison bodies) is measured in COVERAGE — it BEATS every stacking comp (**83% vs a Wildkin brood, 100%
    vs an Infernals 120/120 carry, 100% vs a Corsairs 65/66 carry** — poison ignores their stats) yet FOLDS to the
    **divine-SHIELD wall** (7× DS taunt → **0% win / 61% loss**: each shield blanks one poison instance, so the
    opponent answers coverage by shielding MORE, not by out-stat-ing), plus the fragile low-stat Sirens are
    out-tempo'd if walled. **Reachability:** thin in the macro (Sirens is the least-picked tribe at ~3.6%, and the
    capstone needs a WIDE poison board — like Elderstorm's build-gated coverage; the aggregate reachability gate
    still passes), but it fires for 100% of the owners who build wide, and the COVERAGE ceiling is scratchpad-proven.
    **Gate (binding, macro 200×8):** single-axis margin **−6.0pp** (limit 8; Sirens mono stays weaker than
    multi-axis), reachability **56.4%** (target 50), stale **0.00%**, and **no new OP/dead flag**. Pinned by new
    goldens EV-CVG-01..04 (no cleave below the width gate; Sirens gain cleave at it; a poison-cleaver poisons the
    SPLASHED neighbours = coverage; a divine shield blanks the poison instance = the unchanged counter).

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
