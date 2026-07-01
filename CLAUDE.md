# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state: v1 + expansions built; spec consolidated

The monorepo is **built and playable** (M0–M6 — see `README.md`): `shared` engine,
`server` (Colyseus), `client` (React+Vite), and `sim`. Content has expanded past the
original 3-tribe slice to **all nine tribes** (Prompt-2: Infernals/Constructs; Round-6:
Tuskers/Primordials/Sirens/Corsairs), and the client was rebuilt for game-feel (procedural
cards, causal-beat combat replay, drag-and-drop shop).

- **`design-spec.md`** — the self-contained, developer-ready build document, now a **single current-state spec** (the old v1/§16 split is collapsed). **Read this first**, starting with the "reproducibility contract" preamble: canonical data lives in `shared/content/*` + `shared/config/*`; engine semantics are pinned by §§6–8 + the `shared/engine/*.test.ts` goldens. **§7.6 records known combat-timing divergences** (a real open correctness item — intent vs current code).
- **`requirements.md`** — the decision ledger: 29 locked decisions across 6 rounds, with rationale. Consult when a design choice is ambiguous; it records *why* each was made.
- **`season10_interaction_reference.xlsx`** — the mechanics source of truth (9 tribes / 26 engines / 7 cross-tribe systems). **Functional reference only** (see clean-room rule below). The `.xlsx` is binary; use a tool that can read sheets, not `cat`.

**Balance gate (design-spec §11.3, §14), binding on new content:** the three multipliers
(Grovecaller, Echo Choir, Pale Lich) must have config caps, Pale Lich stays a breakpoint
(`activeWhen`), and the sim's reachability metric must hold **before** new content ships.
Validate content/numbers (config + sim) before animating cards.

## Binding constraint: clean-room rule (design-spec §0)

This overrides everything else. Build **only from functional mechanics** in the reference file. **Never ship** any card name, ability text, flavor, hero name, art, or branding from any existing game — and never ship the nine reference tribe names (Beasts, Murlocs, Demons, Quilboar, Elementals, Nagas, Undead, Mechs, Pirates). All content is original by construction. The reference names appear only as left-column cross-references in the docs and must never leave this repo. When in doubt, pick the more clearly-original option and note it.

Original tribe names (theme "mythic menagerie"): Wildkin, Reefkin, Infernals, Tuskers, Primordials, Sirens, Revenants, Constructs, Corsairs. **The vertical slice uses only Wildkin, Revenants, Reefkin.**

## Planned architecture (the parts that span multiple files)

**Monorepo, pnpm workspaces, TypeScript everywhere.** Four workspaces; `shared` is the single source of truth imported by the other three:

- **`shared/`** — types, config, content, and the **pure (no-IO) engine**. `engine/combat.ts` exposes `resolve(boardA, boardB, seed) -> CombatEvent[]`. Also `rng.ts` (seeded PRNG), `shop.ts`, `effects.ts` (declarative resolver), `auras.ts` (passive-modifier queries), `handlers/` (the custom escape-hatch registry).
- **`server/`** — Colyseus authoritative rooms (`rooms/MatchRoom.ts`), bots (`bots/BotAgent.ts`), pairing, reconnect.
- **`client/`** — React + Vite, placeholder art only (colored shapes + text), combat-log replay.
- **`sim/`** — headless harness that imports the **same** `shared` engine and `server` bots (never re-implements them): `micro.ts` (board-vs-board × N seeds), `macro.ts` (8 bots × M matches), `report.ts`.

Four load-bearing invariants that shape almost every file — violating any of them breaks the design:

1. **Server-authoritative.** The server owns all gold, shop, pool, RNG/seeds, combat, HP, pairings, placement. Clients send **intents only** and render state; every intent is validated server-side before applying.
2. **Seeded determinism.** Combat is a pure function of `(boards, seed)`: same inputs → byte-identical `CombatEvent[]`. *All* combat randomness (targeting, first-attacker tiebreak) draws from the seeded PRNG. This is what makes replay, debugging, and the simulator work — it is a first-class test target, not an aside. Any new `custom` handler needs a determinism test.
3. **Two-channel state privacy.** Public room schema (HP, tier, alive/placement, pairings) syncs to all via `@colyseus/schema`. Private state (shop, hand, board, gold, that player's combat log) is pushed only to the owning client. **No opponent private info ever leaves the server.**
4. **Config-driven balance.** No gameplay constant is hardcoded in logic. Every number lives in `shared/config/*` (catalog in spec §12). Tuning balance = edit config + re-run the simulator, never a logic change.

**Effect data model — hybrid (spec §6).** ~90% of unit effects are pure declarative data: `{trigger, condition?, target, actions[]}` plus passive `AuraSpec`s for multipliers/cost-reduction. The rare ~10% bespoke behaviors use a registered `custom` handler id + params. New units = new data rows in `shared/content/`, requiring no new code. Only 2 of the 26 reference engines need a handler (see spec §8 mapping table). Guard this ratio: keep the escape-hatch rare and isolated so the data model doesn't erode.

**Keyword timing lives in the engine, not in data** (spec §6.5, §7.3). Data only tags which units carry a keyword (`taunt`, `divineShield`, `poison`, `reborn`, `cleave`, `magnetic`); the *timing/resolution* rules are logic in the combat engine. Targeted (`chosenAlly`) effects resolve during the shop phase so combat needs no human input and stays pure.

## Planned commands (define these in package.json as you build)

```
pnpm dev:server     # Colyseus server
pnpm dev:client     # Vite client
pnpm sim:micro      # combat simulator: two boards × N seeds -> win/tie/loss%
pnpm sim:macro      # full-match simulator: 8 bots × M matches -> placement/pick/win rates
pnpm typecheck
pnpm test           # engine unit tests; determinism (fixed seeds) + keyword-timing cases
```

The determinism test is the priority test: same `(boards, seed)` must produce identical `CombatEvent[]` across runs.

## Build order (spec §14.2 milestones)

M0 skeleton (monorepo + seeded PRNG + Colyseus room seating 8 + bot-fill) → M1 shop loop → M2 combat engine (build the micro-sim alongside it; both consume the engine) → M3 full round loop → M4 content + triples → M5 micro-sim + first balance pass → M6 macro-sim + bot polish + reconnection.
