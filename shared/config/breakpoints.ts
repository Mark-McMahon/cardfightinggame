// Breakpoint config (Round-6, spec §16.4). Every ⭐ primary payoff is a named, discrete
// { counter, threshold, payoff } entry — the design law of "breakpoints over linear
// stacking" (decision #22) made data. The §16.7c lint asserts every primary payoff is
// expressible here and flags any per-unit scaling that lacks a threshold.

export type BreakpointCounter =
  | 'deaths' // friendly deaths this combat (avenge / Mortarch / Bone Colossus)
  | 'revenantDeaths' // revenant friendly deaths this combat (Pale Lich)
  | 'tokensThisTurn' // tokens summoned this shop turn (Mother Thorn — shop-scoped, see memory)
  | 'battlecries' // resolved battlecries this shop turn (Echo Choir doubles)
  | 'alliesAtStart' // minions controlled at start of combat (Thornwarden)
  | 'shieldBreak' // this unit's own divine shield broke (Pearlguard; degenerate threshold 1)
  | 'gemsThisTurn' // gems generated this shop turn (Round-6 Tuskers — the compounding doubler)
  | 'lifetimeDeaths' // Phase 3: PERSISTENT per-player friendly-death total (Ossuary Titan — tiered breakpoints)
  | 'boardMerges' // Phase 6: total MAGNETIC merges assembled across the board (Magnaforge — tiered board-wide payoff)
  | 'elementsPlayed'; // Phase 7: PERSISTENT per-player count of Primordials PLAYED this game (Elderstorm — tiered board-wide payoff)

export interface Breakpoint {
  card: string; // catalog id — the lint cross-checks against the catalog
  counter: BreakpointCounter;
  threshold: number;
  once?: boolean; // fire once at the threshold vs each-N (avenge style)
  // payoff fields (interpreted per card; all numbers live here, never in logic):
  atk?: number; // board/self stat payoff
  hp?: number;
  tokenAtk?: number; // Mother Thorn: per-summoned-token buff
  tokenHp?: number;
  amp?: number; // Pale Lich: damage multiplier once active (clamped to engines cap)
  factor?: number; // Tuskers: multiplyStats factor for the ×N doubler (clamped to multiplyFactorCap)
  summonUnitId?: string; // token-summon payoffs (Brackentide / Tideclaimer / Bone Colossus)
  summonCount?: number;
  grantKeyword?: 'divineShield' | 'cleave'; // board-wide keyword grant (Reef Leviathan / Worldspark)
  /**
   * Phase 3: a TIERED breakpoint — several discrete {threshold, atk, hp} steps on one counter, whose
   * per-step payoffs ESCALATE (each step ≥ the last → the step-not-line shape). The top-level
   * `threshold`/`atk`/`hp` mirror the FIRST tier (so single-tier consumers + the lint stay uniform).
   * The card fires one cumulative effect per crossed tier (Ossuary Titan). Payoffs are this-combat.
   */
  tiers?: Array<{ threshold: number; atk: number; hp: number }>;
}

export interface BreakpointsConfig {
  list: Breakpoint[];
}

