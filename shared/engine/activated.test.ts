// EVALS.md Group M — EV-ABL: activated abilities / the spendable gem wallet (decision #39,
// spec §6.6a; supersedes D10). Interfaces: SHOP (activateAbility/resolveTargetChoice/
// toPrivateState), INTENT (Match.applyIntent {type:'activate'}), STATE (privacy), plus the
// §11.3c spend-gated lint. Every number is READ from config (engines.tuskers / economy),
// never hardcoded.
import { describe, it, expect } from 'vitest';
import {
  Match,
  createShopSession,
  startShopPhase,
  endOfTurnPhase,
  activateAbility,
  activatedCost,
  resolveTargetChoice,
  playUnit,
  rollShop,
  boardToCombat,
  toPrivateState,
  makeInstance,
  createPool,
  lintBreakpoints,
  hasBreakpoint,
  hasSpendGated,
  spendGated,
  getCard,
  UNITS,
  economy,
  engines,
  type SeatConfig,
  type ShopSession,
} from '@cardgame/shared';

const T = engines.tuskers;
let __u = 0;
const uid = () => `A${__u++}`;
const fresh = (seed: string) => createShopSession(0, { pool: createPool(), seed });
function put(s: ShopSession, cardId: string, where: 'board' | 'bench' = 'board') {
  const inst = makeInstance(cardId, { uid: uid(), bornTurn: s.round });
  (where === 'board' ? s.board : s.bench).push(inst);
  return inst;
}
const seats = (n: number): SeatConfig[] => Array.from({ length: n }, (_, i) => ({ name: `P${i}`, isBot: true }));

describe('EV-ABL — wallet & escalating doubler cost (decision #39)', () => {
  it('EV-ABL-01: gems accrue into a persistent SPENDABLE wallet; activation deducts exactly the cost', () => {
    const s = fresh('abl01');
    startShopPhase(s);
    put(s, 'tuskers_gemsnout');
    const tusk = put(s, 'tuskers_ivorytusk');
    // accrual: giveGem feeds BOTH the wallet and the per-turn counter (wallet persists across turns)
    for (let t = 0; t < T.doubleBaseCost; t++) {
      endOfTurnPhase(s);
      startShopPhase(s);
    }
    expect(s.gems).toBe(T.doubleBaseCost * T.gemBaseValue);
    expect(s.gemsThisTurn).toBe(0); // per-turn counter reset; the WALLET carried over
    // spend: exactly the current cost
    const cost = activatedCost(s, getCard('tuskers_ivorytusk'));
    expect(cost).toBe(T.doubleBaseCost);
    const res = activateAbility(s, tusk.uid);
    expect(res.ok).toBe(true);
    expect(s.gems).toBe(T.doubleBaseCost * T.gemBaseValue - cost);
  });

  it('EV-ABL-02: the doubler price escalates PER GAME and is SHARED across all doublers (buy A → B costs more)', () => {
    const s = fresh('abl02');
    s.round = 1;
    const a = put(s, 'tuskers_ivorytusk'); // 3/4
    const b = put(s, 'tuskers_ivorylord'); // 5/7
    const c = put(s, 'tuskers_gemtitan'); // 8/8
    s.gems = 999;
    expect(activatedCost(s, getCard('tuskers_ivorytusk'))).toBe(T.doubleBaseCost);
    expect(activateAbility(s, a.uid).ok).toBe(true);
    expect(activatedCost(s, getCard('tuskers_ivorylord'))).toBe(T.doubleBaseCost + T.doubleCostStep);
    expect(activateAbility(s, b.uid).ok).toBe(true);
    expect(activatedCost(s, getCard('tuskers_gemtitan'))).toBe(T.doubleBaseCost + 2 * T.doubleCostStep);
    expect(activateAbility(s, c.uid).ok).toBe(true);
    expect(s.doublesPurchased).toBe(3);
    // per-application factor stayed capped; the escalator never resets (not even across turns)
    expect([a.atk, a.hp]).toEqual([3 * T.doublerFactor, 4 * T.doublerFactor]);
    startShopPhase(s);
    expect(activatedCost(s, getCard('tuskers_ivorytusk'))).toBe(T.doubleBaseCost + 3 * T.doubleCostStep);
    // flat-cost sinks do NOT feed the escalator
    const wright = put(s, 'tuskers_gemwright');
    s.gems = 999;
    expect(activateAbility(s, wright.uid).ok).toBe(true);
    expect(s.doublesPurchased).toBe(3);
  });

  it('EV-ABL-03: once per turn PER MINION — second activate same turn rejected (no mutation); resets next shop turn', () => {
    const s = fresh('abl03');
    startShopPhase(s);
    const tusk = put(s, 'tuskers_ivorytusk');
    s.gems = 999;
    expect(activateAbility(s, tusk.uid).ok).toBe(true);
    const [atk1, gems1, doubles1] = [tusk.atk, s.gems, s.doublesPurchased];
    const rej = activateAbility(s, tusk.uid);
    expect(rej.ok).toBe(false);
    expect(rej.error).toMatch(/already activated/);
    expect([tusk.atk, s.gems, s.doublesPurchased]).toEqual([atk1, gems1, doubles1]); // nothing mutated
    // a DIFFERENT minion may still activate this turn
    const lord = put(s, 'tuskers_ivorylord');
    expect(activateAbility(s, lord.uid).ok).toBe(true);
    // next shop turn: the per-minion gate resets, the escalated price remains
    startShopPhase(s);
    expect(activateAbility(s, tusk.uid).ok).toBe(true);
    expect(tusk.atk).toBe(3 * T.doublerFactor * T.doublerFactor); // compounds on the persistent instance
  });

  it('EV-ABL-04: the purchased double writes the PERSISTENT instance — it survives into toCombatBoard', () => {
    const s = fresh('abl04');
    startShopPhase(s);
    const tusk = put(s, 'tuskers_ivorytusk');
    s.gems = T.doubleBaseCost;
    expect(activateAbility(s, tusk.uid).ok).toBe(true);
    const combat = boardToCombat(s);
    const cu = combat.units.find((u) => u.uid === tusk.uid)!;
    expect([cu.atk, cu.hp]).toEqual([3 * T.doublerFactor, 4 * T.doublerFactor]);
  });
});

