'use client';

import * as React from 'react';

/**
 * useMediaQuery — subscribe to a CSS media query.
 *
 * SSR-safe: returns `false` on the server / first render, then matches
 * after hydration (no hydration mismatch).
 *
 * @example
 *   const isDesktop = useMediaQuery('(min-width: 1280px)');
 *   const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
 *   const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = React.useCallback(
    (notify: () => void) => {
      if (typeof window === 'undefined') return () => undefined;
      const mql = window.matchMedia(query);

      // Older Safari has addListener/removeListener
      if (mql.addEventListener) {
        mql.addEventListener('change', notify);
        return () => mql.removeEventListener('change', notify);
      }
      // legacy Safari fallback
      const legacy = mql as MediaQueryList & {
        addListener?: (cb: () => void) => void;
        removeListener?: (cb: () => void) => void;
      };
      legacy.addListener?.(notify);
      return () => legacy.removeListener?.(notify);
    },
    [query],
  );

  const getSnapshot = React.useCallback(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(query).matches;
  }, [query]);

  // Server snapshot must be stable — always false during SSR.
  const getServerSnapshot = React.useCallback(() => false, []);

  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
