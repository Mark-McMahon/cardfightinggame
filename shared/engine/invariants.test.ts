// EVALS.md Invariants (cross-cutting, meta): EV-VOCAB-01 (anti-idiom law over units.ts) and
// EV-INV-CFG (config-driven-balance lint over the engine source). Both are source/data lints.
// EV-INV-CFG scans shared/engine/*.ts as TEXT at runtime; the engine may not exist yet (regenerated
// in parallel) — absence checks pass trivially and presence checks activate once the source lands.
// Design-spec §6.8, §6.9, §7.6 (D7), §12.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { UNITS } from '@cardgame/shared';

// ── §6.9 vocabulary partition (authoritative) ─────────────────────────────────────
const LIVE = {
  triggers: new Set(['battlecry', 'deathrattle', 'startOfCombat', 'endOfCombat', 'endOfTurn', 'afterFriendlyDeaths', 'onSell', 'onAttack', 'onShieldBreak', 'onSummon', 'afterFriendlyBattlecry']),
  selectors: new Set(['self', 'allAllies', 'chosenAlly', 'leftmostAlly', 'randomAlly', 'lowestStatAlly', 'highestStatAlly', 'frontEnemy', 'highestStatEnemy', 'triggerSource']),
  actions: new Set(['buffStats', 'grantKeyword', 'summon', 'dealDamage', 'giveGem', 'multiplyStats', 'plantDeathrattle', 'resetToBase', 'custom', 'destroy', 'destroyAlly', 'absorbStats', 'gainGold', 'refreshShop']),
  // `gemsThisTurnAtLeast` stays LIVE as engine vocabulary (EV-CND-01/03) though #39 left it
  // with 0 card consumers (the doublers became purchased activations) — see §6.9.
  conditions: new Set(['countAllies', 'battlecriesThisTurnAtLeast', 'gemsThisTurnAtLeast', 'deathsThisCombatAtLeast', 'tokensSummonedThisTurnAtLeast', 'alliesAtMost', 'lifetimeDeathsAtLeast']),
  auraScopes: new Set(['selfTribeAllies', 'yourBattlecries', 'yourEndOfTurn']),
  auraModifiers: new Set(['damageMultiplier', 'triggerMultiplier']),
};
// #39: gainGold/refreshShop are live ONLY inside `activated.actions` (the activated-ability
// resolver); no triggered Effect may use them — asserted below.
const ACTIVATED_ONLY_ACTIONS = new Set(['gainGold', 'refreshShop']);
const RESERVED = {
  triggers: new Set(['onPurchase', 'onDamaged', 'onPlayTribe', 'onRefresh', 'onCast', 'onSacrifice', 'onSpend', 'onTripleCreated']),
  selectors: new Set(['leftNeighbor', 'rightNeighbor', 'adjacentAllies', 'newestAlly', 'oldestAlly', 'nAllies', 'randomEnemy', 'neighborsOfTarget']),
  actions: new Set(['setStats', 'makeSpell', 'discover', 'sacrifice']),
  conditions: new Set(['hasTribe', 'hasKeyword', 'goldAtLeast', 'tierAtLeast', 'isGolden', 'isToken']),
  auraScopes: new Set(['allAllies', 'yourGems', 'yourSpells', 'shopCostTribe']),
  auraModifiers: new Set(['costReduction', 'gemValueAdd', 'spellPowerAdd', 'statBuffOnEvent']),
};
const DESTROY_MAGNITUDE = 100; // the retired `dealDamage: 999` idiom; real dealDamage amounts are ≤ ~3

