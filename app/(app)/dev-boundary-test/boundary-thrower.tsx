'use client';

/**
 * Throws immediately during React render phase so the nearest error boundary catches it.
 * Note: Errors thrown in event handlers are NOT caught by React error boundaries.
 */
export function BoundaryThrower(): never {
  throw new Error('FE-003 dev test: client component render error');
}

