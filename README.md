# Mythic Menagerie — an 8-player auto-battler

A round-based, server-authoritative auto-battler (shop phase → auto-resolved combat →
placement) built clean-room from the mechanics catalog in `season10_interaction_reference.xlsx`.
All content is original by construction (see `design-spec.md` §0). Built directly from
`design-spec.md` (the build document) and `requirements.md` (the decision ledger).

## Quick start

```bash
pnpm install

# play it: run the server and client in two terminals
pnpm dev:server      # Colyseus authoritative server on ws://localhost:2567
pnpm dev:client      # Vite client on http://localhost:5173
```

Open http://localhost:5173, **Create room (with bots)**, **Start match**, then shop and
**Ready up** each round. Empty seats are filled with heuristic bots, so one human can play
a full 8-player match solo.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev:server` | Colyseus server (authoritative rooms). |
| `pnpm dev:client` | React + Vite client (placeholder art). |
| `pnpm sim:micro` | Combat simulator: fixed boards × N seeds → win/tie/loss% (`--seeds=2000`). |
| `pnpm sim:macro` | Full-match simulator: 8 bots × M matches → tribe/unit placement + outlier flags (`--matches=600`). |
| `pnpm test` | Engine unit tests — determinism (fixed seeds) + every keyword timing. |
| `pnpm test:e2e` | Playwright: create room → bot-fill → play a full match to a winner. |
| `pnpm typecheck` | Typecheck every workspace. |

Simulator output (CSV/JSON) is written to `sim-out/`.

## Architecture

pnpm-workspaces monorepo; `shared` is the single source of truth imported by the others.

```
shared/   types, config (all tunable numbers), content (units/tribes/keywords),
          and the PURE no-IO engine: rng, combat, shop, effects, auras, handlers,
          match orchestrator.
server/   Colyseus MatchRoom (two-channel state, timer/ready-up, reconnect→bot-takeover)
          + BotAgent (heuristic, tribe-aware — reused by the sim).
client/   React + Vite. Lobby / Shop / animated CombatReplay / Results.
sim/      headless harness importing the SAME engine + server bots (micro, macro, report).
```

Four load-bearing invariants (from the spec) hold throughout:

1. **Server-authoritative** — clients send *intents only*; every intent is validated
   server-side before applying.
2. **Seeded determinism** — `resolveCombat(boardA, boardB, seed)` is a pure function:
   same inputs → byte-identical `CombatEvent[]`. This is the priority test
   (`shared/engine/combat.test.ts`) and what makes replays + the simulator work.
3. **Two-channel privacy** — public schema (HP, tier, alive/placement, pairings) syncs to
   all; private state (shop, bench, board, gold, your combat log) is pushed only to the
   owning client. No opponent private info leaves the server.
4. **Config-driven balance** — no gameplay constant is hardcoded in logic; every number
   lives in `shared/config/*`. Tuning balance = edit config/content data + re-run the
   simulator, never a logic change.

**Effect model (hybrid).** ~90% of unit behavior is declarative data
(`{trigger, condition?, target, actions[]}` + passive `AuraSpec`s); the rare bespoke
behavior uses a registered `custom` handler. Only one handler exists in the slice
(`replayAdjacentDeathrattle`). New units = new rows in `shared/content/units.ts`.

## Content (vertical slice)

Three original tribes, 24 purchasable units + 2 tokens across tiers 1–6, spanning the
reference engines:

- **Wildkin** — token swarm: generator + amplifier (Mother Thorn), avenge (Pack Mother),
  cleave, end-of-turn trigger multiplier (Grovecaller), and the custom-handler showcase
  (Bonepiper).
- **Reefkin** — battlecry tempo: stat-chain, single-target megabuff, poison & divine-shield
  carriers, and the battlecry doubler aura (Echo Choir).
- **Revenants** — death payoffs: reborn, board-wide deathrattle buffs, and the tribe-wide
  damage-amplifier aura (Pale Lich).

Keywords: taunt, divine shield, poison, reborn, cleave (magnetic is reserved/deferred).

## Balance

`pnpm sim:macro` plays hundreds of full bot matches and flags outliers **relative to each
unit's own tier** (avg placement is otherwise biased by *when* a board holds a unit). The
first balance pass narrowed the tribe spread from ~2.5 placements to ~1.2 and removed the
original tribe-wide dominance; the workflow is config/data-only (zero logic changes).

Current read (600 matches): all three tribes are viable (Revenants ~3.8 avg / Reefkin ~4.4
/ Wildkin ~5.0; neutral = 4.5). Remaining flags are explainable rather than balance-breaking:
*Tombspawn* is simply the strongest 2-drop, and *Bonepiper* is a niche combo piece the
heuristic bots rarely assemble (spec risk §5) — it places well when it does appear. These
are starting numbers; the sim is the tool to keep tuning them.

## Status vs. spec milestones

M0 skeleton · M1 shop loop · M2 combat engine (+ determinism tests) · M3 full round loop
(pairing + ghosts + placement + timer/ready-up + client replay) · M4 content + triples →
golden + Discover · M5 micro-sim + first balance pass · M6 macro-sim + bot difficulty
presets + reconnect→bot-takeover — all implemented.
