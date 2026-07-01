// combatReplay — the pure, render-free segmentation of the server's authoritative CombatEvent[]
// into legible causal BEATS (design-spec §10), plus the pacing math that both consumers need:
//   • the CLIENT (`CombatReplay.tsx`) folds these beats into the animated replay, dwelling on each
//     beat for `REPLAY_BASE_STEP_MS × weight` (÷ COMBAT_SPEED).
//   • the SERVER (`MatchRoom`) sizes the `combat` phase window from `combatWindowMs(logs)` so the
//     replay is never cut off mid-fight (it used to hold a fixed 6.5s, which truncated any real
//     board — see §10). Living in `shared` keeps the two in exact lockstep (invariant: no drift).
//
// PURE: NO React, NO DOM, NO IO. `beats(log)` twice yields deep-equal output, and
// `beats(log).flatMap(b => b.events)` deep-equals `log` (round-trip is a pinned test invariant).
// Content lookups (does this uid own a real deathrattle?) go through `UNIT_BY_ID`, which is pure data.
//
// SEGMENTATION MODEL (single forward pass, deterministic — same input → same beats):
//   - `combatStart`                      → a lone `start` beat.
//   - `combatEnd`                        → a lone `end` beat.
//   - `attack`                           → OPENS a new `strike` beat; its `damage` events (incl.
//                                          cleave splash + shield-break, which carry shieldBroken)
//                                          attach to that same strike.
//   - `death`                            → a `deaths` beat (a whole simultaneous batch merges). This
//                                          beat holds the 0-HP register + death animation; NOTHING
//                                          else rides on it, so the death reads before its payoff.
//   - `deathrattle` (REAL only)          → its OWN `deathrattle` beat, played AFTER the deaths beat.
//                                          The payoff events it caused (its summon / its buff /
//                                          its granted keyword — matched by sourceId/ownerId ===
//                                          the dead unit) attach to that same beat. A `deathrattle`
//                                          event for a unit with NO deathrattle effect (the resolver
//                                          emits one per death as a marker) is SPURIOUS: it is
//                                          absorbed silently into the current beat and never labels a
//                                          card that has no deathrattle (fixes the mislabel bug).
//   - `stats` / `keyword` / `summon`     → an `aftermath` beat (payoffs NOT tied to a just-fired
//     AFTER combat has begun               deathrattle: avenge buffs, reborn returns, onSummon chains).
//   - the SAME event kinds BEFORE the      → a `startOfCombat` beat (Infernal self-damage, Siren
//     first `attack`                        burst, poison — the pre-combat action, not an aftermath).
//
// A new beat starts whenever the incoming event's group differs from the open beat's group; every
// `attack` (and every REAL `deathrattle`) force-splits, and start/end always stand alone.

import type { CombatEvent } from '../types';
import { UNIT_BY_ID } from '../content';

export type BeatKind = 'start' | 'startOfCombat' | 'strike' | 'deaths' | 'deathrattle' | 'aftermath' | 'end';

export interface Beat {
  kind: BeatKind;
  /** The raw events in this beat, in their original stream order. */
  events: CombatEvent[];
  /** Dwell multiplier (≥ 1). Scales with impact — the replay multiplies its base step delay by it. */
  weight: number;
  /** A short causal caption naming the cause of this beat (uses names from the combatStart snapshot). */
  caption: string;
  // ── convenience fields the renderer consumes (all derivable from `events`) ──
  side?: 'a' | 'b'; // strike: which side swung
  attackerId?: string; // strike
  defenderId?: string; // strike
  deaths?: string[]; // deaths: uids that fell this beat
  sourceIds?: string[]; // aftermath / deathrattle: distinct sourceIds that caused the buffs (source→target links)
}

// ── replay pacing constants ────────────────────────────────────────────────────────
// Shared so the client's dwell and the server's phase window are computed from the same numbers.
/** Base per-beat dwell before the impact weight and playback speed are applied. */
export const REPLAY_BASE_STEP_MS = 620;
/**
 * Global combat-pacing multiplier (the one tuning knob for overall replay speed). >1 = faster,
 * <1 = slower. Applied to BOTH the client dwell and the server window so they can never drift.
 * The client's TIMING config (replayTiming.ts) re-exports this as `TIMING.combatSpeed`.
 */
