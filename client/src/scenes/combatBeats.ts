import { UNIT_BY_ID } from '@cardgame/shared';
import type { CombatEvent, Keyword, TribeId, UnitCard } from '@cardgame/shared';

// ─────────────────────────────────────────────────────────────────────────────
// Pure beat-segmentation for the combat replay (rework of design-spec §16.6).
//
// The flat CombatEvent[] is segmented into causal *steps* — never "all-at-once". This
// module is deliberately render-free (no React/Framer) so the segmentation that makes
// combat legible is unit-testable, mirroring the engine's "determinism is the priority
// test" ethos. The scene (CombatReplay.tsx) consumes these Steps and animates them.
//
// The legibility questions each Step answers:
//   1. WHO hits WHOM   — `attack` + `focus` pair attacker↔defender, dimming the rest.
//   2. WHAT got buffed — `buffs[]` carry the per-unit delta and the `sourceId`.
//   3. PACING          — `weight` scales beat duration; trivial events batch, swings hold.
//   4. CAUSALITY       — strike → death → triggered-buff are separate, ordered Steps.
// (In-combat permanence is NOT a real mechanic — combat buffs never persist past the fight,
//  so all combat buffs are this-combat-only; there is no perm/temp distinction to show.)
// ─────────────────────────────────────────────────────────────────────────────

export interface UnitVM {
  uid: string;
  cardId?: string;
  name: string;
  tribe: TribeId;
  tier: number;
  atk: number;
  hp: number;
  maxHp: number;
  keywords: Keyword[];
  golden: boolean;
}

export interface DamageFx {
  targetId: string;
  amount: number;
}
export interface BuffFx {
  targetId: string;
  dAtk: number;
  dHp: number;
  sourceId?: string;
}

export type StepKind = 'intro' | 'strike' | 'buff' | 'gain' | 'death' | 'summon' | 'end';

/** A keyword ability conferred mid-combat (e.g. Spinefish deathrattle → Poison). */
export interface GainFx {
  targetId: string;
  keyword: Keyword;
  sourceId?: string;
}

export interface Step {
  kind: StepKind;
  a: UnitVM[];
  b: UnitVM[];
  attack?: { attackerId: string; defenderId: string; side: 'a' | 'b' };
  damages: DamageFx[];
  buffs: BuffFx[];
  gains: GainFx[];
  summonedIds: string[];
  shieldBreaks: string[];
  poisoned: string[];
  cleaver?: string;
  /** uids to keep bright; everything else dims. null = no dimming (whole board active). */
  focus: string[] | null;
  caption?: string;
  breakpoint: boolean;
  deathsA: number;
  deathsB: number;
  /** impact weight → beat duration. ~0.6 trivial, ~1 normal, 2+ held. */
  weight: number;
  result: 'VICTORY' | 'DEFEAT' | 'TIE' | null;
}

interface Draft {
  kind: StepKind;
  attack?: Step['attack'];
  damages: DamageFx[];
  buffs: BuffFx[];
  gains: GainFx[];
  summonedIds: string[];
  shieldBreaks: string[];
  poisoned: string[];
  cleaver?: string;
  caption?: string;
  breakpoint: boolean;
  buffSource?: string;
  gainSource?: string;
  deathInfo: Array<{ side?: 'a' | 'b'; hadDr: boolean; tier: number }>;
}

/** Resolve a summoned/reborn unit's display data from its uid (tokens: `cardId#n@side`;
 *  reborn appends `~r` to the original uid). Mirrors the engine's uid scheme. */
