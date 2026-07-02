# DECISIONS-NEEDED — human rulings required before evals can be pinned

Every item is an ambiguity, silence, or contradiction that a code-gen agent would otherwise
**guess**. Per the guardrails these are escalated, not resolved here. Each blocks one or more
`EVALS.md` entries and is anchored to its spec home in `design-spec.md` (D1–D10 rulings are now
written in as decided; D11's open sub-ruling is tracked in §6.9/§6.3). Ranked by
correctness impact × number of evals unblocked.

Where the spec already states an intent direction, it is shown as the **leading option** —
but it still needs sign-off, because the reproducibility contract forbids assuming the
current code (or even the current prose) is correct until a golden locks it.

---

## STATUS — D1–D11 all resolved (2026-07-01). Rulings written into `design-spec.md` + `EVALS.md`; D11 applied to `units.ts` + `types`.

| # | Ruling | Spec home |
|---|---|---|
| **D11** | ✅ **RESOLVED** — `destroy`/`sacrifice` promoted to a named action; sub-ruling (a): `destroy` **bypasses** divine shield. Applied to `units.ts` + `types`. | §6.9, §6.3 |
| **D1** | Deaths are simultaneous: collect + register the whole batch, then resolve deathrattles against the settled board. | §7.3 |
| **D2** | Cross-side order = **attacker's side first**; side A first at start of combat; left→right within a side. | §7.3 |
| **D3** | (i) a unit dead to its own `onAttack` does **not** swing; (ii) cleave recomputes neighbors after an `onShieldBreak` insert. | §7.2 |
| **D4** | Determinism is a **property** (same seed → same log within an impl); cross-impl byte-identity **not** required; goldens are an intra-impl guard from the corrected engine. | preamble, §7.6 |
| **D5** | "Count the act, not the resolution": no-target `chosenAlly` fizzles but still counts as a battlecry + increments the counter; Echo-doubled battlecry fires `afterFriendlyBattlecry` twice; empty Discover → next-lower tier then skip; `onSell` on purchasable bodies only. | §4.7 |
| **D6** | Loss-damage base term uses the **winner's** tier. | §4.5 |
| **D7** | Wire `boardCap` + `divineShieldNegatesPoison` to config; honor `simultaneousDeaths`/`deathrattleOrder`; **delete** `attackOrderRule`/`firstAttackerTiebreak`; keep `64`/`8` as commented guards. | §7.6, §12 |
| **D8** | Ghost = **most-recently-eliminated** board, chosen **deterministically from the match seed**. | §4.4 |
| **D9** | `maxRounds` HP-tie tiebreak = **seat order** (lowest seat higher). | §4.6 |
| **D10** | ⚠️ **SUPERSEDED by ledger decision #39 (2026-07-01,** `requirements.md`**):** persistent `gems` is now a **spendable wallet** (activated abilities: purchased doubles + three gem sinks); the doubler's `gemsThisTurn` breakpoint is retired in favor of the spend-gated payoff class (#40, spec §6.6a). *(Original D10 ruling — cosmetic, no sink — retained below as provenance.)* | §4.7, §6.6a |

Two items were never D-scoped and remain open, both outside the regeneration's pure-interface
surface: `avoidImmediateRematch`'s precise tie-break rule, and reconnect/bot-takeover (server
integration, not a property eval). See `EVALS.md` UNPROVEN.

