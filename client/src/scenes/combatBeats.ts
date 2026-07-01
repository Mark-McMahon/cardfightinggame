// combatBeats — the ONE piece of client-only LOGIC (design-spec §10, invariant: no game rules
// in the client; this only RE-SHAPES the server's authoritative CombatEvent[] for legible
// playback). PURE and render-free: NO React, NO DOM. Unit-tested in combatBeats.test.ts.
//
// The server emits a flat, ordered CombatEvent[] (§7.5). A flat replay reads as noise. This
// module segments that stream into ordered CAUSAL BEATS so the replay can honor the §10
// legibility wins — in particular win #4 (causality): "a strike, the deaths it caused, and the
// buffs those deaths triggered are separate ordered beats" — and win #3 (pacing by impact): each
// beat carries a dwell `weight` scaling with its impact (trivial strikes batch fast; multi-death
// pileups and board-wide buffs hold).
//
// SEGMENTATION MODEL (single forward pass, deterministic — same input → same beats):
//   - `combatStart`                      → a lone `start` beat.
//   - `combatEnd`                        → a lone `end` beat.
//   - `attack`                           → OPENS a new `strike` beat; its `damage` events (incl.
//                                          cleave splash + shield-break, which carry shieldBroken)
//                                          attach to that same strike.
//   - `death` / `deathrattle`            → a `deaths` beat (a whole simultaneous batch merges).
//   - `stats` / `keyword` / `summon`     → an `aftermath` beat (the payoffs a strike/deaths caused:
//     AFTER combat has begun                avenge buffs, reborn returns, summons, gained abilities).
//   - the SAME event kinds BEFORE the      → a `startOfCombat` beat (Infernal self-damage, Siren
//     first `attack`                        burst, poison — the pre-combat action, not an aftermath).
//
// A new beat starts whenever the incoming event's group differs from the open beat's group; every
// `attack` force-splits (one strike per swing) and start/end always stand alone. Concatenating
// every beat's `events` in order reproduces the input array exactly (no drop / reorder / dup) —
// this round-trip is a pinned test invariant.

import type { CombatEvent } from '@cardgame/shared';

export type BeatKind = 'start' | 'startOfCombat' | 'strike' | 'deaths' | 'aftermath' | 'end';

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
  sourceIds?: string[]; // aftermath: distinct sourceIds that caused the buffs (for source→target links)
}

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
    case 'deathrattle':
      return 'deaths';
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
      return shield ? 1.5 : 1; // strikes are light; the payoff weight lives in deaths/aftermath beats
    }
    case 'deaths': {
      const n = events.filter((e) => e.t === 'death').length;
      return clamp(1 + n, 1, 5); // a lone death = 2; a multi-death pile holds longer
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
      const dr = events.find((e) => e.t === 'deathrattle');
      const deaths = events.filter((e) => e.t === 'death');
      if (dr && dr.t === 'deathrattle') return `${nameOf(names, dr.unitId)}'s deathrattle`;
      if (deaths.length === 1 && deaths[0].t === 'death') return `${nameOf(names, deaths[0].unitId)} falls`;
      return `${deaths.length} fall`;
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
  if (kind === 'aftermath') {
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

/**
 * Segment a combat log into ordered causal beats. Pure: `beats(log)` twice yields deep-equal
 * output, and `beats(log).flatMap(b => b.events)` deep-equals `log`.
 */
export function beats(log: CombatEvent[]): Beat[] {
  const names = nameMap(log);
  const out: Beat[] = [];
  let cur: { kind: Group; events: CombatEvent[] } | null = null;
  let started = false;

  const flush = () => {
    if (!cur) return;
    const kind = cur.kind;
    const events = cur.events;
    out.push({ kind, events, weight: weightOf(kind, events), caption: captionOf(kind, events, names), ...decorate(kind, events) });
    cur = null;
  };

  for (const ev of log) {
    const g = groupOf(ev, started);
    // every swing is its own beat; start/end always stand alone; otherwise merge same-group runs.
    const forceSplit = ev.t === 'attack' || ev.t === 'combatStart' || ev.t === 'combatEnd';
    if (!cur || cur.kind !== g || forceSplit) {
      flush();
      cur = { kind: g, events: [] };
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
