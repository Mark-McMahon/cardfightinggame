// App — top-level scene routing driven purely by the public phase (server-authoritative), plus the
// create/join landing. During 'combat' the frozen Shop stays behind the CombatReplay overlay so the
// board reads continuously between phases.

import { useState } from 'react';
import type { ReactNode } from 'react';
import { usePublicState, usePrivateState, useCombatLog, useRoom } from './net/hooks';
import { createRoom, joinRoom } from './net/game';
import { Lobby } from './scenes/Lobby';
import { Shop } from './scenes/Shop';
import { CombatReplay, type CombatHeader } from './scenes/CombatReplay';
import { Results } from './scenes/Results';
import { Toasts, resolveOpponent, sideForSeat } from './components';

function Landing(): ReactNode {
  const conn = useRoom();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  return (
    <div className="center">
      <div className="title">Auto-Battler</div>
      <div className="dim">An original, clean-room auto-battler. Create a room or join by code.</div>
      <div className="panel col" style={{ minWidth: 340 }}>
        <input placeholder="Your name" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} />
        <button className="primary" disabled={conn.connecting} onClick={() => void createRoom({ name: name || undefined, botFill: true })}>
          Create room (vs bots)
        </button>
        <div className="row dim" style={{ justifyContent: 'center' }}>
          <div className="sdiv" style={{ flex: 1 }} /> or <div className="sdiv" style={{ flex: 1 }} />
        </div>
        <div className="row">
          <input placeholder="Room code" value={code} style={{ flex: 1 }} onChange={(e) => setCode(e.target.value.trim())} />
          <button disabled={conn.connecting || !code} onClick={() => void joinRoom(code, name || undefined)}>
            Join
          </button>
        </div>
        {conn.connecting && <div className="dim">Connecting…</div>}
        {conn.error && <div style={{ color: 'var(--bad)' }}>{conn.error}</div>}
      </div>
    </div>
  );
}

function CombatScene(): ReactNode {
  const log = useCombatLog();
  const priv = usePrivateState();
  const pub = usePublicState();
  const conn = useRoom();
  const opponent = pub ? resolveOpponent(pub, conn.seat) : null;
  // Bye: no fight this round (odd roster, no ghost to pull). Driven by the synced pairing, not the log
  // (which is empty for a bye), so it shows immediately instead of a stuck "Resolving combat…".
  if (opponent?.bye) {
    return (
      <div className="overlay">
        <div className="center">
          <div className="title">Bye</div>
          <div className="dim">No opponent this round — you take no damage.</div>
        </div>
      </div>
    );
  }
  if (!log || log.length === 0) {
    return (
      <div className="overlay">
        <div className="center dim">Resolving combat…</div>
      </div>
    );
  }
  const myBoard = (priv?.board ?? []).map((u) => ({ uid: u.uid, cardId: u.cardId }));
  const oppName = opponent?.name || 'Opponent';
  // Which side I'm on comes from the synced pairing, not my board uids — so an empty/wiped board no
  // longer mirrors the replay or inverts the Victory/Defeat banner (§10, decisions #65/#66). `side` is
  // authoritative and required: if the pairing hasn't synced yet (null), withhold the replay rather
  // than guess a side — CombatReplay no longer has a board-uid fallback to default to.
  const mySide = pub ? sideForSeat(pub, conn.seat) : null;
  if (mySide == null) {
    return (
      <div className="overlay">
        <div className="center dim">Resolving combat…</div>
      </div>
    );
  }
  // VS command bar data (§10). Identity + HP come from the already-synced public schema — the combat
  // log is identity-free (invariant #2), so nothing here is plumbed through it. A ghost opponent has no
  // living player row → its HP is null (the bar shows the name + "Ghost" tag, no HP).
  const myPub = pub?.players.find((p) => p.seat === conn.seat);
  const oppPub = opponent?.seat != null ? pub?.players.find((p) => p.seat === opponent.seat) : undefined;
  const header: CombatHeader = {
    round: pub?.round ?? null,
    myName: myPub?.name ?? 'You',
    myHp: myPub ? Math.max(0, myPub.hp) : null,
    oppName,
    oppHp: oppPub ? Math.max(0, oppPub.hp) : null,
    oppIsBot: !!oppPub?.isBot,
    oppGhost: !!opponent?.ghost,
  };
  return <CombatReplay log={log} myBoard={myBoard} opponentName={oppName} side={mySide} header={header} />;
}

export function App(): ReactNode {
  const pub = usePublicState();
  const conn = useRoom();

  if (!conn.connected && !conn.connecting) {
    return (
      <>
        <Landing />
        <Toasts />
      </>
    );
  }
  if (!pub) {
    return (
      <>
        <div className="center dim">Connecting…</div>
        <Toasts />
      </>
    );
  }

  let scene: ReactNode;
  switch (pub.phase) {
    case 'lobby':
      scene = <Lobby />;
      break;
    case 'starting':
      scene = (
        <div className="center">
          <div className="title">Match starting…</div>
        </div>
      );
      break;
    case 'shop':
      scene = <Shop />;
      break;
    case 'combat':
      scene = (
        <>
          <Shop />
          <CombatScene />
        </>
      );
      break;
    case 'finished':
      scene = <Results />;
      break;
    default:
      scene = <Lobby />;
  }

  return (
    <>
      {scene}
      <Toasts />
    </>
  );
}
