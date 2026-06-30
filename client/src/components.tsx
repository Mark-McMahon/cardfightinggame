import type { Axis, Keyword, TribeId } from '@cardgame/shared';
import { KEYWORDS, TRIBES, UNIT_BY_ID, triples } from '@cardgame/shared';
import { KW_ICON, TRIBE_CREST } from './icons';
import { CARD_VIEWBOX, cardFace, portraitBg } from './cardArt';

export interface UnitView {
  uid?: string;
  cardId?: string;
  name: string;
  tribe: TribeId;
  tier: number;
  atk: number;
  hp: number;
  keywords: Keyword[];
  golden?: boolean;
  isToken?: boolean;
  /** Static axis tag(s). If omitted, resolved from the catalog via `cardId` (§16.6). */
  axis?: Axis[];
  /** Full ability text — surfaced via the hover tooltip (the card art is icon-only, §16.6). */
  text?: string;
}

/**
 * The card's *printed* stats — base catalog value, scaled by the golden multiplier (§12.4).
 * Buffs are written into the live instance's atk/hp (`UnitInstance`), so comparing the
 * displayed value against this base is how we tell "buffed above printed" from "printed"
 * (the fix for buffs silently overwriting the original stats). Null when the card is unknown
 * (e.g. a fallback combat summon) — callers then treat the stat as un-buffed.
 */
function resolveBaseStats(unit: UnitView): { atk: number; hp: number } | null {
  if (!unit.cardId) return null;
  const card = UNIT_BY_ID[unit.cardId];
  if (!card) return null;
  const mult = unit.golden ? triples.goldenStatMultiplier : 1;
  return { atk: card.atk * mult, hp: card.hp * mult };
}

export function UnitShape({
  unit,
  onClick,
  className = '',
  hpFraction,
  title,
  showTip = false,
}: {
  unit: UnitView;
  onClick?: () => void;
  className?: string;
  hpFraction?: number;
  title?: string;
  /** Render the rich hover tooltip with full card text (§16.6 — shop/board only). */
  showTip?: boolean;
}) {
  const tribe = TRIBES[unit.tribe];
  const base = resolveBaseStats(unit);
  // Ability text for the hover tooltip. Shop offers/units carry `text`; combat `UnitVM`s
  // don't, so fall back to the catalog via `cardId` — this is what lets the *same* tooltip
  // light up when a card is hovered during combat (§16.6), not just in the shop.
  const tipText = unit.text ?? (unit.cardId ? UNIT_BY_ID[unit.cardId]?.text : undefined);
  // Buffed = the live stat exceeds the printed base (golden-adjusted). Surfaced in green so
  // a buffed unit no longer reads as a vanilla printed stat (the reported bug).
  const atkBuffed = base !== null && unit.atk > base.atk;
  const hpBuffed = base !== null && unit.hp > base.hp;
  const tribeName = tribe?.name ?? unit.tribe;

  return (
    <div
      className={`unit ${unit.golden ? 'golden' : ''} ${unit.isToken ? 'token' : ''} ${onClick ? 'clickable' : ''} ${className}`}
      onClick={onClick}
      title={showTip ? undefined : (title ?? unit.name)}
    >
      {/* tribe-themed procedural portrait (§16.6 override — original geometry, see cardArt.ts).
          Tier badge + icon-only keyword chips overlay the art; the ability sentence in the hover
          spells each keyword out. */}
      <div className="portrait" style={{ background: portraitBg(unit.tribe) }}>
        <svg
          viewBox={CARD_VIEWBOX}
          preserveAspectRatio="xMidYMid meet"
          dangerouslySetInnerHTML={{ __html: cardFace(unit.cardId, unit.tribe) }}
        />
        <span className="tier" title={`Tier ${unit.tier}`}>
          T{unit.tier}
        </span>
        {unit.keywords.length > 0 && (
          <div className="kw">
            {unit.keywords.map((k) => (
              <span className="kwtag" key={k} title={KEYWORDS[k]?.name ?? k}>
                {KW_ICON[k]}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="nm">
        {unit.golden ? '★ ' : ''}
        {unit.name}
      </div>
      {hpFraction !== undefined && (
        <div className="hpbar">
          <div style={{ width: `${Math.max(0, Math.min(1, hpFraction)) * 100}%` }} />
        </div>
      )}
      <div className="stats">
        <span className={`atk ${atkBuffed ? 'buffed' : ''}`}>{unit.atk}</span>
        <span className={`hp ${hpBuffed ? 'buffed' : ''}`}>{unit.hp}</span>
      </div>

      {showTip && (
        <div className="card-tip" role="tooltip">
          <div className="tip-name">
            {unit.golden ? '★ ' : ''}
            {unit.name}
          </div>
          <div className="tip-sub">
            {TRIBE_CREST[unit.tribe] ?? ''} {tribeName} · T{unit.tier}
            {' · '}
            {base ? (
              <>
                <span className={atkBuffed ? 'buffed' : ''}>{unit.atk}</span>/
                <span className={hpBuffed ? 'buffed' : ''}>{unit.hp}</span>
                {(atkBuffed || hpBuffed) && (
                  <span className="tip-base"> (base {base.atk}/{base.hp})</span>
                )}
              </>
            ) : (
              `${unit.atk}/${unit.hp}`
            )}
          </div>
          {tipText && <div className="tip-text">{tipText}</div>}
        </div>
      )}
    </div>
  );
}
