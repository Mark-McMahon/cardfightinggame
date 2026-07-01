// Coherence gate (spec §16 Part B, WEB-FRAMEWORK). Static scans over the catalog modelling a
// DEVELOPED board (2–4 slots occupied ⇒ ~3 free slots). Each scanner must be clean on the shipped
// catalog AND bite its synthetic control (proving it is not vacuous). Kept lightweight and pure.

import { economy, breakpoints, UNITS, type UnitCard } from '@cardgame/shared';

const FREE_SLOTS = economy.boardCap - 4; // ≈3 free slots on a developed board (WEB-FRAMEWORK)

// ── B1/B2 cap-truncation / losing-only ────────────────────────────────────────────────────────
// A summon payoff that puts more bodies than the free slots on a developed board is silently
// truncated by boardCap and pays off MOST when behind (empty slots) — the pre-rework Grovelord.

export interface CoherenceIssue {
  card: string;
  rule: string;
  detail: string;
}

export function capTruncationViolations(cards: UnitCard[] = UNITS): CoherenceIssue[] {
  const out: CoherenceIssue[] = [];
  for (const card of cards) {
    for (const e of card.effects) {
      // one-shot start/deathrattle summons that scale a guardian are fine; the redline is a
      // repeatable/large summon that overflows a developed board.
      for (const a of e.actions) {
        if (a.type !== 'summon') continue;
        const count = a.summonCount ?? 1;
        if (count > FREE_SLOTS) {
          out.push({
            card: card.id,
            rule: 'cap-truncation',
            detail: `${e.trigger.type} summon ${count} > ${FREE_SLOTS} free slots (truncated on a developed board; pays off most when behind)`,
          });
        }
      }
    }
  }
  return out;
}

// ── B4 board-count family ───────────────────────────────────────────────────────────────────
// Every "if you control N+ minions" payoff (countAllies / alliesAtStart) is enumerated; the recorded
// call is "grandfather all as intentional density rewards" — each must be a real commitment
// (threshold ≥ 4) that buffs existing bodies / fizzles gracefully.

const DENSITY_MIN_THRESHOLD = 4;

export interface BoardCountCard {
  card: string;
  threshold: number;
  source: 'condition' | 'breakpoint';
}

export function boardCountFamily(cards: UnitCard[] = UNITS): BoardCountCard[] {
  const out: BoardCountCard[] = [];
  for (const card of cards) {
    for (const e of card.effects) {
      if (e.condition?.kind === 'countAllies') {
        out.push({ card: card.id, threshold: e.condition.value ?? 0, source: 'condition' });
      }
    }
  }
  for (const b of breakpoints.list) {
    if (b.counter === 'alliesAtStart') out.push({ card: b.card, threshold: b.threshold, source: 'breakpoint' });
  }
  return out;
}

export function boardCountFamilyViolations(cards: UnitCard[] = UNITS): CoherenceIssue[] {
  return boardCountFamily(cards)
    .filter((c) => c.threshold < DENSITY_MIN_THRESHOLD)
    .map((c) => ({
      card: c.card,
      rule: 'board-count-family',
      detail: `density payoff threshold ${c.threshold} < ${DENSITY_MIN_THRESHOLD} (trivially-on, not a real commitment)`,
    }));
}

// ── B6 shield / poison density ────────────────────────────────────────────────────────────────
// Poison must stay viable in a shield-heavy meta: the biggest poison package must out-number the
// shields a 2-tribe splash can pile on one carry, so "shield negates poison" never crowds poison
// out against tall/doubled lines.

const SPLASH_SHIELD_PILE = 2; // shields a splash can stack on one carry (WEB-FRAMEWORK B6)

export interface ShieldPoisonCensus {
  poisonSources: string[];
  shieldSources: string[];
  ok: boolean;
}

export function shieldPoisonCensus(cards: UnitCard[] = UNITS): ShieldPoisonCensus {
  const poison: string[] = [];
  const shield: string[] = [];
  for (const card of cards) {
    if (card.isToken) continue;
    const hasPoisonKw = card.keywords.includes('poison');
    const grantsPoison = card.effects.some((e) => e.actions.some((a) => a.type === 'grantKeyword' && a.keyword === 'poison'));
    if (hasPoisonKw || grantsPoison) poison.push(card.id);
    const hasShieldKw = card.keywords.includes('divineShield');
    const grantsShield = card.effects.some((e) => e.actions.some((a) => a.type === 'grantKeyword' && a.keyword === 'divineShield'));
    if (hasShieldKw || grantsShield) shield.push(card.id);
  }
  return { poisonSources: poison, shieldSources: shield, ok: poison.length > SPLASH_SHIELD_PILE };
}

export interface CoherenceReport {
  ok: boolean;
  capTruncation: CoherenceIssue[];
  boardCount: CoherenceIssue[];
  shieldPoison: ShieldPoisonCensus;
}

export function coherenceReport(): CoherenceReport {
  const capTruncation = capTruncationViolations();
  const boardCount = boardCountFamilyViolations();
  const shieldPoison = shieldPoisonCensus();
  return {
    ok: capTruncation.length === 0 && boardCount.length === 0 && shieldPoison.ok,
    capTruncation,
    boardCount,
    shieldPoison,
  };
}
