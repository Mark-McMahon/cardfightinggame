// Public surface of the sim workspace (spec §13). Re-exports the harness, metrics, audits, and the
// web/coherence anti-degeneracy harness so tests and tooling import from one place.
export * from './harness';
export * from './metrics';
export * from './boards';
export * from './audit';
export * from './coherence';
export * from './sampler';
export * from './web';
export { runMicro, type MicroResult } from './micro';
export { runMacro, type MacroOpts } from './macro';
