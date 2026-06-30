import { Client, type Room } from 'colyseus.js';
import type { CombatEvent, Intent, PrivateState, PublicState, ToastEvent } from '@cardgame/shared';
import { Store } from './store';

const ENDPOINT = `ws://${location.hostname}:2567`;

export interface Toast extends ToastEvent {
  id: number;
}

export interface ClientCombat {
  events: CombatEvent[];
  side: 'a' | 'b';
  opponentName: string;
}

export const pubStore = new Store<PublicState | null>(null);
export const privStore = new Store<PrivateState | null>(null);
export const combatStore = new Store<ClientCombat | null>(null);
export const seatStore = new Store<number>(-1);
export const connStore = new Store<{ connected: boolean; roomId: string | null; error: string | null }>({
  connected: false,
  roomId: null,
  error: null,
});
export const toastStore = new Store<Toast[]>([]);

let room: Room | null = null;
let toastId = 0;
const client = new Client(ENDPOINT);

function pushToast(t: ToastEvent): void {
  const toast: Toast = { ...t, id: toastId++ };
  toastStore.set([...toastStore.get(), toast].slice(-6));
  setTimeout(() => {
    toastStore.set(toastStore.get().filter((x) => x.id !== toast.id));
  }, 5000);
}

function snapshotPublic(state: any): PublicState {
  return JSON.parse(JSON.stringify(state)) as PublicState;
}

function wire(r: Room): void {
  room = r;
  connStore.set({ connected: true, roomId: r.roomId, error: null });
  r.onStateChange((state) => pubStore.set(snapshotPublic(state)));
  r.onMessage('seat', (m: { seat: number }) => seatStore.set(m.seat));
  r.onMessage('privateState', (m: PrivateState) => privStore.set(m));
  r.onMessage('combatLog', (m: ClientCombat) => combatStore.set(m));
  r.onMessage('toast', (m: ToastEvent) => pushToast(m));
  r.onMessage('error', (m: { reason: string }) => pushToast({ kind: 'info', message: `⚠ ${m.reason}` }));
  r.onError((code, message) => connStore.set({ connected: false, roomId: r.roomId, error: `${code} ${message}` }));
  r.onLeave(() => connStore.set({ connected: false, roomId: null, error: null }));
}

export async function createRoom(name: string, botFill = true): Promise<void> {
  try {
    const r = await client.create('match', { name, botFill });
    wire(r);
  } catch (e) {
    connStore.set({ connected: false, roomId: null, error: String(e) });
  }
}

export async function joinRoom(code: string, name: string): Promise<void> {
  try {
    const r = await client.joinById(code, { name });
    wire(r);
  } catch (e) {
    connStore.set({ connected: false, roomId: null, error: `Could not join "${code}": ${e}` });
  }
}

export function startMatch(): void {
  room?.send('startMatch');
}
export function setBotFill(value: boolean): void {
  room?.send('setBotFill', value);
}
export function sendIntent(intent: Intent): void {
  room?.send('intent', intent);
}
export function clearCombat(): void {
  combatStore.set(null);
}
