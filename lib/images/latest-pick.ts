/**
 * "Only the latest pick counts" for async image preparation. Every pick, accepted or rejected, calls start(); a slower,
 * older pick that finishes later sees isCurrent() === false and must not touch the form. Cancel/Remove call invalidate().
 */
export interface LatestPick {
  start(): number;
  isCurrent(token: number): boolean;
  invalidate(): void;
}

export function createLatestPick(): LatestPick {
  let current = 0;
  return {
    start: () => ++current,
    isCurrent: (token) => token === current,
    invalidate: () => {
      current += 1;
    },
  };
}
