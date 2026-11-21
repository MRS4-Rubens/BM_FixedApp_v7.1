import { describe, expect, it, vi } from 'vitest';

const { set } = vi.hoisted(() => ({ set: vi.fn() }));
vi.mock('@/lib/rate-limit/upstash', () => ({ getRedis: () => ({ set }) }));
vi.mock('@/lib/actions/_shared/logger', () => ({ logError: vi.fn() }));

import { REDIS_KEEPALIVE_KEY, touchRedisKeepalive } from '@/lib/cron/redis-keepalive';

describe('B6 daily Redis keepalive', () => {
  it('writes one key with an 8-day expiry', async () => {
    set.mockResolvedValueOnce('OK');
    const now = new Date('2026-11-21T03:30:00.000Z');
    expect(await touchRedisKeepalive(now)).toBe(true);
    expect(set).toHaveBeenLastCalledWith(REDIS_KEEPALIVE_KEY, now.toISOString(), { ex: 8 * 24 * 60 * 60 });
  });

  it('never throws when Redis is down (the notifications job must still run)', async () => {
    set.mockImplementationOnce(() => Promise.reject(new TypeError('fetch failed')));
    let outcome: string;
    try {
      outcome = String(await touchRedisKeepalive());
    } catch {
      outcome = 'threw';
    }
    expect(outcome).toBe('false');
  });

  it('gives up on a stalled write so the notifications still start', async () => {
    set.mockImplementationOnce(() => new Promise(() => {}));
    const started = Date.now();
    expect(await touchRedisKeepalive(new Date(), 30)).toBe(false);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
