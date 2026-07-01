// CombatReplay — replays the server's authoritative combatLog (CombatEvent[]) as a CHOREOGRAPHED
// sequence of discrete, non-overlapping beats (design-spec §10). It computes NOTHING about the fight
// (combat already happened server-side); it re-derives board state at each beat by folding the event
// stream, then plays each beat as entry → hold → exit.
//
// The load-bearing idea (why the old replay felt "off"): PRESENTATION IS DECOUPLED FROM SIMULATION.
//   • The pure engine segments the log into causal beats (shared/engine/combatReplay.ts): a strike,
//     the deaths it caused, each REAL deathrattle as its own beat, then the buffs those triggered.
//   • This presenter plays them ONE AT A TIME on a single frame-rate-independent rAF clock — a beat
//     only advances once its choreography has had its full dwell (never mid-motion). All sub-beat
//     timing lives in ONE config (replayTiming.ts) with a global `combatSpeed`.
//
// The four legibility wins layered on top:
//   1. WHO HITS WHOM — a directional, ASYMMETRIC telegraph: the attacker glows + scales in place
//      (the eye lands on it FIRST), then winds up, then LUNGES into the exact defender while the rest
//      of the board dims; the defender only RECOILS (knocked away, then settles — never a shake, never
//      toward the attacker). Only the initiator lunges, so who-started-it reads without decoding colour.
//   2. THE DEATH CADENCE — damage pops → the health bar DRAINS → the card HOLDS at 0 HP → it crumbles
//      → only THEN does its deathrattle play (its own beat) → then removal + reflow. No overlap.
//   3. CLEAN FLOATING TEXT — one consistent stack above each card; damage red, buff gold, keyword
//      green; texts never overlap (they stack), and "deathrattle" only ever labels a real one.
//   4. VISIBLE BUFFS — a flash + a stat number that TICKS up, slotted as its own beat, never on a strike.
// Plus the contextual deaths counter (decision #27): shown only when you own a deaths-consuming card.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, useAnimationControls } from 'framer-motion';
import type { CombatEvent, Keyword, TribeId } from '@cardgame/shared';
import { getCard, breakpoints, totalWeight, REPLAY_WINDOW_CAP_MS, REPLAY_TAIL_PAD_MS } from '@cardgame/shared';
import { Card, type CardModel, type CombatCardProps } from '../components';
import { KW_ICON, KW_LABEL } from '../icons';
import { beats, type Beat } from './combatBeats';
import { TIMING, beatDwellMs, strikeTiming, deathTiming, buffTiming, type StrikeFit, type DeathFit, type BuffFit } from './replayTiming';

const DEATHS_CONSUMERS = new Set(breakpoints.list.filter((b) => b.counter === 'deaths' || b.counter === 'revenantDeaths').map((b) => b.card));
const deathsThresholdFor = (cardIds: string[]): number | null => {
  const t = breakpoints.list.filter((b) => DEATHS_CONSUMERS.has(b.card) && cardIds.includes(b.card)).map((b) => b.threshold);
  return t.length ? Math.min(...t) : null;
};

interface RUnit extends CardModel {
  uid: string;
  dead: boolean;
  maxHp: number; // running max HP seen (for the health-bar fill ratio)
}

function unitFromSnap(u: { uid: string; cardId: string; name: string; tribe: TribeId; tier: number; atk: number; hp: number; keywords: Keyword[]; golden: boolean }): RUnit {
  const card = getCard(u.cardId);
  return { ...u, isToken: card?.isToken ?? false, text: card?.text, dead: false, maxHp: u.hp };
}

function resolveSummonCardId(ownerCardId: string): string | undefined {
  const card = getCard(ownerCardId);
  if (card) for (const eff of card.effects) for (const act of eff.actions) if (act.type === 'summon' && act.summonUnitId) return act.summonUnitId;
  return breakpoints.list.find((b) => b.card === ownerCardId && b.summonUnitId)?.summonUnitId;
}

function summonUnit(uid: string, ownerTribe: TribeId, ownerCardId: string): RUnit {
  const cardId = resolveSummonCardId(ownerCardId);
  const card = cardId ? getCard(cardId) : undefined;
  const hp = card?.hp ?? 1;
  return {
    uid,
    cardId: cardId ?? '',
    name: card?.name ?? 'Summon',
    tribe: card?.tribe ?? ownerTribe,
    tier: card?.tier ?? 1,
    atk: card?.atk ?? 1,
    hp,
    keywords: card?.keywords ?? [],
    golden: false,
    isToken: card?.isToken ?? true,
    dead: false,
    maxHp: hp,
  };
}

