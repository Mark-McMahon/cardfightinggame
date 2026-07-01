// EVALS.md Group G — playUnit battlecry / chosenAlly targeting / D5 fizzle / Pattern A&B
// (interfaces: SHOP + INTENT). Written to intent (design-spec §4.2, §4.7 D5, §6.9 audit patterns).
import { describe, it, expect } from 'vitest';
import {
  Match,
  createShopSession,
  playUnit,
  sellUnit,
  resolveTargetChoice,
  makeInstance,
  createPool,
  getCard,
  type ShopSession,
} from '@cardgame/shared';

let __u = 0;
const uid = () => `T${__u++}`;
function put(s: ShopSession, cardId: string, where: 'board' | 'bench' = 'board') {
  const inst = makeInstance(cardId, { uid: uid(), bornTurn: s.round });
  (where === 'board' ? s.board : s.bench).push(inst);
  return inst;
}

describe('EV-ECO — battlecry / targeting / fizzle / patterns (SHOP + INTENT)', () => {
  it('EV-ECO-11: playUnit fires a targeted battlecry → pendingTarget → resolveTargetChoice bakes the result', () => {
    const s = createShopSession(0, { pool: createPool(), seed: 'int11' });
    s.round = 1;
    const ally = put(s, 'reefkin_brineling', 'board'); // a reefkin candidate (2/2)
    const caster = put(s, 'reefkin_tidecaller', 'bench'); // battlecry: chosenAlly reefkin excludeSelf +1/+1
    const res = playUnit(s, caster.uid);
    expect(res.ok).toBe(true);
    expect(s.pendingTarget).toBeTruthy();
    expect(s.pendingTarget!.legalTargets).toContain(ally.uid);
    const [a0, h0] = [ally.atk, ally.hp];
    const rc = resolveTargetChoice(s, ally.uid);
    expect(rc.ok).toBe(true);
    expect(s.pendingTarget).toBeNull();
    const card = getCard('reefkin_tidecaller');
    const bc = card.effects[0].actions[0];
    expect(ally.atk).toBe(a0 + (bc.atk ?? 0));
    expect(ally.hp).toBe(h0 + (bc.hp ?? 0));
  });

  it('EV-ECO-11: the same flow via Match.applyIntent (playUnit + targetChoice intents)', () => {
    const m = new Match('int11b', [{ name: 'A', isBot: true }, { name: 'B', isBot: true }]);
    m.startRound();
    const s = m.sessions[0];
    const ally = put(s, 'reefkin_brineling', 'board');
    const caster = put(s, 'reefkin_tidecaller', 'bench');
    expect(m.applyIntent(0, { type: 'playUnit', unitUid: caster.uid }).ok).toBe(true);
    const priv = m.privateState(0);
    expect(priv.pendingTarget).toBeTruthy();
    expect(m.applyIntent(0, { type: 'targetChoice', targetUid: ally.uid }).ok).toBe(true);
    expect(m.privateState(0).pendingTarget).toBeNull();
    expect(ally.atk).toBeGreaterThan(2);
  });

  it('EV-ECO-15 (D5): a chosenAlly battlecry with no legal target fizzles but still counts as a battlecry', () => {
    const s = createShopSession(0, { pool: createPool(), seed: 'int15' });
    s.round = 1;
    // Tidecaller needs a *reefkin* ally (excludeSelf); with none on the board there is no legal target.
    const caster = put(s, 'reefkin_tidecaller', 'bench');
    const res = playUnit(s, caster.uid);
    expect(res.ok).toBe(true);
    expect(s.pendingTarget).toBeNull(); // fizzled — no prompt
    expect(s.battlecriesThisTurn).toBe(1); // but the act still counts (count the act, not the resolution)
  });

  it('EV-ECO-16: Tidebinder (Pattern A) — afterFriendlyBattlecry buffs Reefkin +1/+1 on each subsequent battlecry', () => {
    const s = createShopSession(0, { pool: createPool(), seed: 'int16a' });
    s.round = 1;
    const binder = put(s, 'reefkin_tidebinder', 'board'); // afterFriendlyBattlecry: Reefkin +1/+1 permanent
    const witness = put(s, 'reefkin_brineling', 'board'); // a Reefkin witness (2/2)
    const [wa, wh] = [witness.atk, witness.hp];
    // play a NON-reefkin battlecry (Brackentide) → Tidebinder's afterFriendlyBattlecry fires
    const bc = put(s, 'wildkin_brackentide', 'bench');
    playUnit(s, bc.uid);
    expect(witness.atk).toBe(wa + 1);
    expect(witness.hp).toBe(wh + 1);
  });

  it('EV-ECO-16: onSell patterns — Tuskmonger (+2 gems) and Quartermaster (highest-Atk Corsair +2/+2)', () => {
    // Tuskmonger: +2 gems per friendly body sold
    const s = createShopSession(0, { pool: createPool(), seed: 'int16b' });
    s.round = 1;
    put(s, 'tuskers_tuskmonger', 'board');
    const g0 = s.gems;
    sellUnit(s, put(s, 'wildkin_brambleling', 'bench').uid);
    expect(s.gems).toBe(g0 + 2);

    // Quartermaster: highest-Attack Corsair +2/+2 (permanent) per body sold
    const s2 = createShopSession(1, { pool: createPool(), seed: 'int16c' });
    s2.round = 1;
    const qm = put(s2, 'corsairs_quartermaster', 'board'); // corsair 4/4 (highest-atk corsair)
    put(s2, 'corsairs_swab', 'board'); // corsair 2/1 (lower atk)
    const [qa, qh] = [qm.atk, qm.hp];
    sellUnit(s2, put(s2, 'wildkin_brambleling', 'bench').uid); // sell a non-corsair body → onSell fires
    expect(qm.atk).toBe(qa + 2);
    expect(qm.hp).toBe(qh + 2);
  });
});
