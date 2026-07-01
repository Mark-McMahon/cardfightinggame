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
      pairing (tracer + reticle + dim the rest), buff `source` + `permanent/temporary`
      surfaced (gold/🔒 vs blue/⏳), **impact-weighted pacing** with manual step/scrub +
      speed, and cause→effect ordering. This **reverses #26's "no effect labels"** for the
      source/permanence cues specifically (still clean-room). Required one **additive**
      engine change — `stats` events now carry `sourceId` + `permanent` (`combatBeats.ts`
      holds the render-free, unit-tested segmentation). *Known gap surfaced:* combat is a
      pure function, so `permanent` is intent only — buffs aren't yet written back to the
      board across combats (`match.ts`); flagged, not fixed.
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

**All major branches resolved (30 decisions across 6 rounds; #30 = per-card procedural art).**

✅ **Full spec written → [`design-spec.md`](./design-spec.md)** (16 sections, developer-ready).
✅ **v1 implemented** (M0–M6 — see `README.md`).
🔜 **Round-6 redesign spec → [`design-spec.md` §16](./design-spec.md)** — game-feel + content
   depth; ready for a fresh agent to implement. Build order in §16.8; the multiplier-cap +
   reachability-metric gate (decisions 25/29) must clear before content ships.
