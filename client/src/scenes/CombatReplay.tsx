import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { clearCombat, type ClientCombat } from '../net/game';
import { UnitShape } from '../components';
import { KW_ICON, KW_LABEL } from '../icons';
import { buildSteps, consumesDeaths, type Step, type UnitVM } from './combatBeats';

// ─────────────────────────────────────────────────────────────────────────────
// Combat replay, re-architected for legibility (rework of design-spec §16.6). The
// causal beat segmentation lives in ./combatBeats (render-free + unit-tested); this
// file animates the Steps it produces:
//   1. WHO hits WHOM   — attacker lunges, an SVG tracer flies to the defender, the
//                        defender wears a reticle, and every other unit dims.
//   2. WHAT got buffed — the changed stat pops, a +atk/+hp chip anchors on the unit and
//      and BY WHAT        holds for the beat, and a link is drawn back to the live source.
//   3. PACING          — each beat's dwell scales with `weight`; manual step/scrub +
//                        speed toggle for working through a confusing fight.
//   4. CAUSALITY       — strike, the deaths it caused, and the triggered buffs are
//                        separate ordered beats, so a swing reads as a chain.
// (No perm/temp split: combat buffs never persist past the fight, so within a combat a
//  "permanent" and a "temporary" buff are identical — there is nothing to distinguish.)
// ─────────────────────────────────────────────────────────────────────────────

// Beat→ms. `weight` already encodes impact; clamp so trivial beats stay snappy and big
// swings hold long enough to register.
const BEAT_BASE_MS = 720;
const BEAT_MIN_MS = 360;
const BEAT_MAX_MS = 2400;
const LUNGE_S = 0.46;
const IMPACT_S = 0.2;

interface Link {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  kind: 'attack' | 'buff' | 'gain';
}

