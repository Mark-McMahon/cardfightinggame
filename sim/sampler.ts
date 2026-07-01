// Adversarial board sampler (spec §16, WEB-FRAMEWORK "the sampler is load-bearing"). The
// anti-degeneracy floor is only as strong as the diversity of opponents it samples, so the sample
// is GENERATED from real play — full 8-bot matches through the SAME Match + BotAgent — never
// hand-authored. `matchPlayPool()` harvests the exact pre-combat boards that fought (every stat is
// what the real shop path produced). Boards are tagged by dominant tribe + tech tag for diversity
// selection and for proving the floor bites (strip a counter → a line becomes a universal winner).

import {
  Match,
  Rng,
  endOfTurnPhase,
  boardToCombat,
  getCard,
  bots,
  type CombatBoard,
  type TribeId,
} from '@cardgame/shared';
import { BotAgent, driveBotTurn } from '@cardgame/server/bots';
import { makeSeatSpecs } from './harness';

export type TechTag = 'poison' | 'shield' | 'cleave' | 'reborn' | 'wide' | 'tall' | 'baseline';

export interface SampleBoard {
  id: string;
  board: CombatBoard;
  tribe: TribeId | null;
  tags: TechTag[];
}

export function dominantTribe(board: CombatBoard): TribeId | null {
  const counts = new Map<TribeId, number>();
  for (const u of board.units) {
    if (getCard(u.cardId).isToken) continue;
    counts.set(u.tribe, (counts.get(u.tribe) ?? 0) + 1);
  }
  let best: TribeId | null = null;
  let bestN = 0;
  for (const [t, n] of counts) if (n > bestN) ((best = t), (bestN = n));
  return best;
}

const WIDE_UNITS = 6;
const TALL_STAT = 25; // a single body this big is a "tall" carry

export function techTagsOf(board: CombatBoard): TechTag[] {
  const tags = new Set<TechTag>();
  let maxStat = 0;
  for (const u of board.units) {
    if (u.keywords.includes('poison')) tags.add('poison');
    if (u.keywords.includes('divineShield')) tags.add('shield');
    if (u.keywords.includes('cleave')) tags.add('cleave');
    if (u.keywords.includes('reborn')) tags.add('reborn');
    maxStat = Math.max(maxStat, u.atk, u.hp);
  }
  if (board.units.length >= WIDE_UNITS) tags.add('wide');
  if (maxStat >= TALL_STAT) tags.add('tall');
  if (tags.size === 0) tags.add('baseline');
  return [...tags];
}

/** The primary tech tag used for diversity bucketing (strongest-signal first). */
export function primaryTag(tags: TechTag[]): TechTag {
  const order: TechTag[] = ['tall', 'poison', 'cleave', 'shield', 'reborn', 'wide', 'baseline'];
  for (const t of order) if (tags.includes(t)) return t;
  return 'baseline';
}

export interface SamplerOpts {
  matches: number;
  seedBase: string;
}

/** Run full bot matches and harvest each living seat's pre-combat board every round. Deterministic
 *  in `seedBase`. Returns raw sample boards (before diversity selection). */
export function matchPlayPool(opts: SamplerOpts): SampleBoard[] {
  const seats = makeSeatSpecs(bots.difficultyPresets);
  const out: SampleBoard[] = [];
  for (let mi = 0; mi < opts.matches; mi++) {
    const seed = `${opts.seedBase}:${mi}`;
    const m = new Match(seed, seats.map((s) => ({ name: s.name, isBot: true })), 'SMP');
    const agents = seats.map((s, i) => new BotAgent(s.weights, new Rng(`${seed}:bot:${i}`)));
    let round = 0;
    while (!m.isFinished() && round < 60) {
      round++;
      m.startRound();
      for (const p of m.state.players) {
        if (!p.alive) continue;
        driveBotTurn(agents[p.seat], () => m.privateState(p.seat), () => m.state, (i) => m.applyIntent(p.seat, i));
      }
      for (const p of m.state.players) if (p.alive) endOfTurnPhase(m.sessions[p.seat]);
      for (const p of m.state.players) {
        if (!p.alive) continue;
        const s = m.sessions[p.seat];
        if (s.board.length === 0) continue;
        const board = boardToCombat(s);
        out.push({
          id: `${seed}:r${round}:s${p.seat}`,
          board,
          tribe: dominantTribe(board),
          tags: techTagsOf(board),
        });
      }
      m.resolveCombatPhase();
    }
  }
  return out;
}

/** Diversity selection: keep the strongest board per (dominant tribe × primary tech tag) bucket —
 *  the adversarial peak of each region — plus low-tech baselines. "Strongest" = most total stats. */
export function selectRealPeaks(pool: SampleBoard[]): SampleBoard[] {
  const byBucket = new Map<string, SampleBoard>();
  const stat = (b: SampleBoard) => b.board.units.reduce((s, u) => s + u.atk + u.hp, 0);
  for (const b of pool) {
    if (b.tags.includes('baseline')) continue;
    const key = `${b.tribe}:${primaryTag(b.tags)}`;
    const cur = byBucket.get(key);
    if (!cur || stat(b) > stat(cur)) byBucket.set(key, b);
  }
  return [...byBucket.values()];
}

export function selectBaselines(pool: SampleBoard[], limit = 8): SampleBoard[] {
  return pool.filter((b) => b.tags.includes('baseline')).slice(0, limit);
}
