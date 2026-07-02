// Shared presentational components, built ON the carried-forward art (cardArt.ts / icons.ts) and
// the carried-forward class names (styles.css). No game logic — pure rendering of props.

import { useEffect, useRef, useState } from 'react';
import type { ReactNode, CSSProperties, DragEvent, MouseEvent } from 'react';
import { animate } from 'framer-motion';
import type { TribeId, Keyword, ClientUnit, ShopOffer, PublicState, PublicPlayer } from '@cardgame/shared';
import { TRIBES, getCard, triples } from '@cardgame/shared';
import { CARD_VIEWBOX, cardFace, portraitBg } from './cardArt';
import { KW_ICON, KW_LABEL, TRIBE_CREST } from './icons';
import { useToasts } from './net/hooks';

// ── the normalized card shape every card view renders from ──────────────────────────
export interface CardModel {
  cardId: string;
  name: string;
  tribe: TribeId;
  tier: number;
  atk: number;
  hp: number;
  keywords: Keyword[];
  golden?: boolean;
  isToken?: boolean;
  text?: string;
}

export function unitToModel(u: ClientUnit): CardModel {
  return { cardId: u.cardId, name: u.name, tribe: u.tribe, tier: u.tier, atk: u.atk, hp: u.hp, keywords: u.keywords, golden: u.golden, isToken: u.isToken, text: u.text };
}

export function offerToModel(o: ShopOffer): CardModel {
  return { cardId: o.cardId, name: o.name, tribe: o.tribe, tier: o.tier, atk: o.atk, hp: o.hp, keywords: o.keywords, text: o.text };
}

/** Per-slot arc CSS vars: `--dist` (distance from row centre) lifts each token on the board's shallow
 * arc (spec §10). Presentation-only; single-sourced here so the shop board and the Results winning-board
 * bow identically. */
export function arcVars(i: number, n: number): CSSProperties {
  const center = (n - 1) / 2;
  return { ['--i' as string]: i, ['--dist' as string]: Math.abs(i - center) } as CSSProperties;
}

export function KeywordChip({ kw }: { kw: Keyword }): ReactNode {
  return (
    <span className="kwtag" title={KW_LABEL[kw]}>
      {KW_ICON[kw]}
    </span>
  );
}

export function TribeCrest({ tribe }: { tribe: TribeId }): ReactNode {
  return <span title={TRIBES[tribe]?.name ?? tribe}>{TRIBE_CREST[tribe]}</span>;
}

/** A labeled pill (coin / gem / generic). Class controls the styling from styles.css. */
export function StatBadge({ kind, icon, iconClass, children, title }: { kind: string; icon?: string; iconClass?: string; children: ReactNode; title?: string }): ReactNode {
  return (
    <span className={kind} title={title}>
      {icon != null && <span className={iconClass}>{icon}</span>}
      <span>{children}</span>
    </span>
  );
}

/**
 * A count that TWEENS to its target instead of snapping — the number visibly ticks (e.g. 5→6) so a
 * buff (or a hit) reads as a discrete, followable change. Presentation-only; the value it lands on is
 * always the authoritative prop. `delayMs` lets a strike defer its hp drain to the contact instant.
 */
function TickNum({ value, delayMs = 0, durationMs = 360 }: { value: number; delayMs?: number; durationMs?: number }): ReactNode {
  const [display, setDisplay] = useState(value);
  const prev = useRef(value);
  useEffect(() => {
    if (prev.current === value) return;
    const from = prev.current;
    prev.current = value;
    const controls = animate(from, value, {
      duration: durationMs / 1000,
      delay: delayMs / 1000,
      ease: 'easeOut',
      onUpdate: (v) => setDisplay(Math.round(v)),
    });
    return () => controls.stop();
  }, [value, delayMs, durationMs]);
  return <>{display}</>;
}

/** Combat-only card extras: a tweened health bar + ticking stat numbers, timed to the current beat. */
export interface CombatCardProps {
  hpMax: number;
  changeDelayMs: number; // when this beat's stat/hp change should visually begin
  hpDrainMs: number; // health-bar drain duration
  tickMs: number; // stat number tick duration
}

interface CardProps {
  model: CardModel;
  className?: string;
  style?: CSSProperties;
  title?: string;
  onClick?: (e: MouseEvent) => void;
  draggable?: boolean;
  onDragStart?: (e: DragEvent) => void;
  onDragEnd?: (e: DragEvent) => void;
  combat?: CombatCardProps; // when set, render the health bar + ticking stats
  children?: ReactNode; // combat overlays (dmg floats, reticle, etc.) mount inside the .unit
}

