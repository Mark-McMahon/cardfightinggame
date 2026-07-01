// EVALS.md Group D (auras) — passive modifiers.
// EV-AUR-01/02 are COMBAT-observable (damageMultiplier / Pale Lich activeWhen) and tested through
// resolveCombat. EV-AUR-03/04/05 concern the SHOP-phase trigger multipliers (Grovecaller endOfTurn,
// Echo Choir battlecry) — NOT firable at the COMBAT interface — so here they pin the config/data
// invariants the caps rest on; the reducer-side firing is a SHOP-interface eval (later pass).
// Design-spec §6.4, §6.8, §6.9.
import { describe, it, expect } from 'vitest';
import {
  resolveCombat,
  getCard,
  engines,
  UNIT_BY_ID,
  type CombatUnit,
  type CombatBoard,
  type CombatEvent,
  type AuraSpec,
} from '@cardgame/shared';

let __uid = 0;
function cu(cardId: string, overrides: Partial<CombatUnit> = {}): CombatUnit {
  const c = getCard(cardId);
  return {
    uid: `${cardId}#${++__uid}`,
    cardId,
    name: c.name,
    tribe: c.tribe,
    tier: c.tier,
    atk: c.atk,
    hp: c.hp,
    keywords: [...c.keywords],
    golden: false,
    isToken: !!c.isToken,
    effects: c.effects,
    auras: c.auras ?? [],
    ...overrides,
  };
}
function board(units: CombatUnit[], playerTier = 1): CombatBoard {
  return { units, playerTier };
}
function byType<T extends CombatEvent['t']>(evs: CombatEvent[], t: T) {
  return evs.filter((e): e is Extract<CombatEvent, { t: T }> => e.t === t);
}
const SEED = 'seed-aur';
const vanilla = (atk: number, hp: number, o: Partial<CombatUnit> = {}) =>
  cu('corsairs_ironclad', { keywords: [], effects: [], atk, hp, ...o });

// an always-active revenant damageMultiplier aura (no activeWhen gate) for the combine test
const dmgAura = (value: number, stacks: boolean): AuraSpec => ({
  scope: 'selfTribeAllies',
  modifier: { kind: 'damageMultiplier', value, tribe: 'revenants' },
  stacks,
});

