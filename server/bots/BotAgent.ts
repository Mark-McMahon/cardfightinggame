// Server-side bot — a headless agent that speaks the SAME intent interface as a human
// (spec §9.6). The Colyseus room can't tell a bot from a player: both funnel intents into
// `Match.applyIntent`. This is deliberately the ONE place bot AI lives, so the simulator
// (Phase 3) reuses the exact same agent + engine instead of re-implementing either.
//
// Import path (pinned in tsconfig.base.json): `@cardgame/server/bots`.
//
// Public API (stable — the sim wires to THIS):
//   • class BotAgent(weights, rng)  — engine-driven, deterministic given a seeded Rng.
//       .step(priv, pub): Intent | null   — the reactive step contract. Returns ONE intent
//         given the CURRENT authoritative snapshot, or null when the turn is complete. It is a
//         step API (not a fire-and-forget Intent[]) because the engine reveals `discover` and
//         `pendingTarget` only AFTER an intent applies — the agent must re-read to react.
//   • driveBotTurn(agent, seat, getPrivate, getPublic, apply): Intent[]
//       — convenience loop: pulls a fresh snapshot, asks the agent, applies via the engine,
//         repeats until readyUp. Both the server and the sim use this.
//
// Everything is engine/config-driven (invariant 4): no gameplay constant is baked in here —
// costs/caps come from the private snapshot (rerollCost, tierUpCost, bench/board room) and the
// card catalog; only the weight bundle (config/bots.ts) shapes preference.

import {
  getCard,
  hasBreakpoint,
  economy,
  Rng,
  type Axis,
  type BotWeights,
  type ClientUnit,
  type Intent,
  type PrivateState,
  type PublicState,
  type ShopOffer,
  type TribeId,
} from '@cardgame/shared';

interface BuildFocus {
  committed: Set<TribeId>;
  targetAxes: Set<Axis>;
  /** committed tribe that is currently under-represented (splash balancing), if any. */
  underTribe: TribeId | null;
}

export class BotAgent {
  readonly weights: BotWeights;
  readonly rng: Rng;
  // per-shop-turn scratch, reset when the public round advances.
  private turn = -1;
  private rollsThisTurn = 0;
  private readied = false;

  constructor(weights: BotWeights, rng: Rng) {
    this.weights = weights;
    this.rng = rng;
  }

  /** Reset per-turn counters the first time we act on a new round. */
  private syncTurn(pub: PublicState): void {
    if (pub.round !== this.turn) {
      this.turn = pub.round;
      this.rollsThisTurn = 0;
      this.readied = false;
    }
  }

  /** One decision for the current authoritative snapshot. `null` ⇒ nothing left to do. */
  step(priv: PrivateState, pub: PublicState): Intent | null {
    this.syncTurn(pub);
    if (this.readied) return null;

    // 1) resolve anything the engine is waiting on FIRST (a played battlecry / a triple).
    if (priv.pendingTarget) {
      const pick = this.bestTarget(priv);
      if (pick) return { type: 'targetChoice', targetUid: pick };
      // no sane target — pick the first legal to clear the block.
      const first = priv.pendingTarget.legalTargets[0];
      if (first) return { type: 'targetChoice', targetUid: first };
    }
    if (priv.discover) {
      return { type: 'discoverPick', optionIndex: this.bestDiscover(priv, pub) };
    }

    const focus = this.buildFocus(priv, pub);

    // 2) develop the board: play the strongest bench unit while there's room.
    if (priv.board.length < economy.boardCap && priv.bench.length > 0) {
      const best = this.bestBench(priv, pub, focus);
      if (best) return { type: 'playUnit', unitUid: best.uid };
    }

    // 3) ramp: tier up when affordable and we keep a tempo reserve (eagerness widens the window).
    if (priv.tierUpCost >= 0 && priv.gold >= priv.tierUpCost) {
      const reserve = Math.ceil((1 - this.weights.tierUpEagerness) * economy.buyCost * 2);
      const benchFull = priv.bench.length >= economy.benchCap;
      if (!benchFull && priv.gold - priv.tierUpCost >= reserve) {
        return { type: 'tierUp' };
      }
    }

    // 4) buy the best worthwhile offer we can afford and hold.
    const buy = this.bestBuy(priv, pub, focus);
    if (buy) {
      if (priv.bench.length >= economy.benchCap) {
        // bench full: free a slot by selling our weakest hold IF the offer clearly beats it.
        const weakest = this.weakestOwned(priv, pub, focus);
        if (weakest && buy.score > weakest.score + 1) {
          return { type: 'sell', unitUid: weakest.unit.uid };
        }
      } else {
        return { type: 'buy', shopIndex: buy.index };
      }
    }

    // 5) roll: chase upgrades / hunt a missing breakpoint, within budget and aggression.
    if (this.shouldRoll(priv, pub, focus)) {
      this.rollsThisTurn++;
      return { type: 'roll' };
    }

    this.readied = true;
    return { type: 'readyUp' };
  }

