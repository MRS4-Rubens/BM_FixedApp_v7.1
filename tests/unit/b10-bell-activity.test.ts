import { describe, expect, it } from 'vitest';
import { ACTIVE_WINDOW_MS, shouldTimedRefresh } from '@/components/app/notifications/refresh-policy';

// B10: a shop PC left open on the app must not wake the database every 30 minutes all day.
describe('B10 bell background refresh', () => {
  const now = 1_700_000_000_000;

  it('checks when the tab is visible and someone used it recently', () => {
    expect(shouldTimedRefresh(true, now, now - 60_000)).toBe(true);
    expect(shouldTimedRefresh(true, now, now - ACTIVE_WINDOW_MS)).toBe(true);
  });

  it('skips when nobody touched the tab for more than 10 minutes', () => {
    expect(shouldTimedRefresh(true, now, now - ACTIVE_WINDOW_MS - 1)).toBe(false);
  });

  it('skips when the tab is hidden', () => {
    expect(shouldTimedRefresh(false, now, now)).toBe(false);
  });
});
