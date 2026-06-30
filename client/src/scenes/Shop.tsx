import { Fragment, useEffect, useRef, useState, type DragEvent } from 'react';
import { useStore } from '../net/hooks';
import { pubStore, privStore, seatStore, sendIntent } from '../net/game';
import { UnitShape } from '../components';
import type { ClientUnit, Pairing, PublicPlayer } from '@cardgame/shared';

// ─────────────────────────────────────────────────────────────────────────────
// Shop — full drag-and-drop (design-spec §16.6, decision #28). Every drag maps to an
// EXISTING intent (no server change):
//   shop → board   = buy, then playUnit at the dropped slot (chained on the next state)
//   shop → bench   = plain buy
//   bench → board  = playUnit at the dropped slot
//   board reorder  = moveUnit
//   board/bench → shop (drag up) = sell  (the shop is the sell target; no dedicated sell zone)
// board → bench (un-deploy) has no server intent and is intentionally NOT a drag — drag a
// board unit up to the shop to clear it. Buttons + click remain as fallbacks (back the e2e flow).
// ─────────────────────────────────────────────────────────────────────────────

type DragItem =
  | { kind: 'shop'; index: number }
  | { kind: 'bench'; uid: string }
  | { kind: 'board'; uid: string; index: number };

function opponentSeat(pairings: Pairing[], players: PublicPlayer[], seat: number): { label: string } | null {
  const nameOf = (s: number) => players.find((p) => p.seat === s)?.name ?? `seat ${s}`;
  for (const p of pairings) {
    if (p.aSeat === seat) return { label: p.ghost ? `${p.ghostName} (ghost)` : nameOf(p.bSeat) };
    if (p.bSeat === seat) return { label: nameOf(p.aSeat) };
  }
  return null;
}

/** Ordinal suffix for placements shown on eliminated players (2nd, 3rd, …). */
function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

/** Insertion index (0..n) in a drop row from the cursor x, measured against `[data-slot]` children. */
function gapFromEvent(e: DragEvent<HTMLElement>): number {
  const slots = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-slot]'));
  for (let i = 0; i < slots.length; i++) {
    const r = slots[i].getBoundingClientRect();
    if (e.clientX < r.left + r.width / 2) return i;
  }
  return slots.length;
}