/** Fold events into the two board lines. Deterministic mirror of what the server already resolved. */
function computeBoards(events: CombatEvent[]): { a: RUnit[]; b: RUnit[] } {
  const a: RUnit[] = [];
  const b: RUnit[] = [];
  const find = (uid: string): RUnit | undefined => a.find((u) => u.uid === uid) ?? b.find((u) => u.uid === uid);
  const sideOf = (uid: string): RUnit[] | null => (a.some((u) => u.uid === uid) ? a : b.some((u) => u.uid === uid) ? b : null);

  for (const e of events) {
    switch (e.t) {
      case 'combatStart':
        a.length = 0;
        b.length = 0;
        e.a.units.forEach((u) => a.push(unitFromSnap(u)));
        e.b.units.forEach((u) => b.push(unitFromSnap(u)));
        break;
      case 'damage': {
        const t = find(e.targetId);
        if (!t) break;
        if (e.shieldBroken) t.keywords = t.keywords.filter((k) => k !== 'divineShield');
        if (e.amount > 0) t.hp -= e.amount;
        break;
      }
      case 'keyword': {
        const u = find(e.unitId);
        if (u && !u.keywords.includes(e.keyword)) u.keywords = [...u.keywords, e.keyword];
        break;
      }
      case 'stats': {
        const u = find(e.unitId);
        if (u) {
          u.atk = e.atk;
          u.hp = e.hp;
          u.maxHp = Math.max(u.maxHp, e.hp);
          u.dead = false; // a unit receiving stats is alive (also handles reborn returning to its slot)
        }
        break;
      }
      case 'death': {
        const u = find(e.unitId);
        if (u) {
          u.dead = true;
          u.hp = 0;
        }
        break;
      }
      case 'summon': {
        const owner = find(e.ownerId);
        const side = sideOf(e.ownerId);
        if (owner && side) {
          const at = Math.min(e.slot, side.length);
          side.splice(at, 0, ...e.unitIds.map((uid) => summonUnit(uid, owner.tribe, owner.cardId)));
        }
        break;
      }
      default:
        break;
    }
  }
  return { a, b };
}

function mySideOf(log: CombatEvent[], myUids: Set<string>): 'a' | 'b' {
  const start = log.find((e) => e.t === 'combatStart');
  if (start && start.t === 'combatStart') {
    if (start.b.units.some((u) => myUids.has(u.uid))) return 'b';
  }
  return 'a';
}

