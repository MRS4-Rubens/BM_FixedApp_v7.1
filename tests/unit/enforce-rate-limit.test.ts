import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  enforceRateLimit,
  resetOutageLogThrottleForTests,
  OUTAGE_RETRY_AFTER_SECONDS,
} from '@/lib/rate-limit/enforce';
import type { RateLimiter } from '@/lib/rate-limit/upstash';
import { logError } from '@/lib/actions/_shared/logger';

vi.mock('@/lib/actions/_shared/logger', () => ({
  logError: vi.fn(),
}));

describe('Enforce Rate Limit Outage Engine (AUTH-002)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetOutageLogThrottleForTests();
  });

  it('returns allowed when limiter succeeds', async () => {
    const fakeLimiter: RateLimiter = {
      limit: vi.fn().mockResolvedValue({
        success: true,
        limit: 10,
        remaining: 9,
        reset: Date.now() + 10_000,
        pending: Promise.resolve(),
      }),
    };

    const result = await enforceRateLimit({
      limiter: fakeLimiter,
      identifier: 'test:id',
      policy: 'fail-closed',
      scope: 'test-scope',
    });

    expect(result).toEqual({ allowed: true, degraded: false });
    expect(logError).not.toHaveBeenCalled();
  });

  it('returns limited when limiter denies request with positive retryAfterSeconds', async () => {
    const fakeLimiter: RateLimiter = {
      limit: vi.fn().mockResolvedValue({
        success: false,
        limit: 10,
        remaining: 0,
        reset: Date.now() + 15_000,
        pending: Promise.resolve(),
      }),
    };

    const result = await enforceRateLimit({
      limiter: fakeLimiter,
      identifier: 'test:id',
      policy: 'fail-closed',
      scope: 'test-scope',
    });

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe('limited');
      expect(result.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    }
    expect(logError).not.toHaveBeenCalled();
  });

  it('fails open (allowed: true, degraded: true) when limiter throws and policy is fail-open', async () => {
    const error = new Error('Redis connection timeout');
    const fakeLimiter: RateLimiter = {
      limit: vi.fn().mockRejectedValue(error),
    };

    const result = await enforceRateLimit({
      limiter: fakeLimiter,
      identifier: 'test:id',
      policy: 'fail-open',
      scope: 'login-scope',
    });

    expect(result).toEqual({ allowed: true, degraded: true });
    expect(logError).toHaveBeenCalledWith('rate-limit-unavailable:login-scope', error, {
      policy: 'fail-open',
    });
  });

  it('fails closed (allowed: false, reason: unavailable) when limiter throws and policy is fail-closed', async () => {
    const error = new Error('Redis down');
    const fakeLimiter: RateLimiter = {
      limit: vi.fn().mockRejectedValue(error),
    };

    const result = await enforceRateLimit({
      limiter: fakeLimiter,
      identifier: 'test:id',
      policy: 'fail-closed',
      scope: 'signup-scope',
    });

    expect(result).toEqual({
      allowed: false,
      reason: 'unavailable',
      retryAfterSeconds: OUTAGE_RETRY_AFTER_SECONDS,
    });
    expect(logError).toHaveBeenCalledWith('rate-limit-unavailable:signup-scope', error, {
      policy: 'fail-closed',
    });
  });

  it('throttles outage alerts to at most 1 log per minute per scope', async () => {
    let fakeNow = 1_000_000;
    const error = new Error('Redis outage');
    const fakeLimiter: RateLimiter = {
      limit: vi.fn().mockRejectedValue(error),
    };

    // First failure at t=1,000,000 -> logs
    await enforceRateLimit({
      limiter: fakeLimiter,
      identifier: 'test:id',
      policy: 'fail-open',
      scope: 'throttled-scope',
      now: () => fakeNow,
    });
    expect(logError).toHaveBeenCalledTimes(1);

    // Second failure 30s later (t=1,030,000) -> should NOT log again
    fakeNow += 30_000;
    await enforceRateLimit({
      limiter: fakeLimiter,
      identifier: 'test:id',
      policy: 'fail-open',
      scope: 'throttled-scope',
      now: () => fakeNow,
    });
    expect(logError).toHaveBeenCalledTimes(1);

    // Third failure 61s after first (t=1,061,000) -> logs second alert
    fakeNow += 31_000;
    await enforceRateLimit({
      limiter: fakeLimiter,
      identifier: 'test:id',
      policy: 'fail-open',
      scope: 'throttled-scope',
      now: () => fakeNow,
    });
    expect(logError).toHaveBeenCalledTimes(2);

    // A different scope logs independently even if within the same minute
    await enforceRateLimit({
      limiter: fakeLimiter,
      identifier: 'test:id',
      policy: 'fail-closed',
      scope: 'different-scope',
      now: () => fakeNow,
    });
    expect(logError).toHaveBeenCalledTimes(3);
  });
});

