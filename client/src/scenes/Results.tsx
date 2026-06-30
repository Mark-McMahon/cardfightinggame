import { useStore } from '../net/hooks';
import { pubStore, seatStore } from '../net/game';

export function Results() {
  const pub = useStore(pubStore);
  const seat = useStore(seatStore);
  if (!pub) return null;
  const ranked = [...pub.players].sort((a, b) => (a.placement || 99) - (b.placement || 99));
  return (
    <div className="app col">
      <div className="title">Final standings</div>
      <div className="panel col">
        {ranked.map((p) => (
          <div className={`row ${p.seat === seat ? 'me' : ''}`} key={p.seat} style={{ padding: '4px 0' }}>
            <span style={{ width: 36, fontWeight: 800, color: p.placement === 1 ? 'var(--gold)' : 'var(--dim)' }}>
              {p.placement === 1 ? '🏆' : `#${p.placement}`}
            </span>
            <span style={{ flex: 1 }}>
              {p.name} {p.isBot ? <span className="tag">BOT</span> : ''} {p.seat === seat ? <span className="tag">YOU</span> : ''}
            </span>
            <span className="dim">Tier {p.tier}</span>
          </div>
        ))}
      </div>
      <button className="primary" onClick={() => location.reload()}>
        New game
      </button>
    </div>
  );
}