export function Shop() {
  const pub = useStore(pubStore);
  const priv = useStore(privStore);
  const seat = useStore(seatStore);

  const [drag, setDrag] = useState<DragItem | null>(null);
  const [hoverGap, setHoverGap] = useState<number | null>(null);
  const [sellOver, setSellOver] = useState(false);
  const [benchOver, setBenchOver] = useState(false);

  // shop → board is a two-step chain: buy lands the unit on the bench, then we play the
  // newly-arrived unit at the dropped slot. Capture the bench before the buy so the next
  // private-state push lets us spot the new uid. A timeout clears it if the buy was illegal.
  const pendingPlace = useRef<{ slot: number; prevUids: Set<string> } | null>(null);

  useEffect(() => {
    const pp = pendingPlace.current;
    if (!pp || !priv) return;
    const fresh = priv.bench.find((u) => !pp.prevUids.has(u.uid));
    if (fresh) {
      pendingPlace.current = null;
      sendIntent({ type: 'playUnit', unitUid: fresh.uid, toSlot: pp.slot });
    }
  }, [priv]);

  if (!pub) return null;

  const me = pub.players.find((p) => p.seat === seat);
  const opp = opponentSeat(pub.pairings, pub.players, seat);
  const pending = priv?.pendingTarget ?? null;
  const legal = new Set(pending?.legalTargets ?? []);
  const board = priv?.board ?? [];

  // standings: living ranked by HP (desc), then dead in finish order, greyed at the bottom.
  const ranked = [...pub.players].sort((a, b) => {
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
    if (a.alive) return b.hp - a.hp || a.seat - b.seat;
    return a.placement - b.placement;
  });
  const firstDeadIdx = ranked.findIndex((p) => !p.alive);

  const buy = (i: number) => sendIntent({ type: 'buy', shopIndex: i });
  const sell = (uid: string) => sendIntent({ type: 'sell', unitUid: uid });
  const play = (uid: string, toSlot?: number) => sendIntent({ type: 'playUnit', unitUid: uid, toSlot });
  const move = (uid: string, toSlot: number) => sendIntent({ type: 'moveUnit', unitUid: uid, toSlot });
  const choose = (uid: string) => sendIntent({ type: 'targetChoice', targetUid: uid });

  /** Buy from the shop and place the bought unit at `slot` once it lands on the bench. */
  const buyToBoard = (shopIndex: number, slot: number) => {
    const pp = { slot, prevUids: new Set((priv?.bench ?? []).map((u) => u.uid)) };
    pendingPlace.current = pp;
    buy(shopIndex);
    setTimeout(() => {
      if (pendingPlace.current === pp) pendingPlace.current = null; // buy was rejected (full bench / no gold)
    }, 1500);
  };

  const resetDrag = () => {
    setDrag(null);
    setHoverGap(null);
    setSellOver(false);
    setBenchOver(false);
  };

  // ── board drop row (reorder / play / buy-and-place) ──
  const onBoardOver = (e: DragEvent<HTMLDivElement>) => {
    if (!drag) return;
    e.preventDefault();
    setSellOver(false);
    setBenchOver(false);
    setHoverGap(gapFromEvent(e));
  };
  const onBoardLeave = (e: DragEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHoverGap(null);
  };
  const onBoardDrop = (e: DragEvent<HTMLDivElement>) => {
    if (!drag) return;
    e.preventDefault();
    const gap = gapFromEvent(e);
    if (drag.kind === 'shop') buyToBoard(drag.index, gap);
    else if (drag.kind === 'bench') play(drag.uid, gap);
    else if (drag.kind === 'board') {
      // moveUnit splices the unit out first, so a rightward move shifts the target slot down by one.
      const toSlot = gap > drag.index ? gap - 1 : gap;
      if (toSlot !== drag.index) move(drag.uid, toSlot);
    }
    resetDrag();
  };

  // ── sell via the shop (board / bench dragged up onto the shop = sell) ──
  const sellArmed = !!drag && drag.kind !== 'shop';
  const onSellOver = (e: DragEvent<HTMLDivElement>) => {
    if (!sellArmed) return;
    e.preventDefault();
    setHoverGap(null);
    setBenchOver(false);
    setSellOver(true);
  };
  // the shop holds draggable cards, so a naive leave flickers as the cursor crosses them;
  // only clear once the cursor truly exits the zone.
  const onSellLeave = (e: DragEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setSellOver(false);
  };
  const onSellDrop = (e: DragEvent<HTMLDivElement>) => {
    if (!drag || drag.kind === 'shop') return;
    e.preventDefault();
    sell(drag.uid);
    resetDrag();
  };

  // ── bench zone (shop → bench = plain buy) ──
  const onBenchOver = (e: DragEvent<HTMLDivElement>) => {
    if (drag?.kind !== 'shop') return;
    e.preventDefault();
    setHoverGap(null);
    setBenchOver(true);
  };
  const onBenchDrop = (e: DragEvent<HTMLDivElement>) => {
    if (drag?.kind !== 'shop') return;
    e.preventDefault();
    buy(drag.index);
    resetDrag();
  };

  const dragMark = (active: boolean) => (active ? 'dragging' : '');

  return (
    <div className="match-main">
      {/* standings rail — round/timer/opponent header, the HP-ranked field, room code footer */}
      <aside className="standings panel">
        <div className="side-head">
          <span className="side-round">
            Round {pub.round} <span className="tag">SHOP</span>
          </span>
          <span className={`side-timer ${pub.timer <= 5 ? 'low' : ''}`}>⏱ {pub.timer}s</span>
        </div>
        {opp && (
          <div className="side-vs">
            vs <strong>{opp.label}</strong>
          </div>
        )}
        <h4 className="standings-title">Standings</h4>
        {ranked.map((p, i) => {
          const isOpp = pub.pairings.some(
            (pr) => (pr.aSeat === seat && pr.bSeat === p.seat) || (pr.bSeat === seat && pr.aSeat === p.seat),
          );
          return (
            <Fragment key={p.seat}>
              {i === firstDeadIdx && firstDeadIdx > 0 && <div className="sdiv" />}
              <div className={`srow ${p.seat === seat ? 'me' : ''} ${isOpp ? 'vs' : ''} ${p.alive ? '' : 'dead'}`}>
                <span className="srank">{p.alive ? i + 1 : p.placement}</span>
                <span className="sname">{p.name}</span>
                <span className="shp">{p.alive ? `♥ ${p.hp}` : ordinal(p.placement)}</span>
              </div>
            </Fragment>
          );
        })}
        <div className="side-foot">room {pub.roomCode}</div>
      </aside>

      {pending && (
        <div className="pending">
          <strong>{pending.sourceName}</strong> — {pending.description}. Pick a highlighted target.
        </div>
      )}

      {/* economy controls — icon-led control bar (§16.6 cleanup) */}
      <div className="panel econ-bar">
        <span className="coin">
          <span className="coin-ico">🪙</span>
          {priv?.gold ?? 0}
        </span>
        <span className="tier-pill">
          Tier <span className="tp-n">{priv?.tier ?? 1}</span>
        </span>

        <button
          className="ctl-btn"
          disabled={!priv || priv.tierUpCost < 0 || priv.gold < priv.tierUpCost}
          onClick={() => sendIntent({ type: 'tierUp' })}
        >
          <span className="ctl-ico">⬆</span>
          Tier Up
          <span className="ctl-cost">{priv && priv.tierUpCost >= 0 ? `${priv.tierUpCost}g` : 'max'}</span>
        </button>
        <button className="ctl-btn" disabled={!priv || priv.gold < priv.rerollCost} onClick={() => sendIntent({ type: 'roll' })}>
          <span className="ctl-ico">🎲</span>
          Roll
          <span className="ctl-cost">{priv?.rerollCost ?? 1}g</span>
        </button>
        <button
          className={`ctl-btn freeze ${priv?.frozen ? 'active' : ''}`}
          onClick={() => sendIntent({ type: priv?.frozen ? 'unfreeze' : 'freeze' })}
        >
          <span className="ctl-ico">❄</span>
          {priv?.frozen ? 'Frozen' : 'Freeze'}
        </button>

        <div className="spacer" />
        <button className="primary ctl-btn ready" disabled={me?.ready} onClick={() => sendIntent({ type: 'readyUp' })}>
          {me?.ready ? '✓ Ready' : 'Ready up'}
        </button>
      </div>

      {/* shop — drag a card down to the board/bench to buy (click still buys); drag a board/bench
          unit UP here to sell it (+1g). The shop doubles as the sell target — no dedicated sell zone. */}
      <div
        className={`zone shop-zone ${sellArmed ? 'sell-armed' : ''} ${sellOver ? 'sell-over' : ''}`}
        onDragOver={onSellOver}
        onDragLeave={onSellLeave}
        onDrop={onSellDrop}
      >
        <h4>
          {sellArmed
            ? sellOver
              ? '🗑 Release to sell (+1g)'
              : '🗑 Drop a unit here to sell (+1g)'
            : `Shop ${priv?.frozen ? '(frozen)' : ''} — drag down to play · click to buy · drag a unit up here to sell`}
        </h4>
        <div className="units-row">
          {priv?.shop.map((o, i) => (
            <div
              className={`dragwrap ${dragMark(drag?.kind === 'shop' && drag.index === i)}`}
              key={`${o.cardId}-${i}`}
              draggable
              onDragStart={() => setDrag({ kind: 'shop', index: i })}
              onDragEnd={resetDrag}
            >
              <UnitShape unit={{ ...o, keywords: o.keywords }} showTip onClick={() => buy(i)} />
            </div>
          ))}
          {priv?.shop.length === 0 && <span className="dim">empty</span>}
        </div>
      </div>

      {/* board — full width now that selling happens by dragging a unit up onto the shop */}
      <div className="zone board-zone">
        <h4>Your board ({board.length}/7) — drag to reorder · front (left) is hit first · drag up to the shop to sell</h4>
        <div
          className={`units-row board-row ${hoverGap !== null ? 'drop-over' : ''}`}
          onDragOver={onBoardOver}
          onDragLeave={onBoardLeave}
          onDrop={onBoardDrop}
        >
          {board.map((u, idx) => (
            <Fragment key={u.uid}>
              {hoverGap === idx && <div className="drop-marker" />}
              <div className={`col bslot ${dragMark(drag?.kind === 'board' && drag.uid === u.uid)}`} data-slot={idx} style={{ alignItems: 'center' }}>
                <div
                  className="dragwrap"
                  draggable
                  onDragStart={() => setDrag({ kind: 'board', uid: u.uid, index: idx })}
                  onDragEnd={resetDrag}
                >
                  <UnitShape
                    unit={u}
                    showTip
                    className={legal.has(u.uid) ? 'legal' : ''}
                    onClick={legal.has(u.uid) ? () => choose(u.uid) : undefined}
                  />
                </div>
              </div>
            </Fragment>
          ))}
          {hoverGap === board.length && <div className="drop-marker" key="m-end" />}
          {board.length === 0 && hoverGap === null && (
            <span className="dim">Drag units here — front (left) units are targeted first.</span>
          )}
        </div>
      </div>

      {/* bench — drag onto board to play; drop a shop card here to buy; click to play */}
      <div className={`zone ${benchOver ? 'drop-over' : ''}`} onDragOver={onBenchOver} onDragLeave={() => setBenchOver(false)} onDrop={onBenchDrop}>
        <h4>Bench ({priv?.bench.length ?? 0}/10) — drag onto board to play (or click)</h4>
        <div className="units-row">
          {priv?.bench.map((u: ClientUnit) => (
            <div
              className={`col dragwrap ${dragMark(drag?.kind === 'bench' && drag.uid === u.uid)}`}
              key={u.uid}
              style={{ alignItems: 'center' }}
              draggable
              onDragStart={() => setDrag({ kind: 'bench', uid: u.uid })}
              onDragEnd={resetDrag}
            >
              <UnitShape unit={u} showTip onClick={() => play(u.uid)} />
              <button className="danger" onClick={() => sell(u.uid)}>
                Sell $
              </button>
            </div>
          ))}
          {priv?.bench.length === 0 && <span className="dim">empty</span>}
        </div>
      </div>

      {/* discover modal */}
      {priv?.discover && (
        <div className="discover-modal">
          <div className="discover-card col">
            <h3>Discover — {priv.discover.reason}</h3>
            <div className="row">
              {priv.discover.options.map((o, i) => (
                <UnitShape
                  key={i}
                  unit={{ ...o, keywords: o.keywords }}
                  showTip
                  onClick={() => sendIntent({ type: 'discoverPick', optionIndex: i })}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
