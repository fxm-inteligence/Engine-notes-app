import { useCallback, useEffect, useSyncExternalStore } from "react";

const values = new Map<string, unknown>();
const hydrated = new Set<string>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** One value per `key` for the whole app; `persist` mirrors it into localStorage (read back after mount, so server and client markup agree). */
export function useSharedState<T>(
  key: string,
  initial: T,
  persist = false,
): [T, (value: T | ((current: T) => T)) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => {
      if (!values.has(key)) values.set(key, initial);
      return values.get(key) as T;
    },
    () => initial,
  );

  useEffect(() => {
    if (!persist || hydrated.has(key)) return;
    hydrated.add(key);
    try {
      const raw = window.localStorage.getItem(`fxm:${key}`);
      if (raw !== null) {
        values.set(key, JSON.parse(raw));
        emit();
      }
    } catch {
      // Unreadable storage keeps the initial value.
    }
  }, [key, persist]);

  const set = useCallback(
    (next: T | ((current: T) => T)) => {
      const current = (values.has(key) ? values.get(key) : initial) as T;
      const resolved = typeof next === "function" ? (next as (current: T) => T)(current) : next;
      values.set(key, resolved);
      if (persist) {
        try {
          window.localStorage.setItem(`fxm:${key}`, JSON.stringify(resolved));
        } catch {
          // Storage may be full or blocked; the in-memory value still updates.
        }
      }
      emit();
    },
    [key, initial, persist],
  );

  return [value, set];
}