export function resolveSummoned(uid: string, units: Map<string, UnitVM>): UnitVM {
  let baseUid = uid;
  while (baseUid.endsWith('~r')) baseUid = baseUid.slice(0, -2);
  const base = units.get(baseUid);
  if (base) {
    const card = UNIT_BY_ID[base.cardId ?? ''];
    return {
      uid,
      cardId: base.cardId,
      name: base.name,
      tribe: base.tribe,
      tier: base.tier,
      atk: card ? card.atk * (base.golden ? 2 : 1) : base.atk,
      hp: 1,
      maxHp: 1,
      keywords: base.keywords.filter((k) => k !== 'reborn'),
      golden: base.golden,
    };
  }
  const cardId = uid.split('#')[0];
  const card = UNIT_BY_ID[cardId];
  if (card) {
    return {
      uid,
      cardId,
      name: card.name,
      tribe: card.tribe,
      tier: card.tier,
      atk: card.atk,
      hp: card.hp,
      maxHp: card.hp,
      keywords: [...card.keywords],
      golden: false,
    };
  }
  return { uid, name: 'Summon', tribe: 'wildkin', tier: 1, atk: 1, hp: 1, maxHp: 1, keywords: [], golden: false };
}

function computeWeight(d: Draft): number {
  switch (d.kind) {
    case 'intro':
      return 2.0;
    case 'strike': {
      const maxDmg = d.damages.reduce((m, x) => Math.max(m, x.amount), 0);
      if (d.damages.length === 0 && d.shieldBreaks.length === 0) return 0.6; // whiff
      let w = 0.85 + Math.min(maxDmg / 8, 0.7);
      if (d.shieldBreaks.length) w += 0.3;
      return w;
    }
    case 'death': {
      const n = d.deathInfo.length;
      let w = 0.75 + 0.2 * n;
      if (d.deathInfo.some((x) => x.hadDr || x.tier >= 4)) w += 0.6; // a death that matters
      if (d.breakpoint) w = Math.max(w, 2.1);
      return Math.min(w, 2.3);
    }
    case 'buff': {
      const n = d.buffs.length;
      // A buff is information-dense — give even a single-target buff room to read (the chip now
      // holds to beat-end, so dwell == reading time). Board-wide = a real swing → hold longer.
      const w = n >= 3 ? 2.2 : 1.5;
      return Math.min(w, 2.4);
    }
    case 'gain':
      // Gaining an ability (e.g. Poison) is a real state change — hold it long enough to read,
      // a touch more when it spreads to several units.
      return Math.min(1.3 + 0.2 * Math.max(0, d.gains.length - 1), 2.0);
    case 'summon':
      return Math.min(1.0 + 0.2 * d.summonedIds.length, 1.7);
    default:
      return 1.0;
  }
}

/** Death-counter thresholds the viewer can actually *cash in* (avenge trigger, a deaths
 *  breakpoint condition, or a deaths-gated aura). Crossing one marks a breakpoint beat —
 *  the "why" behind a sudden swing (decision #27, deaths axis). */
export function collectDeathThresholds(cards: Array<UnitCard | undefined>): Set<number> {
  const out = new Set<number>();
  for (const card of cards) {
    if (!card) continue;
    for (const ef of card.effects) {
      if (ef.trigger.type === 'afterFriendlyDeaths' && ef.trigger.threshold) out.add(ef.trigger.threshold);
      if (ef.condition?.kind === 'deathsThisCombatAtLeast' && ef.condition.value) out.add(ef.condition.value);
    }
    for (const au of card.auras ?? []) {
      if (au.activeWhen?.counter === 'deaths') out.add(au.activeWhen.threshold);
    }
  }
  return out;
}

/** Does this card consume the deaths counter? (avenge trigger, a deaths breakpoint, or a
 *  deaths-gated aura — e.g. Mortarch / Pack Mother / Bone Colossus / Pale Lich.) Static
 *  catalog inspection only — never board-aware (decision #28). */
export function consumesDeaths(cardId?: string): boolean {
  if (!cardId) return false;
  const card = UNIT_BY_ID[cardId];
  if (!card) return false;
  const fromEffects = card.effects.some(
    (ef) => ef.trigger.type === 'afterFriendlyDeaths' || ef.condition?.kind === 'deathsThisCombatAtLeast',
  );
  const fromAuras = (card.auras ?? []).some(
    (au) => au.activeWhen?.counter === 'deaths' || au.activeWhen?.counter === 'revenantDeaths',
  );
  return fromEffects || fromAuras;
}