export const COMBAT_SPEED = 1;
/** Floor for the server combat window — tiny fights still hold on the result banner this long. */
export const REPLAY_WINDOW_MIN_MS = 4000;
/** Ceiling for the server combat window (and the client's auto-fit target). A monster board can
 *  exceed its natural playback here; the client compresses its dwell to finish inside this. */
export const REPLAY_WINDOW_CAP_MS = 22000;
/** Extra hold after the last beat before the next shop opens (lets the result banner land). */
export const REPLAY_TAIL_PAD_MS = 900;

type Group = BeatKind;

/** Which beat-group an event belongs to. `started` flips true at the first `attack` (see model). */
function groupOf(ev: CombatEvent, started: boolean): Group {
  switch (ev.t) {
    case 'combatStart':
      return 'start';
    case 'combatEnd':
      return 'end';
    case 'attack':
      return 'strike';
    case 'death':
      return 'deaths';
    case 'deathrattle':
      return 'deathrattle';
    case 'damage':
      // damage is always part of a swing (the strike that dealt it, or a start-of-combat burst).
      return started ? 'strike' : 'startOfCombat';
    case 'stats':
    case 'keyword':
    case 'summon':
      return started ? 'aftermath' : 'startOfCombat';
  }
}

/** Build a uid → display name map from the combatStart snapshots (the only place names live). */
function nameMap(events: CombatEvent[]): Map<string, string> {
  const m = new Map<string, string>();
  const start = events.find((e) => e.t === 'combatStart');
  if (start && start.t === 'combatStart') {
    for (const u of start.a.units) m.set(u.uid, u.name);
    for (const u of start.b.units) m.set(u.uid, u.name);
  }
  return m;
}

function nameOf(names: Map<string, string>, uid: string | undefined): string {
  return (uid && names.get(uid)) || 'a unit';
}

/** Best-effort: the cardId a unit summons (from its own card's first summon action). */
function summonedCardIdOf(ownerCardId: string | undefined): string | undefined {
  if (!ownerCardId) return undefined;
  const card = UNIT_BY_ID[ownerCardId];
  if (!card) return undefined;
  for (const eff of card.effects) for (const act of eff.actions) if (act.type === 'summon' && act.summonUnitId) return act.summonUnitId;
  return undefined;
}

/**
 * uid → "does this unit actually carry a deathrattle effect?" The resolver emits a `deathrattle`
 * event for EVERY death (as a marker), so the event alone can't be trusted to label a deathrattle —
 * we consult the card catalog. Starting units come from the combatStart snapshot; summoned units'
 * cardIds are resolved best-effort from their owner's summon action. Unknown ids → false (we would
 * rather under-claim a deathrattle than mislabel a card that has none).
 */
function makeHasDeathrattle(events: CombatEvent[]): (uid: string) => boolean {
  const cardIds = new Map<string, string>();
  const start = events.find((e) => e.t === 'combatStart');
  if (start && start.t === 'combatStart') {
    for (const u of start.a.units) cardIds.set(u.uid, u.cardId);
    for (const u of start.b.units) cardIds.set(u.uid, u.cardId);
  }
  for (const e of events) {
    if (e.t !== 'summon') continue;
    const sc = summonedCardIdOf(cardIds.get(e.ownerId));
    if (sc) for (const uid of e.unitIds) cardIds.set(uid, sc);
  }
  return (uid: string): boolean => {
    const cid = cardIds.get(uid);
    const card = cid ? UNIT_BY_ID[cid] : undefined;
    return !!card && card.effects.some((e) => e.trigger.type === 'deathrattle');
  };
}

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

