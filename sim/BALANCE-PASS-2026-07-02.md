# Config balance-tuning pass — 2026-07-02 (post-rework spread compression)

Successor to `POST-REWORK-2026-07-02.md`. Records the **config-only** balance pass that was
deferred out of the #38–#58 rework (invariant #4: "tuning = edit config + re-run the sim, never a
logic change"). Ledger: requirements.md #59 (the pass) + #60/#61/#62 (the three ratified decisions).
Commands: `pnpm --filter @cardgame/sim report` (seed `run`) + `pnpm sim:macro` (seed `macro`).

## Methodology note — measure at 600 matches, not 200

The `POST-REWORK` note's per-tribe win rates were read at **200 matches**, where the metric (fraction
placing 1st, n=50–190 per tribe/seed) swings **±20–25pp** run-to-run — enough that a Wildkin buff
*appeared* to drop Primordials 27pp (pure sampling noise) and Constructs read anywhere from 133% to
176%. This pass makes decisions at **600 matches** (±few pp), and reports the stable numbers below. The
200-match figures in `POST-REWORK` are noise-inflated; treat these as the truer picture. (The official
`report`/`macro` gate numbers below are still the canonical 200-match runs, for methodology continuity.)

## The four levers (all `shared/config/*`; no logic, no content, no new knobs)

| Lever | Card | Change | Why |
|---|---|---|---|
| 1 | `reefkin_pearlguard` | shield-break board payoff **1/3 → 1/2** | Reefkin was the top out-of-band tribe (~215-220%); this payoff fires nearly every combat (the one *reaching* Reefkin knob) |
| 2 | `wildkin_thornwarden` | `alliesAtStart` payoff **2/4 → 3/5** | Wildkin's 24%-pick go-wide anchor was too weak (~26-34% of mean) |
| 3 | `primordials_stormcaller` | `battlecries` board payoff **2/1 → 3/3** | Primordials' reachable board buff was tiny + gave no hp (~50% of mean) |
| 4 | `wildkin_packmother` | avenge payoff **2/2 → 3/3** | the SWARM↔DEATHS carrier that rescued Wildkin from the floor |

## §11.3 gates — all 8 PASS (both seeds), 269 tests green, typecheck clean

| Gate | report (run) | macro (macro) | threshold |
|---|---|---|---|
| (a) single-axis margin | −5.8pp | −8.3pp | ≤ +8pp |
| (b) reachability | 51.4% | 55.5% | ≥ 50% |
| (c) breakpoint lint | 0 | 0 | 0 |
| (d) non-linearity | 8.65 | 8.65 | ≥ 1.5 |
| (e) caps lint | 0 | 0 | 0 |
| (f) anti-degeneracy | UW0/unc0 | UW0/unc0 | 0 |
| (g) stale-combat | 0.00% | 0.00% | ≤ 1% |
| coherence (Part B) | PASS | PASS | — |

## Per-tribe win rate — before → after (600-match, % of mean tribe win rate; band [40%,160%])

Baseline = the pre-pass config re-measured at 600 matches (apples-to-apples, not the noisy 200-match note).

| Tribe | run before | run after | macro before | macro after |
|---|---|---|---|---|
| Reefkin | **248%** | **189%** ⚠ | **214%** | **176%** ⚠ |
| Constructs | 133% | 145% | 147% | 140% |
| Corsairs | 100% | 99% | 105% | 105% |
| Revenants | 87% | 103% | 71% | 89% |
| Sirens | 82% | 83% | 67% | 83% |
| Tuskers | 84% | 80% | 93% | 86% |
| Infernals | 66% | 73% | 90% | 84% |
| Wildkin | 43% | 69% | 48% | 53% |
| Primordials | 57% | 59% | 65% | 85% |
| **spread (range)** | 43–248% (5.8×) | **59–189% (3.2×)** | 48–214% (4.5×) | **53–176% (3.3×)** |

## Success criteria

1. **Infernals + Revenants off the bottom-two — HELD.** Both mid-pack (avgP ~4.3-4.6); bottom-two are
   Primordials/Wildkin (the pre-existing weak tribes), same as the rework.
2. **Win-rate spread narrowed — MET (partially, config-limited).** Range compressed ~1.8× on both seeds;
   the two weak tribes (Primordials, Wildkin) lifted into band; **the only residual out-of-band tribe is
   Reefkin (176-189%).** See the config-limit below.