export function buildSteps(events: CombatEvent[], viewer: 'a' | 'b'): Step[] {
  const steps: Step[] = [];
  const units = new Map<string, UnitVM>();
  const sideOf = new Map<string, 'a' | 'b'>();
  const removed = new Set<string>();
  const order: string[] = [];
  let deathsA = 0;
  let deathsB = 0;
  let winner: 'a' | 'b' | 'tie' | undefined;
  let pendingCause: string | undefined;
  let viewerThresholds = new Set<number>();
  let cur: Draft | null = null;

  const nameOf = (uid: string): string => units.get(uid)?.name ?? 'a unit';
  const lineOf = (s: 'a' | 'b'): UnitVM[] =>
    order
      .filter((uid) => sideOf.get(uid) === s && !removed.has(uid))
      .map((uid) => {
        const u = units.get(uid)!;
        return { ...u, keywords: [...u.keywords] };
      });

  const newDraft = (kind: StepKind): Draft => ({
    kind,
    damages: [],
    buffs: [],
    gains: [],
    summonedIds: [],
    shieldBreaks: [],
    poisoned: [],
    breakpoint: false,
    deathInfo: [],
  });

  const flush = (): void => {
    if (!cur) return;
    const a = lineOf('a');
    const b = lineOf('b');
    const present = new Set([...a, ...b].map((u) => u.uid));
    let focus: string[] | null = null;
    if (cur.kind === 'strike' && cur.attack) {
      focus = [cur.attack.attackerId, cur.attack.defenderId].filter((uid) => present.has(uid));
    } else if (cur.kind === 'buff') {
      const f = new Set<string>();
      for (const bf of cur.buffs) {
        if (present.has(bf.targetId)) f.add(bf.targetId);
        if (bf.sourceId && present.has(bf.sourceId)) f.add(bf.sourceId);
      }
      focus = [...f];
    } else if (cur.kind === 'gain') {
      const f = new Set<string>();
      for (const g of cur.gains) {
        if (present.has(g.targetId)) f.add(g.targetId);
        if (g.sourceId && present.has(g.sourceId)) f.add(g.sourceId);
      }
      focus = [...f];
    }
    steps.push({
      kind: cur.kind,
      a,
      b,
      attack: cur.attack,
      damages: cur.damages,
      buffs: cur.buffs,
      gains: cur.gains,
      summonedIds: cur.summonedIds,
      shieldBreaks: cur.shieldBreaks,
      poisoned: cur.poisoned,
      cleaver: cur.cleaver,
      focus,
      caption: cur.caption,
      breakpoint: cur.breakpoint,
      deathsA,
      deathsB,
      weight: computeWeight(cur),
      result: null,
    });
    cur = null;
  };

  for (const e of events) {
    switch (e.t) {
      case 'combatStart': {
        for (const side of ['a', 'b'] as const) {
          for (const u of e[side].units) {
            units.set(u.uid, {
              uid: u.uid,
              cardId: u.cardId,
              name: u.name,
              tribe: u.tribe,
              tier: u.tier,
              atk: u.atk,
              hp: u.hp,
              maxHp: u.hp,
              keywords: [...u.keywords],
              golden: u.golden,
            });
            sideOf.set(u.uid, side);
            order.push(u.uid);
          }
        }
        viewerThresholds = collectDeathThresholds(e[viewer].units.map((u) => UNIT_BY_ID[u.cardId]));
        cur = newDraft('intro');
        cur.caption = 'Battle begins';
        flush();
        break;
      }
      case 'attack': {
        flush();
        cur = newDraft('strike');
        cur.attack = { attackerId: e.attackerId, defenderId: e.defenderId, side: e.side };
        pendingCause = undefined;
        break;
      }
      case 'damage': {
        if (!cur || cur.kind !== 'strike') {
          flush();
          cur = newDraft('strike'); // an effect-sourced hit with no attack frame
        }
        if (e.shieldBroken) {
          cur.shieldBreaks.push(e.targetId);
        } else {
          const t = units.get(e.targetId);
          if (t) t.hp = Math.max(0, t.hp - e.amount);
          if (e.amount > 0) cur.damages.push({ targetId: e.targetId, amount: e.amount });
        }
        break;
      }
      case 'keyword': {
        if (e.gained) {
          // A unit GAINED a keyword ability (e.g. Spinefish deathrattle → Poison). Its own
          // captioned beat so it's unmistakable WHICH card got it, and we add the keyword to
          // the unit's VM so its card shows the ability icon for the rest of the replay.
          const u = units.get(e.unitId);
          if (u && !u.keywords.includes(e.keyword)) u.keywords.push(e.keyword);
          const src = e.sourceId ?? '';
          if (!cur || cur.kind !== 'gain' || cur.gainSource !== src) {
            flush();
            cur = newDraft('gain');
            cur.gainSource = src;
            cur.caption = pendingCause ?? (e.sourceId ? nameOf(e.sourceId) : undefined);
          }
          cur.gains.push({ targetId: e.unitId, keyword: e.keyword, sourceId: e.sourceId });
        } else if (e.keyword === 'divineShield') {
          const u = units.get(e.unitId);
          if (u) u.keywords = u.keywords.filter((k) => k !== 'divineShield');
          // shield-break is recorded from the paired `damage{shieldBroken}` to avoid double count
        } else if (e.keyword === 'poison') {
          // A poison hit doomed this unit (it will die in the death pass) — affliction, not a gain.
          if (cur) cur.poisoned.push(e.unitId);
        } else if (e.keyword === 'cleave') {
          if (cur && cur.kind === 'strike') cur.cleaver = e.unitId;
        } else if (e.keyword === 'reborn') {
          pendingCause = `${nameOf(e.unitId)} reborn`;
        }
        break;
      }
      case 'stats': {
        const t = units.get(e.unitId);
        if (!t) break;
        const dAtk = e.atk - t.atk;
        const dHp = e.hp - t.hp;
        t.atk = e.atk;
        t.hp = e.hp;
        t.maxHp = Math.max(t.maxHp, e.hp);
        const src = e.sourceId ?? '';
        // A buff is a *consequence* — flush whatever caused it first, then batch consecutive
        // stat changes that share a source into one beat (board-wide buff = 1 beat).
        if (!cur || cur.kind !== 'buff' || cur.buffSource !== src) {
          flush();
          cur = newDraft('buff');
          cur.buffSource = src;
          cur.caption = pendingCause ?? (src ? nameOf(src) : undefined);
        }
        cur.buffs.push({ targetId: e.unitId, dAtk, dHp, sourceId: e.sourceId });
        break;
      }
      case 'summon': {
        flush();
        cur = newDraft('summon');
        const owner = e.ownerId as 'a' | 'b';
        for (const uid of e.unitIds) {
          if (!units.has(uid)) {
            units.set(uid, resolveSummoned(uid, units));
            sideOf.set(uid, owner);
            order.push(uid);
          }
          cur.summonedIds.push(uid);
        }
        cur.caption = pendingCause;
        break;
      }
      case 'deathrattle': {
        pendingCause = `${nameOf(e.unitId)} deathrattle`;
        break;
      }
      case 'death': {
        if (!cur || cur.kind !== 'death') {
          flush();
          cur = newDraft('death');
          pendingCause = undefined;
        }
        const uid = e.unitId;
        const side = sideOf.get(uid);
        const u = units.get(uid);
        const hadDr = !!(u?.cardId && UNIT_BY_ID[u.cardId]?.effects.some((ef) => ef.trigger.type === 'deathrattle'));
        cur.deathInfo.push({ side, hadDr, tier: u?.tier ?? 1 });
        removed.add(uid);
        if (side === 'a') deathsA += 1;
        else if (side === 'b') deathsB += 1;
        const vCount = viewer === 'a' ? deathsA : deathsB;
        if (side === viewer && viewerThresholds.has(vCount)) {
          cur.breakpoint = true;
          cur.caption = 'Breakpoint reached';
        }
        break;
      }
      case 'combatEnd': {
        flush();
        winner = e.winner;
        break;
      }
      default:
        break;
    }
  }
  flush();

  if (steps.length > 0) {
    const result = winner ? (winner === 'tie' ? 'TIE' : winner === viewer ? 'VICTORY' : 'DEFEAT') : null;
    steps[steps.length - 1].result = result;
  }
  return steps;
}
