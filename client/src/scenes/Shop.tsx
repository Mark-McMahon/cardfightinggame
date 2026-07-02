// Shop — the shop-phase scene. Renders the owner's private state and sends INTENTS only (invariant
// 1): buy / sell / roll / freeze / tierUp / playUnit / moveUnit / targetChoice / discoverPick /
// readyUp. Drag-and-drop (decision #28) maps onto that same intent set — no new server op:
//   • shop → board .......... buy + place at slot  (buyThenPlay: buy, then playUnit the new bench unit)
//   • shop → bench .......... buy
//   • bench → board ......... playUnit(uid, slot)
//   • board → board ......... moveUnit(uid, slot)   (reorder)
//   • board/bench → shop .... sell(uid)             (the shop zone doubles as the sell target)
// Buttons remain the fallback (click a shop card to buy, a bench card to play; econ controls are buttons).

import { useRef, useState } from 'react';
import type { DragEvent, CSSProperties, ReactNode } from 'react';
import type { ClientUnit, ShopOffer, Intent, ActivatedAbilityState } from '@cardgame/shared';
import { economy, UNITS } from '@cardgame/shared';
import { usePrivateState, usePublicState, useRoom } from '../net/hooks';
import { sendIntent, buyThenPlay } from '../net/game';
import { Card, Standings, StatBadge, unitToModel, offerToModel, resolveOpponent } from '../components';

// decision #27: a resource counter shows only when you own a card that consumes it. Since #39
// the gem CONSUMERS are the activated-ability cards (the wallet's spenders) — read from the
// catalog (read-only static data).
const GEM_CONSUMERS = new Set(UNITS.filter((u) => u.activated).map((u) => u.id));
const ownsGemConsumer = (ids: string[]): boolean => ids.some((id) => GEM_CONSUMERS.has(id));

type DragFrom = 'shop' | 'bench' | 'board';
interface DragPayload {
  from: DragFrom;
  uid?: string;
  shopIndex?: number;
}

// Positional layout hints for the curved board + fanned hand. Only POSITION (index / distance /
// signed offset from the row centre) is computed here — pure geometry, like a flex index. Every
// tunable MAGNITUDE (the arc rise, the fan angle, the fan lift) lives as a CSS token in styles.css
// (invariant #4: no gameplay number is hardcoded, and presentation magnitudes are single-sourced
// too). CSS reads these vars and multiplies them by its tokens, so the whole curve reshapes from
// one place. `n` is the row length; `i` this card's slot.
function arcVars(i: number, n: number): CSSProperties {
  const center = (n - 1) / 2;
  return { ['--i' as string]: i, ['--dist' as string]: Math.abs(i - center) } as CSSProperties;
}
function fanVars(i: number, n: number): CSSProperties {
  const center = (n - 1) / 2;
  return { ['--off' as string]: (i - center).toFixed(3), ['--dist' as string]: Math.abs(i - center) } as CSSProperties;
}

// A tiny ORIGINAL hero medallion (clean-room §0: procedural, no external art). A framed disc whose
// hue is seeded from the seat so each player's crest is distinct, stamped with their initial.
function HeroCrest({ name, seat }: { name: string; seat: number | null }): ReactNode {
  const initial = (name || '?').trim().slice(0, 1).toUpperCase() || '?';
  const hue = (((seat ?? 0) * 47) % 360 + 360) % 360;
  const style = { ['--crest-hue' as string]: hue } as CSSProperties;
  return (
    <div className="hero-crest" style={style} aria-hidden>
      <span className="hero-initial">{initial}</span>
    </div>
  );
}

