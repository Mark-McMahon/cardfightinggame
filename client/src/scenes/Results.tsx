// Results — final standings once the match phase is 'finished'.

import type { ReactNode } from 'react';
import { usePublicState, useRoom } from '../net/hooks';
import { leaveRoom } from '../net/game';

export function Results(): ReactNode {
  const pub = usePublicState();
  const conn = useRoom();
  if (!pub) return null;

  const place = (seat: number, placement: number) => (seat === pub.winnerSeat ? 1 : placement || 99);
  const ranked = [...pub.players].sort((a, b) => place(a.seat, a.placement) - place(b.seat, b.placement) || b.hp - a.hp);
  const iWon = pub.winnerSeat === conn.seat;

  return (
    <div className="app center">
      <div className={'result-banner ' + (iWon ? 'win' : 'tie')}>
        <span className="rb-word">{iWon ? 'Victory!' : 'Match over'}</span>
      </div>

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
