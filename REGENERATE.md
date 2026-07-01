# REGENERATE — start here

This directory is a **regeneration seed** (Chad Fowler's Phoenix / regenerative-software
model). The durable truth is present; the disposable code has been removed and is to be
**rebuilt from the spec + evals**. This is not a broken project — the missing engine/server/
client/sim are *supposed* to be missing.

> Backup: the last full working build is at `../cardfightinggame/` (untouched). Diff against it
> only to sanity-check, **never** to copy engine behavior back in — that reimports the known
> §7.6 combat-ordering bugs the regeneration exists to fix.

## What's frozen (DO NOT EDIT — this is the ground truth)
- `shared/types/` — the type unions (the interface vocabulary)
- `shared/config/` — every balance number (economy, match, combat, triples, engines,
  breakpoints, systems, bots, sim)
- `shared/content/` — the 90-unit roster, tribes, keywords
- `design-spec.md` (§§6–8 = engine intent, §9.7 = interface contract), `EVALS.md` (the
  acceptance suite), `DECISIONS-NEEDED.md`, `requirements.md`, `WEB-FRAMEWORK.md`,
  `CLAUDE.md`, `season10_interaction_reference.xlsx` (functional reference only — clean-room §0).

## Carried forward (craft — REUSE, don't regenerate)
The procedural card art is **craft, not logic**: the spec (§10) pins its *rules* (procedural
`data→SVG`, per-tribe recipe, keyword/axis icons, no asset files, clean-room), not its exact
*output* — no eval scores how a card looks. Regenerating it would produce a *different*, not a
*more-correct*, result, discarding tuned game-feel for nothing. These files are pure functions
of the **frozen** `@cardgame/shared` data (no engine coupling, clean-room by construction), so
they survive the engine rebuild untouched. Present in the seed at `client/src/`:
- `cardArt.ts` — the `string→SVG` face system (pure; imports only `TribeId`/`TRIBES`)
- `icons.ts` — tribe/keyword/axis icon geometry (pure)
- `styles.css` — the visual system
- `cardArt.test.ts` — the purity/coverage guarantee for the above

Wire the regenerated client **around** these — do not rewrite them. (If the goal is to *prove*
full regenerability or you want a fresh look, regenerating them is clean-room-safe — you just
lose the current recipes.)

## What to rebuild (deleted — regenerate from the above)
- `shared/engine/` — the pure engine: `rng`, `combat`, `shop`, `effects`, `auras`,
  `breakpoints`, `handlers/` (the 2 custom handlers), `instances`, `state`, `pool`, `match`.
  `shared/index.ts` still re-exports `./engine`, so `shared` will not typecheck until this
  exists — expected.
- `server/` — Colyseus rooms, two-channel state, bots, pairing, reconnect (spec §9).
- `sim/` — micro + macro sim and the §11.3 balance gate (reuses the engine + server bots).
- `client/` — React + Vite **wiring only** (spec §10 + `WEB-FRAMEWORK.md`): the workspace
  scaffolding (`package.json`, `tsconfig`, `vite.config`, `index.html`), `App`/`main`, the
  `net/` Colyseus client, the scenes (`Lobby`, `Shop`, `CombatReplay`, `Results`), `components`,
  and `combatBeats.ts` (the causal-beat segmentation — client-only logic with a §10 spec + a
  test). **Reuse the carried-forward `client/src/{cardArt,icons,styles}` — build the scenes and
  components around them.**
- test files + `e2e/` — regenerated to *implement* `EVALS.md`.

## Build order (spec §14.2)
1. Confirm the frozen data/types compile.
2. **Engine + goldens** — every `[live]` primitive in §6.9 with the §6.8 code-only semantics
   + the 2 handlers (§6.5). **Pin combat ordering to §7.1–7.3 *intent* (D1–D3), not to any
   legacy behavior.**
3. **Server** — §9.
4. **Sim** — micro → macro → §11.3 gate.
5. **Client** — §10.

## Acceptance gate
Every eval in `EVALS.md` green (`P` property + `G` intra-impl determinism goldens generated
*from the corrected engine* per D4 + `B` balance gate). The evals that are **RED against the old
`../cardfightinggame` engine by design** — `EV-DTH-08/09/10`, `EV-KW-CLV-DS`, `EV-INV-CFG` —
must come out **GREEN** here: that green *is* the regeneration succeeding.

## One open decision — D11(a)
`destroy` is promoted from the `dealDamage:999` idiom (§6.9, EV-ACT-DESTROY). The lone open
sub-ruling: does `destroy` **bypass a divine shield** (recommended) or stay blockable? Either
rule it and edit the 4 rows in `units.ts` (`{type:'destroy'}`) + fold `sacrifice→destroy` in
`types` before starting, **or** leave the idiom and accept that `EV-VOCAB-01`'s anti-idiom
clause stays RED until you do. See `DECISIONS-NEEDED.md` D11.

## Run (after regenerating)
```bash
pnpm install
pnpm typecheck && pnpm test          # test = EVALS implemented; expect all green
pnpm dev:server                       # ws://localhost:2567
pnpm dev:client                       # http://localhost:5173
pnpm sim:micro   # pnpm sim:macro
```

## Prompt to hand a fresh agent (run from this directory)
> Regenerate this auto-battler from its frozen spec. **Authority (do not violate):**
> `shared/content/*`, `shared/config/*`, `shared/types/*` are FROZEN ground truth — never edit.
> `design-spec.md §§6–8` + `EVALS.md` are the engine intent; `§9.7` is the interface contract.
> `shared/engine`, `server`, `sim`, and the `client` *logic* were deleted on purpose — rebuild
> them in the §14.2 order. **`client/src/{cardArt.ts, icons.ts, styles.css, cardArt.test.ts}`
> are carried-forward craft — reuse them as-is and build the client wiring around them; do not
> rewrite the art.** Correctness = `EVALS.md` green, not any legacy behavior. Pin combat ordering to
> the decided intent in §7.1–7.3 (D1–D3): simultaneous deaths, attacker-side-first cross-side
> order, no-swing-on-self-kill, cleave-recompute-after-shield-break. Honor the four invariants
> (§1). Generate `EV-GLD-*` determinism goldens from your corrected engine (D4 — do not
> reproduce any prior byte log). D11 is the only open human decision — [state your D11(a)
> ruling, or leave the `dealDamage:999` idiom and note EV-VOCAB-01 stays RED].