describe('EV-ABL — validation (server-authoritative; a rejection mutates nothing)', () => {
  it('EV-ABL-05: rejects unknown uid / bench unit / insufficient gems / non-activatable card; wrong phase at the Match level', () => {
    const s = fresh('abl05');
    startShopPhase(s);
    const bench = put(s, 'tuskers_ivorytusk', 'bench');
    const plain = put(s, 'tuskers_gemsnout'); // no activated ability
    const tusk = put(s, 'tuskers_ivorytusk');
    s.gems = 0;
    expect(activateAbility(s, 'nope').error).toBe('unit not found');
    expect(activateAbility(s, bench.uid).error).toBe('unit not on board');
    expect(activateAbility(s, plain.uid).error).toBe('no activated ability');
    expect(activateAbility(s, tusk.uid).error).toBe('not enough gems');
    expect(tusk.atk).toBe(3); // nothing mutated by any rejection
    expect(s.doublesPurchased).toBe(0);
    expect(s.abilityUsedThisTurn).toEqual([]);

    // wrong phase is rejected ABOVE the reducer (Match.applyIntent; the room additionally
    // gates on its own phase): before any round starts there is no shop phase.
    const m = new Match('abl05m', seats(2));
    expect(m.applyIntent(0, { type: 'activate', unitUid: 'x' })).toEqual({ ok: false, error: 'not shop phase' });
  });

  it('EV-ABL-05b: the activate INTENT routes through Match.applyIntent (accept path)', () => {
    const m = new Match('abl05b', seats(2));
    m.startRound();
    const s = m.sessions[0];
    const tusk = put(s, 'tuskers_ivorytusk');
    s.gems = T.doubleBaseCost;
    const res = m.applyIntent(0, { type: 'activate', unitUid: tusk.uid });
    expect(res.ok).toBe(true);
    expect(tusk.atk).toBe(3 * T.doublerFactor);
  });
});