describe('EV-AUR — auras', () => {
  it('EV-AUR-01: non-stacking auras take the MAX; stacking auras MULTIPLY then are capped (§6.8)', () => {
    const cap = engines.revenants.undeadDamageAmpCap; // 2 — the ceiling the combine is capped to
    const runWith = (stacks: boolean) => {
      const attacker = cu('revenants_wisp', { atk: 5, hp: 100000, effects: [] }); // revenant striker
      const c1 = cu('revenants_wisp', { atk: 0, hp: 100000, effects: [], auras: [dmgAura(2, stacks)] });
      const c2 = cu('revenants_wisp', { atk: 0, hp: 100000, effects: [], auras: [dmgAura(2, stacks)] });
      const evs = resolveCombat(board([attacker, c1, c2]), board([vanilla(0, 100000)]), SEED);
      return byType(evs, 'damage').filter((e) => e.sourceId === attacker.uid).map((e) => e.amount);
    };
    // non-stacking: two ×2 copies take the MAX → ×2, never additive/multiplicative (not 20)
    const nonStack = runWith(false);
    expect(nonStack).toContain(5 * 2);
    expect(nonStack).not.toContain(20);
    // stacking: two ×2 copies MULTIPLY (×4) then the combine is CAPPED → never exceeds atk·cap, reaches it.
    // (With value == cap the multiply is capped back to the max, so the observable is the cap clause.)
    const stacked = runWith(true);
    expect(stacked.every((a) => a <= 5 * cap)).toBe(true);
    expect(stacked).toContain(5 * cap);
  });

  it('EV-AUR-02: Pale Lich damage amp is inert below the revenantDeaths threshold and active at/after it', () => {
    const amp = engines.revenants.undeadDamageAmp;
    const threshold = engines.revenants.undeadDamageThreshold; // 3
    expect(UNIT_BY_ID['revenants_palelich'].auras![0].activeWhen).toEqual({ counter: 'revenantDeaths', threshold });

    const lich = cu('revenants_palelich'); // 4/6
    const chaff = [cu('revenants_wisp'), cu('revenants_wisp'), cu('revenants_wisp')];
    const evs = resolveCombat(board([...chaff, lich]), board([vanilla(6, 9999)]), SEED);

    const revUids = new Set(chaff.map((u) => u.uid));
    let seen = 0;
    let activeIdx = -1;
    evs.forEach((e, i) => {
      if (e.t === 'death' && revUids.has(e.unitId)) {
        seen += 1;
        if (seen === threshold) activeIdx = i;
      }
    });
    expect(activeIdx).toBeGreaterThanOrEqual(0); // the fixture crosses the breakpoint
    evs.forEach((e, i) => {
      if (e.t === 'damage' && e.sourceId === lich.uid) {
        if (i > activeIdx) expect(e.amount).toBe(lich.atk * amp); // amped once active
        else expect(e.amount).toBe(lich.atk); // inert below threshold
      }
    });
  });

  it('EV-AUR-03: the trigger-multiplier auras are non-stacking and equal their cap (2 copies → max = cap)', () => {
    // SHOP-phase auras — the numeric cap is what this eval pins; reducer firing is a SHOP eval.
    const grove = UNIT_BY_ID['wildkin_grovecaller'].auras![0];
    expect(grove.scope).toBe('yourEndOfTurn');
    expect(grove.modifier.kind).toBe('triggerMultiplier');
    expect(grove.stacks).toBe(false); // two copies take the max, never sum
    expect(grove.modifier.value).toBe(engines.wildkin.endOfTurnTriggerMultiplier);
    expect(engines.wildkin.endOfTurnTriggerMultiplier).toBeLessThanOrEqual(engines.wildkin.endOfTurnTriggerMultiplierCap);

    const echo = UNIT_BY_ID['reefkin_echochoir'].auras![0];
    expect(echo.scope).toBe('yourBattlecries');
    expect(echo.modifier.kind).toBe('triggerMultiplier');
    expect(echo.stacks).toBe(engines.reefkin.battlecryDoublerStacks);
    expect(echo.stacks).toBe(false);
    expect(echo.modifier.value).toBe(engines.reefkin.battlecryTriggerMultiplier);
    expect(engines.reefkin.battlecryTriggerMultiplier).toBeLessThanOrEqual(engines.reefkin.battlecryTriggerMultiplierCap);
  });

  it('EV-AUR-04: Grovecaller is a yourEndOfTurn triggerMultiplier (summon-scoped per §6.8), never a damage/gem amp', () => {
    // The "applies only to summon end-of-turn actions" restriction is a code-only rule (§6.8); its
    // reducer behavior is a SHOP eval. Here we pin the aura SHAPE that rule keys off.
    const grove = UNIT_BY_ID['wildkin_grovecaller'].auras![0];
    expect(grove.scope).toBe('yourEndOfTurn');
    expect(grove.modifier.kind).toBe('triggerMultiplier');
    // Grovecaller itself carries no combat effect that the amp could touch
    expect(UNIT_BY_ID['wildkin_grovecaller'].effects.length).toBe(0);
  });

  it('EV-AUR-05: Echo Choir doubles battlecries and its doubled triggers still count (yourBattlecries scope)', () => {
    // "doubling increments battlecriesThisTurn by the multiplier up front" is a SHOP-counter rule; the
    // combat-interface pin is the aura shape + that the multiplier is the (capped) battlecry doubler.
    const echo = UNIT_BY_ID['reefkin_echochoir'].auras![0];
    expect(echo.scope).toBe('yourBattlecries');
    expect(echo.modifier.value).toBe(engines.reefkin.battlecryTriggerMultiplier);
    expect(echo.modifier.value).toBeLessThanOrEqual(engines.reefkin.battlecryTriggerMultiplierCap);
  });
});
