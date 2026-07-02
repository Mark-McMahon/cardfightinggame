// EVALS.md Group D (auras) — the SHOP-phase trigger multipliers exercised through the reducer
// (Grovecaller endOfTurn summon-scope, Echo Choir battlecry). The combat-interface data-shape pins
// live in auras.test.ts; here we assert the reducer BEHAVIOR (design-spec §6.4, §6.8 caps).
import { describe, it, expect } from 'vitest';
import {
  createShopSession,
  startShopPhase,
  endOfTurnPhase,
  playUnit,
  activateAbility,
  makeInstance,
  createPool,
  battlecryMultiplier,
  endOfTurnSummonMultiplier,
  engines,
  getBreakpoint,
  UNIT_BY_ID,
  type ShopSession,
  type AuraBearer,
  type TribeId,
} from '@cardgame/shared';

let __u = 0;
const uid = () => `T${__u++}`;
function put(s: ShopSession, cardId: string, where: 'board' | 'bench' = 'board') {
  const inst = makeInstance(cardId, { uid: uid(), bornTurn: s.round });
  (where === 'board' ? s.board : s.bench).push(inst);
  return inst;
}
const bearer = (cardId: string): AuraBearer => {
  const c = UNIT_BY_ID[cardId];
  return { tribe: c.tribe as TribeId, auras: c.auras ?? [] };
};
const thornpups = (s: ShopSession) => s.board.filter((u) => u.cardId === 'wildkin_thornpup');

describe('EV-AUR — trigger multipliers at the SHOP interface', () => {
  it('EV-AUR-03: the trigger multipliers are non-stacking and capped (N copies → max = cap, never sum/product)', () => {
    const eCap = engines.wildkin.endOfTurnTriggerMultiplierCap; // 2
    const bCap = engines.reefkin.battlecryTriggerMultiplierCap; // 2
    // Grovecaller (yourEndOfTurn, summon-scoped): 1, 2, 3 copies all yield the (capped) max, never a product.
    expect(endOfTurnSummonMultiplier([bearer('wildkin_grovecaller')])).toBe(eCap);
    expect(endOfTurnSummonMultiplier([bearer('wildkin_grovecaller'), bearer('wildkin_grovecaller')])).toBe(eCap);
    expect(
      endOfTurnSummonMultiplier([bearer('wildkin_grovecaller'), bearer('wildkin_grovecaller'), bearer('wildkin_grovecaller')]),
    ).toBe(eCap);
    // Echo Choir (yourBattlecries): same non-stacking cap.
    expect(battlecryMultiplier([bearer('reefkin_echochoir')])).toBe(bCap);
    expect(battlecryMultiplier([bearer('reefkin_echochoir'), bearer('reefkin_echochoir')])).toBe(bCap);
    // no auras → neutral multiplier of 1
    expect(endOfTurnSummonMultiplier([])).toBe(1);
    expect(battlecryMultiplier([])).toBe(1);
  });

  it('EV-AUR-04: Grovecaller multiplies ONLY end-of-turn summon actions — not giveGem, not a purchased double (#39)', () => {
    const per = engines.tuskers.gemBaseValue;
    const factor = engines.tuskers.doublerFactor; // ×2 purchased doubler (decision #39)
    // Board: Grovecaller + 3 Gemsnouts (giveGem) + Ivorytusk (purchased-double activated ability).
    const s = createShopSession(0, { pool: createPool(), seed: 'aur04a' });
    startShopPhase(s);
    put(s, 'wildkin_grovecaller');
    put(s, 'tuskers_gemsnout');
    put(s, 'tuskers_gemsnout');
    put(s, 'tuskers_gemsnout');
    const tusk = put(s, 'tuskers_ivorytusk'); // 3/4
    const [ta, th] = [tusk.atk, tusk.hp];
    endOfTurnPhase(s);
    // giveGem NOT multiplied by Grovecaller: exactly 3 gems (3 generators × gemBaseValue), not 6
    expect(s.gemsThisTurn).toBe(3 * per);
    expect(s.gems).toBe(3 * per);
    // a PURCHASED double is outside the endOfTurn aura's reach entirely (#39): with Grovecaller
    // on board, one bought activation applies exactly ×factor, never ×factor².
    startShopPhase(s);
    s.gems = engines.tuskers.doubleBaseCost;
    expect(activateAbility(s, tusk.uid).ok).toBe(true);
    expect(tusk.atk).toBe(ta * factor);
    expect(tusk.hp).toBe(th * factor);

    // Contrast: a SUMMON end-of-turn action IS multiplied by Grovecaller.
    const s2 = createShopSession(1, { pool: createPool(), seed: 'aur04b' });
    startShopPhase(s2);
    put(s2, 'wildkin_grovecaller');
    put(s2, 'wildkin_brambleling'); // endOfTurn: summon tokensPerTurn Thornpups
    endOfTurnPhase(s2);
    expect(thornpups(s2).length).toBe(engines.wildkin.tokensPerTurn * engines.wildkin.endOfTurnTriggerMultiplierCap);
  });

  it('EV-AUR-05 (Phase 4 rebalance, decision #50): Echo Choir amplifies battlecry OUTPUT but no longer counts the ECHOED battlecry toward breakpoints', () => {
    const mult = engines.reefkin.battlecryTriggerMultiplier; // 2
    const cbp = getBreakpoint('reefkin_chorustide'); // battlecries≥2 → board +atk/+hp

    // (A) COUNTER: with Echo Choir on board, ONE Chorus Tide play increments battlecriesThisTurn by
    // exactly 1 (the real play) — NOT by the multiplier. So it does NOT reach its own ≥2 gate from
    // the echoed copy: the board buff does NOT fire (the closed double-dip).
    const s = createShopSession(0, { pool: createPool(), seed: 'aur05a' });
    s.round = 1;
    put(s, 'reefkin_echochoir', 'board');
    const witness = put(s, 'wildkin_brambleling', 'board'); // 1/3 witness
    const [wa, wh] = [witness.atk, witness.hp];
    playUnit(s, put(s, 'reefkin_chorustide', 'bench').uid);
    expect(s.battlecriesThisTurn).toBe(1); // echoed copy does NOT inflate the count (was 2 pre-#50)
    expect(witness.atk).toBe(wa); // gate ≥2 not reached from the echo → no buff
    expect(witness.hp).toBe(wh);

    // (B) OUTPUT still doubles: a SECOND real battlecry crosses the ≥2 gate (count 1→2), and the
    // gated payoff then resolves `multiplier` times — the ×2 amplifies the buff MAGNITUDE, proving
    // the doubler still works, only the COUNT that gates OTHER payoffs stopped double-counting.
    playUnit(s, put(s, 'reefkin_chorustide', 'bench').uid);
    expect(s.battlecriesThisTurn).toBe(2); // two real plays, +1 each
    expect(witness.atk).toBe(wa + cbp.atk! * mult); // ×2 OUTPUT preserved
    expect(witness.hp).toBe(wh + cbp.hp! * mult);

    // Contrast without Echo Choir: one Chorus Tide play → battlecries == 1 < 2 → no buff (unchanged).
    const s2 = createShopSession(1, { pool: createPool(), seed: 'aur05b' });
    s2.round = 1;
    const w2 = put(s2, 'wildkin_brambleling', 'board');
    const [wa2, wh2] = [w2.atk, w2.hp];
    playUnit(s2, put(s2, 'reefkin_chorustide', 'bench').uid);
    expect(s2.battlecriesThisTurn).toBe(1);
    expect(w2.atk).toBe(wa2);
    expect(w2.hp).toBe(wh2);
  });
});
