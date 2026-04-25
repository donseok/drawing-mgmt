'use client';

import * as React from 'react';

/**
 * useLocalStorage — persistent state in `window.localStorage`.
 *
 * - SSR-safe: returns `initialValue` on the server / first render, hydrates
 *   to the stored value on the client. (No hydration mismatch because state
 *   reads happen post-mount.)
 * - Cross-tab sync: subscribes to the `storage` event so other tabs see
 *   updates.
 * - Custom event: dispatches `local-storage` so multiple hooks for the same
 *   key in the same tab stay in sync.
 *
 * @example
 *   const [open, setOpen] = useLocalStorage('detailPanelOpen', true);
 *   const [width, setWidth] = useLocalStorage<number>('detailPanelWidth', 400);
 */

const LOCAL_STORAGE_EVENT = 'local-storage';

type SetValue<T> = T | ((prev: T) => T);

function readValue<T>(key: string, initial: T): T {
  if (typeof window === 'undefined') return initial;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return initial;
    return JSON.parse(raw) as T;
  } catch {
    return initial;
  }
}

export function useLocalStorage<T>(
  key: string,
  initialValue: T,
): [T, (value: SetValue<T>) => void, () => void] {
  // Track value with state, but read lazily (post-mount) to stay SSR-safe.
  const [storedValue, setStoredValue] = React.useState<T>(initialValue);
  const [hydrated, setHydrated] = React.useState(false);

  // Hydrate on mount
  React.useEffect(() => {
    setStoredValue(readValue(key, initialValue));
    setHydrated(true);
    // Note: `initialValue` intentionally omitted from deps —
    // first-mount hydration only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const setValue = React.useCallback(
    (value: SetValue<T>) => {
      setStoredValue((prev) => {
        const next = value instanceof Function ? value(prev) : value;
        if (typeof window !== 'undefined') {
          try {
            window.localStorage.setItem(key, JSON.stringify(next));
            window.dispatchEvent(
              new StorageEvent(LOCAL_STORAGE_EVENT, { key, newValue: JSON.stringify(next) }),
            );
          } catch {
            // quota exceeded / private mode — silently swallow
          }
        }
        return next;
      });
    },
    [key],
  );

  const remove = React.useCallback(() => {
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(key);
        window.dispatchEvent(
          new StorageEvent(LOCAL_STORAGE_EVENT, { key, newValue: null }),
        );
      } catch {
        /* noop */
      }
    }
    setStoredValue(initialValue);
  }, [initialValue, key]);

  // Cross-tab + same-tab sync
  React.useEffect(() => {
    if (typeof window === 'undefined') return;

    const handle = (event: StorageEvent) => {
      if (event.key !== key) return;
      try {
        const next =
          event.newValue === null
            ? initialValue
            : (JSON.parse(event.newValue) as T);
        setStoredValue(next);
      } catch {
        /* noop */
      }
    };

    window.addEventListener('storage', handle);
    window.addEventListener(LOCAL_STORAGE_EVENT, handle as EventListener);
    return () => {
      window.removeEventListener('storage', handle);
      window.removeEventListener(LOCAL_STORAGE_EVENT, handle as EventListener);
    };
  }, [key, initialValue]);

  // Until hydrated, expose the initial value (consistent across SSR + first paint).
  return [hydrated ? storedValue : initialValue, setValue, remove];
}