interface Link {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Measured strike geometry: how far the attacker lunges, and which way the defender is knocked. */
interface StrikeGeom {
  attackerId: string;
  defenderId: string;
  dx: number; // attacker THRUST vector (toward defender — the committed poke)
  dy: number;
  wx: number; // attacker WIND-UP vector (away from defender — the anticipation pull-back)
  wy: number;
  kx: number; // defender KNOCKBACK vector (away from attacker)
  ky: number;
}

/**
 * A frame-rate-independent, non-drifting per-beat clock. Fires `onDone` once `durationMs` of real
 * time has elapsed (measured from rAF timestamps, so it can't drift like a chained setTimeout). It
 * restarts whenever `resetKey`/`durationMs`/`playing` change (i.e. every beat), so pausing then
 * resuming replays the current beat's dwell cleanly.
 */
function useBeatClock(durationMs: number, playing: boolean, resetKey: number, onDone: () => void): void {
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => {
    if (!playing || !isFinite(durationMs) || durationMs <= 0) return;
    let raf = 0;
    let start: number | null = null;
    let fired = false;
    const tick = (ts: number): void => {
      if (start === null) start = ts;
      if (ts - start >= durationMs) {
        if (!fired) {
          fired = true;
          doneRef.current();
        }
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [durationMs, playing, resetKey]);
}

export function CombatReplay({ log, myBoard }: { log: CombatEvent[]; myBoard: { uid: string; cardId: string }[] }) {
  const bs = useMemo(() => beats(log), [log]);
  // Auto-fit: the server holds the 'combat' phase for combatWindowMs (capped). If this fight's
  // natural playback would overrun that cap, compress the dwell just enough to finish inside it,
  // so the replay always plays to the result banner instead of being cut off mid-fight (§10).
  const autoScale = useMemo(() => {
    const naturalMs = (totalWeight(bs) * TIMING.baseStepMs) / TIMING.combatSpeed;
    const target = REPLAY_WINDOW_CAP_MS - REPLAY_TAIL_PAD_MS;
    return Math.max(1, naturalMs / target);
  }, [bs]);
  const myUids = useMemo(() => new Set(myBoard.map((u) => u.uid)), [myBoard]);
  const myCardIds = useMemo(() => myBoard.map((u) => u.cardId), [myBoard]);
  const mySide = useMemo(() => mySideOf(log, myUids), [log, myUids]);

  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [dismissed, setDismissed] = useState(false); // Skip → close the overlay entirely (win #5)

  // §10 win #2 — the drain fires on IMPACT, not beat-start. A strike beat's damage stays hidden (bar
  // full, HP number un-ticked) until the attacker's lunge actually REACHES the defender: the attacker's
  // fx animation fires `onImpact` at full extension (see BattleLine.onUpdate), which stamps this beat as
  // struck. Derived (impactAtIdx === idx) rather than an effect so it is false again the instant a new
  // beat opens — no one-frame flash of pre-drained HP, and no lunge-restarting reset effect.
  const [impactAtIdx, setImpactAtIdx] = useState(-1);
  const impactReached = impactAtIdx === idx;
  const onImpact = useCallback(() => {
    setImpactAtIdx((prev) => {
      if (prev === idx) return prev; // already landed this beat — fire once
      // dev-only cadence instrumentation (matches the [beat] log): stamp the impact instant so the
      // §10 Playwright audit can confirm the HP drain fires at contact, not at beat-start. Gated on #replay-lab.
      if (typeof window !== 'undefined' && window.location.hash.includes('replay-lab')) {
        // eslint-disable-next-line no-console
        console.log(`[impact] t=${Math.round(performance.now())} beat#${idx + 1} — lunge reached defender; HP drain fires now`);
      }
      return idx;
    });
  }, [idx]);

  // reset to the top whenever a fresh combat arrives
  useEffect(() => {
    setIdx(0);
    setPlaying(true);
    setDismissed(false);
  }, [log]);

  const beat: Beat | undefined = bs[idx];
  const atEnd = idx >= bs.length - 1;

  // Per-beat dwell (ms). This is the advance clock AND the budget the sub-beat choreography fits into.
  const beatMs = beatDwellMs(beat?.weight ?? 1, speed, autoScale);
  const sFit: StrikeFit = useMemo(() => strikeTiming(beatMs), [beatMs]);
  const dFit: DeathFit = useMemo(() => deathTiming(beatMs), [beatMs]);
  const bFit: BuffFit = useMemo(() => buffTiming(beatMs), [beatMs]);

  // advance one beat once the current beat's dwell has fully elapsed (frame-rate independent).
  useBeatClock(atEnd ? 0 : beatMs, playing, idx, () => setIdx((i) => Math.min(i + 1, bs.length - 1)));

  // dev-only cadence instrumentation: a timestamped log per beat so the Playwright harness can audit
  // ordering and the real gaps between beats (§10, Step-3 "observe then verify"). Gated on #replay-lab.
  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.hash.includes('replay-lab')) {
      // eslint-disable-next-line no-console
      console.log(`[beat] t=${Math.round(performance.now())} #${idx + 1}/${bs.length} kind=${beat?.kind} w=${beat?.weight} cap="${beat?.caption}"`);
    }
  }, [idx, bs, beat]);

  const eventsUpto = useMemo(() => bs.slice(0, idx + 1).flatMap((b) => b.events), [bs, idx]);
  const eventsPrev = useMemo(() => bs.slice(0, idx).flatMap((b) => b.events), [bs, idx]);
  const cur = useMemo(() => computeBoards(eventsUpto), [eventsUpto]);
  const prev = useMemo(() => computeBoards(eventsPrev), [eventsPrev]);

  // per-beat focus (highlights / floats / deltas)
  const focus = useMemo(() => computeFocus(beat, cur, prev), [beat, cur, prev]);

