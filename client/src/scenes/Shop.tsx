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
import type { DragEvent } from 'react';
import type { ClientUnit, ShopOffer, Intent } from '@cardgame/shared';
import { economy, breakpoints } from '@cardgame/shared';
import { usePrivateState, usePublicState, useRoom } from '../net/hooks';
import { sendIntent, buyThenPlay } from '../net/game';
import { Card, Standings, StatBadge, unitToModel, offerToModel } from '../components';

// decision #27: a manufactured-event counter shows only when you own a card that consumes it.
// The catalog→counter mapping is the authoritative breakpoints config (read-only static data).
const GEM_CONSUMERS = new Set(breakpoints.list.filter((b) => b.counter === 'gemsThisTurn').map((b) => b.card));
const ownsGemConsumer = (ids: string[]): boolean => ids.some((id) => GEM_CONSUMERS.has(id));

type DragFrom = 'shop' | 'bench' | 'board';
interface DragPayload {
  from: DragFrom;
  uid?: string;
  shopIndex?: number;
}

function opponentSeat(pairings: { aSeat: number; bSeat: number; ghost: boolean }[], seat: number | null): number | null {
  if (seat == null) return null;
  for (const pr of pairings) {
    if (pr.aSeat === seat) return pr.ghost ? null : pr.bSeat;
    if (pr.bSeat === seat) return pr.aSeat;
  }
  return null;
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

  if (!priv || !pub) return <div className="center dim">Loading shop…</div>;

  const pending = priv.pendingTarget;
  const legal = new Set(pending?.legalTargets ?? []);
  const myPub = pub.players.find((p) => p.seat === conn.seat);
  const oppSeat = opponentSeat(pub.pairings, conn.seat);
  const ownedIds = [...priv.board, ...priv.bench].map((u) => u.cardId);
  const showGems = ownsGemConsumer(ownedIds) || priv.gems > 0;

  const benchFull = priv.bench.length >= economy.benchCap;
  const boardFull = priv.board.length >= economy.boardCap;
  const canAfford = (n: number) => priv.gold >= n;

  // ── drag lifecycle ──────────────────────────────────────────────────────────────
  const startDrag = (payload: DragPayload, key: string) => (e: DragEvent) => {
    if (pending) return;
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
  };

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
    const d = dragRef.current;
    if (d?.from === 'shop' && d.shopIndex != null && !benchFull) sendIntent({ type: 'buy', shopIndex: d.shopIndex });
    endDrag();
  };

  const onShopDrop = (e: DragEvent) => {
    e.preventDefault();
    const d = dragRef.current;
    if (d && (d.from === 'board' || d.from === 'bench') && d.uid) sendIntent({ type: 'sell', unitUid: d.uid });
    endDrag();
  };

  const sellArmed = dragFrom === 'board' || dragFrom === 'bench';

  // ── click fallbacks ─────────────────────────────────────────────────────────────
  const clickOffer = (i: number) => () => {
    if (pending) return;
    if (canAfford(economy.buyCost) && !benchFull) sendIntent({ type: 'buy', shopIndex: i });
  };
  const clickBench = (u: ClientUnit) => () => {
    if (pending) {
      if (legal.has(u.uid)) sendIntent({ type: 'targetChoice', targetUid: u.uid });
      return;
    }
    if (!boardFull) sendIntent({ type: 'playUnit', unitUid: u.uid });
  };
  const clickBoard = (u: ClientUnit) => () => {
    if (pending && legal.has(u.uid)) sendIntent({ type: 'targetChoice', targetUid: u.uid });
  };

  const intent = (i: Intent) => () => sendIntent(i);

  return (
    <div className="match-main">
      <Standings pub={pub} mySeat={conn.seat} opponentSeat={oppSeat} />

      {/* economy control bar */}
      <div className="econ-bar panel">
        <StatBadge kind="coin" icon="◈" iconClass="coin-ico" title="gold">
          {priv.gold}
        </StatBadge>
        <span className="tier-pill" title="tavern tier">
          Tier <span className="tp-n">{priv.tier}</span>
        </span>
        {showGems && (
          <StatBadge kind="gem-pill" icon="◆" iconClass="gem-ico" title="gems (feeds the Tusker doubler)">
            {priv.gems}
          </StatBadge>
        )}
        <div className="spacer" />
        <button className="ctl-btn" disabled={priv.tierUpCost < 0 || !canAfford(priv.tierUpCost)} onClick={intent({ type: 'tierUp' })}>
          <span className="ctl-ico">▲</span> Tier Up
          {priv.tierUpCost >= 0 && <span className="ctl-cost">{priv.tierUpCost}</span>}
        </button>
        <button className="ctl-btn" disabled={!canAfford(priv.rerollCost)} onClick={intent({ type: 'roll' })}>
          <span className="ctl-ico">⟳</span> Roll<span className="ctl-cost">{priv.rerollCost}</span>
        </button>
        <button className={'ctl-btn freeze' + (priv.frozen ? ' active' : '')} onClick={intent(priv.frozen ? { type: 'unfreeze' } : { type: 'freeze' })}>
          <span className="ctl-ico">❄</span> Freeze
        </button>
        <button className="ctl-btn ready primary" disabled={!!myPub?.ready} onClick={intent({ type: 'readyUp' })}>
          {myPub?.ready ? 'Ready ✓' : 'Ready'}
        </button>
      </div>

      {pending && (
        <div className="pending">
          <strong>{pending.sourceName}:</strong> {pending.description} — click a highlighted target.
        </div>
      )}

      {/* SHOP zone — also the sell target while dragging a board/bench unit */}
      <div
        className={'zone shop-zone' + (sellArmed ? ' sell-armed' : '') + (sellOver ? ' sell-over' : '')}
        onDragOver={(e) => {
          if (sellArmed) {
            e.preventDefault();
            setSellOver(true);
          }
        }}
        onDragLeave={() => setSellOver(false)}
        onDrop={onShopDrop}
      >
        <h4>{sellArmed ? `Drop to sell (+${economy.sellRefund}g)` : 'Shop'}</h4>
        <div className="units-row">
          {priv.shop.length === 0 && <span className="dim">empty — roll for units</span>}
          {priv.shop.map((o: ShopOffer, i: number) => {
            const key = `shop-${i}`;
            const affordable = canAfford(economy.buyCost) && !benchFull;
            return (
              <div
                key={key}
                className={'dragwrap' + (draggingKey === key ? ' dragging' : '')}
                draggable={!pending}
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

      {/* BOARD zone — buy/play/reorder drop target */}
      <div className="zone board-zone">
        <h4>Board {priv.board.length}/{economy.boardCap}</h4>
        <div
          className={'units-row board-row' + (boardOver ? ' drop-over' : '')}
          onDragOver={onBoardOver}
          onDragLeave={() => {
            setBoardOver(false);
            setDropSlot(null);
          }}
          onDrop={onBoardDrop}
        >
          {priv.board.length === 0 && dropSlot == null && <span className="dim">drag units here to fight</span>}
          {priv.board.map((u, i) => (
            <div key={u.uid} style={{ display: 'contents' }}>
              {dropSlot === i && <div className="drop-marker" />}
              <div
                ref={(el) => {
                  slotRefs.current[i] = el;
                }}
                className={'bslot' + (draggingKey === u.uid ? ' dragging' : '')}
                draggable={!pending}
                onDragStart={startDrag({ from: 'board', uid: u.uid }, u.uid)}
                onDragEnd={endDrag}
                onClick={clickBoard(u)}
              >
                <Card model={unitToModel(u)} className={pending && legal.has(u.uid) ? 'legal' : ''} />
              </div>
            </div>
          ))}
          {dropSlot === priv.board.length && <div className="drop-marker" />}
        </div>
      </div>

      {/* BENCH zone — buy(from shop) drop target */}
      <div className="zone" onDragOver={(e) => dragRef.current?.from === 'shop' && e.preventDefault()} onDrop={onBenchDrop}>
        <h4>Bench {priv.bench.length}/{economy.benchCap}</h4>
        <div className="units-row">
          {priv.bench.length === 0 && <span className="dim">buy units from the shop</span>}
          {priv.bench.map((u) => (
            <div
              key={u.uid}
              className={'bslot' + (draggingKey === u.uid ? ' dragging' : '')}
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

      {/* DISCOVER modal (triple reward etc.) */}
      {priv.discover && (
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
