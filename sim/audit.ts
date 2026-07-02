// Static catalog audits (spec §11.3c/e, §16). Pure over `shared/config` + `shared/content` — no
// simulation. Two lints:
//
//   • CAPS (EV-BAL-E, decision #25) — no multiplier value anywhere exceeds its engines.ts cap
//     (endOfTurnTriggerMultiplierCap, battlecryTriggerMultiplierCap, undeadDamageAmpCap,
//     multiplyFactorCap), and every cap is finite & positive.
//   • BREAKPOINT / ANTI-LINEAR (EV-BAL-C, §6.6 design law) — every ⭐ primary payoff is a discrete
//     breakpoints.ts row (reuse the engine's `lintBreakpoints`); every breakpoint-gated card is
//     registered; and no repeatable board-state trigger grows stats without a threshold/cap.

import {
  engines,
  breakpoints,
  UNITS,
  lintBreakpoints,
  hasBreakpoint,
  hasSpendGated,
  hasContestedCondition,
  type UnitCard,
} from '@cardgame/shared';

// ── CAPS (EV-BAL-E) ─────────────────────────────────────────────────────────────────────────

export interface CapsAudit {
  ok: boolean;
  violations: string[];
}

export function capsAudit(): CapsAudit {
  const v: string[] = [];
  const caps = {
    endOfTurn: engines.wildkin.endOfTurnTriggerMultiplierCap,
    battlecry: engines.reefkin.battlecryTriggerMultiplierCap,
    undeadAmp: engines.revenants.undeadDamageAmpCap,
    multiply: engines.tuskers.multiplyFactorCap,
  };
  // every cap finite & positive
  for (const [name, c] of Object.entries(caps)) {
    if (!Number.isFinite(c) || c <= 0) v.push(`cap ${name} is not finite/positive: ${c}`);
  }
  // configured multiplier values ≤ their caps
  if (engines.wildkin.endOfTurnTriggerMultiplier > caps.endOfTurn)
    v.push(`endOfTurnTriggerMultiplier ${engines.wildkin.endOfTurnTriggerMultiplier} > cap ${caps.endOfTurn}`);
  if (engines.reefkin.battlecryTriggerMultiplier > caps.battlecry)
    v.push(`battlecryTriggerMultiplier ${engines.reefkin.battlecryTriggerMultiplier} > cap ${caps.battlecry}`);
  if (engines.revenants.undeadDamageAmp > caps.undeadAmp)
    v.push(`undeadDamageAmp ${engines.revenants.undeadDamageAmp} > cap ${caps.undeadAmp}`);
  if (engines.tuskers.doublerFactor > caps.multiply)
    v.push(`doublerFactor ${engines.tuskers.doublerFactor} > cap ${caps.multiply}`);

  // breakpoint payoff multipliers ≤ caps (amp → undeadAmp, factor → multiply)
  for (const b of breakpoints.list) {
    if (b.amp != null && b.amp > caps.undeadAmp) v.push(`breakpoint ${b.card} amp ${b.amp} > cap ${caps.undeadAmp}`);
    if (b.factor != null && b.factor > caps.multiply) v.push(`breakpoint ${b.card} factor ${b.factor} > cap ${caps.multiply}`);
  }

  // aura multiplier values on cards ≤ their caps; multiplyStats action factors ≤ multiply cap
  for (const card of UNITS) {
    for (const aura of card.auras ?? []) {
      const val = aura.modifier.value;
      if (aura.modifier.kind === 'triggerMultiplier') {
        if (aura.scope === 'yourBattlecries' && val > caps.battlecry) v.push(`${card.id} battlecry aura ${val} > cap ${caps.battlecry}`);
        if (aura.scope === 'yourEndOfTurn' && val > caps.endOfTurn) v.push(`${card.id} endOfTurn aura ${val} > cap ${caps.endOfTurn}`);
      }
      if (aura.modifier.kind === 'damageMultiplier' && val > caps.undeadAmp)
        v.push(`${card.id} damage aura ${val} > cap ${caps.undeadAmp}`);
    }
    for (const eff of card.effects) {
      for (const act of eff.actions) {
        if (act.type === 'multiplyStats' && (act.factor ?? 1) > caps.multiply)
          v.push(`${card.id} multiplyStats factor ${act.factor} > cap ${caps.multiply}`);
      }
    }
    // activated abilities (#39) obey the same multiply cap — a purchased double is still capped.
    for (const act of card.activated?.actions ?? []) {
      if (act.type === 'multiplyStats' && (act.factor ?? 1) > caps.multiply)
        v.push(`${card.id} activated multiplyStats factor ${act.factor} > cap ${caps.multiply}`);
    }
  }
  return { ok: v.length === 0, violations: v };
}

// ── BREAKPOINT / ANTI-LINEAR (EV-BAL-C) ────────────────────────────────────────────────────────

