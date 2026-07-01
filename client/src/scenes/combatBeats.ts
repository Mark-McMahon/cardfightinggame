// combatBeats — the client's view onto the causal-beat segmentation of the server's authoritative
// CombatEvent[] (design-spec §10). The logic now lives in the PURE shared engine
// (`@cardgame/shared` → shared/engine/combatReplay.ts) so the client's replay dwell and the
// server's combat-phase window are sized from the exact same pacing math and can never drift.
// This module re-exports it so the scene + its §10 eval (combatBeats.test.ts) keep a stable path.

export { beats, totalWeight, type Beat, type BeatKind } from '@cardgame/shared';
