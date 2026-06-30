// Minimal observable store for React's useSyncExternalStore.
export class Store<T> {
  private value: T;
  private listeners = new Set<() => void>();

  constructor(initial: T) {
    this.value = initial;
  }
  get = (): T => this.value;
  set = (next: T): void => {
    this.value = next;
    this.listeners.forEach((l) => l());
  };
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}
