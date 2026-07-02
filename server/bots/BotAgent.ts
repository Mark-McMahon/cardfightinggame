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
  hasSpendGated,
  hasContestedCondition,
  economy,
  engines,
  Rng,
  type ActivatedAbilityState,
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

// A CONSUMPTION card (Gorgemaw, #44) proactively eats a chosen friendly on play, keeping its
// stats and feeding the persistent lifetimeDeaths line. Detected from card DATA (a `destroyAlly`
// action) so it stays config/content-driven — no card id is hardcoded in the bot.
function isConsumption(cardId: string): boolean {
  return getCard(cardId).effects.some((e) => e.actions.some((a) => a.type === 'destroyAlly'));
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

    // 1.5) MAGNETIC merge (#54): consolidate a magnetic bench unit into a Construct tower on the board
    // (a go-tall/anti-wide line). Placed BEFORE development so magnetic units feed the tower rather than
    // being played standalone once a tower exists. Deterministic (biggest under-cap tower, tie → uid).
    const merge = this.bestMerge(priv);
    if (merge) return { type: 'merge', unitUid: merge.unitUid, targetUid: merge.targetUid };

    // 2) develop the board: play the strongest bench unit while there's room — with the ONE
    // consumption-archetype (#44) adjustment handled in chooseDevelopment: a consumption body
    // (Gorgemaw) is not played into an empty board (its eat would fizzle with no ally to consume).
    if (priv.board.length < economy.boardCap && priv.bench.length > 0) {
      const play = this.chooseDevelopment(priv, pub, focus);
      if (play) return { type: 'playUnit', unitUid: play };
    }

    // 2.5) spend the gem wallet (decision #39): deterministic greedy policy — doublers first
    // (the compounding line), then the utility sinks. All randomness stays on the seeded rng.
    const activate = this.bestActivation(priv, pub, focus);
    if (activate) return { type: 'activate', unitUid: activate };

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
    // spend-gated payoff cards (#39), contested-condition payoff cards (#40 corollary — e.g.
    // Gravemonarch's survive-a-near-wipe double), and consumption cards (#44 — Gorgemaw eats a
    // chaff body for stats + feeds the persistent lifetimeDeaths line) are all primary payoffs:
    // value them like breakpoints so the bot BUYS + KEEPS them instead of dumping a 3/3 as chaff.
    if (hasBreakpoint(cardId) || hasSpendGated(cardId) || hasContestedCondition(cardId) || isConsumption(cardId))
      s += this.weights.breakpointValue;
    // Phase 5 (#54–56): the magnetic sources / Forgemaster / gold Corsairs are NOT breakpoints, so they
    // get NO payoff bump — over-valuing them crowds real breakpoints out of splash builds and breaks the
    // load-bearing EV-BAL-B reachability gate. They still reach combat as ordinary on-tribe bodies (base
    // synergy scoring) and the magnetic MERGE line is exercised by the dedicated `bestMerge` policy.
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
    excludeUid?: string,
  ): ClientUnit | null {
    let best: ClientUnit | null = null;
    let bestScore = -Infinity;
    for (const u of priv.bench) {
      if (u.uid === excludeUid) continue;
      const sc = this.scoreUnit(u, focus) + this.rng.next() * 0.01;
      if (sc > bestScore) {
        bestScore = sc;
        best = u;
      }
    }
    return best;
  }

  /**
   * Pick which bench unit to play, or null when there's nothing to develop. Layered on "play the
   * strongest bench unit" is ONE consumption-archetype (#44) adjustment: a consumption body
   * (Gorgemaw) is not played into an EMPTY board — it needs another ally to eat, else the
   * battlecry fizzles; so develop a normal body first and let the consumer eat next step.
   * (Go-tall payoffs like Cindermarshal are deliberately NOT special-cased: deploying wide
   * dominates in the current engine, so a bot never rationally holds narrow — the go-tall line
   * is a documented Phase-4 board-shape concern, design-spec §11.2 / decision #47, not a
   * Phase-3 bot behavior.)
   */
  private chooseDevelopment(priv: PrivateState, pub: PublicState, focus: BuildFocus): string | null {
    const best = this.bestBench(priv, pub, focus);
    if (!best) return null;
    if (isConsumption(best.cardId) && priv.board.length === 0) {
      const alt = this.bestBench(priv, pub, focus, best.uid);
      if (alt && !isConsumption(alt.cardId)) return alt.uid;
    }
    return best.uid;
  }

  /**
   * MAGNETIC merge policy (#54, deterministic): for a committed Construct build (≥3 Constructs owned),
   * merge the lowest-uid magnetic BENCH unit into the biggest under-cap Construct TOWER on the board
   * (ties → lowest uid). Returns null if there is no tower yet (develop one first) or no magnetic unit.
   * Standalone play is never forced — a magnetic unit with no tower falls through to normal development.
   */
  private bestMerge(priv: PrivateState): { unitUid: string; targetUid: string } | null {
    const constructs = [...priv.board, ...priv.bench].filter((u) => u.tribe === 'constructs').length;
    if (constructs < 3) return null; // only a committed Construct build consolidates
    const mag = priv.bench
      .filter((u) => u.keywords.includes('magnetic'))
      .sort((a, b) => (a.uid < b.uid ? -1 : 1))[0];
    if (!mag) return null;
    const cap = engines.constructs.magneticMergeCap;
    const tower = priv.board
      .filter((u) => u.tribe === 'constructs' && (u.mergeCount ?? 0) < cap)
      .sort((a, b) => b.atk + b.hp - (a.atk + a.hp) || (a.uid < b.uid ? -1 : 1))[0];
    if (!tower) return null;
    return { unitUid: mag.uid, targetUid: tower.uid };
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
        hasSpendGated(o.cardId) ||
        hasContestedCondition(o.cardId) ||
        isConsumption(o.cardId) ||
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

    // breakpoint hunt: assemble up to breakpointHuntTarget distinct payoff cards
    // (spend-gated payoff cards count as payoffs too, #39).
    const owned = new Set<string>();
    for (const u of [...priv.board, ...priv.bench])
      if (hasBreakpoint(u.cardId) || hasSpendGated(u.cardId) || hasContestedCondition(u.cardId) || isConsumption(u.cardId)) owned.add(u.cardId);
    const offered = priv.shop.some((o) => hasBreakpoint(o.cardId) || hasSpendGated(o.cardId) || hasContestedCondition(o.cardId) || isConsumption(o.cardId));
    if (owned.size < this.weights.breakpointHuntTarget && !offered && this.rollsThisTurn < this.weights.breakpointHuntMaxRolls) {
      return true;
    }

    // otherwise roll opportunistically if the shop has nothing worth buying yet.
    const buy = this.bestBuy(priv, pub, focus);
    const nothingGood = !buy || buy.score < this.weights.rerollThreshold;
    return nothingGood && this.rng.next() < this.weights.rollAggression;
  }

  /**
   * Decision #39 activation policy (deterministic, minimal):
   *   1. DOUBLERS (escalating cost) — greedy: whenever the wallet covers the current price,
   *      double the biggest doubler on board (ties → lowest uid). The all-in compounding line.
   *   2. Facetguard-style chosenAlly buffs — activate when affordable and there is a real board
   *      (≥2 units, so the shield lands on a carry, not only on itself); the pendingTarget step
   *      then picks the biggest ally (bestTarget).
   *   3. Gemwright (gainGold) — only while below goldCap (never waste the clamped gold).
   *   4. Oreseeker (refreshShop) — a free roll when the bot would have rolled anyway.
   * Returns the uid to activate, or null.
   */
  private bestActivation(priv: PrivateState, pub: PublicState, focus: BuildFocus): string | null {
    const abilities = priv.abilities ?? [];
    if (abilities.length === 0) return null;
    const byUid = new Map<string, ClientUnit>();
    for (const u of priv.board) byUid.set(u.uid, u);
    const usable = abilities.filter((a) => !a.used && priv.gems >= a.cost && byUid.has(a.uid));
    if (usable.length === 0) return null;

    const kindOf = (a: ActivatedAbilityState): 'doubler' | 'target' | 'gold' | 'refresh' | 'other' => {
      const spec = getCard(a.cardId).activated;
      if (!spec) return 'other';
      if (spec.cost === 'doublerEscalating') return 'doubler';
      if (spec.target.selector === 'chosenAlly') return 'target';
      if (spec.actions.some((x) => x.type === 'gainGold')) return 'gold';
      if (spec.actions.some((x) => x.type === 'refreshShop')) return 'refresh';
      return 'other';
    };
    const statOf = (a: ActivatedAbilityState): number => {
      const u = byUid.get(a.uid);
      return u ? u.atk + u.hp : 0;
    };

    const doublers = usable
      .filter((a) => kindOf(a) === 'doubler')
      .sort((x, y) => statOf(y) - statOf(x) || (x.uid < y.uid ? -1 : 1));
    if (doublers.length > 0) return doublers[0].uid;

    const targeted = usable.find((a) => kindOf(a) === 'target');
    if (targeted && priv.board.length >= 2) return targeted.uid;

    const gold = usable.find((a) => kindOf(a) === 'gold');
    if (gold && priv.gold < economy.goldCap) return gold.uid;

    const refresh = usable.find((a) => kindOf(a) === 'refresh');
    if (refresh && this.shouldRoll(priv, pub, focus)) return refresh.uid;

    return null;
  }

  private bestTarget(priv: PrivateState): string | null {
    const pt = priv.pendingTarget;
    const legal = pt?.legalTargets ?? [];
    if (legal.length === 0) return null;
    const byUid = new Map<string, ClientUnit>();
    for (const u of [...priv.board, ...priv.bench]) byUid.set(u.uid, u);
    // Consumption sources (Gorgemaw's destroyAlly) EAT the SMALLEST spare body — never the carry; the
    // absorb keeps its stats, so sacrificing chaff is a strict upgrade. All other targeted abilities
    // (Facetguard-style buffs) want the BIGGEST ally. Detect the sacrifice case from the source card.
    const src = pt ? byUid.get(pt.sourceUid) : undefined;
    const isSacrifice = src ? isConsumption(src.cardId) : false;
    let best: string | null = null;
    let bestVal = isSacrifice ? Infinity : -Infinity;
    for (const uid of legal) {
      const u = byUid.get(uid);
      const val = u ? u.atk + u.hp : 0;
      if (isSacrifice ? val < bestVal : val > bestVal) {
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
