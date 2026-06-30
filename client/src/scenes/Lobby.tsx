import { useState } from 'react';
import { useStore } from '../net/hooks';
import {
  connStore,
  pubStore,
  seatStore,
  createRoom,
  joinRoom,
  startMatch,
  setBotFill,
} from '../net/game';

export function Lobby() {
  const conn = useStore(connStore);
  const pub = useStore(pubStore);
  const seat = useStore(seatStore);
  const [name, setName] = useState('Player');
  const [code, setCode] = useState('');

  if (!conn.connected) {
    return (
      <div className="center">
        <div className="title">⚔ Mythic Menagerie</div>
        <div className="dim">An 8-player auto-battler</div>
        <div className="panel col" style={{ width: 360 }}>
          <label className="dim">Display name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={16} />
          <button className="primary" onClick={() => createRoom(name)}>
            Create room (with bots)
          </button>
          <div className="row">
            <input
              placeholder="room code"
              value={code}
              onChange={(e) => setCode(e.target.value.trim())}
              style={{ flex: 1 }}
            />
            <button disabled={!code} onClick={() => joinRoom(code, name)}>
              Join
            </button>
          </div>
          {conn.error && <div style={{ color: 'var(--bad)' }}>{conn.error}</div>}
        </div>
      </div>
    );
  }

  const isHost = pub?.hostSeat === seat;
  return (
    <div className="app col">
      <div className="title">Lobby</div>
      <div className="panel col">
        <div className="row">
          <span className="dim">Room code:</span>
          <span className="tag" style={{ fontSize: 16 }}>
            {conn.roomId}
          </span>
          <span className="dim">— share this so others can join.</span>
        </div>
        <div>
          <h4 className="dim">Players ({pub?.players.length ?? 0}/8)</h4>
          <div className="players">
            {pub?.players.map((p) => (
              <div className={`pchip ${p.seat === seat ? 'me' : ''}`} key={p.seat}>
                <div className="nm">
                  {p.name} {p.isBot ? <span className="tag">BOT</span> : ''}
                  {p.seat === pub.hostSeat ? <span className="tag">HOST</span> : ''}
                </div>
              </div>
            ))}
          </div>
        </div>
        {isHost ? (
          <div className="row">
            <label className="row">
              <input
                type="checkbox"
                checked={pub?.botFill ?? true}
                onChange={(e) => setBotFill(e.target.checked)}
              />
              <span style={{ marginLeft: 6 }}>Fill empty seats with bots</span>
            </label>
            <div className="spacer" />
            <button className="primary" onClick={startMatch}>
              Start match
            </button>
          </div>
        ) : (
          <div className="dim">Waiting for the host to start…</div>
        )}
      </div>
    </div>
  );
}