/** Dwell weight for a finished beat — the pacing-by-impact lever (§10 win #3). */
function weightOf(kind: BeatKind, events: CombatEvent[]): number {
  switch (kind) {
    case 'start':
      return 2; // hold so the two boards register
    case 'end':
      return 3; // hold on the result
    case 'strike': {
      const shield = events.some((e) => e.t === 'damage' && e.shieldBroken);
      // A strike now carries a full asymmetric telegraph (highlight → wind-up → thrust → impact →
      // recoil, §10 win #1 / replayTiming.ts). Its dwell must fit that choreography uncompressed on
      // a normal-length fight, so the base strike holds ~1.6 base-steps; a shield-break holds longer
      // still for the shatter ring. (A monster board still auto-compresses to the window cap.)
      return shield ? 2.2 : 1.6;
    }
    case 'deaths': {
      const n = events.filter((e) => e.t === 'death').length;
      // A death beat must hold long enough for the 0-HP register + death animation (≥2 base steps);
      // a multi-death pile holds longer still.
      return clamp(1 + n, 2, 5);
    }
    case 'deathrattle': {
      // A deathrattle is a payoff — always hold, and hold longer the wider its effect.
      const touched = new Set<string>();
      let summons = 0;
      for (const e of events) {
        if (e.t === 'stats' || e.t === 'keyword') touched.add(e.unitId);
        else if (e.t === 'summon') summons += e.unitIds.length;
        else if (e.t === 'damage' && e.amount > 0) touched.add(e.targetId);
      }
      return clamp(2 + touched.size + summons, 2, 6);
    }
    case 'aftermath':
    case 'startOfCombat': {
      // breadth is the clearest "impact" proxy: a board-wide buff touches many units → holds.
      const touched = new Set<string>();
      let summons = 0;
      for (const e of events) {
        if (e.t === 'stats' || e.t === 'keyword') touched.add(e.unitId);
        else if (e.t === 'summon') summons += e.unitIds.length;
        else if (e.t === 'damage' && e.amount > 0) touched.add(e.targetId);
      }
      return clamp(1 + touched.size + summons, 1, 6);
    }
  }
}

function captionOf(kind: BeatKind, events: CombatEvent[], names: Map<string, string>): string {
  switch (kind) {
    case 'start':
      return 'Battle begins';
    case 'startOfCombat':
      return 'Start of combat';
    case 'end': {
      const end = events.find((e) => e.t === 'combatEnd');
      if (end && end.t === 'combatEnd') {
        if (end.winner === 'tie') return 'Draw';
        return `Side ${end.winner.toUpperCase()} wins`;
      }
      return 'Combat ends';
    }
    case 'strike': {
      const atk = events.find((e) => e.t === 'attack');
      if (atk && atk.t === 'attack') return `${nameOf(names, atk.attackerId)} strikes ${nameOf(names, atk.defenderId)}`;
      return 'A strike';
    }
    case 'deaths': {
      // Caption ONLY from the deaths themselves — never from the marker `deathrattle` events that
      // may have been absorbed here (those are for units with no real deathrattle).
      const deaths = events.filter((e) => e.t === 'death');
      if (deaths.length === 1 && deaths[0].t === 'death') return `${nameOf(names, deaths[0].unitId)} falls`;
      return `${deaths.length} fall`;
    }
    case 'deathrattle': {
      const dr = events.find((e) => e.t === 'deathrattle');
      if (dr && dr.t === 'deathrattle') return `${nameOf(names, dr.unitId)}'s deathrattle`;
      return 'Deathrattle';
    }
    case 'aftermath': {
      const summon = events.find((e) => e.t === 'summon');
      if (summon && summon.t === 'summon') return `${nameOf(names, summon.ownerId)} summons`;
      const gain = events.find((e) => e.t === 'keyword');
      if (gain && gain.t === 'keyword') return `${nameOf(names, gain.unitId)} gains ${gain.keyword}`;
      const buff = events.find((e) => e.t === 'stats' && e.sourceId);
      if (buff && buff.t === 'stats' && buff.sourceId) return `${nameOf(names, buff.sourceId)} empowers the board`;
      return 'A unit returns'; // reborn / un-sourced stat change
    }
  }
}

