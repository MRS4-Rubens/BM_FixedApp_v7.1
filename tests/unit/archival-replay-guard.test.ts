import { describe, expect, it, vi } from 'vitest';
import { consumeArchivalJti, type ReplayStore } from '@/lib/security/archival-replay-guard';

describe('Archival Replay Guard (SEC-004)', () => {
  it('marks jti as consumed on first call and replayed on second call with fake store', async () => {
    const memory = new Map<string, number>();
    const fakeStore: ReplayStore = {
      set: vi.fn(async (key: string, value: number, options: { nx: true; ex: number }) => {
        if (options.nx && memory.has(key)) {
          return null;
        }
        memory.set(key, value);
        return 'OK';
      }),
    };

    const jti = 'abcdefghijklmnopqrstuv';
    const firstCall = await consumeArchivalJti(jti, 180, fakeStore);
    expect(firstCall).toBe('CONSUMED');
    expect(fakeStore.set).toHaveBeenCalledWith(`archival:jti:${jti}`, 1, { nx: true, ex: 180 });

    const secondCall = await consumeArchivalJti(jti, 180, fakeStore);
    expect(secondCall).toBe('REPLAYED');
    expect(fakeStore.set).toHaveBeenCalledTimes(2);
  });

  it('passes the exact key, value 1, nx: true, and given ex TTL to store', async () => {
    const fakeStore: ReplayStore = {
      set: vi.fn(async () => 'OK'),
    };

    const jti = 'jti-test-1234567890abc';
    const outcome = await consumeArchivalJti(jti, 240, fakeStore);

    expect(outcome).toBe('CONSUMED');
    expect(fakeStore.set).toHaveBeenCalledWith('archival:jti:jti-test-1234567890abc', 1, {
      nx: true,
      ex: 240,
    });
  });

  it('throws RangeError for non-positive or non-integer ttlSeconds', async () => {
    const fakeStore: ReplayStore = {
      set: vi.fn(async () => 'OK'),
    };

    await expect(consumeArchivalJti('jti', 0, fakeStore)).rejects.toThrow(RangeError);
    await expect(consumeArchivalJti('jti', -10, fakeStore)).rejects.toThrow(RangeError);
    await expect(consumeArchivalJti('jti', 1.5, fakeStore)).rejects.toThrow(RangeError);
    await expect(consumeArchivalJti('jti', NaN, fakeStore)).rejects.toThrow(RangeError);
  });

  it('propagates store errors so callers fail closed', async () => {
    const storeError = new Error('Upstash connection timeout');
    const fakeStore: ReplayStore = {
      set: vi.fn(async () => {
        throw storeError;
      }),
    };

    await expect(consumeArchivalJti('jti', 120, fakeStore)).rejects.toThrow('Upstash connection timeout');
  });
});
