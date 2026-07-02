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

// Touch/no-hover detection (§10). On a coarse/no-hover pointer, HTML5 drag-and-drop is unavailable and
// a tap fires the click *with* a sticky `:hover`, so tap-to-buy fires while the player only meant to
// read the card. Scenes use this to switch to a tap-to-INSPECT model (a deliberate Buy/Play/Sell in the
// inspect sheet) instead of tap-to-act. Subscribed via matchMedia so plugging in a mouse re-renders.
const TOUCH_QUERY = '(hover: none), (pointer: coarse)';
export function useIsTouch(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(TOUCH_QUERY);
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => window.matchMedia(TOUCH_QUERY).matches,
    () => false, // SSR fallback (unused — this is a Vite SPA)
  );
}
