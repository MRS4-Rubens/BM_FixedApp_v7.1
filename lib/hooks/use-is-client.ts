'use client';

import { useSyncExternalStore } from 'react';

const emptySubscribe = () => () => {};

/**
 * Returns false during SSR and the hydration render, true afterwards.
 * Replaces the "setMounted(true) in useEffect" pattern to avoid cascading
 * renders and hydration mismatches.
 */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

