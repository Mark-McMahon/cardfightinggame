// CombatReplay — replays the server's authoritative combatLog (CombatEvent[]) as causal beats
// (combatBeats.ts) with Framer Motion. It computes NOTHING about the fight (combat already happened
// server-side); it only re-derives board state at each beat by folding the event stream, and layers
// the §10 legibility wins on top:
//   1. who hits whom — the attacker lunges, a tracer flies to the exact defender, others dim
//   2. what got buffed by what — the changed stat pops, a chip floats, a link is drawn to stats.sourceId
//   3. pacing by impact — each beat's dwell = base × beat.weight (trivial strikes batch; buffs/deaths hold)
//   4. causality — strike / deaths-it-caused / buffs-those-deaths-triggered are separate captioned beats
//   5. (reserved) a perm/temp cue — combat buffs currently all read as this-combat (§7.6 writeback gap)
// Plus the contextual deaths counter (decision #27): shown only when you own a deaths-consuming card.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import type { CombatEvent, Keyword, TribeId } from '@cardgame/shared';
import { getCard, breakpoints } from '@cardgame/shared';
import { Card, type CardModel } from '../components';
import { KW_ICON, KW_LABEL } from '../icons';
import { beats, type Beat } from './combatBeats';

const BASE_STEP_MS = 620;
const DEATHS_CONSUMERS = new Set(breakpoints.list.filter((b) => b.counter === 'deaths' || b.counter === 'revenantDeaths').map((b) => b.card));
const deathsThresholdFor = (cardIds: string[]): number | null => {
  const t = breakpoints.list.filter((b) => DEATHS_CONSUMERS.has(b.card) && cardIds.includes(b.card)).map((b) => b.threshold);
  return t.length ? Math.min(...t) : null;
};

interface RUnit extends CardModel {
  uid: string;
  dead: boolean;
}

function unitFromSnap(u: { uid: string; cardId: string; name: string; tribe: TribeId; tier: number; atk: number; hp: number; keywords: Keyword[]; golden: boolean }): RUnit {
  const card = getCard(u.cardId);
  return { ...u, isToken: card?.isToken ?? false, text: card?.text, dead: false };
}

function resolveSummonCardId(ownerCardId: string): string | undefined {
  const card = getCard(ownerCardId);
  if (card) for (const eff of card.effects) for (const act of eff.actions) if (act.type === 'summon' && act.summonUnitId) return act.summonUnitId;
  return breakpoints.list.find((b) => b.card === ownerCardId && b.summonUnitId)?.summonUnitId;
}

