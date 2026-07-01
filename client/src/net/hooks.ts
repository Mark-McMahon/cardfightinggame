// hooks — React bindings over the store (useSyncExternalStore). Scenes subscribe only to the slice
// they render, so a private-state push doesn't re-render a pure public-state view and vice-versa.

import { useSyncExternalStore } from 'react';
import { store, type GameState, type ConnInfo, type ToastItem } from './store';
import type { PublicState, PrivateState, CombatEvent } from '@cardgame/shared';

function useSlice<T>(select: (s: GameState) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(store.getState()));
}

export function usePublicState(): PublicState | null {
  return useSlice((s) => s.publicState);
}

export function usePrivateState(): PrivateState | null {
  return useSlice((s) => s.privateState);
}

export function useCombatLog(): CombatEvent[] | null {
  return useSlice((s) => s.combatLog);
}

export function useToasts(): ToastItem[] {
  return useSlice((s) => s.toasts);
}

/** Connection info (seat, room code, connected/connecting, last error). */
export function useRoom(): ConnInfo {
  return useSlice((s) => s.conn);
}