describe('EV-VOCAB-01 — anti-idiom law over shipped content (units.ts)', () => {
  it('EV-VOCAB-01: every primitive a card uses is a §6.9 LIVE primitive; no reserved primitive is used', () => {
    for (const card of UNITS) {
      for (const eff of card.effects) {
        expect(LIVE.triggers.has(eff.trigger.type), `${card.id} trigger ${eff.trigger.type}`).toBe(true);
        expect(RESERVED.triggers.has(eff.trigger.type)).toBe(false);
        expect(LIVE.selectors.has(eff.target.selector), `${card.id} selector ${eff.target.selector}`).toBe(true);
        expect(RESERVED.selectors.has(eff.target.selector)).toBe(false);
        if (eff.condition) {
          expect(LIVE.conditions.has(eff.condition.kind), `${card.id} condition ${eff.condition.kind}`).toBe(true);
          expect(RESERVED.conditions.has(eff.condition.kind)).toBe(false);
        }
        for (const act of eff.actions) {
          expect(LIVE.actions.has(act.type), `${card.id} action ${act.type}`).toBe(true);
          expect(RESERVED.actions.has(act.type)).toBe(false);
          // gainGold/refreshShop are activated-only primitives (#39) — never in a triggered Effect
          expect(ACTIVATED_ONLY_ACTIONS.has(act.type), `${card.id} triggered ${act.type} (activated-only)`).toBe(false);
        }
      }
      // the activated-ability surface (#39) uses the same LIVE vocabulary
      if (card.activated) {
        expect(LIVE.selectors.has(card.activated.target.selector), `${card.id} activated selector`).toBe(true);
        for (const act of card.activated.actions) {
          expect(LIVE.actions.has(act.type), `${card.id} activated action ${act.type}`).toBe(true);
          expect(RESERVED.actions.has(act.type)).toBe(false);
        }
        const cost = card.activated.cost;
        expect(cost === 'doublerEscalating' || (typeof cost === 'number' && cost > 0), `${card.id} activated cost`).toBe(true);
      }
      for (const aura of card.auras ?? []) {
        expect(LIVE.auraScopes.has(aura.scope), `${card.id} aura scope ${aura.scope}`).toBe(true);
        expect(RESERVED.auraScopes.has(aura.scope)).toBe(false);
        expect(LIVE.auraModifiers.has(aura.modifier.kind), `${card.id} aura modifier ${aura.modifier.kind}`).toBe(true);
        expect(RESERVED.auraModifiers.has(aura.modifier.kind)).toBe(false);
      }
    }
  });

  it('EV-VOCAB-01: no dealDamage carries a "destroy" magnitude — removal must be the `destroy` action (D11)', () => {
    for (const card of UNITS) {
      for (const eff of card.effects) {
        for (const act of eff.actions) {
          if (act.type === 'dealDamage') expect(act.amount ?? 0, `${card.id} dealDamage amount`).toBeLessThan(DESTROY_MAGNITUDE);
        }
      }
    }
  });
});

// ── EV-INV-CFG: config-driven-balance lint over the (regenerated) engine source ────
function engineSources(): { file: string; text: string }[] {
  const root = fileURLToPath(new URL('.', import.meta.url)); // shared/engine
  if (!existsSync(root)) return [];
  const out: { file: string; text: string }[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = `${dir}/${name}`;
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) out.push({ file: full, text: readFileSync(full, 'utf8') });
    }
  };
  walk(root);
  return out;
}

describe('EV-INV-CFG — config-driven balance lint over engine source (D7)', () => {
  it('EV-INV-CFG: the deleted single-valued knobs attackOrderRule/firstAttackerTiebreak never appear', () => {
    for (const { file, text } of engineSources()) {
      expect(text.includes('attackOrderRule'), `${file}`).toBe(false);
      expect(text.includes('firstAttackerTiebreak'), `${file}`).toBe(false);
    }
  });

  it('EV-INV-CFG: boardCap + divineShieldNegatesPoison are SOURCED from config, not literals (activates once the engine lands)', () => {
    const srcs = engineSources();
    if (srcs.length === 0) return; // engine not regenerated yet — the presence checks run at integration
    const scope = srcs.map((s) => s.text).join('\n');
    // D7: these two must be read FROM config (their config names appear where the behavior is wired).
    // simultaneousDeaths / deathrattleOrder are "honored" BEHAVIORALLY (proven at the COMBAT interface by
    // EV-DTH-08 D1 / EV-DTH-09 D2) rather than necessarily referenced by name — so they are not string-required here.
    for (const knob of ['boardCap', 'divineShieldNegatesPoison']) {
      expect(scope.includes(knob), `engine references config knob ${knob}`).toBe(true);
    }
  });
});