export interface BreakpointAudit {
  ok: boolean;
  violations: string[];
}

const BREAKPOINT_CONDITIONS = new Set([
  'battlecriesThisTurnAtLeast',
  'tokensSummonedThisTurnAtLeast',
  'gemsThisTurnAtLeast',
  'deathsThisCombatAtLeast',
  'lifetimeDeathsAtLeast', // Phase 3: Ossuary Titan's tiered persistent-death counter
  'boardMergesAtLeast', // Phase 6: Magnaforge's tiered board-wide magnetic counter
  'countAllies',
  // NB: `alliesAtMost` is deliberately NOT here — it is a go-tall GATE on a fixed conditional buff
  // (Lone Vanguard), not a scaling counter, so it needs no breakpoint row.
]);

/** A card carries a "primary breakpoint payoff" if it has a threshold-gated effect (a
 *  breakpoint-counter condition) or an avenge (afterFriendlyDeaths) with a threshold that is NOT
 *  the exempt capped token-death thin-floor (tokensOnly). Such cards MUST be registered rows. */
function carriesPrimaryPayoff(card: UnitCard): boolean {
  for (const e of card.effects) {
    if (e.condition && BREAKPOINT_CONDITIONS.has(e.condition.kind)) return true;
    if (e.trigger.type === 'afterFriendlyDeaths' && e.trigger.threshold != null && e.trigger.tokensOnly !== true) return true;
  }
  return false;
}

/** Repeatable shop board-state triggers that would let stats grow per-turn for free (the §6.6
 *  banned "buy more of the same" gradient). Paid-per-increment patterns (afterFriendlyBattlecry,
 *  onSell) and combat one-shots are NOT in this set. */
const REPEATABLE_SHOP_TRIGGERS = new Set(['endOfTurn', 'onSummon']);
const STAT_GROWTH_ACTIONS = new Set(['buffStats', 'setStats', 'multiplyStats']);

export function breakpointAudit(): BreakpointAudit {
  const v: string[] = [];

  // (1) engine lint: every row → real card, no dupes (every ⭐ card ↔ exactly one row) +
  //     the spend-gated registry checks (#39: registry ↔ `activated` 1:1, cost knobs real).
  const lint = lintBreakpoints();
  if (!lint.ok) v.push(...lint.errors);

  // (2) coverage: every threshold-gated primary payoff is registered as ONE of the three legal
  //     payoff classes — a breakpoint row, a spend-gated ability (#39), or a contested-condition
  //     payoff (#40 corollary: exponential-by-risk, e.g. Grave Emperor's survive-a-near-wipe double).
  for (const card of UNITS) {
    if (carriesPrimaryPayoff(card) && !hasBreakpoint(card.id) && !hasContestedCondition(card.id)) {
      v.push(`primary payoff not registered (breakpoint / contested-condition): ${card.id}`);
    }
  }

  // (2b) SPEND-GATED class (#39/#40): a stat-growing activated ability is a primary payoff.
  //      It is legal — each step is PURCHASED — only if registered in the spend-gated registry.
  const GROWTH = new Set(['buffStats', 'setStats', 'multiplyStats']);
  for (const card of UNITS) {
    const grows = (card.activated?.actions ?? []).some((a) => GROWTH.has(a.type));
    if (grows && !hasSpendGated(card.id)) {
      v.push(`stat-growing activated ability not spend-gated-registered: ${card.id}`);
    }
  }

  // (3) anti-linear: no repeatable shop board-state trigger grows stats without a gate/breakpoint.
  for (const card of UNITS) {
    for (const e of card.effects) {
      if (!REPEATABLE_SHOP_TRIGGERS.has(e.trigger.type)) continue;
      const grows = e.actions.some((a) => STAT_GROWTH_ACTIONS.has(a.type));
      if (!grows) continue;
      const gated = e.condition != null || hasBreakpoint(card.id);
      if (!gated) v.push(`ungated per-turn stat growth (linear stacking): ${card.id} (${e.trigger.type})`);
    }
  }

  return { ok: v.length === 0, violations: v };
}

// ── synthetic controls (prove the scanners bite; used by audit.test.ts) ─────────────────────────

/** A synthetic ungated repeatable doubler — the anti-linear redline. Returns true if the scanner
 *  logic would flag it (used to prove the lint is not vacuous). */
export function wouldFlagUngatedGrowth(card: UnitCard): boolean {
  for (const e of card.effects) {
    if (!REPEATABLE_SHOP_TRIGGERS.has(e.trigger.type)) continue;
    if (!e.actions.some((a) => STAT_GROWTH_ACTIONS.has(a.type))) continue;
    if (e.condition == null && !hasBreakpoint(card.id)) return true;
  }
  return false;
}

export function wouldFlagOverCapMultiplier(value: number, cap: number): boolean {
  return value > cap;
}