  // Death cadence: during a deaths beat the fallen cards HOLD at 0 HP, crumble, and only THEN are
  // removed (row reflows). This flag flips after the 0-HP hold + crumble so the removal is its own
  // sub-beat — never simultaneous with the death animation.
  const [corpsesCleared, setCorpsesCleared] = useState(false);
  useEffect(() => {
    setCorpsesCleared(false);
    if (beat?.kind !== 'deaths' || !playing) return;
    const h = setTimeout(() => setCorpsesCleared(true), dFit.zeroHoldMs + dFit.animMs);
    return () => clearTimeout(h);
  }, [idx, beat, playing, dFit.zeroHoldMs, dFit.animMs]);

  // When do THIS beat's stat/hp changes visually begin? A STRIKE's drain is gated on the lunge
  // reaching the defender (impactReached), so its bar/number carry NO extra delay — the impact flip
  // is the trigger (see BattleLine). A buff's tick still waits `flashMs` past its flash ring.
  const isStrike = beat?.kind === 'strike';
  const changeDelayMs = beat && (beat.kind === 'aftermath' || beat.kind === 'deathrattle' || beat.kind === 'startOfCombat') ? bFit.flashMs : 0;
  const tickMs = isStrike ? Math.min(TIMING.hpDrainMs, beatMs * 0.6) : bFit.tickMs;

  // contextual deaths counter (decision #27)
  const mineUids = useMemo(() => {
    const s = new Set(myUids);
    for (const e of log) if (e.t === 'summon' && s.has(e.ownerId)) e.unitIds.forEach((u) => s.add(u));
    return s;
  }, [log, myUids]);
  const deathsThreshold = deathsThresholdFor(myCardIds);
  const runningDeaths = eventsUpto.filter((e) => e.t === 'death' && mineUids.has(e.unitId)).length;
  const showDeaths = deathsThreshold != null;
  const deathsFired = showDeaths && runningDeaths >= (deathsThreshold ?? Infinity);

