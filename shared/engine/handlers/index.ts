// Custom handler registry — the deliberate ~10% escape-hatch (spec §6.5). EXACTLY two ship;
// both are combat-only. An unknown handlerId is a HARD error (guards the anti-idiom law: a
// new bespoke behavior must be a registered handler, never smuggled in).

/** The callbacks a custom handler may use. combat.ts supplies a concrete context per firing. */
export interface CustomHandlerContext {
  /** Re-fire a unit's deathrattle effects WITHOUT that unit dying (Bonepiper). */
  replayDeathrattle: (unitUid: string) => void;
  /** Living adjacent allies (left/right neighbor) of the source, in board order. */
  adjacentAllyUids: string[];
  /** All living friendly uids (for scope 'wholeBoard'). */
  allyUids: string[];
  /** Arm the one-shot "next friendly dier's deathrattle fires twice" flag (Pallbearer). */
  primeDoubleNextDeathrattle: () => void;
  params: Record<string, unknown>;
}

export type CustomHandler = (ctx: CustomHandlerContext) => void;

export const HANDLERS: Record<string, CustomHandler> = {
  // Bonepiper: after it attacks, re-trigger an adjacent friendly deathrattle (no death).
  replayAdjacentDeathrattle(ctx) {
    const scope = (ctx.params.scope as string | undefined) ?? 'adjacent';
    const targets = scope === 'wholeBoard' ? ctx.allyUids : ctx.adjacentAllyUids;
    for (const uid of targets) ctx.replayDeathrattle(uid);
  },
  // Pallbearer: arm a one-shot flag — the next friendly to die fires its deathrattle twice.
  primeNextDeathrattleDouble(ctx) {
    ctx.primeDoubleNextDeathrattle();
  },
};

/** Dispatch a custom action. Unknown id → hard error (spec §6.5). */
export function runHandler(id: string, ctx: CustomHandlerContext): void {
  const handler = HANDLERS[id];
  if (!handler) throw new Error(`Unknown custom handler: ${id}`);
  handler(ctx);
}
