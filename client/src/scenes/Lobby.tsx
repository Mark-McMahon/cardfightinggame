// Lobby — the pre-match room: share the code, see seated players, host toggles bot-fill + starts.
// All lobby actions are server messages (setBotFill / startMatch); seat list is public state.

import type { ReactNode } from 'react';
import { usePublicState, useRoom } from '../net/hooks';
import { setBotFill, startMatch, leaveRoom } from '../net/game';

export function Lobby(): ReactNode {
  const pub = usePublicState();
  const conn = useRoom();
  if (!pub) return <div className="center dim">Entering lobby…</div>;

  const isHost = pub.hostSeat === conn.seat;
  const canStart = isHost && (pub.botFill || pub.players.length >= 2);

  return (
    <div className="app">
      <div className="row">
        <div className="title">Lobby</div>
        <div className="spacer" />
        <button onClick={leaveRoom}>Leave</button>
      </div>

      <div className="panel col" style={{ marginTop: 12 }}>
        <div className="row">
          <span className="dim">Room code</span>
          <span className="tag" style={{ fontSize: 18, letterSpacing: 1, padding: '4px 10px' }}>
            {pub.roomCode}
          </span>
          <button onClick={() => navigator.clipboard?.writeText(pub.roomCode)}>Copy</button>
        </div>
        <div className="dim">Share the code so others can join ({pub.players.length}/8 seated).</div>
      </div>

      <div className="panel" style={{ marginTop: 12 }}>
        <div className="standings-title">Seats</div>
        <div className="players">
          {pub.players.map((p) => (
            <div key={p.seat} className={'pchip' + (p.seat === conn.seat ? ' me' : '')}>
              <div className="nm">
                {p.name}
                {p.seat === pub.hostSeat && <span className="tag">host</span>}
                {p.isBot && <span className="tag">bot</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {isHost ? (
        <div className="row panel" style={{ marginTop: 12 }}>
          <label className="row" style={{ gap: 6 }}>
            <input type="checkbox" checked={pub.botFill} onChange={(e) => setBotFill(e.target.checked)} />
            Fill empty seats with bots
          </label>
          <div className="spacer" />
          <button className="primary" disabled={!canStart} onClick={startMatch}>
            Start match
          </button>
        </div>
      ) : (
        <div className="dim" style={{ marginTop: 12 }}>
          Waiting for the host to start…
        </div>
      )}
    </div>
  );
}