/** The card token — procedural portrait + tier + keyword chips + Atk/HP + hover tooltip. */
export function Card({ model, className, style, title, onClick, draggable, onDragStart, onDragEnd, combat, children }: CardProps): ReactNode {
  const { cardId, name, tribe, tier, atk, hp, keywords, golden, isToken, text } = model;
  const base = getCard(cardId);
  const mult = golden ? triples.goldenStatMultiplier : 1;
  const baseAtk = base ? base.atk * mult : atk;
  const baseHp = base ? base.hp * mult : hp;
  const atkBuffed = atk > baseAtk;
  const hpBuffed = hp > baseHp;
  const cls = ['unit', golden ? 'golden' : '', isToken ? 'token' : '', className ?? ''].filter(Boolean).join(' ');
  const hpFill = combat ? Math.max(0, Math.min(1, hp / Math.max(1, combat.hpMax))) : 0;
  return (
    <div className={cls} style={style} title={title} onClick={onClick} draggable={draggable} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="portrait" style={{ background: portraitBg(tribe) }}>
        <svg viewBox={CARD_VIEWBOX} preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" dangerouslySetInnerHTML={{ __html: cardFace(cardId, tribe) }} />
        <div className="tier">{tier}</div>
        {keywords.length > 0 && (
          <div className="kw">
            {keywords.map((k) => (
              <KeywordChip key={k} kw={k} />
            ))}
          </div>
        )}
      </div>
      <div className="nm">{name}</div>
      {combat && (
        <div className="hpbar" aria-hidden>
          <div style={{ width: `${hpFill * 100}%`, transition: `width ${combat.hpDrainMs}ms ease ${combat.changeDelayMs}ms` }} />
        </div>
      )}
      <div className="stats">
        <span className={'atk' + (atkBuffed ? ' buffed' : '')}>{combat ? <TickNum value={atk} delayMs={combat.changeDelayMs} durationMs={combat.tickMs} /> : atk}</span>
        <span className={'hp' + (hpBuffed ? ' buffed' : '')}>{combat ? <TickNum value={hp} delayMs={combat.changeDelayMs} durationMs={combat.tickMs} /> : hp}</span>
      </div>
      <div className="card-tip">
        <CardTipBody model={model} />
      </div>
      {children}
    </div>
  );
}

/**
 * The inner content of a card's inspect tooltip — name, tribe·tier, base-vs-buffed stats, keywords
 * named in full (granted-this-game keywords under a separate "Added this game" block), and ability
 * text (§10). Factored out of `Card` so the hover tooltip (desktop) and the touch inspect sheet
 * (`Shop.tsx`) render byte-identical content from a single source.
 */
export function CardTipBody({ model }: { model: CardModel }): ReactNode {
  const { cardId, name, tribe, tier, atk, hp, keywords, golden, text } = model;
  const base = getCard(cardId);
  const mult = golden ? triples.goldenStatMultiplier : 1;
  const baseAtk = base ? base.atk * mult : atk;
  const baseHp = base ? base.hp * mult : hp;
  const atkBuffed = atk > baseAtk;
  const hpBuffed = hp > baseHp;
  // Split keywords into innate (printed on the card) vs granted this game (via a battlecry/aura), so the
  // tip can name them in words and call the added ones out separately. No catalog entry (a token) ⇒
  // treat every keyword as innate rather than mislabel them all as "added".
  const baseKeywords = base?.keywords ?? keywords;
  const innateKeywords = keywords.filter((k) => baseKeywords.includes(k));
  const addedKeywords = keywords.filter((k) => !baseKeywords.includes(k));
  return (
    <>
      <div className="tip-name">{name}</div>
      <div className="tip-sub">
        {TRIBES[tribe]?.name ?? tribe} · Tier {tier} ·{' '}
        <span className={atkBuffed ? 'buffed' : ''}>{atk}</span>/<span className={hpBuffed ? 'buffed' : ''}>{hp}</span>
        {(atkBuffed || hpBuffed) && (
          <span className="tip-base">
            {' '}
            (base {baseAtk}/{baseHp})
          </span>
        )}
      </div>
      {innateKeywords.length > 0 && (
        <div className="tip-kw">
          {innateKeywords.map((k) => (
            <span key={k} className="tip-kwchip">
              {KW_ICON[k]} {KW_LABEL[k]}
            </span>
          ))}
        </div>
      )}
      {text && <div className="tip-text">{text}</div>}
      {addedKeywords.length > 0 && (
        <div className="tip-added">
          <span className="tip-added-hd">Added this game</span>
          {addedKeywords.map((k) => (
            <span key={k} className="tip-kwchip added">
              {KW_ICON[k]} {KW_LABEL[k]}
            </span>
          ))}
        </div>
      )}
    </>
  );
}

