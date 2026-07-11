// EVALS Group P — EV-CVG: the Sirens POISON-COVERAGE capstone (Phase 7, decision #77). Sirens stays
// deliberately STAT-AGNOSTIC (decision #1): its scaling is measured in poison COVERAGE/REACH — more CONNECTING
// poison bodies — NOT stat totals. Venomtide grants your Sirens CLEAVE at a wide board; because a poison
// attacker's cleave carries POISON to the splashed neighbours, a wide poison board poisons the WHOLE enemy row
// per swing (reaches past the shielded front). Proves: below the width gate → no cleave; at the gate → Sirens
// gain cleave; a poison-cleaver poisons the SPLASHED neighbours (coverage); and the counter is UNCHANGED —
// divine-SHIELD walls blank each poison instance. Design-spec §6.5, §7.3, §8; #77, #1.
import { describe, it, expect } from 'vitest';
import { resolveCombat, getCard, getBreakpoint, type CombatUnit, type CombatBoard, type CombatEvent, type Keyword } from '@cardgame/shared';

let __uid = 0;
function cu(cardId: string, o: Partial<CombatUnit> = {}): CombatUnit {
  const c = getCard(cardId);
  return {
    uid: o.uid ?? `${cardId}#${++__uid}`, cardId, name: c.name, tribe: c.tribe, tier: c.tier,
    atk: o.atk ?? c.atk, hp: o.hp ?? c.hp, keywords: o.keywords ?? [...c.keywords],
    golden: false, isToken: !!c.isToken, effects: c.effects, auras: c.auras ?? [],
  };
}
const byType = <T extends CombatEvent['t']>(evs: CombatEvent[], t: T) =>
  evs.filter((e): e is Extract<CombatEvent, { t: T }> => e.t === t);

describe('EV-CVG — Venomtide poison-coverage capstone (#77, #1)', () => {
  const thr = getBreakpoint('sirens_venomtide').threshold; // wide-board gate (6)

  // a Siren board of `n` bodies: Venomtide (poison) + a witness poison Siren + filler Sirens. Returns the
  // cleave `stats`-free `keyword`-grant events on the witness (the grant fires only at the width gate).
  const cleaveGrantedTo = (n: number, witnessUid: string) => {
    const units: CombatUnit[] = [
      cu('sirens_venomtide', { hp: 100000 }),
      cu('sirens_lurefish', { uid: witnessUid, hp: 100000 }), // a poison Siren witness
    ];
    while (units.length < n) units.push(cu('sirens_sirenling', { hp: 100000 }));
    const a: CombatBoard = { units, playerTier: 6 };
    const b: CombatBoard = { units: [cu('corsairs_ironclad', { keywords: [], atk: 0, hp: 100000 })], playerTier: 6 };
    return byType(resolveCombat(a, b, `cvg:${n}`), 'keyword').filter((e) => e.unitId === witnessUid && e.keyword === 'cleave');
  };

  it('EV-CVG-01: below the width gate → NO cleave is granted (coverage stays off)', () => {
    expect(cleaveGrantedTo(thr - 1, 'W')).toHaveLength(0);
  });

  it('EV-CVG-02: at the width gate → your poison Sirens gain Cleave', () => {
    expect(cleaveGrantedTo(thr, 'W').length).toBeGreaterThanOrEqual(1);
  });

  it('EV-CVG-03: COVERAGE — a poison-cleaver poisons the SPLASHED neighbours, not just the front (reach past the front)', () => {
    // a lone poison-cleaver (as Venomtide grants) attacks a 3-wide enemy row: the cleave carries poison to BOTH
    // neighbours, so all three enemies die to poison — coverage, not just a single-target chip.
    const cleaver = cu('sirens_lurefish', { atk: 1, hp: 100, keywords: ['poison', 'cleave'] });
    const a: CombatBoard = { units: [cleaver], playerTier: 6 };
    const b: CombatBoard = {
      units: [
        cu('corsairs_ironclad', { uid: 'L', atk: 0, hp: 50, keywords: [] }),
        cu('corsairs_ironclad', { uid: 'M', atk: 0, hp: 50, keywords: [] }),
        cu('corsairs_ironclad', { uid: 'R', atk: 0, hp: 50, keywords: [] }),
      ], playerTier: 6,
    };
    const deaths = new Set(byType(resolveCombat(a, b, 'cvg-splash'), 'death').map((e) => e.unitId));
    // the front (M, the default target) + at least one splashed neighbour die to the poison-cleave (50 hp each,
    // 1 atk → only poison could kill them). Proves the poison REACHED beyond the single front body.
    expect(deaths.has('M')).toBe(true);
    expect(deaths.has('L') || deaths.has('R')).toBe(true);
  });

  it('EV-CVG-04: the counter is UNCHANGED (decision #1) — a divine SHIELD blanks the poison instance (one extra hit to break through)', () => {
    // an immortal 1-atk poison-cleaver vs a passive body: it takes ONE attack to poison an unshielded body to death,
    // but TWO against a divine-shielded one (the shield absorbs the first poison instance). Proves the counter is
    // shielding (blank the instance), not stat-racing — a full wall of shields blanks a whole poison wave.
    const hitsBeforeDeath = (defenderKeywords: Keyword[]) => {
      // S has some attack so it strikes the immortal cleaver and eats a poison RETALIATION (retaliations carry
      // no `attack` event, so count `damage` events to S — the real poison instances landing on it).
      const cleaver = cu('sirens_lurefish', { atk: 1, hp: 100000, keywords: ['poison', 'cleave'] });
      const s = cu('corsairs_ironclad', { uid: 'S', atk: 1, hp: 50, keywords: defenderKeywords });
      const evs = resolveCombat({ units: [cleaver], playerTier: 6 }, { units: [s], playerTier: 6 }, 'cvg-shield');
      let hits = 0;
      for (const e of evs) {
        if (e.t === 'damage' && e.targetId === 'S') hits++;
        if (e.t === 'death' && e.unitId === 'S') break;
      }
      return hits;
    };
    expect(hitsBeforeDeath([])).toBe(1); // no shield: poison kills on the first touch (stat-agnostic)
    expect(hitsBeforeDeath(['divineShield'])).toBe(2); // shield blanks the first poison instance → survives one extra hit
  });
});