export function CombatReplay({ combat }: { combat: ClientCombat }) {
  const viewer = combat.side;
  const steps = useMemo(() => buildSteps(combat.events, viewer), [combat.events, viewer]);

  const [si, setSi] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);

  useEffect(() => {
    setSi(0);
    setPlaying(true);
  }, [combat]);

  const last = steps.length - 1;
  const done = si >= last;
  const step =
    steps[si] ??
    steps[last] ??
    ({ kind: 'end', a: [], b: [], damages: [], buffs: [], gains: [], summonedIds: [], shieldBreaks: [], poisoned: [], focus: null, breakpoint: false, deathsA: 0, deathsB: 0, weight: 1, result: null } as Step);

  // Auto-advance, paced by the *current* beat's impact weight.
  useEffect(() => {
    if (!playing || done) return;
    const dur = Math.min(BEAT_MAX_MS, Math.max(BEAT_MIN_MS, BEAT_BASE_MS * step.weight)) / speed;
    const id = setTimeout(() => setSi((s) => Math.min(s + 1, last)), dur);
    return () => clearTimeout(id);
  }, [si, playing, done, last, speed, step.weight]);

  const topSide: 'a' | 'b' = viewer === 'a' ? 'b' : 'a';
  const botSide: 'a' | 'b' = viewer;

  const ownsDeathConsumer = useMemo(
    () => (steps[0]?.[viewer] ?? []).some((u) => consumesDeaths(u.cardId)),
    [steps, viewer],
  );

  // ── measure attacker↔defender / source→target geometry for the SVG link overlay ──
  const fieldRef = useRef<HTMLDivElement | null>(null);
  const slotRefs = useRef<Map<string, HTMLElement>>(new Map());
  const [links, setLinks] = useState<Link[]>([]);
  const [resizeTick, setResizeTick] = useState(0);

  useLayoutEffect(() => {
    const measure = (): void => {
      const cont = fieldRef.current;
      if (!cont) return;
      const cr = cont.getBoundingClientRect();
      const center = (uid: string): { x: number; y: number } | null => {
        const el = slotRefs.current.get(uid);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2 - cr.left, y: r.top + r.height / 2 - cr.top };
      };
      const ls: Link[] = [];
      if (step.kind === 'strike' && step.attack) {
        const s = center(step.attack.attackerId);
        const t = center(step.attack.defenderId);
        if (s && t) ls.push({ x1: s.x, y1: s.y, x2: t.x, y2: t.y, kind: 'attack' });
      } else if (step.kind === 'buff') {
        for (const bf of step.buffs) {
          if (!bf.sourceId || bf.sourceId === bf.targetId) continue;
          const s = center(bf.sourceId);
          const t = center(bf.targetId);
          if (s && t) ls.push({ x1: s.x, y1: s.y, x2: t.x, y2: t.y, kind: 'buff' });
        }
      } else if (step.kind === 'gain') {
        for (const g of step.gains) {
          if (!g.sourceId || g.sourceId === g.targetId) continue;
          const s = center(g.sourceId);
          const t = center(g.targetId);
          if (s && t) ls.push({ x1: s.x, y1: s.y, x2: t.x, y2: t.y, kind: 'gain' });
        }
      }
      setLinks(ls);
    };
    measure();
    const raf = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(raf);
  }, [si, resizeTick, step]);

  useEffect(() => {
    const onResize = (): void => setResizeTick((t) => t + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const linkColor = (k: Link['kind']): string =>
    k === 'attack' ? '#ff5a52' : k === 'gain' ? '#7ee08a' : '#6ab0ff'; // buff → blue

  const renderLine = (units: UnitVM[], position: 'top' | 'bottom', label: string, mine: boolean) => {
    const lungeY = position === 'top' ? 46 : -46;
    const antic = position === 'top' ? -8 : 8;
    const tilt = position === 'top' ? 26 : -26;
    const impact = IMPACT_S / speed;
    return (
      <div className="bl-side">
        <div className={`bl-label ${mine ? 'win' : 'dim'}`}>{label}</div>
        <div className="bl-line">
          <AnimatePresence mode="popLayout" initial={false}>
            {units.map((u) => {
              const isAttacker = step.attack?.attackerId === u.uid;
              const isDefender = step.attack?.defenderId === u.uid;
              const myDmg = step.damages.filter((d) => d.targetId === u.uid);
              const isHit = myDmg.length > 0;
              const shieldBroke = step.shieldBreaks.includes(u.uid);
              const buff = step.buffs.find((bf) => bf.targetId === u.uid);
              const gain = step.gains.find((g) => g.targetId === u.uid);
              const isSource =
                (step.kind === 'buff' && step.buffs.some((bf) => bf.sourceId === u.uid && bf.targetId !== u.uid)) ||
                (step.kind === 'gain' && step.gains.some((g) => g.sourceId === u.uid && g.targetId !== u.uid));
              const isSummoned = step.summonedIds.includes(u.uid);
              const doomed = step.poisoned.includes(u.uid);
              const dim = step.focus !== null && !step.focus.includes(u.uid);

              const cls = [
                isAttacker ? 'is-attacker' : '',
                isDefender ? 'is-target' : '',
                isSource ? 'is-source' : '',
                dim ? 'is-dim' : '',
                buff ? 'bufftgt' : '',
                buff && buff.dAtk !== 0 ? 'pop-atk' : '',
                buff && buff.dHp !== 0 ? 'pop-hp' : '',
                gain ? 'gaintgt' : '',
                doomed ? 'doomed' : '',
              ]
                .filter(Boolean)
                .join(' ');

              const role = isAttacker ? `lunge-${si}` : isHit ? `hit-${si}` : isSummoned ? `summon-${si}` : 'idle';

              return (
                <motion.div
                  key={u.uid}
                  layout
                  className="bl-slot"
                  ref={(el) => {
                    if (el) slotRefs.current.set(u.uid, el);
                    else slotRefs.current.delete(u.uid);
                  }}
                  initial={{ opacity: 0, scale: 0.65, x: 18, y: position === 'top' ? -14 : 14 }}
                  animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
                  exit={{
                    opacity: 0,
                    scale: 0.25,
                    rotate: tilt,
                    y: 26,
                    filter: 'blur(4px)',
                    transition: { duration: 0.34 / speed, ease: 'easeIn' },
                  }}
                  transition={{ duration: 0.34 / speed, ease: 'easeOut' }}
                >
                  <motion.div
                    key={`${u.uid}:${role}`}
                    animate={
                      isAttacker
                        ? { y: [0, antic, lungeY, lungeY * 0.4, 0], scale: [1, 1, 1.08, 1.02, 1] }
                        : isHit || isDefender
                          ? { x: [0, -1, -6, 6, -3, 0] }
                          : {}
                    }
                    transition={
                      isAttacker
                        ? { duration: LUNGE_S / speed, ease: 'easeOut', times: [0, 0.18, 0.42, 0.6, 1] }
                        : { duration: 0.42 / speed, ease: 'easeOut', delay: impact }
                    }
                  >
                    {isDefender && <div className="target-reticle" />}
                    <UnitShape unit={u} hpFraction={u.hp / Math.max(1, u.maxHp)} className={cls} showTip />
                  </motion.div>

                  {isHit && (
                    <motion.div
                      key={`hf-${si}`}
                      className="hitflash"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: [0, 0.5, 0] }}
                      transition={{ duration: 0.34 / speed, delay: impact, times: [0, 0.25, 1] }}
                    />
                  )}
                  {shieldBroke && (
                    <motion.div
                      key={`sf-${si}`}
                      className="shieldflash"
                      initial={{ opacity: 0, scale: 0.6 }}
                      animate={{ opacity: [0, 0.95, 0], scale: [0.6, 1.15, 1.5] }}
                      transition={{ duration: 0.5 / speed, delay: impact, times: [0, 0.25, 1] }}
                    />
                  )}
                  {myDmg.map((d, i) => (
                    <motion.div
                      key={`df-${si}-${i}`}
                      className="dmgfloat"
                      initial={{ opacity: 0, y: -4, scale: 0.6 }}
                      animate={{ opacity: [0, 1, 1, 0], y: [-4, -14, -28, -42], scale: [0.6, 1.15, 1, 1] }}
                      transition={{ duration: 0.66 / speed, delay: impact, times: [0, 0.18, 0.5, 1] }}
                    >
                      -{d.amount}
                    </motion.div>
                  ))}
                  {buff && (
                    // Anchored chip: pops in and HOLDS (no self-fade, no fly-away). Its lifetime is
                    // gated by `buff` + keyed by `si`, so it lives exactly as long as the beat —
                    // reading-time == beat-dwell, no magic timer fighting the beat clock.
                    <motion.div
                      key={`buff-${si}`}
                      className="bufffloat"
                      initial={{ opacity: 0, y: 8, scale: 0.7 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ duration: 0.3 / speed, ease: 'easeOut' }}
                    >
                      {buff.dAtk !== 0 && <span className="bf-atk">{buff.dAtk > 0 ? '+' : ''}{buff.dAtk}⚔</span>}
                      {buff.dHp !== 0 && <span className="bf-hp">{buff.dHp > 0 ? '+' : ''}{buff.dHp}❤</span>}
                    </motion.div>
                  )}
                  {gain && (
                    // Same anchor-and-hold as the buff chip: pop in, then HOLD to beat-end (no
                    // fly-away), so the gained keyword reads for the full beat instead of racing
                    // its own fade clock.
                    <motion.div
                      key={`gain-${si}`}
                      className="gainfloat"
                      title={`Gained ${KW_LABEL[gain.keyword]}`}
                      initial={{ opacity: 0, y: 8, scale: 0.6 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ duration: 0.3 / speed, ease: 'easeOut' }}
                    >
                      <span className="gn-ico">{KW_ICON[gain.keyword]}</span>
                      <span className="gn-label">+{KW_LABEL[gain.keyword]}</span>
                    </motion.div>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
          {units.length === 0 && <span className="dim bl-empty">— wiped —</span>}
        </div>
      </div>
    );
  };

  const friendlyDeaths = viewer === 'a' ? step.deathsA : step.deathsB;

  return (
    <div className="overlay">
      <div className="combat-head">
        <h2>Combat</h2>
        {ownsDeathConsumer && (
          <span className={`ctx-counter ${step.breakpoint ? 'fired' : ''}`} title="Friendly deaths this combat">
            💀{' '}
            <motion.span
              key={friendlyDeaths}
              className="ctx-num"
              initial={{ scale: 1.7, color: '#ff6b6b' }}
              animate={{ scale: 1, color: '#efe6d6' }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
            >
              {friendlyDeaths}
            </motion.span>
          </span>
        )}
        <div className="spacer" />
        <span className="dim">
          beat {Math.min(si + 1, steps.length)}/{steps.length}
        </span>
      </div>

      <div className="battlefield" ref={fieldRef}>
        {renderLine(topSide === 'a' ? step.a : step.b, 'top', combat.opponentName, false)}
        <div className="bl-divider">
          <span className="vs-badge">VS</span>
        </div>
        {renderLine(botSide === 'a' ? step.a : step.b, 'bottom', 'You', true)}

        <svg className="link-overlay" aria-hidden>
          {links.map((l, i) => (
            <g key={`${si}-${i}`}>
              <motion.line
                x1={l.x1}
                y1={l.y1}
                x2={l.x2}
                y2={l.y2}
                stroke={linkColor(l.kind)}
                strokeWidth={l.kind === 'attack' ? 3 : 2.5}
                strokeLinecap="round"
                strokeDasharray={l.kind === 'attack' ? '2 8' : undefined}
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: l.kind === 'attack' ? [0, 0.9, 0.5] : [0, 0.85, 0.6] }}
                transition={{ duration: 0.4 / speed }}
              />
              {l.kind === 'attack' && (
                <motion.circle
                  r={5}
                  fill="#fff"
                  initial={{ cx: l.x1, cy: l.y1, opacity: 0 }}
                  animate={{ cx: [l.x1, l.x2], cy: [l.y1, l.y2], opacity: [0.2, 1, 0] }}
                  transition={{ duration: 0.42 / speed, ease: 'easeIn' }}
                />
              )}
            </g>
          ))}
        </svg>
      </div>

      {step.caption && (
        <motion.div
          key={`cap-${si}`}
          className={`beat-caption ${step.breakpoint ? 'breakpoint' : ''}`}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
        >
          {step.breakpoint && <span className="cap-spark">⚡</span>}
          {step.caption}
        </motion.div>
      )}

      {done && step.result && (
        <motion.div
          className={`result-banner ${step.result === 'VICTORY' ? 'win' : step.result === 'DEFEAT' ? 'loss' : 'tie'}`}
          initial={{ opacity: 0, scale: 0.6, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 17 }}
        >
          {step.result}
        </motion.div>
      )}

      <div className="row combat-controls">
        <button onClick={() => setSi((s) => Math.max(0, s - 1))} disabled={si === 0} title="previous beat">
          ◀ Step
        </button>
        <button onClick={() => setPlaying((p) => !p)} disabled={done} title="play / pause">
          {playing ? '⏸ Pause' : '▶ Play'}
        </button>
        <button onClick={() => setSi((s) => Math.min(last, s + 1))} disabled={done} title="next beat">
          Step ▶
        </button>
        <button onClick={() => setSpeed((s) => (s === 0.5 ? 1 : s === 1 ? 2 : 0.5))} title="playback speed">
          {speed}× speed
        </button>
        <input
          className="scrub"
          type="range"
          min={0}
          max={last}
          value={si}
          onChange={(ev) => {
            setPlaying(false);
            setSi(Number(ev.target.value));
          }}
          title="scrub beats"
        />
        {!done && (
          <button
            onClick={() => {
              setPlaying(false);
              setSi(last);
            }}
          >
            Skip ▶▶
          </button>
        )}
        <div className="spacer" />
        <button className="primary" onClick={() => clearCombat()}>
          Continue
        </button>
      </div>
    </div>
  );
}
