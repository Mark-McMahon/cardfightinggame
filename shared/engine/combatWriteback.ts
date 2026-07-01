// Combat → persistent-board writeback fold (spec §7.5, decision #38; closes §7.6 item 5).
//
// `resolveCombat` stays PURE: it only EMITS `permanent:true` (+ `dAtk`/`dHp` deltas) on stat
// events produced by combat-fired `buffStats` actions flagged `permanent:true` in data. This
// fold is the impure half's bookkeeping, run by `Match.resolveCombatPhase` AFTER combat: it
// reads the event log and replays those deltas onto the SURVIVING persistent instances.
//
// Rules (decision #38, 2026-07-01):
//  • Buffs fold onto SURVIVORS only — a unit dead at combat end accrues nothing.
//  • A Reborn resurrection counts as surviving: the reborn unit keeps its persistent uid and
//    is listed in the per-side survivor list, so buffs it received (before or after dying)
//    fold normally. The in-combat reborn stat reset is NOT a buff and is never folded.
//  • The persistent `UnitInstance.uid` IS the writeback key (CombatUnit.uid carries it through
//    combat unchanged) — no extra id plumbing exists or is needed.
//  • A permanent buff that targeted a combat-summoned token (per-fight `sum#N` uid — no
//    persistent instance) is a DEFINED, LOGGED no-op: a log line, never a crash or mutation.
//  • Ghost boards never accrue — Match simply never folds onto a dead player's snapshot.
//  • Only the DELTA (`dAtk`/`dHp`) folds — the event's absolute atk/hp include combat damage
//    and combat-only buffs and must never touch the persistent board.
//  • Deltas fold under the §6.8 stat clamps (#38 rule h): each dAtk/dHp replays through the
//    same `applyBuff` combat's buffStats used (atk floored at 0, hp at 1, rounded), so a
//    permanent DEBUFF emitted against buffed in-combat stats can never write atk<0/hp<1
//    onto the persistent board (EV-WBK-09).
//
// The fold is deterministic (pure function of its inputs; events replayed in log order with
// the same `applyBuff` clamps combat used) and NEVER modifies the log it reads.

import type { CombatEvent, UnitInstance } from '../types';
import { applyBuff } from './effects';

export interface WritebackApplication {
  uid: string;
  dAtk: number;
  dHp: number;
}

export interface WritebackResult {
  /** Per-event deltas applied onto persistent instances, in log order. */
  applied: WritebackApplication[];
  /** Permanent-buff target uids with no persistent instance (combat-summoned tokens): no-ops. */
  tokenNoOps: string[];
  /** Human-readable session/match log lines describing what the fold did (incl. token no-ops). */
  logLines: string[];
}

/** Which side each uid fought on, derived from the log itself: the combatStart snapshots
 *  seed both lines; combat-summoned units inherit their summoner's (owner's) side. */
function sideOfUnits(log: readonly CombatEvent[]): Map<string, 'a' | 'b'> {
  const side = new Map<string, 'a' | 'b'>();
  for (const ev of log) {
    if (ev.t === 'combatStart') {
      for (const u of ev.a.units) side.set(u.uid, 'a');
      for (const u of ev.b.units) side.set(u.uid, 'b');
    } else if (ev.t === 'summon') {
      const s = side.get(ev.ownerId);
      if (s) for (const uid of ev.unitIds) side.set(uid, s);
    }
  }
  return side;
}

/**
 * Fold the log's permanent stat buffs for one side onto `board` (mutated in place),
 * restricted to `survivors` (that side's living uids at combat end —
 * `combatEnd.survivorsA/B`). Events belonging to the OTHER side are ignored (each side
 * folds its own board). Returns what happened; never touches `log`.
 */
export function foldPermanentBuffs(
  log: readonly CombatEvent[],
  board: UnitInstance[],
  survivors: readonly string[],
  side: 'a' | 'b',
): WritebackResult {
  const survivorSet = new Set(survivors);
  const unitSide = sideOfUnits(log);
  const result: WritebackResult = { applied: [], tokenNoOps: [], logLines: [] };

  for (const ev of log) {
    if (ev.t !== 'stats' || ev.permanent !== true) continue;
    if (unitSide.get(ev.unitId) !== side) continue; // the other side's business
    const dAtk = ev.dAtk ?? 0;
    const dHp = ev.dHp ?? 0;
    const inst = board.find((u) => u.uid === ev.unitId);
    if (!inst) {
      // Combat-summoned token (or otherwise non-persistent uid): defined, logged no-op (#38).
      result.tokenNoOps.push(ev.unitId);
      result.logLines.push(
        `writeback: permanent buff (+${dAtk}/+${dHp}) on combat-summoned ${ev.unitId} discarded — tokens have no persistent instance`,
      );
      continue;
    }
    if (!survivorSet.has(ev.unitId)) {
      // Died (and did not reborn): permanent buffs do not accrue to the fallen (#38).
      result.logLines.push(
        `writeback: permanent buff (+${dAtk}/+${dHp}) on ${ev.unitId} dropped — did not survive combat`,
      );
      continue;
    }
    const s = applyBuff({ atk: inst.atk, hp: inst.hp }, dAtk, dHp);
    inst.atk = s.atk;
    inst.hp = s.hp;
    result.applied.push({ uid: ev.unitId, dAtk, dHp });
    result.logLines.push(`writeback: ${ev.unitId} keeps +${dAtk}/+${dHp} (permanent, → ${s.atk}/${s.hp})`);
  }

  return result;
}