export const breakpoints: BreakpointsConfig = {
  list: [
    // ── Wildkin / SWARM ──
    // tokensThisTurn / battlecries thresholds tuned DOWN from the spec's illustrative 3/4
    // (§16.5) to 2/3: the reachability gate (§16.7b) showed the shop-turn breakpoints were
    // unreachable for a splash at 3+, so splashing was never worth it (failure mode B).
    // Mother Thorn redesign (audit Gate 1): the free per-turn whole-board slab is REMOVED. Only the
    // per-token buff remains, and its threshold is raised 2→3 so it costs a real over-summon (a second
    // generator / a summon-battlecry), not one autopilot Brambleling. tokenAtk/tokenHp only.
    { card: 'wildkin_motherthorn', counter: 'tokensThisTurn', threshold: 3, tokenAtk: 2, tokenHp: 2 },
    { card: 'wildkin_thornwarden', counter: 'alliesAtStart', threshold: 5, once: true, atk: 3, hp: 5 }, // Phase 4 gate-spread: STAYS at 5 (the low-width anchor of the diversified alliesAtStart ladder 5/6/7, decision #48). Balance pass (#59): payoff 2/4→3/5 — Wildkin's 24%-pick go-wide anchor was too weak (tribe ~26-34% of mean win rate).
    { card: 'wildkin_grovelord', counter: 'alliesAtStart', threshold: 7, once: true, atk: 2, hp: 2 }, // Phase 4 gate-spread: 5→7 — a FULL-BOARD payoff (decision #48). Balance-risk noted: nerfs an already-weak line; no compensating tuning this PR (rework rule). Phase 5 (#57): a 7→6 relaxation was tried to restore EV-BAL-B headroom and REVERTED (zero effect on the metric)
    { card: 'wildkin_packmother', counter: 'deaths', threshold: 2, atk: 3, hp: 3 }, // each-N (existing avenge); aligned to engines.wildkin.avengePayoff (balance pass #59: 2/2→3/3, the SWARM↔DEATHS carrier that rescued Wildkin from ~36% of mean)
    { card: 'wildkin_brackentide', counter: 'battlecries', threshold: 2, summonUnitId: 'wildkin_thornpup', summonCount: 2 },
    // Thornqueen (Phase 7, decision #74 — the SWARM↔DEATHS scaling capstone). Wildkin was the WEAKEST tribe
    // (macro avgP ~5.6): a WIDE board of modest per-body tokens with a flat, width-capped Grovelord buff and no
    // way to make the swarm's per-body scale high. This turns the swarm's endless FALLEN into a whole-board payoff:
    // a TIERED breakpoint on the PERSISTENT `lifetimeDeaths` counter — REUSED from Ossuary Titan (no new plumbing;
    // combat deaths incl. tokens feed it via match.ts, so a wide board that loses bodies every combat accrues it
    // FAST → reachable, unlike a build-gated counter). It extends Wildkin's existing avenge/DEATHS sub-theme (Pack
    // Mother) rather than Revenants' identity (which uses `revenantDeaths` + a contested double + damage amp, not a
    // generic board-wide buff). One cumulative this-combat buff to your WILDKIN per crossed milestone (permanent:false;
    // the §7.5 writeback must NOT fold it); thresholds 8/16/24 (Wildkin dies ~3-5/combat → a whole-game brood), step
    // payoffs 3/3 → 5/5 → 8/8 ESCALATE (≥1.5× → non-linear, EV-BAL-D shape). High ceiling by MANY EARNED STEPS (each
    // fallen body is a bought+lost swarm member), never one multiply — and it still folds to POISON (one-shots each
    // pumped body, stat-agnostic), to CLEAVE (mows the wide brood), and to WIDTH-removal. Thresholds 24/48/72 span the
    // MEASURED accrual range (owners reach lifetimeDeaths min 43 / median 63 / max 97 — deaths auto-accrue fast) so the
    // payoff is a GENUINE earned ramp, NOT a flat slab: tier-1 (24) is reliable at acquisition (100% of owners), tier-2
    // (48) usual, tier-3 (72) the aspirational late-game stretch (~40%) as the brood's dead pile up over the game.
    { card: 'wildkin_thornqueen', counter: 'lifetimeDeaths', threshold: 24, atk: 3, hp: 3,
      tiers: [
        { threshold: 24, atk: 3, hp: 3 },
        { threshold: 48, atk: 5, hp: 5 },
        { threshold: 72, atk: 8, hp: 8 },
      ],
    },
    // ── Revenants / DEATHS ──
    { card: 'revenants_mortarch', counter: 'deaths', threshold: 3, once: true, atk: 3, hp: 3 },
    { card: 'revenants_palelich', counter: 'revenantDeaths', threshold: 3, amp: 2 },
    { card: 'revenants_tideclaimer', counter: 'battlecries', threshold: 2, summonUnitId: 'revenants_rebornwisp', summonCount: 1 },
    { card: 'revenants_boncolossus', counter: 'deaths', threshold: 4, once: true, summonUnitId: 'revenants_rebornwraith', summonCount: 2 },
    // Ossuary Titan (Phase 3): the original "+1/+1 per 2 lifetime deaths" is LINEAR primary scaling
    // (banned by #22). Reworked to DISCRETE, ESCALATING breakpoints on the PERSISTENT lifetimeDeaths
    // counter — a step, not a line: the card fires one cumulative self-buff per crossed tier at start
    // of combat, THIS COMBAT ONLY (permanent:false). Thresholds 4/8/12 are a whole-game investment
    // (deaths accrue across every fight + every Maw sacrifice); step payoffs 2/2 → 3/3 → 5/5 grow so
    // the marginal reward per crossed tier RISES (non-linear ≥1.5×), never a flat per-death gradient.
    { card: 'revenants_ossuarytitan', counter: 'lifetimeDeaths', threshold: 4, atk: 2, hp: 2,
      tiers: [
        { threshold: 4, atk: 2, hp: 2 },
        { threshold: 8, atk: 3, hp: 3 },
        { threshold: 12, atk: 5, hp: 5 },
      ],
    },
    // ── Reefkin / BATTLECRIES (+ ENDURE) ──
    { card: 'reefkin_pearlguard', counter: 'shieldBreak', threshold: 1, once: true, atk: 1, hp: 2 }, // balance pass (#59): board payoff 1/3→1/2 — Reefkin was the top out-of-band tribe (~215-220% of mean); this shield-break board buff fires nearly every combat, so it is the one *reaching* Reefkin lever (the pearlguard 2/3 DS+taunt BODY that drives its 24% pick is not a config knob). Stopped at 1/2 (not 1/1): a further point transferred Reefkin's lost wins to the equally-untouchable Constructs, pushing IT out of band (zero-sum apex coupling) for no net spread gain. atk kept at 1 (EV-BP-10 golden asserts the board buff fires).
    { card: 'reefkin_chorustide', counter: 'battlecries', threshold: 2, atk: 3, hp: 3 },
    { card: 'reefkin_leviathan', counter: 'battlecries', threshold: 3, grantKeyword: 'divineShield' },
    // ── Prompt-2: Infernals / SACRIFICE (reuse the combat `deaths` counter — an aggressor's
    //    manufactured deaths). Self-buff carries: a step at the threshold, countered by poison. ──
    { card: 'infernals_bloodcaller', counter: 'deaths', threshold: 3, once: true, atk: 5, hp: 3 },
    { card: 'infernals_abysslord', counter: 'deaths', threshold: 4, once: true, atk: 8, hp: 6 },
    // Carrion Sovereign (audit: Infernals T6 capstone + Pattern-A death scalar). everyN at threshold 1
    // → fires on EVERY friendly death; combat-only BY DESIGN (explicit permanent:false — the §7.5
    // writeback is live, this card deliberately opts out), so each +atk/+hp is paid by a spent
    // body and resets each fight. Registered as a breakpoint so the anti-linear lint bounds it (like
    // Pack Mother). Organic ceiling = deaths manufacturable in one combat; folds to poison + width.
    { card: 'infernals_carrionsovereign', counter: 'deaths', threshold: 1, atk: 2, hp: 1 },
    // Soulglutton (Phase 7, decision #75 — the SACRIFICE PERSISTENT ceiling). Infernals' pre-Phase-7 payoffs were
    // ALL this-combat (Bloodcaller/Abysslord death breakpoints, Carrion Sovereign's per-death board buff) or one-time
    // (Gorgemaw's single battlecry eat) — nothing PERSISTED across combats, so the "few+tall" carry could never reach
    // a very-high total. This is the first PERMANENT death payoff: at 3+ friendly deaths this combat (once), the carry
    // PERMANENTLY gains +6/+6 (permanent:true → the §7.5 writeback folds it onto the SURVIVING instance). Each combat
    // where you manufacture 3+ sacrifices adds one chunk, so over the game the carry grows TALL through MANY EARNED
    // STEPS (each death is a spent body — Infernals sacrifice their own width via Hollow Priest/Pyrewalker/Dreadmaw/Maw),
    // never one multiply (never the ×2 cap). It ends FEW + TALL, so it still folds HARD to POISON (a single touch kills
    // the giant, ignoring its size — stat-agnostic) and to a WIDE board (2-3 bodies out-action one carry). Reuses the
    // existing `deaths` counter (no new plumbing). Threshold 3 (not Abysslord's 4) so the two capstones don't share a gate.
    { card: 'infernals_soulglutton', counter: 'deaths', threshold: 3, once: true, atk: 6, hp: 6 },
    // ── Prompt-2: Constructs / ASSEMBLY (reuse `deaths` + `alliesAtStart`). Rebuild payoffs —
    //    summon a guardian; countered by poison/tall (the refill can't out-attrition a chip). ──
    { card: 'constructs_foundry', counter: 'deaths', threshold: 4, once: true, summonUnitId: 'constructs_sentinel', summonCount: 1 },
    { card: 'constructs_titanforge', counter: 'alliesAtStart', threshold: 6, once: true, summonUnitId: 'constructs_sentinel', summonCount: 1 }, // Phase 4 gate-spread: 5→6 (mid-width, decision #48)
    // Aegis Prime (audit: Constructs T6 capstone + Pattern-A redeploy scalar). everyN at threshold 1 →
    // each friendly death pumps the surviving Constructs (combat-only); the assembly loop IS the fuel.
    // Registered as a breakpoint so the anti-linear lint bounds it. Folds to poison + tall.
    { card: 'constructs_aegisprime', counter: 'deaths', threshold: 1, atk: 1, hp: 1 },
    // Magnaforge (Phase 6, decision #68 — the BOARD-WIDE magnetic capstone). The old magnetic identity was
    // single-carry ONLY (merge into one tower, go-tall). This turns assembled merges into a WHOLE-BOARD
    // payoff: a TIERED breakpoint on `boardMerges` (total merges across the board), mirroring Ossuary Titan
    // but targeting your Constructs instead of self. A step, not a line — one cumulative this-combat buff
    // per crossed tier (permanent:false; the §7.5 writeback must NOT fold it). Thresholds 3/6/9 are a real
    // magnetic investment (9 needs ≥2 towers, since the per-unit cap is 5) fed by the T1/T3/T2/T4/T5 magnetic
    // ladder; step payoffs 3/3 → 5/5 → 8/8 ESCALATE (≥1.5× the first → non-linear, EV-BAL-D shape). High
    // ceiling by MANY EARNED STEPS (each merge is a bought+consumed body), never one giant multiply — and it
    // still folds to POISON (one-shots any pumped body, stat-agnostic), CLEAVE (mows the clustered board),
    // and Nullforge (strips the permanent merged towers underneath the buff).
    { card: 'constructs_magnaforge', counter: 'boardMerges', threshold: 3, atk: 3, hp: 3,
      tiers: [
        { threshold: 3, atk: 3, hp: 3 },
        { threshold: 6, atk: 5, hp: 5 },
        { threshold: 9, atk: 8, hp: 8 },
      ],
    },

    // ═══ Round-6 replayability expansion — four tribes, each with a distinct keyword strength ═══
    // ── Tuskers / SPOILS: the EXPONENTIAL engine — reworked by decision #39. The doublers are no
    //    longer gemsThisTurn breakpoints: each ×factor step is now PURCHASED with spendable gems
    //    (activated ability, escalating per-game cost). They are registered in the SPEND-GATED
    //    payoff registry below (`spendGated`) — the §11.3c lint's second legal primary-payoff
    //    class. Still beatable by poison (P1 ignores stat size). ──
    // ── Primordials / ELEMENTS: play-count → WIDE cleave splash. Counter: TALL (few targets waste
    //    cleave) + poison. Reuses `battlecries` (each play) and `alliesAtStart` (went wide). ──
    { card: 'primordials_stormcaller', counter: 'battlecries', threshold: 2, atk: 3, hp: 3 }, // balance pass (#59): 2/1→3/3 — Primordials' reachable permanent board buff was too small + gave no hp; tribe sat ~50% of mean
    { card: 'primordials_tempest', counter: 'alliesAtStart', threshold: 6, once: true, atk: 2 }, // Phase 4 gate-spread: 5→6 (mid-width, decision #48)
    { card: 'primordials_worldspark', counter: 'alliesAtStart', threshold: 7, once: true, grantKeyword: 'cleave' }, // Phase 4 gate-spread: 5→7 — FULL-BOARD cleave grant (decision #48). Balance-risk noted (see Grovelord); no compensating tuning this PR. Phase 5 (#57): a 7→6 relaxation was tried + REVERTED (zero effect on EV-BAL-B; reachability restored via harness payoff-credit instead)
    // Elderstorm (Phase 7, decision #72 — the ELEMENTS scaling capstone). Primordials' pre-Phase-7 ceiling was
    // the WEAKEST of the nine: all payoffs were shop-turn / go-wide one-shots (stormcaller, tempest, worldspark)
    // with no PERSISTENT axis, so a developed board topped out at modest per-body buffs + a cleave grant. This
    // turns every element CHANNELLED over the game into a WHOLE-BOARD payoff: a TIERED breakpoint on the persistent
    // `elementsPlayed` counter (incremented in shop.playUnit per Primordial played, like forgemastersPlayed — NOT a
    // board-state read), mirroring Ossuary Titan/Magnaforge but board-wide over your Primordials. A step, not a line —
    // one cumulative this-combat buff per crossed tier (permanent:false; the §7.5 writeback must NOT fold it).
    // Thresholds 4/8/12 are a whole-GAME investment (a Primordial played most turns). Tier-1 (4) is a real-but-light
    // Primordials commitment reached by ~21% of Elderstorm owners in the macro sim (the Magnaforge 16.7% precedent —
    // measured via ownedBreakpointMaxCounter); the higher tiers (8/12) are the aspirational ceiling a dedicated build
    // reaches (scratchpad-proven, mirroring Magnaforge's top tier which needs ≥2 towers). Retuned DOWN from an initial
    // 8/16/24: the bots splash Elderstorm as a strong 6/8 body rather than going mono-Primordials (the weakest, least-
    // picked tribe), reaching max 5 elements — so 8+ was unreachable in the sim. Step payoffs 3/3 → 5/5 → 8/8 ESCALATE
    // (≥1.5× the first → non-linear, EV-BAL-D shape). High ceiling by MANY EARNED STEPS (each element is a bought+played
    // body), never one giant multiply — and it still folds to POISON (one-shots any buffed body, stat-agnostic), to TALL
    // (a lone big wall starves the wide cleavers of neighbours to splash), and to WIDTH/removal. Its own body carries
    // cleave so the buffed wide line splashes.
    { card: 'primordials_elderstorm', counter: 'elementsPlayed', threshold: 4, atk: 3, hp: 3,
      tiers: [
        { threshold: 4, atk: 3, hp: 3 },
        { threshold: 8, atk: 5, hp: 5 },
        { threshold: 12, atk: 8, hp: 8 },
      ],
    },
    // ── Sirens / SPELLCRAFT: a second POISON home + start-of-combat burst. Counter: divine-shield
    //    walls (blank the poison instance) + being out-tempo'd. Reuses `battlecries`. ──
    { card: 'sirens_deepchanter', counter: 'battlecries', threshold: 2, atk: 2, hp: 2 },
    { card: 'sirens_abysscantor', counter: 'battlecries', threshold: 3 }, // payoff (board-wide Poison) is granted in-card
    { card: 'sirens_leviathansong', counter: 'battlecries', threshold: 3, atk: 2, hp: 2 },
    // Venomtide (Phase 7, decision #77 — the POISON-COVERAGE capstone; Sirens stays deliberately STAT-AGNOSTIC per
    // decision #1). Sirens' scaling is measured in COVERAGE/REACH — more CONNECTING poison bodies — NOT stat totals.
    // At a WIDE board (alliesAtStart≥6) it grants your Sirens CLEAVE this combat: since a poison attacker's cleave
    // carries POISON to the splashed neighbours (combat.ts `attackerPoison`), a wide poison board (innate poison +
    // Abysscantor's board-poison) poisons the WHOLE enemy row per swing — poison REACHES past the shielded front to
    // the unshielded bodies behind/beside it. Coverage scales with the number of poison bodies you field (each becomes
    // a 3-wide poison-cleaver), never with stats. Reuses `alliesAtStart` + `grantKeyword:'cleave'` (no new plumbing).
    // Same PRIMITIVE as Worldspark but a different PURPOSE — poison DELIVERY, not damage splash. This-combat only
    // (grantKeyword in combat never persists). The counter is UNCHANGED (decision #1): divine-SHIELD walls blank each
    // poison instance (cleave just means the opponent must shield MORE bodies), and Sirens' fragile low-stat bodies
    // are out-tempo'd if the poison is walled off. Threshold 6 (go-wide) — a real full-board poison commitment.
    { card: 'sirens_venomtide', counter: 'alliesAtStart', threshold: 6, once: true, grantKeyword: 'cleave' },
    // ── Corsairs / TEMPO: on-buy aggression → sticky REBORN / divine-shield width. Counter: poison
    //    (kills each reborn body twice over) + cleave (mows the width). Reuses `alliesAtStart`. ──
    { card: 'corsairs_reaver', counter: 'alliesAtStart', threshold: 5, once: true, atk: 1 }, // Phase 4 gate-spread: STAYS at 5 (low-width anchor, decision #48)
    { card: 'corsairs_marauder', counter: 'alliesAtStart', threshold: 6, once: true, atk: 2, hp: 1 }, // Phase 4 gate-spread: 5→6 (mid-width, decision #48)
  ],
};