function summonUnit(uid: string, ownerTribe: TribeId, ownerCardId: string): RUnit {
  const cardId = resolveSummonCardId(ownerCardId);
  const card = cardId ? getCard(cardId) : undefined;
  return {
    uid,
    cardId: cardId ?? '',
    name: card?.name ?? 'Summon',
    tribe: card?.tribe ?? ownerTribe,
    tier: card?.tier ?? 1,
    atk: card?.atk ?? 1,
    hp: card?.hp ?? 1,
    keywords: card?.keywords ?? [],
    golden: false,
    isToken: card?.isToken ?? true,
    dead: false,
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
  kind: 'hit' | 'buff';
}

export function CombatReplay({ log, myBoard }: { log: CombatEvent[]; myBoard: { uid: string; cardId: string }[] }) {
  const bs = useMemo(() => beats(log), [log]);
  const myUids = useMemo(() => new Set(myBoard.map((u) => u.uid)), [myBoard]);
  const myCardIds = useMemo(() => myBoard.map((u) => u.cardId), [myBoard]);
  const mySide = useMemo(() => mySideOf(log, myUids), [log, myUids]);

  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);

  // reset to the top whenever a fresh combat arrives
  useEffect(() => {
    setIdx(0);
    setPlaying(true);
  }, [log]);

  // auto-advance, dwelling per beat weight (win #3)
  useEffect(() => {
    if (!playing || idx >= bs.length - 1) return;
    const w = bs[idx]?.weight ?? 1;
    const h = setTimeout(() => setIdx((i) => Math.min(i + 1, bs.length - 1)), (BASE_STEP_MS * w) / speed);
    return () => clearTimeout(h);
  }, [playing, idx, bs, speed]);

  const eventsUpto = useMemo(() => bs.slice(0, idx + 1).flatMap((b) => b.events), [bs, idx]);
  const eventsPrev = useMemo(() => bs.slice(0, idx).flatMap((b) => b.events), [bs, idx]);
  const cur = useMemo(() => computeBoards(eventsUpto), [eventsUpto]);
  const prev = useMemo(() => computeBoards(eventsPrev), [eventsPrev]);
  const beat: Beat | undefined = bs[idx];

  // per-beat focus (highlights / floats / deltas)
  const focus = useMemo(() => computeFocus(beat, cur, prev), [beat, cur, prev]);

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

  // link tracer geometry (wins #1 + #2) — measured after each beat renders
  const fieldRef = useRef<HTMLDivElement>(null);
  const slotEls = useRef<Map<string, HTMLDivElement>>(new Map());
  const [links, setLinks] = useState<Link[]>([]);
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) {
      setLinks([]);
      return;
    }
    const fr = field.getBoundingClientRect();
    const center = (uid: string): { x: number; y: number } | null => {
      const el = slotEls.current.get(uid);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left - fr.left + r.width / 2, y: r.top - fr.top + r.height / 2 };
    };
    const next: Link[] = [];
    if (beat?.attackerId && beat?.defenderId) {
      const s = center(beat.attackerId);
      const t = center(beat.defenderId);
      if (s && t) next.push({ x1: s.x, y1: s.y, x2: t.x, y2: t.y, kind: 'hit' });
    }
    for (const [tgt, src] of focus.buffLinks) {
      const s = center(src);
      const t = center(tgt);
      if (s && t) next.push({ x1: s.x, y1: s.y, x2: t.x, y2: t.y, kind: 'buff' });
    }
    setLinks(next);
  }, [idx, beat, focus, cur]);

  const setSlotRef = (uid: string) => (el: HTMLDivElement | null) => {
    if (el) slotEls.current.set(uid, el);
    else slotEls.current.delete(uid);
  };

  const end = log.find((e) => e.t === 'combatEnd');
  const atEnd = idx >= bs.length - 1;

  const topSide = mySide === 'a' ? 'b' : 'a';
  const bottomSide = mySide;

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

      <div className="battlefield" ref={fieldRef}>
        <svg className="link-overlay">
          {links.map((l, i) => (
            <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={l.kind === 'hit' ? '#ff5a52' : '#6ab0ff'} strokeWidth={l.kind === 'hit' ? 3 : 2} strokeDasharray={l.kind === 'buff' ? '5 4' : undefined} opacity={0.85} />
          ))}
        </svg>

        <BattleLine label={topSide === mySide ? 'You' : 'Opponent'} units={cur[topSide]} focus={focus} setSlotRef={setSlotRef} otherCenterY={1} />
        <div className="bl-divider">
          <span className="vs-badge">VS</span>
        </div>
        <BattleLine label={bottomSide === mySide ? 'You' : 'Opponent'} units={cur[bottomSide]} focus={focus} setSlotRef={setSlotRef} otherCenterY={-1} />
      </div>

      <div className={'beat-caption' + (deathsFired && beat?.kind === 'aftermath' ? ' breakpoint' : '')}>
        <span className="cap-spark">{beat ? beatIcon(beat.kind) : ''}</span>
        {beat?.caption ?? ''}
      </div>

      {atEnd && end && end.t === 'combatEnd' && <ResultBanner winner={end.winner} mySide={mySide} damage={end.damageToLoser} />}

      <div className="combat-controls panel">
        <div className="row">
          <button onClick={() => setIdx((i) => Math.max(0, i - 1))}>◀</button>
          <button className="primary" onClick={() => setPlaying((p) => !p)}>
            {playing ? 'Pause' : 'Play'}
          </button>
          <button onClick={() => setIdx((i) => Math.min(bs.length - 1, i + 1))}>▶</button>
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
          <button onClick={() => { setPlaying(false); setIdx(bs.length - 1); }}>Skip ▶▶</button>
        </div>
      </div>
    </div>
  );
}

interface Focus {
  active: boolean;
  attackerId?: string;
  defenderId?: string;
  sources: Set<string>;
  buffs: Map<string, { da: number; dh: number }>;
  gains: Map<string, Keyword>;
  doomed: Set<string>;
  dmg: Map<string, number>;
  buffLinks: Array<[string, string]>; // [target, source]
}