// ── standings sidebar (living ranked by HP; dead greyed at the bottom in finish order) ──────
function SRow({ p, label, me, vs, dead }: { p: PublicPlayer; label: ReactNode; me: boolean; vs: boolean; dead: boolean }): ReactNode {
  const cls = ['srow', me ? 'me' : '', vs ? 'vs' : '', dead ? 'dead' : ''].filter(Boolean).join(' ');
  return (
    <div className={cls}>
      <span className="srank">{label}</span>
      <span className="sname">
        {p.name}
        {p.isBot && ' ·bot'}
      </span>
      <span className="stier">T{p.tier}</span>
      <span className="shp">{p.hp}</span>
    </div>
  );
}

// Who `seat` is paired against this round, resolved from the public schema (pairings + players) — the
// SINGLE source for both the shop "vs" preview and the combat replay label (spec §10). `seat` is null
// for a ghost bye (nothing living to highlight), but `name` still carries the ghost's display name so
// the shop and the combat screen agree instead of one showing blank.
export interface OpponentInfo {
  seat: number | null; // living opponent's seat, or null for a ghost fight / bye (no living row to highlight)
  name: string;
  ghost: boolean; // fighting a dead player's frozen board
  bye: boolean; // no opponent at all this round (ghosts off / none yet) — no fight happens
}

export function resolveOpponent(pub: PublicState, mySeat: number | null): OpponentInfo | null {
  if (mySeat == null) return null;
  const nameOf = (seat: number) => pub.players.find((p) => p.seat === seat)?.name || 'Opponent';
  for (const pr of pub.pairings) {
    if (pr.aSeat === mySeat) {
      if (pr.bye) return { seat: null, name: 'Bye', ghost: false, bye: true };
      if (pr.ghost) return { seat: null, name: pr.ghostName || 'Ghost', ghost: true, bye: false };
      return { seat: pr.bSeat, name: nameOf(pr.bSeat), ghost: false, bye: false };
    }
    if (pr.bSeat === mySeat) return { seat: pr.aSeat, name: nameOf(pr.aSeat), ghost: false, bye: false };
  }
  return null;
}

// Which side of the combat log `seat` fought on, read from the SAME synced pairing as resolveOpponent
// (spec §10). `resolveCombatPhase` always resolves `aSeat`'s board as side 'a' and `bSeat`'s as side
// 'b' (and the live player is always side 'a' in a ghost fight), so this is the authoritative side —
// unlike inferring it from the viewer's board uids, which is empty (→ wrong side) for an empty or
// fully-wiped board. Returns null for a bye / no pairing (no fight to orient).
export function sideForSeat(pub: PublicState, mySeat: number | null): 'a' | 'b' | null {
  if (mySeat == null) return null;
  for (const pr of pub.pairings) {
    if (pr.bye) continue;
    if (pr.aSeat === mySeat) return 'a';
    if (pr.bSeat === mySeat) return 'b';
  }
  return null;
}

export function Standings({ pub, mySeat, opponent }: { pub: PublicState; mySeat: number | null; opponent: OpponentInfo | null }): ReactNode {
  const living = pub.players.filter((p) => p.alive).sort((a, b) => b.hp - a.hp || a.seat - b.seat);
  const dead = pub.players.filter((p) => !p.alive).sort((a, b) => a.placement - b.placement);
  return (
    <div className="standings panel">
      <div className="side-head">
        <span className="side-round">Round {pub.round}</span>
        {pub.phase === 'shop' && <span className={'side-timer' + (pub.timer <= 10 ? ' low' : '')}>{pub.timer}s</span>}
      </div>
      {opponent &&
        (opponent.bye ? (
          <div className="side-vs side-bye">Bye · no opponent</div>
        ) : (
          <div className="side-vs">
            vs <strong>{opponent.name}</strong>
            {opponent.ghost && <span className="vs-ghost"> · ghost</span>}
          </div>
        ))}
      <div className="standings-title">Standings</div>
      {living.map((p, i) => (
        <SRow key={p.seat} p={p} label={i + 1} me={p.seat === mySeat} vs={p.seat === opponent?.seat} dead={false} />
      ))}
      {dead.length > 0 && <div className="sdiv" />}
      {dead.map((p) => (
        <SRow key={p.seat} p={p} label={`#${p.placement}`} me={p.seat === mySeat} vs={false} dead />
      ))}
      <div className="side-foot">ROOM {pub.roomCode}</div>
    </div>
  );
}

/** Bottom-right transient toasts (triple / eliminated / combat result / errors). */
export function Toasts(): ReactNode {
  const toasts = useToasts();
  if (toasts.length === 0) return null;
  return (
    <div className="toast-wrap">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          {t.message}
        </div>
      ))}
    </div>
  );
}