  // ── scoring ────────────────────────────────────────────────────────────────────

  private buildFocus(priv: PrivateState, pub: PublicState): BuildFocus {
    const counts = new Map<TribeId, number>();
    for (const u of [...priv.board, ...priv.bench]) {
      counts.set(u.tribe, (counts.get(u.tribe) ?? 0) + 1);
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const committed = new Set<TribeId>();
    const committing = pub.round >= this.weights.tribeCommitTurn;
    const primary = sorted[0];
    if (primary && (committing ? primary[1] >= 1 : primary[1] >= 3)) committed.add(primary[0]);
    const secondary = sorted[1];
    if (committing && secondary && secondary[1] >= 2) committed.add(secondary[0]); // real splash

    let underTribe: TribeId | null = null;
    if (committed.size === 2 && this.weights.splashBalanceBonus > 0) {
      const [a, b] = [...committed];
      underTribe = (counts.get(a) ?? 0) <= (counts.get(b) ?? 0) ? a : b;
    }

    const targetAxes = new Set<Axis>();
    for (const u of [...priv.board, ...priv.bench]) {
      if (committed.size && !committed.has(u.tribe)) continue;
      for (const ax of getCard(u.cardId).axis ?? []) targetAxes.add(ax);
    }
    return { committed, targetAxes, underTribe };
  }

  private scoreCard(
    cardId: string,
    atk: number,
    hp: number,
    tribe: TribeId,
    focus: BuildFocus,
  ): number {
    const card = getCard(cardId);
    let s = atk + hp; // raw body
    if (focus.committed.size === 0 || focus.committed.has(tribe)) s *= this.weights.synergyValue;
    const axes = card.axis ?? [];
    for (const ax of axes) if (focus.targetAxes.has(ax)) s += this.weights.axisValue;
    if (axes.length >= 2 && axes.some((a) => focus.targetAxes.has(a))) s += this.weights.bridgeValue;
    if (hasBreakpoint(cardId)) s += this.weights.breakpointValue;
    if (focus.underTribe && tribe === focus.underTribe) s += this.weights.splashBalanceBonus;
    return s;
  }

  private scoreOffer(o: ShopOffer, focus: BuildFocus): number {
    return this.scoreCard(o.cardId, o.atk, o.hp, o.tribe, focus);
  }

  private scoreUnit(u: ClientUnit, focus: BuildFocus): number {
    return this.scoreCard(u.cardId, u.atk, u.hp, u.tribe, focus);
  }

  // ── choices ────────────────────────────────────────────────────────────────────

  private bestBench(
    priv: PrivateState,
    _pub: PublicState,
    focus: BuildFocus,
  ): ClientUnit | null {
    let best: ClientUnit | null = null;
    let bestScore = -Infinity;
    for (const u of priv.bench) {
      const sc = this.scoreUnit(u, focus) + this.rng.next() * 0.01;
      if (sc > bestScore) {
        bestScore = sc;
        best = u;
      }
    }
    return best;
  }

  private bestBuy(
    priv: PrivateState,
    pub: PublicState,
    focus: BuildFocus,
  ): { index: number; score: number } | null {
    if (priv.gold < economy.buyCost) return null;
    const committing = pub.round >= this.weights.tribeCommitTurn;
    let best: { index: number; score: number } | null = null;
    for (let i = 0; i < priv.shop.length; i++) {
      const o = priv.shop[i];
      const worthwhile =
        !committing ||
        focus.committed.size === 0 ||
        focus.committed.has(o.tribe) ||
        hasBreakpoint(o.cardId) ||
        (getCard(o.cardId).axis ?? []).some((a) => focus.targetAxes.has(a));
      if (!worthwhile) continue;
      const sc = this.scoreOffer(o, focus) + this.rng.next() * 0.01;
      if (!best || sc > best.score) best = { index: i, score: sc };
    }
    return best;
  }

  private weakestOwned(
    priv: PrivateState,
    _pub: PublicState,
    focus: BuildFocus,
  ): { unit: ClientUnit; score: number } | null {
    let worst: { unit: ClientUnit; score: number } | null = null;
    for (const u of [...priv.bench, ...priv.board]) {
      if (u.isToken) continue; // tokens refund nothing / vanish; don't sell them for room
      const sc = this.scoreUnit(u, focus);
      if (!worst || sc < worst.score) worst = { unit: u, score: sc };
    }
    return worst;
  }

  private shouldRoll(priv: PrivateState, pub: PublicState, focus: BuildFocus): boolean {
    if (priv.gold < priv.rerollCost) return false;
    if (priv.bench.length >= economy.benchCap) return false;
    const reserve = Math.round((1 - this.weights.rollAggression) * economy.buyCost);
    if (priv.gold - priv.rerollCost < reserve) return false;

    // breakpoint hunt: assemble up to breakpointHuntTarget distinct payoff cards.
    const owned = new Set<string>();
    for (const u of [...priv.board, ...priv.bench]) if (hasBreakpoint(u.cardId)) owned.add(u.cardId);
    const offered = priv.shop.some((o) => hasBreakpoint(o.cardId));
    if (owned.size < this.weights.breakpointHuntTarget && !offered && this.rollsThisTurn < this.weights.breakpointHuntMaxRolls) {
      return true;
    }

    // otherwise roll opportunistically if the shop has nothing worth buying yet.
    const buy = this.bestBuy(priv, pub, focus);
    const nothingGood = !buy || buy.score < this.weights.rerollThreshold;
    return nothingGood && this.rng.next() < this.weights.rollAggression;
  }

  private bestTarget(priv: PrivateState): string | null {
    const legal = priv.pendingTarget?.legalTargets ?? [];
    if (legal.length === 0) return null;
    const byUid = new Map<string, ClientUnit>();
    for (const u of [...priv.board, ...priv.bench]) byUid.set(u.uid, u);
    let best: string | null = null;
    let bestVal = -Infinity;
    for (const uid of legal) {
      const u = byUid.get(uid);
      const val = u ? u.atk + u.hp : 0;
      if (val > bestVal) {
        bestVal = val;
        best = uid;
      }
    }
    return best;
  }

  private bestDiscover(priv: PrivateState, pub: PublicState): number {
    const focus = this.buildFocus(priv, pub);
    const opts = priv.discover?.options ?? [];
    let best = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < opts.length; i++) {
      const sc = this.scoreOffer(opts[i], focus) + this.rng.next() * 0.01;
      if (sc > bestScore) {
        bestScore = sc;
        best = i;
      }
    }
    return best;
  }
}

/**
 * Drive one full shop turn for `seat`: repeatedly pull the CURRENT authoritative snapshot,
 * ask the agent for the next intent, and apply it through the engine — exactly what a human
 * client + server do, so bots and humans are indistinguishable to the room (spec §9.6).
 * Returns the intents actually applied (useful for the sim / tests).
 */
export function driveBotTurn(
  agent: BotAgent,
  getPrivate: () => PrivateState,
  getPublic: () => PublicState,
  apply: (intent: Intent) => { ok: boolean; error?: string },
  maxSteps = 300,
): Intent[] {
  const applied: Intent[] = [];
  for (let i = 0; i < maxSteps; i++) {
    const intent = agent.step(getPrivate(), getPublic());
    if (!intent) break;
    const res = apply(intent);
    applied.push(intent);
    if (intent.type === 'readyUp') break;
    if (!res.ok) break; // engine rejected — stop rather than spin (the agent tried its best)
  }
  return applied;
}
