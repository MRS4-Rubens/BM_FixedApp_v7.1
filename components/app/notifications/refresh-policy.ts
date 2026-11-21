/**
 * B10: the bell's timed re-check runs only if someone used this tab recently, so a shop PC left open on the app all day
 * does not wake the database every half hour. Window-focus re-checks are throttled (alt-tabbing back and forth).
 */
export const ACTIVE_WINDOW_MS = 10 * 60_000;
export const FOCUS_THROTTLE_MS = 2 * 60_000;

/** PURE: should the background timer check now? */
export function shouldTimedRefresh(visible: boolean, now: number, lastActivityAt: number): boolean {
  return visible && now - lastActivityAt <= ACTIVE_WINDOW_MS;
}
