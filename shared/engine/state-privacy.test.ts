// EVALS.md EV-INV-PRIV — the two-channel privacy split (interface: STATE). PublicState (synced to
// ALL) must carry NO private data (shop/bench/board/gold/gems/hand/opponent combat log); private
// data lives only on the owner's privateState push. Design-spec §9.3, invariant 3.
import { describe, it, expect } from 'vitest';
import { Match, type SeatConfig } from '@cardgame/shared';

const seats = (n: number): SeatConfig[] =>
  Array.from({ length: n }, (_, i) => ({ name: `P${i}`, isBot: true }));

describe('EV-INV-PRIV — public/private channel split', () => {
  it('EV-INV-PRIV: PublicState contains no shop/bench/board/gold/gems/hand/combat-log; private data only on the owner push', () => {
    const m = new Match('priv', seats(2));
    m.startRound();
    // populate a session with private state: buy a unit, gems, a private combat log
    m.applyIntent(0, { type: 'buy', shopIndex: 0 });
    m.sessions[0].gems = 5;
    m.sessions[0].lastCombatLog = [{ t: 'combatEnd', winner: 'a', survivors: [], damageToLoser: 7 }];

    // PublicState shape: only the documented public keys (§9.3)
    const PUBLIC_KEYS = ['roomCode', 'phase', 'round', 'timer', 'players', 'pairings', 'hostSeat', 'botFill', 'winnerSeat'];
    expect(Object.keys(m.state).sort()).toEqual([...PUBLIC_KEYS].sort());

    // each public player carries only the public per-player fields
    const PLAYER_KEYS = ['seat', 'name', 'hp', 'tier', 'alive', 'placement', 'isBot', 'connected', 'ready'];
    for (const p of m.state.players) expect(Object.keys(p).sort()).toEqual([...PLAYER_KEYS].sort());

    // no private field KEY appears ANYWHERE in the serialized public state (match `"key":`, not values —
    // e.g. the phase value "shop" is legitimately public)
    const pub = JSON.stringify(m.state);
    for (const key of ['gold', 'gems', 'shop', 'bench', 'board', 'hand', 'lastCombatLog', 'discover', 'pendingTarget', 'log', 'baseIncome']) {
      expect(pub.includes(`"${key}":`), `public state leaks key ${key}`).toBe(false);
    }

    // the private channel (owner-only) DOES carry the private data
    const priv = m.privateState(0);
    for (const key of ['gold', 'gems', 'shop', 'bench', 'board', 'discover', 'pendingTarget', 'lastCombatLog', 'log', 'tierUpCost', 'rerollCost']) {
      expect(key in priv, `private state missing ${key}`).toBe(true);
    }
    expect(priv.gems).toBe(5);
    expect(priv.bench.length).toBe(1); // the bought unit is visible only to its owner
    expect(priv.lastCombatLog).not.toBeNull();
  });

  it('EV-INV-PRIV: no opponent private info is reachable from PublicState (no per-seat private blob)', () => {
    const m = new Match('priv2', seats(2));
    m.startRound();
    m.applyIntent(1, { type: 'buy', shopIndex: 0 }); // seat 1 buys something private
    // seat 1's bought unit / shop must not be observable in the shared public state
    const pub = JSON.stringify(m.state);
    const boughtCardId = m.privateState(1).bench[0].cardId;
    expect(pub.includes(boughtCardId)).toBe(false);
  });
});