const byCard: Record<string, Breakpoint> = Object.fromEntries(breakpoints.list.map((b) => [b.card, b]));

/** Look up the breakpoint for a card (throws if missing — content/config must stay in sync). */
export function getBreakpoint(card: string): Breakpoint {
  const b = byCard[card];
  if (!b) throw new Error(`No breakpoint configured for ${card}`);
  return b;
}

export function hasBreakpoint(card: string): boolean {
  return card in byCard;
}

// ─────────────────────────────────────────────────────────────────────────────
// Spend-gated payoff registry (decision #39/#40; spec §6.6a, §11.3c)
// ─────────────────────────────────────────────────────────────────────────────
// The SECOND legal primary-payoff class beside breakpoints: a payoff whose every step is
// PURCHASED with a currency (an explicit decision), not accrued from board state. The
// §11.3c lint accepts a card's threshold-free primary payoff ONLY if it is registered
// here, its card carries an `activated` ability, and its `costKnobs` resolve to positive
// finite numbers in `engines[<tribe>]` — exponential scaling is legal only where each
// step is bought (decision #40: "when in doubt add a cost, not a bigger number").

export interface SpendGatedPayoff {
  card: string; // catalog id — the lint cross-checks against the catalog + its `activated` spec
  currency: 'gems' | 'gold'; // the spendable wallet (Tuskers spend gems; Phase 7 #73: Corsairs spend GOLD)
  costKnobs: string[]; // engines[<card.tribe>] knob names that price each step
}

