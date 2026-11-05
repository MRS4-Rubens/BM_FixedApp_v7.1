import { describe, expect, it, vi } from 'vitest';

// Simulate the standard test mock factory that omits getRedis
vi.mock('@/lib/rate-limit/upstash', () => ({
  sensitiveActionLimiter: { limit: vi.fn() },
  checkRateLimit: vi.fn(),
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
}));

describe('limiters lazy instantiation (SEC-005)', () => {
  it('does not throw when importing @/lib/rate-limit/limiters even if getRedis is absent from the upstash mock', async () => {
    // Dynamically import limiters module
    const limiters = await import('@/lib/rate-limit/limiters');

    expect(limiters.defaultActionLimiter).toBeDefined();
    expect(typeof limiters.defaultActionLimiter.limit).toBe('function');
    expect(limiters.publicAssetLimiter).toBeDefined();
    expect(typeof limiters.publicAssetLimiter.limit).toBe('function');
    expect(limiters.DEFAULT_ACTION_LIMIT).toBe(120);
    expect(limiters.PUBLIC_ASSET_LIMIT).toBe(300);
  });
});