export function Shop() {
  const priv = usePrivateState();
  const pub = usePublicState();
  const conn = useRoom();

  const dragRef = useRef<DragPayload | null>(null);
  const slotRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [dragFrom, setDragFrom] = useState<DragFrom | null>(null);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [dropSlot, setDropSlot] = useState<number | null>(null);
  const [boardOver, setBoardOver] = useState(false);
  const [sellOver, setSellOver] = useState(false);
  const [mergeOverUid, setMergeOverUid] = useState<string | null>(null);

  if (!priv || !pub) return <div className="center dim">Loading shop…</div>;

  // The shop is rendered in two phases (App.tsx): live during 'shop', and as a FROZEN preview behind
  // the combat replay during 'combat'. When a player hits Skip ✕, the replay closes and reveals this
  // frozen shop — but the server is still holding the combat window, so inputs aren't live yet and any
  // buy would bounce with 'not shop phase'. Gate all intents on the real phase and surface the server's
  // "next shop" countdown (pub.timer during combat) so the reveal is honest, not silently dead (§10).
  const shopLive = pub.phase === 'shop';

  const pending = priv.pendingTarget;
  const legal = new Set(pending?.legalTargets ?? []);
  const myPub = pub.players.find((p) => p.seat === conn.seat);
  const opponent = resolveOpponent(pub, conn.seat);
  const ownedIds = [...priv.board, ...priv.bench].map((u) => u.cardId);
  const showGems = ownsGemConsumer(ownedIds) || priv.gems > 0;
  const abilityByUid = new Map<string, ActivatedAbilityState>((priv.abilities ?? []).map((a) => [a.uid, a]));

  const benchFull = priv.bench.length >= economy.benchCap;
  const boardFull = priv.board.length >= economy.boardCap;
  const canAfford = (n: number) => priv.gold >= n;

  // ── drag lifecycle ──────────────────────────────────────────────────────────────
  const startDrag = (payload: DragPayload, key: string) => (e: DragEvent) => {
    if (pending || !shopLive) return;
    dragRef.current = payload;
    setDragFrom(payload.from);
    setDraggingKey(key);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', key);
  };
  const endDrag = () => {
    dragRef.current = null;
    setDragFrom(null);
    setDraggingKey(null);
    setDropSlot(null);
    setBoardOver(false);
    setSellOver(false);
    setMergeOverUid(null);
  };

  // ── magnetic merge (decision #54): drag a MAGNETIC bench unit onto a friendly Construct on the board
  // to MERGE (instead of playing it standalone). Maps onto the `merge` intent; a non-magnetic drag or a
  // non-Construct target falls through to the normal board drop (play / reorder). ───────────────────
  const draggedMagneticBench = (): ClientUnit | undefined => {
    const d = dragRef.current;
    if (!d || d.from !== 'bench' || !d.uid) return undefined;
    const u = priv.bench.find((b) => b.uid === d.uid);
    return u && u.keywords.includes('magnetic') ? u : undefined;
  };
  const canMergeOnto = (u: ClientUnit): boolean => !!draggedMagneticBench() && u.tribe === 'constructs';

  // insertion slot on the board from the pointer x, using the live slot rects.
  const slotFromX = (x: number): number => {
    const rects = slotRefs.current;
    for (let i = 0; i < priv.board.length; i++) {
      const el = rects[i];
      if (el) {
        const r = el.getBoundingClientRect();
        if (x < r.left + r.width / 2) return i;
      }
    }
    return priv.board.length;
  };

  const onBoardOver = (e: DragEvent) => {
    if (!dragRef.current) return;
    e.preventDefault();
    setBoardOver(true);
    setDropSlot(slotFromX(e.clientX));
  };
  const onBoardDrop = (e: DragEvent) => {
    e.preventDefault();
    if (!shopLive) return endDrag();
    const d = dragRef.current;
    const slot = dropSlot ?? priv.board.length;
    if (d) {
      if (d.from === 'shop' && d.shopIndex != null && !boardFull) buyThenPlay(d.shopIndex, slot);
      else if (d.from === 'bench' && d.uid && !boardFull) sendIntent({ type: 'playUnit', unitUid: d.uid, toSlot: slot });
      else if (d.from === 'board' && d.uid) sendIntent({ type: 'moveUnit', unitUid: d.uid, toSlot: slot });
    }
    endDrag();
  };

  const onBenchDrop = (e: DragEvent) => {
    e.preventDefault();
    if (!shopLive) return endDrag();
    const d = dragRef.current;
    if (d?.from === 'shop' && d.shopIndex != null && !benchFull) sendIntent({ type: 'buy', shopIndex: d.shopIndex });
    endDrag();
  };

  const onShopDrop = (e: DragEvent) => {
    e.preventDefault();
    if (!shopLive) return endDrag();
    const d = dragRef.current;
    if (d && (d.from === 'board' || d.from === 'bench') && d.uid) sendIntent({ type: 'sell', unitUid: d.uid });
    endDrag();
  };

  const sellArmed = dragFrom === 'board' || dragFrom === 'bench';

  // ── click fallbacks ─────────────────────────────────────────────────────────────
  const clickOffer = (i: number) => () => {
    if (pending || !shopLive) return;
    if (canAfford(economy.buyCost) && !benchFull) sendIntent({ type: 'buy', shopIndex: i });
  };
  const clickBench = (u: ClientUnit) => () => {
    if (!shopLive) return;
    if (pending) {
      if (legal.has(u.uid)) sendIntent({ type: 'targetChoice', targetUid: u.uid });
      return;
    }
    if (!boardFull) sendIntent({ type: 'playUnit', unitUid: u.uid });
  };
  const clickBoard = (u: ClientUnit) => () => {
    if (shopLive && pending && legal.has(u.uid)) sendIntent({ type: 'targetChoice', targetUid: u.uid });
  };

  const intent = (i: Intent) => () => {
    if (shopLive) sendIntent(i);
  };

  const boardN = priv.board.length;
  const handN = priv.bench.length;

  return (
    <div className={'match-main tabletop' + (shopLive ? '' : ' shop-frozen')}>
      <Standings pub={pub} mySeat={conn.seat} opponent={opponent} />

      {/* Combat hold: the shop below is a frozen preview, not yet live. The grey-out alone reads as a
          dead shop (clicks do nothing under pointer-events:none), so make the reason UNMISTAKABLE — a
          lock banner with a live countdown to when buying reopens. Skipping the replay does NOT shorten
          the server's combat window; this is why a buy right after Skip bounces with 'not shop phase' (§10). */}
      {!shopLive && (
        <div className="shop-wait" role="status" aria-live="polite">
          <span className="sw-lock" aria-hidden>🔒</span>
          <div className="sw-text">
            <strong>Shop locked — combat is still resolving.</strong>
            <span className="sw-sub">Skipping the replay doesn't reopen the shop early; it opens for everyone at once.</span>
          </div>
          <div className="sw-timer" aria-label="time until the next shop opens">
            {pub.timer > 0 ? (
              <>
                <span className="sw-secs">{pub.timer}</span>
                <span className="sw-unit">s</span>
              </>
            ) : (
              <span className="sw-opening">opening…</span>
            )}
          </div>
        </div>
      )}

      {pending && (
        <div className="pending">
          <strong>{pending.sourceName}:</strong> {pending.description} — click a highlighted target.
        </div>
      )}

      {/* The tabletop surface — one continuous felt/wood table (no boxed panels): a tavern shelf up
          top (drag a minion DOWN to buy), the curved board as the focal felt, and a hero dock + a
          fanned hand along the bottom. Every intent is exactly as before; this is presentation only. */}
      <div className="table">
        {/* TAVERN SHELF — the shop counter you drag from; doubles as the sell target while dragging a
            board/bench unit up here (drop to sell). */}
        <div
          className={'tavern' + (sellArmed ? ' sell-armed' : '') + (sellOver ? ' sell-over' : '')}
          onDragOver={(e) => {
            if (sellArmed) {
              e.preventDefault();
              setSellOver(true);
            }
          }}
          onDragLeave={() => setSellOver(false)}
          onDrop={onShopDrop}
        >
          {/* The tavern bar is the top control deck (nearest the shop you spend into): the wallet
              (gold + gems) reads beside the shop title, then the shop/commit actions — Tier-Up,
              Freeze, Refresh, and the glowing Ready. HP lives on the bottom hero plate instead. */}
          <div className="tavern-bar">
            <span className="tavern-title">{sellArmed ? `↑ Drop to sell  +${economy.sellRefund}g` : shopLive ? 'Tavern' : 'Tavern · 🔒 locked'}</span>
            <StatBadge kind="coin" icon="◈" iconClass="coin-ico" title="gold">
              {priv.gold}
            </StatBadge>
            {showGems && (
              <StatBadge kind="gem-pill" icon="◆" iconClass="gem-ico" title="gems (feeds the Tusker doubler)">
                {priv.gems}
              </StatBadge>
            )}
            <span className="spacer" />
            <button className="ctl-btn tierup" disabled={priv.tierUpCost < 0 || !canAfford(priv.tierUpCost)} onClick={intent({ type: 'tierUp' })}>
              <span className="ctl-ico">▲</span> Tier <span className="tp-n">{priv.tier}</span>
              {priv.tierUpCost >= 0 && <span className="ctl-cost">{priv.tierUpCost}</span>}
            </button>
            <button
              className={'ctl-btn freeze' + (priv.frozen ? ' active' : '')}
              title="freeze the shop for next turn"
              onClick={intent(priv.frozen ? { type: 'unfreeze' } : { type: 'freeze' })}
            >
              <span className="ctl-ico">❄</span> {priv.frozen ? 'Frozen' : 'Freeze'}
            </button>
            <button className="ctl-btn refresh" disabled={!canAfford(priv.rerollCost)} onClick={intent({ type: 'roll' })}>
              <span className="ctl-ico">⟳</span> Refresh<span className="ctl-cost">{priv.rerollCost}</span>
            </button>
            <button className="ctl-btn ready primary" disabled={!!myPub?.ready} onClick={intent({ type: 'readyUp' })}>
              {myPub?.ready ? 'Ready ✓' : 'Ready'}
            </button>
          </div>
          <div className="shelf">
            {priv.shop.length === 0 && <span className="dim shelf-empty">empty — refresh for units</span>}
            {priv.shop.map((o: ShopOffer, i: number) => {
              const key = `shop-${i}`;
              const affordable = canAfford(economy.buyCost) && !benchFull;
              return (
                <div
                  key={key}
                  className={'dragwrap' + (draggingKey === key ? ' dragging' : '')}
                  draggable={!pending && shopLive}
                  onDragStart={startDrag({ from: 'shop', shopIndex: i }, key)}
                  onDragEnd={endDrag}
                  onClick={clickOffer(i)}
                >
                  <Card model={offerToModel(o)} className={affordable && !pending ? 'clickable' : ''} />
                </div>
              );
            })}
          </div>
        </div>

        {/* BOARD FELT — the focal surface; buy/play/reorder drop target. Units sit on a shallow arc.
            The drop handlers live on the FELT (the whole visible surface), not the inner card row:
            the felt is flex-grow and fills the table, so wiring drops to the short bottom-pinned row
            left most of the visible board silently rejecting drops (the taller the window, the worse).
            Per-unit merge drops still take priority via stopPropagation on the arc-slot. */}
        <div
          className={'board-felt' + (boardOver ? ' drop-over' : '')}
          onDragOver={onBoardOver}
          onDragLeave={() => {
            setBoardOver(false);
            setDropSlot(null);
          }}
          onDrop={onBoardDrop}
        >
          <div className="board-tag">Board {boardN}/{economy.boardCap}</div>
          <div className="board-row">
            {boardN === 0 && dropSlot == null && <span className="dim board-empty">drag units here to fight</span>}
            {priv.board.map((u, i) => {
              const ability = abilityByUid.get(u.uid);
              const abilityReady = !!ability && !ability.used && priv.gems >= ability.cost && shopLive && !pending;
              return (
                <div key={u.uid} style={{ display: 'contents' }}>
                  {dropSlot === i && <div className="drop-marker" />}
                  <div
                    ref={(el) => {
                      slotRefs.current[i] = el;
                    }}
                    style={arcVars(i, boardN)}
                    className={'bslot arc-slot' + (draggingKey === u.uid ? ' dragging' : '') + (mergeOverUid === u.uid ? ' merge-over' : '')}
                    draggable={!pending && shopLive}
                    onDragStart={startDrag({ from: 'board', uid: u.uid }, u.uid)}
                    onDragEnd={endDrag}
                    onDragOver={(e) => {
                      if (shopLive && canMergeOnto(u)) {
                        e.preventDefault();
                        e.stopPropagation(); // take priority over the board-row reorder/play drop
                        setMergeOverUid(u.uid);
                      }
                    }}
                    onDragLeave={() => setMergeOverUid((cur) => (cur === u.uid ? null : cur))}
                    onDrop={(e) => {
                      const d = dragRef.current;
                      if (shopLive && canMergeOnto(u) && d?.uid) {
                        e.preventDefault();
                        e.stopPropagation();
                        sendIntent({ type: 'merge', unitUid: d.uid, targetUid: u.uid });
                        endDrag();
                      }
                    }}
                    onClick={clickBoard(u)}
                  >
                    <Card model={unitToModel(u)} className={pending && legal.has(u.uid) ? 'legal' : ''} />
                    {/* activated ability (decision #39): buy with gems, once per turn per minion */}
                    {ability && (
                      <button
                        className={'ability-btn' + (ability.used ? ' used' : '')}
                        disabled={!abilityReady}
                        title={ability.used ? 'already activated this turn' : u.text ?? 'activate'}
                        onClick={(e) => {
                          e.stopPropagation(); // never fall through to target-pick on the card
                          if (abilityReady) sendIntent({ type: 'activate', unitUid: u.uid });
                        }}
                      >
                        {ability.used ? '✓ used' : <>◆{ability.cost} activate</>}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {dropSlot === boardN && <div className="drop-marker" />}
          </div>
        </div>

        {/* DOCK — hero identity plate (portrait + HP orb; health lives at the bottom, the econ
            controls moved up to the tavern bar) + the fanned hand (bench). The hand is the
            buy(from shop) drop target. */}
        <div className="dock">
          <div className="hero">
            <HeroCrest name={myPub?.name ?? 'You'} seat={conn.seat} />
            <div className="hp-orb" title="your health">
              <span className="hp-val">{Math.max(0, myPub?.hp ?? 0)}</span>
            </div>
          </div>

          <div className="hand" onDragOver={(e) => dragRef.current?.from === 'shop' && e.preventDefault()} onDrop={onBenchDrop}>
            <div className="hand-tag">Hand {handN}/{economy.benchCap}</div>
            <div className="hand-fan">
              {handN === 0 && <span className="dim hand-empty">buy units from the tavern</span>}
              {priv.bench.map((u, i) => (
                <div
                  key={u.uid}
                  style={fanVars(i, handN)}
                  className={'bslot fan-card' + (draggingKey === u.uid ? ' dragging' : '')}
                  draggable={!pending}
                  onDragStart={startDrag({ from: 'bench', uid: u.uid }, u.uid)}
                  onDragEnd={endDrag}
                  onClick={clickBench(u)}
                >
                  <Card model={unitToModel(u)} className={pending && legal.has(u.uid) ? 'legal' : !pending && !boardFull ? 'clickable' : ''} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* DISCOVER modal (triple reward etc.) — a shop-phase reward; never over the combat freeze */}
      {shopLive && priv.discover && (
        <div className="discover-modal">
          <div className="discover-card">
            <div className="standings-title">Discover — {priv.discover.reason}</div>
            <div className="units-row">
              {priv.discover.options.map((o, i) => (
                <div key={i} onClick={() => sendIntent({ type: 'discoverPick', optionIndex: i })}>
                  <Card model={offerToModel(o)} className="clickable" />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
