import { useStore } from './net/hooks';
import { connStore, pubStore, combatStore, toastStore } from './net/game';
import { Lobby } from './scenes/Lobby';
import { Shop } from './scenes/Shop';
import { Results } from './scenes/Results';
import { CombatReplay } from './scenes/CombatReplay';

function Toasts() {
  const toasts = useStore(toastStore);
  return (
    <div className="toast-wrap">
      {toasts.map((t) => (
        <div className="toast" key={t.id}>
          {t.message}
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const conn = useStore(connStore);
  const pub = useStore(pubStore);
  const combat = useStore(combatStore);

  let scene = <Lobby />;
  if (conn.connected && pub) {
    if (pub.phase === 'finished') scene = <Results />;
    else if (pub.phase === 'lobby') scene = <Lobby />;
    else scene = <Shop />; // shop & (brief) combat phase both show the shop board underneath
  }

  return (
    <>
      {scene}
      {combat && <CombatReplay combat={combat} />}
      <Toasts />
    </>
  );
}
