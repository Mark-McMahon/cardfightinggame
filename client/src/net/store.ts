// store — a tiny subscribable snapshot of everything the UI renders: the public RoomState, this
// client's private push, its latest combat log, transient toasts, and connection info. The
// TRANSPORT (game.ts) is the only writer; scenes read via hooks.ts (useSyncExternalStore).
//
// Invariant 4 lives here by omission: the store has exactly the two server channels — `publicState`
// (synced to all) and `privateState` (owner-only). There is no place to put opponent private data,
// because the client never receives any (two-channel privacy is enforced server-side).

import type { PublicState, PrivateState, CombatEvent, ToastEvent } from '@cardgame/shared';

export interface ToastItem extends ToastEvent {
  id: number;
}

export interface ConnInfo {
  connected: boolean;
  connecting: boolean;
  seat: number | null;
  roomCode: string | null;
  error: string | null;
}

export interface GameState {
  conn: ConnInfo;
  publicState: PublicState | null;
  privateState: PrivateState | null;
  combatLog: CombatEvent[] | null;
  toasts: ToastItem[];
}

const initial: GameState = {
  conn: { connected: false, connecting: false, seat: null, roomCode: null, error: null },
  publicState: null,
  privateState: null,
  combatLog: null,
  toasts: [],
};

let state: GameState = initial;
const listeners = new Set<() => void>();
let toastSeq = 0;

function emit(): void {
  for (const l of listeners) l();
}

// Slices are replaced immutably so useSyncExternalStore selectors stay referentially stable when
// their slice is untouched (no needless re-renders).
function set(patch: Partial<GameState>): void {
  state = { ...state, ...patch };
  emit();
}

export const store = {
  getState(): GameState {
    return state;
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  setConn(patch: Partial<ConnInfo>): void {
    set({ conn: { ...state.conn, ...patch } });
  },
  setPublic(p: PublicState): void {
    set({ publicState: p });
  },
  setPrivate(p: PrivateState): void {
    set({ privateState: p });
  },
  setCombatLog(log: CombatEvent[]): void {
    set({ combatLog: log });
  },
  pushToast(t: ToastEvent): void {
    const item: ToastItem = { ...t, id: ++toastSeq };
    set({ toasts: [...state.toasts, item].slice(-5) });
    setTimeout(() => store.dismissToast(item.id), 4500);
  },
  dismissToast(id: number): void {
    set({ toasts: state.toasts.filter((t) => t.id !== id) });
  },
  reset(): void {
    state = { ...initial, toasts: [] };
    emit();
  },
};
