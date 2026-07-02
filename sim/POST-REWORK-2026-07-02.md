# Post-rework sim state — 2026-07-02 (multi-lane scaling & strategy rework, Phases 1–5)

Final validation at HEAD after ledger decisions #38–#58. Compare to
`BASELINE-2026-07-01.md` (pre-rework). Commands: `pnpm --filter @cardgame/sim report`
(seed `run`) + `pnpm sim:macro` (seed `macro`), 200 matches each. Methodology identical to
the baseline note (tribe = `classifyBoard(peakBoard).dominantTribe`; win rate = fraction
placing 1st; Tusker stddev = population stddev over raw placements).

## §11.3 gates — all 8 PASS (both seeds)

| Gate | report | macro | threshold |
|---|---|---|---|
| (a) single-axis margin | −6.5pp | −8.4pp | ≤ +8pp |
| (b) reachability | 52.6% | 54.4% | ≥ 50% |
| (c) breakpoint+spend-gated+contested lint | 0 | 0 | 0 |
| (d) non-linearity step ratio | 8.65 | 8.65 | ≥ 1.5 (baseline 10.29) |
| (e) caps lint | 0 | 0 | 0 |
| (f) anti-degeneracy floor | UW=0 / uncountered=0 | same | 0 |
| (g) stale-combat | 0.00% | 0.00% | ≤ 1% |
| coherence (Part B) | PASS | PASS | — |

## Per-tribe (report/run; mean tribe win rate 12.6%)

| Tribe | avgPlacement (base→now) | winRate | % of mean |
|---|---|---|---|
| Reefkin | 3.33 → 3.31 | 27.8% | 220% |
| Constructs | 4.01 → 3.70 | 19.1% | 151% |
| Corsairs | 4.18 → 4.34 | 14.6% | 116% |
| Sirens | 4.75 → 4.38 | 14.0% | 111% |
| Revenants | 4.70 → 4.28 | 10.3% | 82% |
| Tuskers | 4.91 → 4.80 | 10.9% | 87% |
| Infernals | 4.78 → 4.57 | 8.6% | 68% |
| Primordials | 4.87 → 5.53 | 3.9% | 31% |
| Wildkin | 5.47 → 5.91 | 4.3% | 34% |

## Success criteria

1. **Infernals + Revenants no longer bottom-two — MET.** Bottom-two are now
   Primordials + Wildkin on both seeds; Infernals (4.57) and Revenants (4.28) are mid-pack.
2. **No tribe outside the win-rate band — UNMET.** Reefkin (~220%) and Constructs (~151%)
   are too strong; Primordials (31%) and Wildkin (34% run) too weak.
3. **Tusker placement variance materially reduced — UNMET.** stddev 2.245→2.279 (run),
   2.277→2.230 (macro): effectively flat. (Tusker *pick rate* more than doubled and mean
   placement improved slightly; the purchased-doubler paced the mechanic but did not tighten
   outcome dispersion.)

Persistent auto-flags: OP `corsairs_marauder`, `tuskers_warhoard` (both seeds),
`constructs_titanforge`; DEAD `wildkin_thornpup`, `wildkin_brambleling` (both seeds),
`primordials_tideling` (macro).

## Proposed tuning — FOR REVIEW, NOT APPLIED (per the rework "no number tuning beyond spec" rule)

These are config-only (`shared/config/*`) candidates for a *separate* balance pass; the sim
must be re-run after each. None were applied in the rework PR.

- **Lift Primordials/Wildkin off the floor.** Both are the pre-existing weak tribes (Phase 4's
  gate spread raised Grovelord/Worldspark to 7 but, isolated, did not worsen them vs their true
  predecessor). Candidates: lower `wildkin_thornpup`/`wildkin_brambleling` gate or raise their
  floor payoff (both DEAD ~6.5); revisit `primordials_tideling`/`gustling`; consider dropping
  Grovelord/Worldspark back to 6 if the full-board gate proves too steep for the tribe's tempo.
- **Rein in Reefkin/Constructs.** Reefkin ~220% and Constructs ~151% of mean. Candidates:
  `reefkin_pearlguard` (recurring OP flag), the Reefkin battlecry-chain knobs; Constructs'
  `titanforge` (OP 2.30) — its own on-summon Sentinel body is the driver, so a small Sentinel
  stat or Titanforge-gate tweak, not a Forgemaster change.
- **Individual OP flags:** `corsairs_marauder` and `tuskers_warhoard` are flagged on both seeds.
- **Tusker variance:** if tightening is wanted, consider a soft floor on the doubler line or a
  larger `doubleCostStep` so all-in blowouts are rarer — but weigh against the intended
  high-ceiling identity.

## Open items flagged during the rework (for human ratification)

- **Merge-tower reachability credit (#58d).** EV-BAL-B (the binding reachability gate) counts an
  assembled magnetic-merge tower (`mergeCount>0`) as a primary payoff. Without it, the 8 new
  Phase-4/5 pool cards dilute reachability to ~48% (fail); with it, 52.6% (pass). The credit is
  non-vacuous (116/1600 player-games assemble a tower, cap reached) and mirrors the #39
  spend-gated precedent, but it is a metric-class extension that landed alongside the content it
  validates — a human should confirm merge-tower assembly is a legitimate primary payoff rather
  than a moved goalpost.
- **Forgemaster dead in sim (#58).** Forgemaster's +1/+1-per-stack Sentinel modifier is correct
  and unit-test-pinned (EV-FRG-01..03, EV-GLD-16) but fires in ~1/1600 macro player-games (bots
  buy it but rarely develop it), so its *balance* is unvalidated by the macro sim. Documented gap,
  not tuned away (raising its valuation to force it onto board is what broke EV-BAL-B in an
  interim attempt).
- **Cindermarshal go-tall (#47b).** Its `alliesAtMost≤4` start-of-combat payoff stays unreached in
  the macro sim (bots fill to boardCap 7); effect correctness is pinned by EV-CON evals. Deferred.
