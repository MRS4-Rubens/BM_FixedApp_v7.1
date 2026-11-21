/**
 * B2: Neon Free sleeps after 5 idle minutes and the first query after that takes ~2 s. The login screen asks the
 * server to wake the database while the user types, so the dashboard opens fast after Sign in.
 *
 * The endpoint is public (anyone can open the login page), so wake-ups are strictly capped: at most one database ping
 * every WARM_MIN_GAP_MS and WARM_DAILY_CAP per day per server. Even if someone called it non-stop, that keeps the database
 * awake at most ~20 x 5 min = ~1.7 h a day (about 12 of the 100 free compute-hours a month), never all day.
 */
export const WARM_MIN_GAP_MS = 4 * 60_000;
export const WARM_DAILY_CAP = 20;

export interface WarmState {
  lastAt: number;
  day: string;
  count: number;
}

const istDay = (now: number) => new Date(now + 5.5 * 3_600_000).toISOString().slice(0, 10);

/** PURE: decide whether to ping now; returns the next state when it does. */
export function decideWarm(state: WarmState, now: number): { warm: boolean; next: WarmState } {
  const day = istDay(now);
  const count = state.day === day ? state.count : 0;
  if (now - state.lastAt < WARM_MIN_GAP_MS || count >= WARM_DAILY_CAP) {
    return { warm: false, next: { ...state, day, count } };
  }
  return { warm: true, next: { lastAt: now, day, count: count + 1 } };
}

export const initialWarmState: WarmState = { lastAt: 0, day: '', count: 0 };