describe('EV-ABL — Facetguard (chosenAlly activation → pendingTarget machinery)', () => {
  it('EV-ABL-06: activate arms pendingTarget; targetChoice applies the PERMANENT buff + Divine Shield; illegal target rejected', () => {
    const s = fresh('abl06');
    startShopPhase(s);
    const facet = put(s, 'tuskers_facetguard');
    const ally = put(s, 'tuskers_grubtusk');
    const benched = put(s, 'tuskers_gemsnout', 'bench'); // bench is NOT a legal target
    s.gems = T.facetguardCost;
    expect(activateAbility(s, facet.uid).ok).toBe(true);
    expect(s.gems).toBe(0); // spent on arming (the purchase is the activation)
    expect(s.pendingTarget).toBeTruthy();
    const priv = toPrivateState(s);
    expect(priv.pendingTarget!.legalTargets).toContain(ally.uid);
    expect(priv.pendingTarget!.legalTargets).not.toContain(benched.uid);
    // illegal pick rejected, pendingTarget survives
    expect(resolveTargetChoice(s, benched.uid).ok).toBe(false);
    expect(s.pendingTarget).toBeTruthy();
    // legal pick: permanent stat write + keyword on the persistent instance
    const [a0, h0] = [ally.atk, ally.hp];
    expect(resolveTargetChoice(s, ally.uid).ok).toBe(true);
    expect(ally.atk).toBe(a0 + T.gemDumpPayoffAtk);
    expect(ally.hp).toBe(h0 + T.gemDumpPayoffHp);
    expect(ally.keywords).toContain('divineShield');
    // persists into combat (a shop-phase persistent write, like other shop permanents)
    const cu = boardToCombat(s).units.find((u) => u.uid === ally.uid)!;
    expect(cu.atk).toBe(a0 + T.gemDumpPayoffAtk);
    expect(cu.keywords).toContain('divineShield');
    // once per turn: a second activation this turn is rejected even with gems
    s.gems = 99;
    expect(activateAbility(s, facet.uid).error).toMatch(/already activated/);
  });

  it('EV-ABL-06b (#43): a PAID pending target cannot be silently voided — playUnit is rejected while one is armed', () => {
    const s = fresh('abl06b');
    startShopPhase(s);
    const facet = put(s, 'tuskers_facetguard');
    const ally = put(s, 'tuskers_grubtusk');
    const bench = put(s, 'reefkin_brineling', 'bench'); // a chosenAlly battlecry unit on the bench
    s.gems = T.facetguardCost;
    // arm the PAID Facetguard pending (gems already spent — the purchase is the activation)
    expect(activateAbility(s, facet.uid).ok).toBe(true);
    expect(s.gems).toBe(0);
    expect(s.pendingTarget!.sourceUid).toBe(facet.uid);
    // playing another unit here would have overwritten the pending (fireBattlecry) and lost the gems.
    const rej = playUnit(s, bench.uid);
    expect(rej.ok).toBe(false);
    expect(rej.error).toMatch(/resolve pending target first/);
    // rejection mutated nothing: pending still Facetguard's, unit still benched, board unchanged
    expect(s.pendingTarget!.sourceUid).toBe(facet.uid);
    expect(s.bench.some((u) => u.uid === bench.uid)).toBe(true);
    expect(s.board.some((u) => u.uid === bench.uid)).toBe(false);
    // resolving the paid choice still lands its buff (the purchase was honored, not fizzled)
    const [a0, h0] = [ally.atk, ally.hp];
    expect(resolveTargetChoice(s, ally.uid).ok).toBe(true);
    expect(ally.atk).toBe(a0 + T.gemDumpPayoffAtk);
    expect(ally.keywords).toContain('divineShield');
    // and now that the pending is cleared, the bench unit plays normally
    expect(playUnit(s, bench.uid).ok).toBe(true);
  });
});

describe('EV-ABL — Gemwright (the ONLY gem→gold bridge, one-way, goldCap-clamped)', () => {
  it('EV-ABL-07: spend gems → gain gold; gold never exceeds goldCap; the bridge is one-way by construction', () => {
    const s = fresh('abl07');
    startShopPhase(s);
    const wright = put(s, 'tuskers_gemwright');
    s.gold = 0;
    s.gems = 2 * T.gemwrightCost;
    expect(activateAbility(s, wright.uid).ok).toBe(true);
    expect(s.gold).toBe(T.gemwrightGold);
    expect(s.gems).toBe(T.gemwrightCost);
    // goldCap clamp: at the cap the gold does not rise (the spend still happens — player choice)
    startShopPhase(s);
    s.gold = economy.goldCap;
    s.gems = T.gemwrightCost;
    expect(activateAbility(s, wright.uid).ok).toBe(true);
    expect(s.gold).toBe(economy.goldCap);
    expect(s.gems).toBe(0);
    // one-way by construction: Gemwright is the ONLY gainGold ability in the catalog, every
    // activated ability is priced in GEMS (never gold), and nothing converts gold into gems.
    const goldMakers = UNITS.filter((u) => (u.activated?.actions ?? []).some((a) => a.type === 'gainGold'));
    expect(goldMakers.map((u) => u.id)).toEqual(['tuskers_gemwright']);
    for (const card of UNITS) {
      for (const eff of card.effects) {
        expect(eff.actions.some((a) => a.type === 'gainGold'), `${card.id} triggered gainGold`).toBe(false);
      }
    }
  });
});

