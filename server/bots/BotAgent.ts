import {
  type Match,
  type PlayerState,
  type UnitCard,
  type TribeId,
  type Axis,
  type Difficulty,
  type BotWeights,
  getCard,
  hasBreakpoint,
  economy,
  bots as botsCfg,
  currentTierUpCost,
} from '@cardgame/shared';

// Heuristic, tunable, tribe-aware bot (spec §10). Pure decision logic with NO
// Colyseus dependency, so the macro-simulator reuses it verbatim. It drives a
// player's shop turn by emitting the same intents a human client would.
//
// Round-6 (spec §16): the bot now values the static axis glyph, breakpoint payoffs, and
// bridge cards, and can commit to a TWO-tribe splash — so the macro-sim can actually
// assemble splash builds and measure breakpoint reachability (§16.7b). All weights live
// in config/bots.ts; nothing balance-bearing is hardcoded here.

/** Each tribe's home manufactured-event axis (spec §16.1). */
const TRIBE_HOME_AXIS: Partial<Record<TribeId, Axis>> = {
  wildkin: 'swarm',
  revenants: 'deaths',
  reefkin: 'battlecries',
};

/** What the bot is building toward this turn: its committed tribe(s) + target axes. */
interface BuildFocus {
  tribes: Set<TribeId>;
  axes: Set<Axis>;
  /** Splash only: the under-represented committed tribe to top up (so the splash is real). */
  underTribe: TribeId | null;
  /** Breakpoint cards already owned — a 2nd copy isn't build-defining, so the breakpoint
   *  bonus only applies to NEW breaks (drives the bot to collect distinct payoffs, the
   *  cross-tribe reachability §16.7b depends on). */
  ownedBreakCards: Set<string>;
}

function keywordBonus(card: UnitCard): number {
  let b = 0;
  for (const k of card.keywords) {
    if (k === 'poison') b += 3;
    else if (k === 'divineShield') b += 2;
    else if (k === 'cleave') b += 2;
    else if (k === 'reborn') b += 2;
    else if (k === 'taunt') b += 1;
  }
  return b;
}

function synergyBonus(card: UnitCard): number {
  let b = 0;
  if (card.auras && card.auras.length) b += 4; // amplifiers / doublers are build-defining
  for (const e of card.effects) {
    if (e.trigger.type === 'battlecry' || e.trigger.type === 'deathrattle') b += 1;
    if (e.trigger.type === 'endOfTurn' || e.trigger.type === 'onSummon') b += 1.5;
    if (e.trigger.type === 'afterFriendlyDeaths') b += 1;
  }
  return b;
}

function scoreCard(card: UnitCard, focus: BuildFocus, weights: BotWeights): number {
  let s = card.atk + card.hp + keywordBonus(card) + synergyBonus(card) + card.tier * 0.5;
  // Axis alignment: reward cards that feed the axis/axes this build is chasing.
  if (card.axis && card.axis.length && focus.axes.size) {
    const matches = card.axis.filter((a) => focus.axes.has(a)).length;
    if (matches > 0) {
      s += weights.axisValue * matches;
      if (card.axis.length >= 2) s += weights.bridgeValue; // multi-axis bridge glue
    }
  }
  // Owning a ⭐ breakpoint payoff is build-defining — but only the FIRST of each (a 2nd
  // copy is just stats + a triple, not a new axis to reach).
  if (hasBreakpoint(card.id) && !focus.ownedBreakCards.has(card.id)) s += weights.breakpointValue;
  // Splash: top up the lagging committed tribe so the second breakpoint stays reachable.
  if (card.tribe === focus.underTribe) s += weights.splashBalanceBonus;
  // On-(any committed)-tribe synergy multiplier.
  if (focus.tribes.has(card.tribe)) s *= weights.synergyValue;
  return s;
}

function ownedCopies(p: PlayerState, cardId: string): number {
  return [...p.bench, ...p.board].filter((u) => u.cardId === cardId && !u.golden).length;
}

