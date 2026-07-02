// Board construction helpers for the micro-sim and the web harness. A board is a list of card
// entries → a CombatBoard, built through the real `makeInstance`/`toCombatBoard` transforms so the
// combat engine sees exactly what a live shop board would produce (effects + auras + keywords).

import {
  makeInstance,
  toCombatBoard,
  createShopSession,
  endOfTurnPhase,
  activateAbility,
  activatedCost,
  boardToCombat,
  getCard,
  type CombatBoard,
  type UnitInstance,
} from '@cardgame/shared';

export interface BoardEntry {
  cardId: string;
  count?: number;
  atk?: number; // stat override (else the card's printed stats)
  hp?: number;
  golden?: boolean;
}

export function buildBoard(entries: BoardEntry[], playerTier = 6): CombatBoard {
  const insts: UnitInstance[] = [];
  let seq = 0;
  for (const e of entries) {
    for (let k = 0; k < (e.count ?? 1); k++) {
      insts.push(
        makeInstance(e.cardId, { uid: `b${seq++}`, atk: e.atk, hp: e.hp, golden: e.golden, bornTurn: 0 }),
      );
    }
  }
  return toCombatBoard(insts, playerTier);
}

/**
 * Assemble a board through the REAL shop paths for `turns` shop turns — the only honest way to
 * reach the exponential Tusker ceiling (nothing is stat-tuned; the engine computes the
 * compounding). Each simulated turn: (shop phase) greedily BUY every affordable escalating
 * doubler activation (decision #39 — the purchased line, biggest doubler first), then
 * (end of turn) `endOfTurnPhase` fires the generators' `giveGem` into the wallet. Only the
 * escalating doublers are auto-activated here; the flat-cost utility sinks are exercised by
 * the tuskers tests directly (they need target/decision context a growth loop shouldn't fake).
 */
export function assembleGrown(cardIds: string[], turns: number, playerTier = 6): CombatBoard {
  const s = createShopSession(0, { seed: 'assemble' });
  s.round = 1;
  for (const id of cardIds) {
    if (getCard(id).isToken) continue;
    s.board.push(makeInstance(id, { uid: `a${s.uidSeq++}`, bornTurn: 0 }));
  }
  for (let t = 0; t < turns; t++) {
    // a fresh shop turn (startShopPhase would reset these):
    s.gemsThisTurn = 0;
    s.abilityUsedThisTurn = [];
    // shop phase: greedy doubler purchases (biggest carry first; once per turn per minion).
    for (;;) {
      const doublers = s.board
        .filter((u) => getCard(u.cardId).activated?.cost === 'doublerEscalating')
        .filter((u) => !s.abilityUsedThisTurn.includes(u.uid))
        .filter((u) => s.gems >= activatedCost(s, getCard(u.cardId)))
        .sort((a, b) => b.atk + b.hp - (a.atk + a.hp));
      if (doublers.length === 0) break;
      if (!activateAbility(s, doublers[0].uid).ok) break;
    }
    // end of shop turn: generators feed the wallet.
    endOfTurnPhase(s);
  }
  s.tier = playerTier;
  return boardToCombat(s);
}
