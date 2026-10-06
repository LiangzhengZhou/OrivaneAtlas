/** Per-workbench preferences without a global shell render on every control. */
export function createViewStore<T>(
  initial: T,
  equal: (a: T, b: T) => boolean = Object.is,
) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => value,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(next: T | ((previous: T) => T)) {
      const updated =
        typeof next === "function" ? (next as (previous: T) => T)(value) : next;
      if (equal(value, updated)) return;
      value = updated;
      for (const listener of listeners) listener();
    },
  };
}
