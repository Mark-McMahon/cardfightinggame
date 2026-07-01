// Shared presentational components, built ON the carried-forward art (cardArt.ts / icons.ts) and
// the carried-forward class names (styles.css). No game logic — pure rendering of props.

import type { ReactNode, CSSProperties, DragEvent, MouseEvent } from 'react';
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

interface CardProps {
  model: CardModel;
  className?: string;
  style?: CSSProperties;
  title?: string;
  onClick?: (e: MouseEvent) => void;
  draggable?: boolean;
  onDragStart?: (e: DragEvent) => void;
  onDragEnd?: (e: DragEvent) => void;
  children?: ReactNode; // combat overlays (dmg floats, reticle, etc.) mount inside the .unit
}

/** The card token — procedural portrait + tier + keyword chips + Atk/HP + hover tooltip. */
export function Card({ model, className, style, title, onClick, draggable, onDragStart, onDragEnd, children }: CardProps): ReactNode {
  const { cardId, name, tribe, tier, atk, hp, keywords, golden, isToken, text } = model;
  const base = getCard(cardId);
  const mult = golden ? triples.goldenStatMultiplier : 1;
  const baseAtk = base ? base.atk * mult : atk;
  const baseHp = base ? base.hp * mult : hp;
  const atkBuffed = atk > baseAtk;
  const hpBuffed = hp > baseHp;
  const cls = ['unit', golden ? 'golden' : '', isToken ? 'token' : '', className ?? ''].filter(Boolean).join(' ');
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
      <div className="stats">
        <span className={'atk' + (atkBuffed ? ' buffed' : '')}>{atk}</span>
        <span className={'hp' + (hpBuffed ? ' buffed' : '')}>{hp}</span>
      </div>
      <div className="card-tip">
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
        {text && <div className="tip-text">{text}</div>}
      </div>
      {children}
    </div>
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

export function Standings({ pub, mySeat, opponentSeat }: { pub: PublicState; mySeat: number | null; opponentSeat: number | null }): ReactNode {
  const living = pub.players.filter((p) => p.alive).sort((a, b) => b.hp - a.hp || a.seat - b.seat);
  const dead = pub.players.filter((p) => !p.alive).sort((a, b) => a.placement - b.placement);
  const oppName = opponentSeat != null ? pub.players.find((p) => p.seat === opponentSeat)?.name : undefined;
  return (
    <div className="standings panel">
      <div className="side-head">
        <span className="side-round">Round {pub.round}</span>
        {pub.phase === 'shop' && <span className={'side-timer' + (pub.timer <= 10 ? ' low' : '')}>{pub.timer}s</span>}
      </div>
      {oppName && (
        <div className="side-vs">
          vs <strong>{oppName}</strong>
        </div>
      )}
      <div className="standings-title">Standings</div>
      {living.map((p, i) => (
        <SRow key={p.seat} p={p} label={i + 1} me={p.seat === mySeat} vs={p.seat === opponentSeat} dead={false} />
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