function computeFocus(beat: Beat | undefined, cur: { a: RUnit[]; b: RUnit[] }, prev: { a: RUnit[]; b: RUnit[] }): Focus {
  const f: Focus = { active: false, sources: new Set(), buffs: new Map(), gains: new Map(), doomed: new Set(), dmg: new Map(), buffLinks: [] };
  if (!beat) return f;
  const findPrev = (uid: string) => prev.a.find((u) => u.uid === uid) ?? prev.b.find((u) => u.uid === uid);

  if (beat.kind === 'strike') {
    f.active = true;
    f.attackerId = beat.attackerId;
    f.defenderId = beat.defenderId;
    for (const e of beat.events) if (e.t === 'damage' && e.amount > 0) f.dmg.set(e.targetId, (f.dmg.get(e.targetId) ?? 0) + e.amount);
  } else if (beat.kind === 'aftermath' || beat.kind === 'startOfCombat') {
    f.active = true;
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
      } else if (e.t === 'keyword') {
        f.gains.set(e.unitId, e.keyword);
        if (e.sourceId) {
          f.sources.add(e.sourceId);
          if (e.sourceId !== e.unitId) f.buffLinks.push([e.unitId, e.sourceId]);
        }
      } else if (e.t === 'summon') {
        f.sources.add(e.ownerId);
      }
    }
  } else if (beat.kind === 'deaths') {
    f.active = true;
    (beat.deaths ?? []).forEach((uid) => f.doomed.add(uid));
  }
  return f;
}

function BattleLine({ label, units, focus, setSlotRef, otherCenterY }: { label: string; units: RUnit[]; focus: Focus; setSlotRef: (uid: string) => (el: HTMLDivElement | null) => void; otherCenterY: number }) {
  return (
    <div className="bl-side">
      <div className="bl-label">{label}</div>
      <div className="bl-line">
        {units.length === 0 && <span className="bl-empty dim">— wiped —</span>}
        {units.map((u) => {
          const isAtt = u.uid === focus.attackerId;
          const isTgt = u.uid === focus.defenderId;
          const isSrc = focus.sources.has(u.uid);
          const buff = focus.buffs.get(u.uid);
          const gain = focus.gains.get(u.uid);
          const isDoom = focus.doomed.has(u.uid);
          const dmg = focus.dmg.get(u.uid) ?? 0;
          const dim = focus.active && !isAtt && !isTgt && !isSrc && !buff && !gain && !isDoom;
          const slotCls = ['bl-slot', isAtt ? 'is-attacker' : '', isTgt ? 'is-target' : '', isSrc ? 'is-source' : '', dim ? 'is-dim' : ''].filter(Boolean).join(' ');
          const unitCls = [u.dead ? 'dead' : '', buff ? 'bufftgt' : '', buff && buff.da > 0 ? 'pop-atk' : '', buff && buff.dh > 0 ? 'pop-hp' : '', gain ? 'gaintgt' : '', isDoom ? 'doomed' : ''].filter(Boolean).join(' ');
          const lunge = isAtt ? { y: otherCenterY * 14 } : { y: 0 };
          return (
            <div key={u.uid} className={slotCls} ref={setSlotRef(u.uid)}>
              <motion.div animate={lunge} transition={{ type: 'spring', stiffness: 500, damping: 20 }}>
                <Card model={toModel(u)} className={unitCls}>
                  {isTgt && <div className="target-reticle" />}
                  {dmg > 0 && <div className="dmgfloat">-{dmg}</div>}
                  {buff && (buff.da > 0 || buff.dh > 0) && (
                    <div className="bufffloat">
                      {buff.da > 0 && <span className="bf-atk">+{buff.da}</span>}
                      {buff.dh > 0 && <span className="bf-hp">+{buff.dh}</span>}
                    </div>
                  )}
                  {gain && (
                    <div className="gainfloat">
                      <span className="gn-ico">{KW_ICON[gain]}</span>+{KW_LABEL[gain]}
                    </div>
                  )}
                </Card>
              </motion.div>
            </div>
          );
        })}
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

function toModel(u: RUnit): CardModel {
  return { cardId: u.cardId, name: u.name, tribe: u.tribe, tier: u.tier, atk: u.atk, hp: u.hp, keywords: u.keywords, golden: u.golden, isToken: u.isToken, text: u.text };
}

function beatIcon(kind: Beat['kind']): string {
  switch (kind) {
    case 'strike':
      return '⚔';
    case 'deaths':
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
