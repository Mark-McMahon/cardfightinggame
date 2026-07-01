// Board construction helpers for the micro-sim and the web harness. A board is a list of card
// entries → a CombatBoard, built through the real `makeInstance`/`toCombatBoard` transforms so the
// combat engine sees exactly what a live shop board would produce (effects + auras + keywords).

import {
  makeInstance,
  toCombatBoard,
  createShopSession,
  endOfTurnPhase,
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
 * Assemble a board through the REAL shop `endOfTurnPhase` path for `turns` shop turns — the only
 * honest way to reach the exponential Tusker ceiling (nothing is stat-tuned; the engine computes
 * the compounding). `carriers` are the doubler(s)/units that persist and compound; `generators`
 * feed gemsThisTurn each turn so the doubler's breakpoint fires.
 */
export function assembleGrown(cardIds: string[], turns: number, playerTier = 6): CombatBoard {
  const s = createShopSession(0, { seed: 'assemble' });
  s.round = 1;
  for (const id of cardIds) {
    if (getCard(id).isToken) continue;
    s.board.push(makeInstance(id, { uid: `a${s.uidSeq++}`, bornTurn: 0 }));
  }
  for (let t = 0; t < turns; t++) {
    s.gemsThisTurn = 0; // a fresh shop turn (startShopPhase would reset this)
    endOfTurnPhase(s);
  }
  s.tier = playerTier;
  return boardToCombat(s);
}
