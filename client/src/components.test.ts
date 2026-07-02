import { describe, it, expect } from 'vitest';
import type { PublicState, Pairing } from '@cardgame/shared';
import { sideForSeat, resolveOpponent, arcVars } from './components';

// sideForSeat is the fix for the empty/wiped-board replay mirror (§10): the viewer's combat side must
// come from the synced pairing, NEVER from their board uids (which are empty for a wiped board and so
// can't identify the side). resolveCombatPhase always resolves aSeat as side 'a' and bSeat as 'b'.

function pub(pairings: Pairing[]): PublicState {
  return {
    roomCode: 'R', phase: 'combat', round: 3, timer: 0, hostSeat: 0, botFill: false, winnerSeat: -1,
    players: [], pairings,
  };
}

describe('sideForSeat — combat side from the pairing, not the board', () => {
  it("aSeat fights as 'a' and bSeat as 'b'", () => {
    const p = pub([{ aSeat: 2, bSeat: 5, ghost: false, bye: false }]);
    expect(sideForSeat(p, 2)).toBe('a');
    expect(sideForSeat(p, 5)).toBe('b');
  });

  it("the live player is side 'a' in a ghost fight", () => {
    const p = pub([{ aSeat: 3, bSeat: -1, ghost: true, ghostName: 'Ghost', bye: false }]);
    expect(sideForSeat(p, 3)).toBe('a');
  });

  it('returns null for a bye or a seat with no pairing (no fight to orient)', () => {
    expect(sideForSeat(pub([{ aSeat: 4, bSeat: -1, ghost: false, bye: true }]), 4)).toBeNull();
    expect(sideForSeat(pub([{ aSeat: 0, bSeat: 1, ghost: false, bye: false }]), 7)).toBeNull();
    expect(sideForSeat(pub([]), null)).toBeNull();
  });

  it('agrees with resolveOpponent: whichever seat is NOT me is the opponent', () => {
    const p = pub([{ aSeat: 1, bSeat: 6, ghost: false, bye: false }]);
    // seat 6 is on side 'b'; its opponent is seat 1 (side 'a') — the two derivations must not disagree.
    expect(sideForSeat(p, 6)).toBe('b');
    expect(resolveOpponent(p, 6)?.seat).toBe(1);
  });
});

// arcVars is the shared board-arc layout helper (§10) used by BOTH the shop board and the Results
// winning-board — the row bows symmetrically about its centre (centre slot lifted least, wings most).
describe('arcVars — symmetric distance-from-centre for the board arc', () => {
  const dist = (i: number, n: number) => (arcVars(i, n) as Record<string, number>)['--dist'];
  it('centres a 7-wide board: 3,2,1,0,1,2,3', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((i) => dist(i, 7))).toEqual([3, 2, 1, 0, 1, 2, 3]);
  });
  it('a lone unit sits flat (dist 0), and even boards straddle the centre', () => {
    expect(dist(0, 1)).toBe(0);
    expect([dist(0, 2), dist(1, 2)]).toEqual([0.5, 0.5]);
  });
});
