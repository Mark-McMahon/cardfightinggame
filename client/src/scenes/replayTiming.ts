// replayTiming — the SINGLE source of presentation-only, sub-beat animation timing for the combat
// replay (design-spec §10 game-feel). Everything the presenter animates keys off `TIMING`, so one
// strike (attacker wind-up → lunge → contact → impact/knockback → recoil), one death (0-HP hold →
// crumble → removal), one buff (flash → number tick) and every floating text can never drift apart.
//
// These are pure FEEL constants — NOT balance, and NOT the shared dwell/window math. The overall
// tempo lever is `TIMING.combatSpeed`, which is the SHARED `COMBAT_SPEED` (so the server's combat
// window is sized from the same number and the replay never overruns/undershoots it). The per-beat
// `*Timing(beatMs)` fitters clamp each choreography to the CURRENT beat's dwell, so a fight the
// server compressed to fit its window still animates cleanly instead of being cut mid-motion.

import { REPLAY_BASE_STEP_MS, COMBAT_SPEED } from '@cardgame/shared';

export const TIMING = {
  /** Global tempo multiplier (>1 faster, <1 slower). Shared with the server window sizing. */
  combatSpeed: COMBAT_SPEED,
  /** Base per-beat dwell (before weight + playback speed). The presenter's advance clock uses this. */
  baseStepMs: REPLAY_BASE_STEP_MS,

  // ── one strike — an ASYMMETRIC telegraph (design-spec §10 win #1) ────────────────
  // ONLY the attacker travels. Sequenced so the eye lands on the initiator BEFORE it acts:
  // highlight (glow + scale, stationary) → wind-up (pull back) → thrust (poke in) → impact
  // hold → recoil (settle home). The defender NEVER lunges — it only recoils on impact.
  strike: {
    highlightMs: 260, // attacker glows + scales up, STATIONARY — the eye lands on it first
    windupMs: 140, // attacker pulls back AWAY from the defender (anticipation, ease-out)
    thrustMs: 110, // attacker shoots TOWARD the defender, poking in (ease-in / accelerating)
    impactHoldMs: 70, // attacker holds at full extension while the defender reacts
    recoilMs: 300, // attacker eases back to its slot and settles (ease-out); then the glow lifts
    reach: 0.6, // fraction of the gap between card centers the thrust covers (a committed poke, not a nudge)
    impactFraction: 0.92, // the lunge counts as "landed" (fires the drain) at this fraction of full thrust extension
    windbackPx: 20, // how far the attacker pulls back during the wind-up
    knockbackPx: 16, // how far the struck defender is shoved back on impact
    knockbackMs: 70, // the defender is shoved out this fast…
    settleMs: 220, // …then eases back to its slot (it never overshoots toward the attacker)
  },

  // ── one death ─────────────────────────────────────────────────────────────────
  death: {
    zeroHoldMs: 220, // the card sits visibly at 0 HP before it dies
    animMs: 380, // crumble / shrink / fade
  },

  // ── one buff (stat payoff) ──────────────────────────────────────────────────────
  buff: {
    flashMs: 160, // aura/ring flash before the number moves
    tickMs: 380, // the stat number counts up (with a bounce)
  },

  // ── floating text (damage / heal / buff chips) ─────────────────────────────────
  float: {
    riseMs: 720, // scale-in pop → float up → fade
    stackMs: 26, // vertical offset per stacked text so two never overlap on one card (px handled in CSS)
  },

  /** Health-bar drain tween (never snapped). */
  hpDrainMs: 300,
  /** Extra delay per cleave-splash target so a wide hit reads as a left→right sweep. */
  cleaveStaggerMs: 55,
} as const;

/** Convert a beat's raw weight into its on-screen dwell (ms) at a given user playback speed + auto-fit. */
export function beatDwellMs(weight: number, speed: number, autoScale: number): number {
  return (TIMING.baseStepMs * weight) / (speed * autoScale * TIMING.combatSpeed);
}

export interface StrikeFit {
  highlightMs: number; // attacker glow/scale hold before it moves
  windupMs: number; // attacker pull-back
  thrustMs: number; // attacker lunge into the defender
  contactMs: number; // instant the blow lands = highlight + windup + thrust (fx + damage floats fire here)
  impactHoldMs: number; // attacker dwell at full extension
  recoilMs: number; // attacker return home
  totalMs: number; // full attacker choreography (highlight → recoil)
  knockbackMs: number; // defender shove-out phase
  reactionMs: number; // full defender reaction (knockback + settle)
  flashMs: number; // hit-flash duration
  floatMs: number;
}

/** Fit the strike choreography into `beatMs`, scaling down uniformly if the beat was compressed. */
export function strikeTiming(beatMs: number): StrikeFit {
  const s = TIMING.strike;
  const contact = s.highlightMs + s.windupMs + s.thrustMs;
  const total = contact + s.impactHoldMs + s.recoilMs;
  const scale = Math.min(1, (beatMs * 0.9) / total);
  const reaction = (s.knockbackMs + s.settleMs) * scale;
  return {
    highlightMs: s.highlightMs * scale,
    windupMs: s.windupMs * scale,
    thrustMs: s.thrustMs * scale,
    contactMs: contact * scale,
    impactHoldMs: s.impactHoldMs * scale,
    recoilMs: s.recoilMs * scale,
    totalMs: total * scale,
    knockbackMs: s.knockbackMs * scale,
    reactionMs: reaction,
    flashMs: reaction,
    floatMs: Math.min(TIMING.float.riseMs, beatMs * 1.1),
  };
}

export interface DeathFit {
  zeroHoldMs: number;
  animMs: number;
}

/** Fit the death choreography (0-HP hold → crumble) into `beatMs`. */
export function deathTiming(beatMs: number): DeathFit {
  const d = TIMING.death;
  const naturalLen = d.zeroHoldMs + d.animMs;
  const scale = Math.min(1, (beatMs * 0.85) / naturalLen);
  return { zeroHoldMs: d.zeroHoldMs * scale, animMs: d.animMs * scale };
}

export interface BuffFit {
  flashMs: number;
  tickMs: number;
  floatMs: number;
}

/** Fit the buff choreography (flash → number tick) into `beatMs`. */
export function buffTiming(beatMs: number): BuffFit {
  const b = TIMING.buff;
  const naturalLen = b.flashMs + b.tickMs;
  const scale = Math.min(1, (beatMs * 0.9) / naturalLen);
  return {
    flashMs: b.flashMs * scale,
    tickMs: b.tickMs * scale,
    floatMs: Math.min(TIMING.float.riseMs, beatMs * 1.1),
  };
}