export const spendGated: SpendGatedPayoff[] = [
  // the three doublers share the escalating per-game formula (doubleBaseCost + doubleCostStep·k)
  { card: 'tuskers_ivorytusk', currency: 'gems', costKnobs: ['doubleBaseCost', 'doubleCostStep'] },
  { card: 'tuskers_ivorylord', currency: 'gems', costKnobs: ['doubleBaseCost', 'doubleCostStep'] },
  { card: 'tuskers_gemtitan', currency: 'gems', costKnobs: ['doubleBaseCost', 'doubleCostStep'] },
  // gem sinks (flat costs)
  { card: 'tuskers_gemwright', currency: 'gems', costKnobs: ['gemwrightCost'] },
  { card: 'tuskers_facetguard', currency: 'gems', costKnobs: ['facetguardCost'] },
  { card: 'tuskers_oreseeker', currency: 'gems', costKnobs: ['oreseekerCost'] },
  // Prizemaster (Phase 7, decision #73): the Corsairs GOLD spend-gated lever — once/turn, spend gold to
  // permanently +5/+5 a chosen Corsair. Flat gold cost; the ceiling scales with the gold economy (Vault
  // Keeper's raised cap funds more activations). The FIRST non-gem spend-gated payoff (currency: 'gold').
  { card: 'corsairs_prizemaster', currency: 'gold', costKnobs: ['prizemasterCost'] },
];

