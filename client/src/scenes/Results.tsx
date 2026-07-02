// Results — final standings once the match phase is 'finished'.

import type { ReactNode } from 'react';
import { usePublicState, usePrivateState, useRoom } from '../net/hooks';
import { leaveRoom } from '../net/game';
import { Card, unitToModel, arcVars } from '../components';

export function Results(): ReactNode {
  const pub = usePublicState();
  const priv = usePrivateState();
  const conn = useRoom();
  if (!pub) return null;

  const place = (seat: number, placement: number) => (seat === pub.winnerSeat ? 1 : placement || 99);
  const ranked = [...pub.players].sort((a, b) => place(a.seat, a.placement) - place(b.seat, b.placement) || b.hp - a.hp);
  const iWon = pub.winnerSeat === conn.seat;
  // On a win, take a victory lap over the roster that won it — the winner's own post-final-combat board
  // (permanent buffs folded in, §7.5). It's already in the private channel (persisted at 'finished'), so
  // no server change: two-channel privacy means we can only ever show the viewer their OWN board.
  const winBoard = iWon ? priv?.board ?? [] : [];

  return (
    <div className="app center">
      <div className={'result-banner ' + (iWon ? 'win' : 'tie')}>
        <span className="rb-word">{iWon ? 'Victory!' : 'Match over'}</span>
      </div>

      {winBoard.length > 0 && (
        <div className="panel win-board">
          <div className="standings-title">Your winning board</div>
          <div className="board-row wb-row">
            {winBoard.map((u, i) => (
              <div key={u.uid} className="arc-slot" style={arcVars(i, winBoard.length)}>
                <Card model={unitToModel(u)} />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="panel" style={{ minWidth: 340 }}>
        <div className="standings-title">Final placements</div>
        {ranked.map((p) => {
          const pl = place(p.seat, p.placement);
          return (
            <div key={p.seat} className={'srow' + (p.seat === conn.seat ? ' me' : '') + (p.seat !== pub.winnerSeat && !p.alive ? ' dead' : '')}>
              <span className="srank">#{pl === 99 ? '-' : pl}</span>
              <span className="sname">
                {p.name}
                {p.isBot && ' ·bot'}
              </span>
              <span className="shp">{p.hp}</span>
            </div>
          );
        })}
      </div>

      <button className="primary" onClick={leaveRoom}>
        Back to menu
      </button>
    </div>
  );
}
