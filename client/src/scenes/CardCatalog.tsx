// CardCatalog — a browsable, friend-facing reference of the ENTIRE card pool, reached via the URL
// hash #cards (see main.tsx). Purely a read-only view of the shared catalog: it imports the same
// `UNITS`/`PURCHASABLE_UNITS` the engine plays from and renders them with the same <Card> token used
// in the shop, so it can never drift out of date — when content/tuning changes, this page reflects it
// automatically (no separate list to maintain). No server connection is needed to view it.

import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { UNITS, PURCHASABLE_UNITS, TRIBES, SLICE_TRIBES, KEYWORDS } from '@cardgame/shared';
import type { UnitCard, TribeId, Keyword } from '@cardgame/shared';
import { Card } from '../components';
import type { CardModel } from '../components';
import { KW_ICON, KW_LABEL } from '../icons';

// Catalog cards are always at base stats (no live buffs), so the <Card> buff-highlight is inert here.
function toModel(u: UnitCard): CardModel {
  return { cardId: u.id, name: u.name, tribe: u.tribe, tier: u.tier, atk: u.atk, hp: u.hp, keywords: u.keywords, isToken: u.isToken, text: u.text };
}

type TribeFilter = TribeId | 'all';
type TierFilter = number | 'all';
type KwFilter = Keyword | 'all';

const TIERS = [1, 2, 3, 4, 5, 6];
const KEYWORD_LIST = Object.keys(KEYWORDS) as Keyword[];

export function CardCatalog(): ReactNode {
  const [q, setQ] = useState('');
  const [tribe, setTribe] = useState<TribeFilter>('all');
  const [tier, setTier] = useState<TierFilter>('all');
  const [kw, setKw] = useState<KwFilter>('all');
  const [showTokens, setShowTokens] = useState(false);

  const source = showTokens ? UNITS : PURCHASABLE_UNITS;
  const needle = q.trim().toLowerCase();

  const groups = useMemo(() => {
    const match = (u: UnitCard): boolean => {
      if (tier !== 'all' && u.tier !== tier) return false;
      if (kw !== 'all' && !u.keywords.includes(kw)) return false;
      if (needle) {
        const hay = (u.name + ' ' + (u.text ?? '')).toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    };
    return SLICE_TRIBES.map((t) => ({
      tribe: t,
      cards: source
        .filter((u) => u.tribe === t && (tribe === 'all' || tribe === t) && match(u))
        .sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name)),
    })).filter((g) => g.cards.length > 0);
  }, [source, tribe, tier, kw, needle]);

  const shown = groups.reduce((n, g) => n + g.cards.length, 0);

  const clear = (): void => {
    setQ('');
    setTribe('all');
    setTier('all');
    setKw('all');
  };

  return (
    <div className="catalog">
      <div className="catalog-top">
        <div>
          <div className="title">Card Catalog</div>
          <div className="catalog-sub">
            Every card in the game, generated live from the current build — always up to date.
          </div>
        </div>
        {/* href="#" clears the hash → main.tsx re-renders the game app (no reload). */}
        <a className="catalog-back" href="#">
          ← Back to game
        </a>
      </div>

      <div className="catalog-controls panel">
        <div className="catalog-filters">
          <span className="flabel">Tribe</span>
          <button className={tribe === 'all' ? 'primary' : ''} onClick={() => setTribe('all')}>
            All
          </button>
          {SLICE_TRIBES.map((t) => (
            <button key={t} className={tribe === t ? 'primary' : ''} onClick={() => setTribe(t)}>
              <span className="tribe-dot" style={{ background: TRIBES[t].colorHex }} />
              {TRIBES[t].name}
            </button>
          ))}
        </div>

        <div className="catalog-filters">
          <span className="flabel">Tier</span>
          <button className={tier === 'all' ? 'primary' : ''} onClick={() => setTier('all')}>
            All
          </button>
          {TIERS.map((t) => (
            <button key={t} className={tier === t ? 'primary' : ''} onClick={() => setTier(t)}>
              {t}
            </button>
          ))}
        </div>

        <div className="catalog-filters">
          <span className="flabel">Keyword</span>
          <button className={kw === 'all' ? 'primary' : ''} onClick={() => setKw('all')}>
            Any
          </button>
          {KEYWORD_LIST.map((k) => (
            <button key={k} className={kw === k ? 'primary' : ''} onClick={() => setKw(k)} title={KEYWORDS[k].rulesText}>
              {KW_ICON[k]} {KW_LABEL[k]}
            </button>
          ))}
        </div>

        <div className="catalog-filters">
          <input
            className="catalog-search"
            placeholder="Search name or text…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <label className="catalog-toggle">
            <input type="checkbox" checked={showTokens} onChange={(e) => setShowTokens(e.target.checked)} />
            Show tokens
          </label>
          <button onClick={clear}>Clear</button>
          <span className="spacer" />
          <span className="catalog-count">
            {shown} card{shown === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      <div className="panel kw-legend">
        {KEYWORD_LIST.map((k) => (
          <span key={k} className="kwl">
            <span className="kwl-ico">{KW_ICON[k]}</span>
            <span className="kwl-name">{KEYWORDS[k].name}</span>
            <span className="kwl-rule">— {KEYWORDS[k].rulesText}</span>
          </span>
        ))}
      </div>

      {groups.length === 0 && <div className="catalog-empty">No cards match those filters.</div>}

      {groups.map((g) => {
        const def = TRIBES[g.tribe];
        return (
          <section key={g.tribe} className="catalog-tribe">
            <div className="catalog-tribe-hd" style={{ borderColor: def.colorHex }}>
              <span className="catalog-tribe-name" style={{ color: def.colorHex }}>
                {def.name}
              </span>
              <span className="catalog-tribe-blurb">{def.blurb}</span>
              <span className="catalog-tribe-count">
                {g.cards.length} card{g.cards.length === 1 ? '' : 's'}
              </span>
            </div>
            <div className="catalog-grid">
              {g.cards.map((u) => (
                <div key={u.id} className="catalog-cell">
                  <Card model={toModel(u)} />
                  {(u.keywords.length > 0 || u.text) && (
                    <div className="catalog-desc">
                      {u.keywords.length > 0 && (
                        <div className="catalog-kw">
                          {u.keywords.map((k) => (
                            <span key={k} className="ck" title={KEYWORDS[k].rulesText}>
                              {KW_ICON[k]} {KW_LABEL[k]}
                            </span>
                          ))}
                        </div>
                      )}
                      {u.text && <div className="catalog-text">{u.text}</div>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export default CardCatalog;