const spendByCard: Record<string, SpendGatedPayoff> = Object.fromEntries(spendGated.map((r) => [r.card, r]));

export function hasSpendGated(card: string): boolean {
  return card in spendByCard;
}

export function getSpendGated(card: string): SpendGatedPayoff {
  const r = spendByCard[card];
  if (!r) throw new Error(`No spend-gated registry row for ${card}`);
  return r;
}

// ─────────────────────────────────────────────────────────────────────────────
// Contested-condition payoff registry (decision #40 corollary; spec §6.6b/§11.3c)
// ─────────────────────────────────────────────────────────────────────────────
// The THIRD legal primary-payoff class beside breakpoints and spend-gated abilities: a payoff whose
// every step is purchased with a RISK — a CONTESTED CONDITION that the opponent actively fights
// against, not accrued for free from your own board state. Exponential scaling is legal here because
// each step demands surviving that contested condition (decision #40: unbounded scaling is fine only
// where each step is bought with a decision, a risk, OR a contested condition).
//
// The §11.3c lint accepts a card's threshold-gated primary payoff WITHOUT a breakpoint row ONLY if it
// is registered here, names the combat CONDITION that gates it, and that condition resolves to a real,
// positive `engines[<tribe>]` knob. This is a first-class classification, NOT a suppression: a payoff
// that is neither a breakpoint, nor spend-gated, nor a registered contested condition still fails.