function decorate(kind: BeatKind, events: CombatEvent[]): Partial<Beat> {
  if (kind === 'strike') {
    const atk = events.find((e) => e.t === 'attack');
    if (atk && atk.t === 'attack') return { side: atk.side, attackerId: atk.attackerId, defenderId: atk.defenderId };
  }
  if (kind === 'deaths') {
    return { deaths: events.filter((e) => e.t === 'death').map((e) => (e.t === 'death' ? e.unitId : '')) };
  }
  if (kind === 'aftermath' || kind === 'deathrattle') {
    const src = new Set<string>();
    for (const e of events) {
      if (e.t === 'stats' && e.sourceId) src.add(e.sourceId);
      if (e.t === 'keyword' && e.sourceId) src.add(e.sourceId);
      if (e.t === 'summon') src.add(e.ownerId);
    }
    return { sourceIds: [...src] };
  }
  return {};
}

/** The event that CAUSED a payoff (for attaching it to the deathrattle that produced it). */
function causeOf(ev: CombatEvent): string | undefined {
  if (ev.t === 'summon') return ev.ownerId;
  if (ev.t === 'stats' || ev.t === 'keyword') return ev.sourceId;
  return undefined;
}

/**
 * Segment a combat log into ordered causal beats. Pure: `beats(log)` twice yields deep-equal
 * output, and `beats(log).flatMap(b => b.events)` deep-equals `log`.
 */
export function beats(log: CombatEvent[]): Beat[] {
  const names = nameMap(log);
  const hasDeathrattle = makeHasDeathrattle(log);
  const out: Beat[] = [];
  let cur: { kind: Group; events: CombatEvent[]; drUid?: string } | null = null;
  let started = false;

  const flush = () => {
    if (!cur) return;
    const kind = cur.kind;
    const events = cur.events;
    out.push({ kind, events, weight: weightOf(kind, events), caption: captionOf(kind, events, names), ...decorate(kind, events) });
    cur = null;
  };

  for (const ev of log) {
    let g = groupOf(ev, started);
    let forceSplit = ev.t === 'attack' || ev.t === 'combatStart' || ev.t === 'combatEnd';

    if (ev.t === 'deathrattle') {
      if (hasDeathrattle(ev.unitId)) {
        // a REAL deathrattle → its own beat (so it plays as a discrete payoff, after the death).
        g = 'deathrattle';
        forceSplit = true;
      } else {
        // spurious marker (unit has no deathrattle) → absorb into the current beat, unlabeled.
        g = cur ? cur.kind : 'deaths';
        forceSplit = false;
      }
    } else if (cur && cur.kind === 'deathrattle' && (ev.t === 'stats' || ev.t === 'keyword' || ev.t === 'summon')) {
      // a payoff caused by the just-fired deathrattle rides on its beat; avenge/reborn (a different
      // or absent source) breaks off into its own aftermath beat.
      if (causeOf(ev) === cur.drUid) g = 'deathrattle';
    }

    if (!cur || cur.kind !== g || forceSplit) {
      flush();
      cur = { kind: g, events: [] };
      if (g === 'deathrattle' && ev.t === 'deathrattle') cur.drUid = ev.unitId;
    }
    cur.events.push(ev);
    if (ev.t === 'attack') started = true;
  }
  flush();
  return out;
}

/** Total dwell weight of a beat list — handy for the renderer to size a scrub/progress bar. */
export function totalWeight(bs: Beat[]): number {
  return bs.reduce((s, b) => s + b.weight, 0);
}

/** Natural playback length of one combat log at a given speed (before any auto-fit compression). */
export function combatReplayMs(log: CombatEvent[], speed = 1): number {
  return (totalWeight(beats(log)) * REPLAY_BASE_STEP_MS) / COMBAT_SPEED / speed;
}

/**
 * How long the server should hold the `combat` phase so every watching client can see its whole
 * replay: the longest natural playback across the given logs, padded, then clamped to [MIN, CAP].
 * A fight longer than the CAP is compressed client-side (see CombatReplay auto-fit) to still fit.
 */
export function combatWindowMs(logs: CombatEvent[][]): number {
  let maxMs = 0;
  for (const log of logs) maxMs = Math.max(maxMs, combatReplayMs(log));
  return clamp(maxMs + REPLAY_TAIL_PAD_MS, REPLAY_WINDOW_MIN_MS, REPLAY_WINDOW_CAP_MS);
}
