import { describe, expect, it } from 'vitest';
import { WARM_DAILY_CAP, WARM_MIN_GAP_MS, decideWarm, initialWarmState } from '@/lib/db/warmup-policy';

// B2: the login-screen wake-up is public, so it must be capped to protect Neon's free compute-hours.
describe('B2 database wake-up cap', () => {
  const t0 = Date.parse('2026-11-21T04:00:00.000Z'); // 09:30 IST

  it('wakes on the first call', () => {
    expect(decideWarm(initialWarmState, t0).warm).toBe(true);
  });

  it('ignores calls within 4 minutes of the last ping', () => {
    const first = decideWarm(initialWarmState, t0).next;
    expect(decideWarm(first, t0 + WARM_MIN_GAP_MS - 1).warm).toBe(false);
    expect(decideWarm(first, t0 + WARM_MIN_GAP_MS).warm).toBe(true);
  });

  it('stops after the daily cap even under non-stop calls, and resets the next IST day', () => {
    let state = initialWarmState;
    let pings = 0;
    for (let i = 0; i < 500; i++) {
      const d = decideWarm(state, t0 + i * WARM_MIN_GAP_MS);
      state = d.next;
      if (d.warm) pings++;
      if (i * WARM_MIN_GAP_MS > 12 * 3_600_000) break; // stay inside the same IST day
    }
    expect(pings).toBe(WARM_DAILY_CAP);
    const nextDay = t0 + 24 * 3_600_000;
    expect(decideWarm(state, nextDay).warm).toBe(true);
  });
});