3. **Tusker variance — NOT pursued (optional).** stddev run 2.265 / macro 2.313 ≈ baseline 2.245/2.277
   (flat). A larger `doubleCostStep` / soft doubler floor would flatten the intended high-ceiling blowout
   identity (#39); the tradeoff is recorded, the lane's character preserved.

## Config-limited residual (the honest finding: some targets are unreachable by config alone)

**Reefkin (176-189%) and, in tension with it, Constructs cannot both be pulled ≤160% by config alone**,
because their win share rides on **hardcoded BODIES with no config knob**:
- Reefkin: `pearlguard` 2/3 DS+taunt (24% pick) + `spinefish`/`coralwarden`/`brineling` keyword-GRANT
  utility (poison / divine-shield — binary keywords, not stats). Only pearlguard's board payoff is a knob.
- Constructs: `cogling` 2/2 deathrattle-token (21% pick) + `bulwark` 2/4 DS+taunt. Its only reaching knobs
  are the gate-B-tied `magneticMergeCap` and the dead-in-sim `forgemasterSentinelBuff`. (`mechDeathToken*`,
  `spellcraftBuff*`, `spellpowerPerCast`, `buffPerToken`, `elementalPlayBuffHp` are all **verified-dead knobs**.)

The **zero-sum apex coupling**: pushing pearlguard 1/3→**1/1** cuts Reefkin to 172% but transfers the lost
wins to the untouchable Constructs (133→174%, out) for no net spread gain. So **1/2 is the sweet spot** —
shave Reefkin maximally without overflowing Constructs (which stays 140-145%, in band). The change that
would actually close it is a **content edit** (out of scope for a config-only pass): trim the
pearlguard/cogling/bulwark **body** stats (e.g. pearlguard 2/3→2/2, Sentinel 6/6→5/5) or convert those
body stats into config knobs so they become tunable.

**Levers that did NOT reach in bot play (tried + reverted, byte-≈-identical output):** motherthorn
threshold 3→2, tokenDeathFloor 1→2 / cap 6→10, chorustide 3/3→2/2, elementalPlayBuffAtk 2→3, burstDamage
3→5. Bots rarely satisfy shop-turn / battlecry-gated conditions or this-combat token payoffs — only
frequently-firing effects + on-board body payoffs move a tribe. (This is why levers 1–4 above are all
either a near-always-firing payoff or a common on-board body.)

## OP-flag disposition (goal B)

- `corsairs_marauder` (2.0-2.3, both seeds): config-nerfable (breakpoint 2/1→1/1) **but** redistributes to
  the untouchable Constructs → net goal-A regression → **left as-is + documented**.
- `tuskers_warhoard` (1.9-2.4, both seeds): **no isolated config lever** (5/6 taunt body + hardcoded
  deathrattle +2/+2 + the *shared* `gemBaseValue`). Needs a content edit to isolate → documented.
- `wildkin_packmother` (2.0-2.1): a NEW flag from lever 4 — the deliberate carrier that rescued Wildkin.
  Retained as an acceptable build-around outlier (dialing to 3/2 drops Wildkin toward the floor, feeds the
  apexes, and does not clear the flag; folds to poison + being killed before deaths accrue).
- `corsairs_seaqueen` (1.8-2.1, 600-match only): hardcoded 5/6 DS+taunt body + hardcoded battlecry — no lever.

## Decisions ratified this pass (see requirements.md)

- **#60 — merge-tower reachability credit: RATIFIED** (kept). A legitimate assembled go-tall primary payoff
  (116/1600, cap reached), same class as the #39 spend-gated precedent; load-bearing (without it ~48%, fail)
  and passing with headroom (51.4/55.5%). Not a moved goalpost.
- **#61 — Forgemaster: ACCEPTED as a documented unit-test-only card.** Combat scalar pinned by EV-FRG-01..03
  + EV-GLD-16; macro non-coverage (~1/1600) is a documented gap, not tuned away (forcing it onto board broke
  EV-BAL-B in #57's interim). No bot-valuation change.
- **#62 — Cindermarshal go-tall: ACCEPTED as a documented sim-coverage gap.** Effect pinned by EV-CON; bots
  fill to boardCap 7 and never go Infernal-narrow. Closes the #47b/#57/#58 deferral chain permanently.