  // Geometry, measured after each beat renders (§10 wins #1 + #2): source→target BUFF links, plus the
  // attacker's WIND-UP + THRUST vectors and the defender's KNOCKBACK vector (from resting slot centers).
  const fieldRef = useRef<HTMLDivElement>(null);
  const [links, setLinks] = useState<Link[]>([]);
  const [strikeGeom, setStrikeGeom] = useState<StrikeGeom | null>(null);
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) {
      setLinks([]);
      setStrikeGeom(null);
      return;
    }
    const fr = field.getBoundingClientRect();
    // Read the resting slot centres straight from the DOM by data-uid. (A callback ref on the slot's
    // framer `motion.div` is NOT reliably invoked, which previously left slotEls empty → strikeGeom
    // null → the strike collapsed to the symmetric fallback. Querying the committed DOM is robust.)
    const center = (uid: string): { x: number; y: number } | null => {
      const el = uid ? field.querySelector<HTMLElement>(`.bl-slot[data-uid="${uid}"]`) : null;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left - fr.left + r.width / 2, y: r.top - fr.top + r.height / 2 };
    };
    // buff links only — the hit "laser" is gone; the lunge + impact now carry who-hits-whom.
    const nextLinks: Link[] = [];
    for (const [tgt, src] of focus.buffLinks) {
      const s = center(src);
      const t = center(tgt);
      if (s && t) nextLinks.push({ x1: s.x, y1: s.y, x2: t.x, y2: t.y });
    }
    setLinks(nextLinks);
    // strike geometry: the attacker winds back away from the defender, then thrusts `reach` of the way
    // toward it (poking in); the defender is shoved further from the attacker. All along the same vector.
    let geom: StrikeGeom | null = null;
    if (beat?.attackerId && beat?.defenderId) {
      const s = center(beat.attackerId);
      const t = center(beat.defenderId);
      if (s && t) {
        const vx = t.x - s.x;
        const vy = t.y - s.y;
        const len = Math.hypot(vx, vy) || 1;
        geom = {
          attackerId: beat.attackerId,
          defenderId: beat.defenderId,
          dx: vx * TIMING.strike.reach,
          dy: vy * TIMING.strike.reach,
          wx: -(vx / len) * TIMING.strike.windbackPx,
          wy: -(vy / len) * TIMING.strike.windbackPx,
          kx: (vx / len) * TIMING.strike.knockbackPx,
          ky: (vy / len) * TIMING.strike.knockbackPx,
        };
      }
    }
    setStrikeGeom(geom);
  }, [idx, beat, focus]);

  // A small whole-field screen shake punctuates the blow at the contact instant. It shakes the WHOLE
  // battlefield (not a card), so it's a punctuation cue and never competes with the attacker's lunge
  // for "who hit whom". Because a field-wide transform shifts the field rect and every slot rect
  // together, it leaves the measured slot centers (relative to the field) untouched (§10 win #1).
  const fieldShake = useAnimationControls();
  useEffect(() => {
    if (beat?.kind === 'strike' && beat.attackerId && beat.defenderId && playing && isFinite(beatMs)) {
      fieldShake.start({ x: [0, -3, 3, -2, 1, 0] }, { duration: 0.2, delay: sFit.contactMs / 1000, ease: 'easeOut' });
    } else {
      fieldShake.set({ x: 0 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, playing]);

  const end = log.find((e) => e.t === 'combatEnd');

  if (dismissed) return null; // Skip closes the whole combat window (the frozen shop shows behind it)

  const topSide = mySide === 'a' ? 'b' : 'a';
  const bottomSide = mySide;

  const lineProps = { focus, strikeGeom, sFit, dFit, corpsesCleared, beatIdx: idx, changeDelayMs, hpDrainMs: TIMING.hpDrainMs, tickMs, isStrike, impactReached, onImpact };

  return (
    <div className="overlay">
      <div className="combat-head">
        <h2>Combat — Round replay</h2>
        {showDeaths && (
          <span className={'ctx-counter' + (deathsFired ? ' fired' : '')} title="friendly deaths this combat">
            Deaths {runningDeaths}
            {deathsThreshold != null ? ` / ${deathsThreshold}` : ''}
          </span>
        )}
      </div>

      <motion.div className={'battlefield' + (beat?.kind === 'strike' ? ' striking' : '')} ref={fieldRef} animate={fieldShake}>
        <svg className="link-overlay">
          {/* buff/source links: a soft dashed line from source → recipient, faded in each beat. */}
          {links.map((l, i) => (
            <motion.line
              key={`${idx}-${i}`}
              x1={l.x1}
              y1={l.y1}
              x2={l.x2}
              y2={l.y2}
              stroke="#e8be46"
              strokeWidth={2}
              strokeLinecap="round"
              strokeDasharray="5 5"
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.8 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
            />
          ))}
        </svg>

        <BattleLine label={topSide === mySide ? 'You' : 'Opponent'} units={cur[topSide]} {...lineProps} />
        <div className="bl-divider">
          <span className="vs-badge">VS</span>
        </div>
        <BattleLine label={bottomSide === mySide ? 'You' : 'Opponent'} units={cur[bottomSide]} {...lineProps} />
      </motion.div>

      <div className={'beat-caption' + (deathsFired && beat?.kind === 'deathrattle' ? ' breakpoint' : '')}>
        <span className="cap-spark">{beat ? beatIcon(beat.kind) : ''}</span>
        {beat?.caption ?? ''}
      </div>

      {atEnd && end && end.t === 'combatEnd' && <ResultBanner winner={end.winner} mySide={mySide} damage={end.damageToLoser} />}

      <div className="combat-controls panel">
        <div className="row">
          <button onClick={() => { setPlaying(false); setIdx((i) => Math.max(0, i - 1)); }}>◀</button>
          <button className="primary" onClick={() => setPlaying((p) => !p)}>
            {playing ? 'Pause' : 'Play'}
          </button>
          <button onClick={() => { setPlaying(false); setIdx((i) => Math.min(bs.length - 1, i + 1)); }}>▶</button>
          <input className="scrub" type="range" min={0} max={Math.max(0, bs.length - 1)} value={idx} onChange={(e) => { setPlaying(false); setIdx(Number(e.target.value)); }} />
          <span className="dim">
            beat {idx + 1}/{bs.length}
          </span>
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
            <option value={0.5}>0.5×</option>
            <option value={1}>1×</option>
            <option value={2}>2×</option>
            <option value={4}>4×</option>
          </select>
          <button onClick={() => setDismissed(true)}>Skip ✕</button>
        </div>
      </div>
    </div>
  );
}

interface Focus {
  attackerId?: string;
  defenderId?: string;
  sources: Set<string>;
  buffs: Map<string, { da: number; dh: number }>;
  gains: Map<string, Keyword>;
  doomed: Set<string>;
  dmg: Map<string, number>;
  shieldBroken: Set<string>; // units whose divine shield popped this beat → shatter cue
  buffLinks: Array<[string, string]>; // [target, source]
}

function computeFocus(beat: Beat | undefined, cur: { a: RUnit[]; b: RUnit[] }, prev: { a: RUnit[]; b: RUnit[] }): Focus {
  const f: Focus = { sources: new Set(), buffs: new Map(), gains: new Map(), doomed: new Set(), dmg: new Map(), shieldBroken: new Set(), buffLinks: [] };
  if (!beat) return f;
  const findPrev = (uid: string) => prev.a.find((u) => u.uid === uid) ?? prev.b.find((u) => u.uid === uid);

  if (beat.kind === 'strike') {
    f.attackerId = beat.attackerId;
    f.defenderId = beat.defenderId;
    for (const e of beat.events) {
      if (e.t === 'damage' && e.amount > 0) f.dmg.set(e.targetId, (f.dmg.get(e.targetId) ?? 0) + e.amount);
      if (e.t === 'damage' && e.shieldBroken) f.shieldBroken.add(e.targetId);
      if (e.t === 'keyword' && e.keyword === 'divineShield' && !e.gained) f.shieldBroken.add(e.unitId);
    }
  } else if (beat.kind === 'aftermath' || beat.kind === 'deathrattle' || beat.kind === 'startOfCombat') {
    for (const e of beat.events) {
      if (e.t === 'stats') {
        if (e.sourceId) f.sources.add(e.sourceId);
        const before = findPrev(e.unitId);
        const da = before ? e.atk - before.atk : 0;
        const dh = before ? e.hp - before.hp : 0;
        if (da > 0 || dh > 0) {
          f.buffs.set(e.unitId, { da: Math.max(0, da), dh: Math.max(0, dh) });
          if (e.sourceId && e.sourceId !== e.unitId) f.buffLinks.push([e.unitId, e.sourceId]);
        }
      } else if (e.t === 'keyword' && e.gained) {
        f.gains.set(e.unitId, e.keyword);
        if (e.sourceId) {
          f.sources.add(e.sourceId);
          if (e.sourceId !== e.unitId) f.buffLinks.push([e.unitId, e.sourceId]);
        }
      } else if (e.t === 'summon') {
        f.sources.add(e.ownerId);
      } else if (e.t === 'damage' && e.amount > 0) {
        // start-of-combat self-damage / poison burst reads as a struck unit.
        f.dmg.set(e.targetId, (f.dmg.get(e.targetId) ?? 0) + e.amount);
      }
    }
  } else if (beat.kind === 'deaths') {
    (beat.deaths ?? []).forEach((uid) => f.doomed.add(uid));
  }
  return f;
}

interface LineProps {
  label: string;
  units: RUnit[];
  focus: Focus;
  strikeGeom: StrikeGeom | null;
  sFit: StrikeFit;
  dFit: DeathFit;
  corpsesCleared: boolean;
  beatIdx: number;
  changeDelayMs: number;
  hpDrainMs: number;
  tickMs: number;
  isStrike: boolean;
  impactReached: boolean; // this strike beat's lunge has reached the defender → drains may play
  onImpact: () => void; // the attacker's fx calls this at full lunge extension
}

function BattleLine({ label, units, focus, strikeGeom, sFit, dFit, corpsesCleared, beatIdx, changeDelayMs, hpDrainMs, tickMs, isStrike, impactReached, onImpact }: LineProps) {
  // A unit dying THIS beat stays on the board (showing 0 HP, then crumbling) UNTIL `corpsesCleared`,
  // so its death cue reads fully before AnimatePresence collapses it out and the row reflows.
  const shown = units.filter((u) => !u.dead || (focus.doomed.has(u.uid) && !corpsesCleared));
  return (
    <div className="bl-side">
      <div className="bl-label">{label}</div>
      <div className="bl-line">
        {shown.length === 0 && <span className="bl-empty dim">— wiped —</span>}
        <AnimatePresence mode="popLayout" initial={false}>
          {shown.map((u) => {
            const isAtt = u.uid === focus.attackerId;
            const isTgt = u.uid === focus.defenderId;
            const isSrc = focus.sources.has(u.uid);
            const buff = focus.buffs.get(u.uid);
            const gain = focus.gains.get(u.uid);
            const isDoom = focus.doomed.has(u.uid);
            const dmg = focus.dmg.get(u.uid) ?? 0;
            const struck = dmg > 0;
            const splash = struck && !isTgt && !isAtt; // cleave neighbour / burst — not the defender
            const shieldBroke = focus.shieldBroken.has(u.uid);
            const slotCls = ['bl-slot', isAtt ? 'is-attacker' : '', isTgt ? 'is-target' : '', isSrc ? 'is-source' : '', splash ? 'is-splash' : ''].filter(Boolean).join(' ');
            const unitCls = [buff ? 'bufftgt' : '', buff && buff.da > 0 ? 'pop-atk' : '', buff && buff.dh > 0 ? 'pop-hp' : '', gain ? 'gaintgt' : '', isDoom ? 'dying' : ''].filter(Boolean).join(' ');

            // §10 win #2 — HOLD a strike's damage until the lunge actually LANDS. A struck unit shows
            // its PRE-damage HP (bar full, number un-ticked) until `impactReached` flips at contact;
            // then the persistent bar drains and the number ticks. This is what binds the drain to the
            // impact keyframe instead of beat-start. Gate only when a real lunge will fire the impact
            // (strikeGeom present); the degenerate no-geometry path keeps the old immediate drain so a
            // bar can never get stuck full.
            const gated = isStrike && struck && !!strikeGeom;
            const dispHp = gated && !impactReached ? u.hp + dmg : u.hp;
            const cprops: CombatCardProps = { hpMax: u.maxHp, changeDelayMs: gated ? 0 : changeDelayMs, hpDrainMs, tickMs };

            // fx layer — the asymmetric telegraph (§10 win #1). Whatever the attacker does, the
            // defender does the opposite or nothing, so the LUNGE (belonging to exactly one card) is
            // the pre-attentive "who started it" signal — not colour.
            let fxAnimate: Record<string, number | number[]> = { x: 0, y: 0, scale: 1 };
            let fxTransition: Record<string, unknown> = { duration: 0.2 };
            let fxKey = 'idle';
            let onFxUpdate: ((latest: { x?: number; y?: number }) => void) | undefined;
            if (isAtt && strikeGeom && strikeGeom.attackerId === u.uid) {
              // ATTACKER — the ONLY card that travels: highlight (glow+scale, STILL) → wind-up (pull
              // back, away) → thrust (accelerate in, poke) → hold at contact → recoil home. Never shakes,
              // never gets knocked back by its own blow.
              const { dx, dy, wx, wy } = strikeGeom;
              const t = sFit.totalMs || 1;
              fxAnimate = { x: [0, 0, wx, dx, dx, 0], y: [0, 0, wy, dy, dy, 0], scale: [1, 1.06, 1.06, 1.06, 1.06, 1] };
              fxTransition = {
                duration: t / 1000,
                times: [0, sFit.highlightMs / t, (sFit.highlightMs + sFit.windupMs) / t, sFit.contactMs / t, (sFit.contactMs + sFit.impactHoldMs) / t, 1],
                ease: ['easeOut', 'easeOut', 'easeIn', 'linear', 'easeOut'],
              };
              fxKey = `att${beatIdx}`;
              // IMPACT keyframe: fire the drain the instant the lunge's translate reaches (near) full
              // thrust extension — i.e. when the sprite arrives at the defender. Bound to the actual
              // tween via onUpdate, so slowing the replay keeps HP full until the sprite lands.
              const reachMag = Math.hypot(dx, dy);
              onFxUpdate = (latest) => {
                if (impactReached || reachMag <= 0) return;
                if (Math.hypot(latest.x ?? 0, latest.y ?? 0) >= reachMag * TIMING.strike.impactFraction) onImpact();
              };
            } else if (isTgt && strikeGeom && strikeGeom.defenderId === u.uid) {
              // DEFENDER — reacts ONLY: knocked away from the attacker on impact, then settles back to
              // its slot. It never travels toward the attacker and never lunges.
              const { kx, ky } = strikeGeom;
              const r = sFit.reactionMs || 1;
              fxAnimate = { x: [0, kx, 0], y: [0, ky, 0], scale: 1 };
              fxTransition = { duration: r / 1000, delay: sFit.contactMs / 1000, times: [0, sFit.knockbackMs / r, 1], ease: ['easeOut', 'easeInOut'] };
              fxKey = `tgt${beatIdx}`;
            } else if (struck) {
              // cleave splash / start-of-combat burst — a gentle shove AWAY from the attacker (same
              // direction as the defender), or a small settle dip if there's no initiator. Never a
              // lateral shake, so it never competes with the lunge for the eye.
              const r = sFit.reactionMs || 1;
              if (strikeGeom) {
                const { kx, ky } = strikeGeom;
                fxAnimate = { x: [0, kx * 0.5, 0], y: [0, ky * 0.5, 0], scale: 1 };
                fxTransition = { duration: r / 1000, delay: (sFit.contactMs + TIMING.cleaveStaggerMs) / 1000, times: [0, sFit.knockbackMs / r, 1], ease: ['easeOut', 'easeInOut'] };
              } else {
                fxAnimate = { y: [0, 4, 0], scale: 1 };
                fxTransition = { duration: r / 1000, delay: changeDelayMs / 1000, times: [0, sFit.knockbackMs / r, 1], ease: 'easeOut' };
              }
              fxKey = `hit${beatIdx}`;
            }
            const contactDelay = { animationDelay: `${sFit.contactMs + (splash ? TIMING.cleaveStaggerMs : 0)}ms` };
            // dying units carry their crumble timing (0-HP hold → crumble) inline so it fits the beat.
            const dieStyle = isDoom ? { animationDelay: `${dFit.zeroHoldMs}ms`, animationDuration: `${dFit.animMs}ms` } : undefined;

            return (
              <motion.div
                key={u.uid}
                layout
                data-uid={u.uid}
                className={slotCls}
                initial={{ scale: 0.7, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.4, opacity: 0 }}
                transition={{ duration: 0.26, ease: 'easeOut' }}
              >
                <motion.div className="fx" key={fxKey} animate={fxAnimate} transition={fxTransition} onUpdate={onFxUpdate}>
                  <Card model={toModel(u, dispHp)} className={unitCls} style={dieStyle} combat={cprops}>
                    {isTgt && <div className="target-reticle" key={`rt${beatIdx}`} />}
                    {struck && <span className="hitflash" key={`hf${beatIdx}`} style={{ ...contactDelay, animationDuration: `${sFit.flashMs}ms` }} />}
                    {shieldBroke && <span className="shieldflash" key={`sf${beatIdx}`} style={contactDelay} />}
                    {/* one consistent stack of floating text above the card — nothing overlaps */}
                    <div className="floatstack">
                      {dmg > 0 && (
                        <div className={'floaty dmg' + (splash ? ' splash' : '')} key={`df${beatIdx}`} style={{ ...contactDelay, animationDuration: `${sFit.floatMs}ms` }}>
                          -{dmg}
                        </div>
                      )}
                      {buff && (buff.da > 0 || buff.dh > 0) && (
                        <div className="floaty buff" key={`bf${beatIdx}`} style={{ animationDelay: `${changeDelayMs}ms` }}>
                          {buff.da > 0 && <span className="bf-atk">+{buff.da}</span>}
                          {buff.dh > 0 && <span className="bf-hp">+{buff.dh}</span>}
                        </div>
                      )}
                      {gain && (
                        <div className="floaty gain" key={`gf${beatIdx}`} style={{ animationDelay: `${changeDelayMs}ms` }}>
                          <span className="gn-ico">{KW_ICON[gain]}</span>+{KW_LABEL[gain]}
                        </div>
                      )}
                    </div>
                  </Card>
                </motion.div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}

function ResultBanner({ winner, mySide, damage }: { winner: 'a' | 'b' | 'tie'; mySide: 'a' | 'b'; damage: number }) {
  if (winner === 'tie') return <div className="result-banner tie"><span className="rb-word">Draw</span></div>;
  const iWon = winner === mySide;
  return (
    <div className={'result-banner ' + (iWon ? 'win' : 'loss')}>
      <span className="rb-word">{iWon ? 'Victory' : 'Defeat'}</span>
      <span className={'rb-dmg ' + (iWon ? 'foe' : 'you')}>{iWon ? `dealt ${damage}` : `took ${damage}`}</span>
    </div>
  );
}

function toModel(u: RUnit, hp: number = u.hp): CardModel {
  return { cardId: u.cardId, name: u.name, tribe: u.tribe, tier: u.tier, atk: u.atk, hp: Math.max(0, hp), keywords: u.keywords, golden: u.golden, isToken: u.isToken, text: u.text };
}

function beatIcon(kind: Beat['kind']): string {
  switch (kind) {
    case 'strike':
      return '⚔';
    case 'deaths':
      return '☠';
    case 'deathrattle':
      return '☠';
    case 'aftermath':
      return '✦';
    case 'startOfCombat':
      return '✧';
    case 'end':
      return '★';
    default:
      return '•';
  }
}
