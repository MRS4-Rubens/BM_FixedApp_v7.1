import { describe, expect, it } from 'vitest';
import { checkRateLimit, type RateLimiter } from '@/lib/rate-limit/upstash';

describe('checkRateLimit (SEC-005)', () => {
  it('returns allowed: true when limiter succeeds', async () => {
    const fakeLimiter: RateLimiter = {
      limit: async () => ({
        success: true,
        limit: 10,
        remaining: 9,
        reset: Date.now() + 60_000,
        pending: Promise.resolve(),
      }),
    };

    const result = await checkRateLimit(fakeLimiter, 'test-id');
    expect(result.allowed).toBe(true);
    expect(result.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it('returns allowed: false with retryAfterSeconds >= 1 when limiter rejects', async () => {
    const fakeLimiter: RateLimiter = {
      limit: async () => ({
        success: false,
        limit: 10,
        remaining: 0,
        reset: Date.now() + 15_000,
        pending: Promise.resolve(),
      }),
    };

    const result = await checkRateLimit(fakeLimiter, 'test-id');
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(result.retryAfterSeconds).toBeLessThanOrEqual(16);
  });

  it('guarantees retryAfterSeconds is at least 1 even if reset is in the past', async () => {
    const fakeLimiter: RateLimiter = {
      limit: async () => ({
        success: false,
        limit: 10,
        remaining: 0,
        reset: Date.now() - 5000,
        pending: Promise.resolve(),
      }),
    };

    const result = await checkRateLimit(fakeLimiter, 'test-id');
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBe(1);
  });

  it('throws an outage error when limiter returns reason: "timeout"', async () => {
    const fakeLimiter: RateLimiter = {
      limit: async () => ({
        success: true,
        limit: 10,
        remaining: 10,
        reset: Date.now() + 60_000,
        pending: Promise.resolve(),
        reason: 'timeout',
      }),
    };

    await expect(checkRateLimit(fakeLimiter, 'test-id')).rejects.toThrow('Rate limiter timed out');
  });
});