function commitTribe(p: PlayerState, round: number, weights: BotWeights): TribeId | null {
  if (round < weights.tribeCommitTurn && p.board.length + p.bench.length < 3) return null;
  const counts = new Map<TribeId, number>();
  for (const u of [...p.board, ...p.bench]) {
    const t = getCard(u.cardId).tribe;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  let best: TribeId | null = null;
  let bestN = 0;
  for (const [t, n] of counts) {
    if (n > bestN) {
      bestN = n;
      best = t;
    }
  }
  return best;
}

function unitScore(p: PlayerState, uid: string): number {
  const u = [...p.board, ...p.bench].find((x) => x.uid === uid);
  if (!u) return 0;
  return u.atk + u.hp;
}

export interface BotOptions {
  difficulty?: Difficulty;
  /**
   * The build this bot commits to (used by the macro-sim to cover the design space):
   * one tribe = a mono stack, two tribes = a cross-tribe splash. Omit to let the bot
   * commit organically to whatever it draws (the original behavior).
   */
  committedTribes?: TribeId[];
}

export class BotAgent {
  readonly weights: BotWeights;
  readonly difficulty: Difficulty;
  readonly committedTribes?: TribeId[];
  constructor(opts: BotOptions | Difficulty = 'medium') {
    const o: BotOptions = typeof opts === 'string' ? { difficulty: opts } : opts;
    this.difficulty = o.difficulty ?? 'medium';
    this.committedTribes = o.committedTribes?.length ? o.committedTribes : undefined;
    this.weights = botsCfg.difficultyPresets[this.difficulty];
  }

  /** Resolve the build focus (committed tribes + target axes) for this turn. */
  private focus(p: PlayerState, round: number): BuildFocus {
    const tribes = this.committedTribes ?? (() => {
      const t = commitTribe(p, round, this.weights);
      return t ? [t] : [];
    })();
    const tribeSet = new Set(tribes);
    const axes = new Set<Axis>();
    for (const t of tribes) {
      const a = TRIBE_HOME_AXIS[t];
      if (a) axes.add(a);
    }
    const ownedBreakCards = new Set<string>();
    for (const u of [...p.board, ...p.bench]) if (hasBreakpoint(u.cardId)) ownedBreakCards.add(u.cardId);

    let underTribe: TribeId | null = null;
    if (tribes.length === 2 && this.weights.splashBalanceBonus > 0) {
      const owned = new Map<TribeId, number>();
      for (const u of [...p.board, ...p.bench]) {
        const t = getCard(u.cardId).tribe;
        if (tribeSet.has(t)) owned.set(t, (owned.get(t) ?? 0) + 1);
      }
      const [t1, t2] = tribes;
      const c1 = owned.get(t1) ?? 0;
      const c2 = owned.get(t2) ?? 0;
      if (c1 !== c2) underTribe = c1 < c2 ? t1 : t2;
    }
    return { tribes: tribeSet, axes, underTribe, ownedBreakCards };
  }

  /** Resolve any pending battlecry target / discover, picking the best option. */
  private resolveInteractions(match: Match, seat: number, focus: BuildFocus): void {
    let p = match.player(seat)!;
    let guard = 0;
    while ((p.pendingTarget || p.discover) && guard++ < 12) {
      if (p.pendingTarget) {
        // pick the legal target with the highest current stats (the carry)
        const best = [...p.pendingTarget.legalTargets].sort((a, b) => unitScore(p, b) - unitScore(p, a))[0];
        match.applyIntent(seat, { type: 'targetChoice', targetUid: best });
      } else if (p.discover) {
        let bestIdx = 0;
        let bestScore = -Infinity;
        p.discover.options.forEach((cardId, i) => {
          const sc = scoreCard(getCard(cardId), focus, this.weights);
          if (sc > bestScore) {
            bestScore = sc;
            bestIdx = i;
          }
        });
        match.applyIntent(seat, { type: 'discoverPick', optionIndex: bestIdx });
      }
      p = match.player(seat)!;
    }
  }

  /** Pick the best shop slot to buy; returns -1 if nothing worth buying now. */
  private pickBuy(p: PlayerState, focus: BuildFocus): { index: number; score: number } {
    let bestIdx = -1;
    let bestScore = 0;
    p.shop.forEach((cardId, i) => {
      const card = getCard(cardId);
      let sc = scoreCard(card, focus, this.weights);
      // huge bonus if this completes a triple
      if (ownedCopies(p, cardId) >= 2) sc += 20;
      else if (ownedCopies(p, cardId) === 1) sc += 4;
      if (sc > bestScore) {
        bestScore = sc;
        bestIdx = i;
      }
    });
    return { index: bestIdx, score: bestScore };
  }

  private playFromBench(match: Match, seat: number, focus: BuildFocus): void {
    let p = match.player(seat)!;
    // play units until the board is full or pending interaction blocks
    let guard = 0;
    while (p.board.length < economy.boardCap && p.bench.length > 0 && guard++ < 20) {
      if (p.pendingTarget) {
        this.resolveInteractions(match, seat, focus);
        p = match.player(seat)!;
        continue;
      }
      // play the highest-scored bench unit
      const best = [...p.bench].sort(
        (a, b) => scoreCard(getCard(b.cardId), focus, this.weights) - scoreCard(getCard(a.cardId), focus, this.weights),
      )[0];
      const r = match.applyIntent(seat, { type: 'playUnit', unitUid: best.uid });
      if (!r.ok) break;
      this.resolveInteractions(match, seat, focus);
      p = match.player(seat)!;
    }
  }

  private shouldTierUp(p: PlayerState, round: number): boolean {
    const cost = currentTierUpCost(p);
    if (cost < 0) return false;
    if (p.gold < cost) return false;
    if (p.board.length < 2 && round < 3) return false; // need early tempo first
    const buffer = Math.round((1 - this.weights.tierUpEagerness) * 4);
    return p.gold - cost >= buffer;
  }

  private positionBoard(match: Match, seat: number): void {
    const p = match.player(seat)!;
    const ordered = [...p.board].sort((a, b) => {
      const ta = a.keywords.includes('taunt') ? 1 : 0;
      const tb = b.keywords.includes('taunt') ? 1 : 0;
      if (ta !== tb) return tb - ta; // taunts to the front
      // tankier bodies forward, fragile carries / aura units toward the back
      return b.hp - a.hp;
    });
    ordered.forEach((u, i) => {
      if (p.board[i]?.uid !== u.uid) match.applyIntent(seat, { type: 'moveUnit', unitUid: u.uid, toSlot: i });
    });
  }

  /** Run one full shop turn for the seat, then ready up. */
  takeShopTurn(match: Match, seat: number, round: number): void {
    let p = match.player(seat)!;
    let focus = this.focus(p, round);
    this.resolveInteractions(match, seat, focus);

    let huntRolls = 0;
    let safety = 0;
    while (safety++ < 40) {
      p = match.player(seat)!;
      if (p.pendingTarget || p.discover) {
        this.resolveInteractions(match, seat, focus);
        continue;
      }

      // 1) ramp when affordable & sensible
      if (this.shouldTierUp(p, round)) {
        const r = match.applyIntent(seat, { type: 'tierUp' });
        if (r.ok) continue;
      }

      // re-focus each pass: the splash-balance nudge + owned-breaks set track the board
      focus = this.focus(p, round);

      // 1.5) hunt for the next breakpoint payoff: under target, none on offer, can still
      // afford to buy what we roll into → spend a roll (this is how a splash assembles its
      // second, cross-tribe break — §16.7b). Bounded per turn.
      if (
        focus.ownedBreakCards.size < this.weights.breakpointHuntTarget &&
        huntRolls < this.weights.breakpointHuntMaxRolls &&
        !p.frozen &&
        p.gold >= economy.rerollCost + economy.buyCost &&
        !p.shop.some((id) => hasBreakpoint(id) && !focus.ownedBreakCards.has(id))
      ) {
        const r = match.applyIntent(seat, { type: 'roll' });
        if (r.ok) {
          huntRolls += 1;
          continue;
        }
      }

      // 2) buy the best available unit
      const buy = this.pickBuy(p, focus);
      if (buy.index >= 0 && p.gold >= economy.buyCost && p.bench.length < economy.benchCap) {
        const r = match.applyIntent(seat, { type: 'buy', shopIndex: buy.index });
        if (r.ok) {
          this.playFromBench(match, seat, focus);
          continue;
        }
      }

      // 3) play anything still on the bench
      if (p.bench.length > 0 && p.board.length < economy.boardCap) {
        this.playFromBench(match, seat, focus);
        const after = match.player(seat)!;
        if (after.bench.length < p.bench.length) continue;
      }

      // 4) reroll for upgrades if we can afford to keep a buffer
      const wantRoll =
        p.gold >= economy.rerollCost + 2 &&
        p.gold >= Math.round(5 * (1 - this.weights.rollAggression)) &&
        buy.score < this.weights.rerollThreshold;
      if (wantRoll) {
        const r = match.applyIntent(seat, { type: 'roll' });
        if (r.ok) continue;
      }

      // 5) freeze a shop holding a strong on-tribe unit we cannot afford
      const strongUnaffordable = p.shop.some((cardId) => {
        const card = getCard(cardId);
        return (
          p.gold < economy.buyCost &&
          (focus.tribes.has(card.tribe) || (card.auras && card.auras.length > 0) || hasBreakpoint(card.id))
        );
      });
      if (strongUnaffordable && !p.frozen) {
        match.applyIntent(seat, { type: 'freeze' });
      }
      break;
    }

    // sell weak filler if the bench is jammed
    p = match.player(seat)!;
    if (p.bench.length >= economy.benchCap) {
      const weakest = [...p.bench].sort((a, b) => a.atk + a.hp - (b.atk + b.hp))[0];
      if (weakest) match.applyIntent(seat, { type: 'sell', unitUid: weakest.uid });
    }

    this.positionBoard(match, seat);
    match.applyIntent(seat, { type: 'readyUp' });
  }
}