describe('EV-ABL — Oreseeker (gem-paid shop refresh) & RNG discipline', () => {
  it('EV-ABL-08: refresh draws the SAME seeded sequence as a paid roll (deterministic) and clears a freeze', () => {
    // A: gem refresh · B: paid roll — identical session seeds ⇒ identical offers.
    const a = fresh('abl08');
    startShopPhase(a);
    const seekerA = put(a, 'tuskers_oreseeker');
    a.frozen = true; // a refresh clears a freeze exactly like a paid roll does
    a.gems = T.oreseekerCost;
    const goldBefore = a.gold;
    expect(activateAbility(a, seekerA.uid).ok).toBe(true);
    expect(a.gold).toBe(goldBefore); // FREE — no gold charge
    expect(a.frozen).toBe(false);

    const b = fresh('abl08');
    startShopPhase(b);
    put(b, 'tuskers_oreseeker');
    b.gold = 10;
    expect(rollShop(b).ok).toBe(true);
    expect(a.shop).toEqual(b.shop); // same seed, same draw path → same offers
  });

  it('EV-ABL-08b: NON-refresh activations draw nothing from the session RNG (the roll stream is unperturbed)', () => {
    const withActivation = fresh('abl08b');
    startShopPhase(withActivation);
    const tusk = put(withActivation, 'tuskers_ivorytusk');
    withActivation.gems = T.doubleBaseCost;
    expect(activateAbility(withActivation, tusk.uid).ok).toBe(true);
    withActivation.gold = 10;
    rollShop(withActivation);

    const without = fresh('abl08b');
    startShopPhase(without);
    put(without, 'tuskers_ivorytusk');
    without.gold = 10;
    rollShop(without);
    expect(withActivation.shop).toEqual(without.shop);
  });
});

describe('EV-ABL — privacy & the spend-gated lint (§11.3c)', () => {
  it('EV-ABL-09: activated-ability state is PRIVATE-channel only (never in PublicState)', () => {
    const m = new Match('abl09', seats(2));
    m.startRound();
    const s = m.sessions[0];
    const tusk = put(s, 'tuskers_ivorytusk');
    s.gems = T.doubleBaseCost;
    m.applyIntent(0, { type: 'activate', unitUid: tusk.uid });
    const pub = JSON.stringify(m.state);
    for (const key of ['abilities', 'gems', 'doublesPurchased', 'abilityUsedThisTurn', 'abilityUses']) {
      expect(pub.includes(`"${key}"`), `public state leaks ${key}`).toBe(false);
    }
    const priv = m.privateState(0);
    expect(priv.abilities.length).toBe(1);
    expect(priv.abilities[0]).toEqual({
      uid: tusk.uid,
      cardId: 'tuskers_ivorytusk',
      cost: T.doubleBaseCost + T.doubleCostStep, // escalated CURRENT price
      used: true,
    });
    // the opponent's private push never contains seat 0's ability state
    expect(m.privateState(1).abilities).toEqual([]);
  });

  it('EV-ABL-10: §11.3c lint — doublers are SPEND-GATED (not breakpoints); registry ↔ activated is 1:1; lint green', () => {
    const lint = lintBreakpoints();
    expect(lint.errors).toEqual([]);
    expect(lint.ok).toBe(true);
    // the doubler breakpoint rows are GONE; the doublers are classified spend-gated instead
    for (const id of ['tuskers_ivorytusk', 'tuskers_ivorylord', 'tuskers_gemtitan']) {
      expect(hasBreakpoint(id), `${id} still a breakpoint`).toBe(false);
      expect(hasSpendGated(id), `${id} not spend-gated`).toBe(true);
    }
    // every card with an activated ability is registered, and vice versa
    const activatedIds = UNITS.filter((u) => u.activated).map((u) => u.id).sort();
    expect(spendGated.map((r) => r.card).sort()).toEqual(activatedIds);
    // every registered cost knob is a real positive number in the card's tribe block
    for (const row of spendGated) {
      const tribe = getCard(row.card).tribe;
      const block = (engines as unknown as Record<string, Record<string, unknown>>)[tribe];
      for (const knob of row.costKnobs) {
        expect(typeof block[knob]).toBe('number');
        expect(block[knob] as number).toBeGreaterThan(0);
      }
    }
  });
});