*Original escalations retained below as provenance.* **Each D1–D10 block describes the
pre-ruling OPEN state**; its spec pointers and quoted "open decision / leading option /
question / silence" language reflect the spec text *as it was when the item was open*. The
binding rulings are the STATUS table above — where a block says an item is open, the STATUS
table supersedes it. (The spec body itself no longer carries that open language; e.g. §7.6 #2
now states D2's cross-side order as decided.)

---

## D1 — Within-side simultaneous-death resolution order  ⟶ *highest priority*
**Spec:** §7.6 #1, §15 #1 (called the highest-priority correctness item). **Blocks:** EV-DTH-08,
all EV-GLD-*, EV-INV-DET (their expected logs).
**Silence/divergence:** config declares `simultaneousDeaths:true` + `deathrattleOrder:
'boardLeftToRight'`, but **neither flag is read** (verified). The engine removes a dying unit
and fires its deathrattle before processing the next dier, so the first deathrattle mutates
the board the second sees.
**Question:** When ≥2 units on the same side die on one resolution pass, do we (a) collect all
deaths, snapshot, then resolve every deathrattle against the *settled* pre-resolution board
(the stated intent), or (b) keep the current sequential "remove-and-fire" behavior?
**Leading option:** (a) — matches the config flags and §7.6 intent. Confirm, then lock a golden.

## D2 — Cross-side death/deathrattle global order
**Spec:** §7.6 #2 (explicitly "an open decision"). **Blocks:** EV-DTH-09, EV-GLD-*.
**Contradiction:** in a mutual-kill trade the engine resolves *all of side A* then *all of side
B*, regardless of board position — an unsanctioned side-A advantage.
**Question:** What is the intended global order for simultaneous cross-side deaths?
Options: (a) strict global left→right interleaving by slot; (b) attacker's side first;
(c) keep A-then-B (make it a deliberate, documented rule). **No leading option — the spec
declines to assume current behavior is intended.** This is the single most likely source of
silent divergence between two "correct" implementations.

## D3 — `onAttack` pre-swing lethality & `onShieldBreak`-induced target shift
**Spec:** §7.6 #3, #4. **Blocks:** EV-DTH-10, EV-KW-DS-01/CLV interaction, EV-GLD-*.
**Divergence:** (i) an `onAttack` that deals lethal self-damage leaves the attacker at HP≤0 but
it still swings; (ii) `onShieldBreak` fires mid-hit and, if it summons/inserts a unit, the
already-captured defender/cleave neighbor indices are stale.
**Questions:** (i) Should a unit that dies to its own `onAttack` still complete the attack?
(intent reads *no*.) (ii) After an `onShieldBreak` insert, must cleave neighbor indices be
recomputed against the post-insert line? (intent reads *yes*.) Confirm both, then lock goldens.

## D4 — RNG draw-order contract (byte-determinism survivability)
**Spec:** §6.8, §15 #2, EVALS UNPROVEN #3. **Blocks:** the reproducibility guarantee itself
for any fresh regen.
**Problem:** property evals are RNG-order-independent by design, so a regeneration that makes
*correct decisions* via a *different sequence/count* of PRNG draws passes every `P` eval yet
produces a different byte log — breaking replay and the sim's determinism. The spec says this
cannot be reproduced from prose.
**Question:** How is byte-determinism carried across a regeneration? Options: (a) freeze the
current `EV-GLD-*` logs as authoritative tier-2 artifacts a regen must reproduce (locks the
exact draw order); (b) write an explicit "draw-order contract" — for each combat step, the
ordered list of `rng.*` calls and their argument shapes — as part of §6.8; (c) accept that
only *outcome* is reproducible and drop byte-identity as a guarantee (weakens replay/debug).
**Note:** interacts with D1–D3 — the golden can only be frozen *after* the ordering rulings.

## D5 — Fizzle / edge-case rules for targeted & reactive effects
**Spec:** §4.2, §6.2 (silent). **Blocks:** EV-ECO-11/13, EV-SEL-02, UNPROVEN #10/#11.
**Silences (bundle — needs one ruling each):**
- `chosenAlly` battlecry with **no legal target** in shop: fizzle (still counts as a battlecry?),
  reject the play, or auto-resolve to nothing?
- **Discover** when the tier+offset pool is **empty/insufficient**: offer fewer, offer from a
  lower tier, or skip?
- `onSell`: does it fire when selling a **token**, or only a purchasable body? Does selling the
  Pattern-B card itself count?
- `afterFriendlyBattlecry`: does an Echo-Choir-**doubled** battlecry fire it once or twice?
  (Interacts with EV-AUR-05's "doubled triggers count.")
- Does a fizzled/target-less battlecry still increment `battlecriesThisTurn`?

## D6 — Loss-damage base term: winner tier vs player/loser tier
**Spec:** §4.5 (TODO marker), `match.ts` comment. **Blocks:** EV-MTC-01.
**Ambiguity:** `combat.ts` uses the **winner's** tier in the base term; the `match.ts` config
comment says the ambiguous `playerTier`. Genre convention (surviving-enemy tiers + winner's
tavern tier) supports winner-tier, but this is unconfirmed.
**Question:** Is `winnerTier·lossBaseTierWeight` intended, or should it be the loser's own tier?
Confirm before pinning the arithmetic eval.

## D7 — Config-driven-balance repair scope (§7.6 #6)
**Spec:** §7.6 #6, §12 combat bullet. **Blocks:** EV-INV-CFG (fails today by design), EV-ECO-09.
**Question:** For each hardcoded constant, wire-to-config or delete-the-dead-knob?
- `boardCap` literal `7` in combat → source from `economy.boardCap`. (wire)
- death-loop guards `64` / summon-drop `8` → config or leave as engineering guards?
- the 5 dead combat knobs (`attackOrderRule`, `firstAttackerTiebreak`,
  `divineShieldNegatesPoison`, `simultaneousDeaths`, `deathrattleOrder`): **honor them** (make
  behavior config-driven) or **delete them** (admit they're not knobs)? This choice is
  entangled with D1/D3.

## D8 — Ghost source selection
**Spec:** §4.4 (silent on *which* board). **Blocks:** EV-MTC-06 (full form), UNPROVEN #6.
**Question:** When the live count is odd, whose snapshot is the ghost — most-recently
eliminated, highest-final-placement, random-from-seed? And is the choice deterministic from
the match seed (required for sim reproducibility)?

## D9 — `maxRounds` finalization tiebreak
**Spec:** §4.6 ("finalized by remaining HP"). **Blocks:** EV-MTC-05 (full form).
**Question:** If multiple survivors are tied on remaining HP at round 25, what breaks the tie
(cumulative damage dealt, seat order, seeded coin)? Needed for a deterministic placement eval.

## D10 — Persistent `gems` spend sink (reserved-system drift)
> **SUPERSEDED (2026-07-01):** decision **#39** in `requirements.md` makes `gems` a spendable
> wallet with real sinks (spec §5, §6.6a); EV-ECO-14 was rewritten accordingly.

**Spec:** §6 reserved note, §15 #7. **Blocks:** EV-ECO-14 (full form), UNPROVEN #8.
**Question:** `gemCarryOver=true` accrues a persistent `gems` count, but only the per-turn
`gemsThisTurn` counter is consumed (the doubler breakpoint). Is the persistent `gems` total
meant to have a use (a spend action — the reserved `onSpend`/gems-as-currency), is it purely a
display of lifetime greed, or should `gemCarryOver` be reconsidered? Either wire a sink or
document `gems` as cosmetic so an eval can assert the (non-)behavior.

---

### Ranking rationale
D1–D4 are **correctness/determinism** and block the most evals (and each other): the combat
ordering trio (D1–D3) must be decided before the byte-determinism artifact (D4) can be frozen.
D5–D6 change **observable outcomes** (targeting fizzles, hero damage). D7 is the **invariant-4**
repair. D8–D10 are **narrower** loop/edge rulings.

---

## D11 — Promote `destroy`/`sacrifice` from the `dealDamage: 999` idiom to a named action  ✅ RESOLVED (2026-07-01)
**Spec:** §6.9, §6.3. **Blocks:** EV-ACT-DESTROY, EV-VOCAB-01; the `units.ts` + `types` refactor.
**Direction (user-set):** make it a **named `destroy` action**; the `dealDamage: 999` idiom is
retired. This exists because the idiom hides load-bearing semantics an agent can't infer from
`dealDamage` + `999`. Four cards use it: Hollow Priest, Pyrewalker, Dreadmaw, Maelstrom Cantor.
**Pinned (recommended — confirm):**
- (b) **Death accounting = YES.** The destroyed unit **counts as a friendly death and fires its
  deathrattle.** Load-bearing: the Infernals sacrifice→`deaths` breakpoints (Bloodcaller/Abysslord/
  Carrion Sovereign) and Gravebrand/Dreadmaw deathrattles depend on it. *(Keep — not really optional.)*
- (c) **Not combat damage = YES.** No retaliation, no poison flag, no `damage` event — emit a
  `death` (and `deathrattle`) directly. *(Keep.)*
- (d) **Target scope:** one `destroy` action usable on any selector; ally-target = "sacrifice".
  All 4 current uses target `lowestStatAlly`. *(Keep single action.)*

**✅ THE ONE SUB-RULING — RESOLVED (2026-07-01):**
- (a) **Divine shield: BYPASS.** `destroy` is true removal, not damage — a shielded ally is
  destroyed and its shield is left untouched (a chosen sacrifice goes through). This changes the
  old `dealDamage: 999` behavior by design; that RED-vs-old result validates EV-ACT-DESTROY.

**Applied (2026-07-01):** the 4 `dealDamage: 999` rows in `units.ts` are now `{ type: 'destroy' }`;
`shared/types` folded `sacrifice`→`destroy` (no 10th action added); EV-ACT-DESTROY + EV-VOCAB-01
finalized. Engine must implement `destroy` = remove target, `deaths++`, fire deathrattle, bypass
shield, emit `death`/`deathrattle` (no `damage`).

### Ranking rationale (continued)
D11 is a **vocabulary-completeness** item, not a live-balance one — the only behavior change is
sub-ruling (a). Everything else is making an existing hidden semantic explicit and eval-covered.