export interface ContestedConditionPayoff {
  card: string; // catalog id — the lint cross-checks against the catalog
  // the combat condition that gates each step (the CONTEST the opponent fights). Grave Emperor: it
  // must SURVIVE while 5+ friendlies die THIS combat — a near-wipe the opponent is trying to complete.
  condition: 'survivedNearWipe';
  thresholdKnobs: string[]; // engines[<card.tribe>] knob names sizing the contested threshold + payoff
}

export const contestedCondition: ContestedConditionPayoff[] = [
  // Gravemonarch (Phase 3): end of combat, IF 5+ friendlies died this combat AND it survived →
  // permanently DOUBLE its stats (via the §7.5 writeback-multiply). Each double is bought by surviving
  // a near-wipe — the opponent contests it by finishing the kill (poison a 1-hp reborn, out-tempo).
  { card: 'revenants_gravemonarch', condition: 'survivedNearWipe', thresholdKnobs: ['graveEmperorDeathThreshold', 'graveEmperorFactor'] },
];

const contestedByCard: Record<string, ContestedConditionPayoff> = Object.fromEntries(contestedCondition.map((r) => [r.card, r]));

export function hasContestedCondition(card: string): boolean {
  return card in contestedByCard;
}

export function getContestedCondition(card: string): ContestedConditionPayoff {
  const r = contestedByCard[card];
  if (!r) throw new Error(`No contested-condition registry row for ${card}`);
  return r;
}
