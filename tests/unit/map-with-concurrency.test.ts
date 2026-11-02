import { describe, expect, it } from 'vitest';
import { mapWithConcurrency } from '@/lib/async/map-with-concurrency';

describe('mapWithConcurrency', () => {
  it('throws RangeError if limit is 0 or negative or non-integer', async () => {
    await expect(mapWithConcurrency([1, 2], 0, async (x) => x)).rejects.toThrow(RangeError);
    await expect(mapWithConcurrency([1, 2], -1, async (x) => x)).rejects.toThrow(RangeError);
    await expect(mapWithConcurrency([1, 2], 1.5, async (x) => x)).rejects.toThrow(RangeError);
  });

  it('preserves order of results and reports per-item status', async () => {
    const items = [10, 20, 30, 40, 50];
    const results = await mapWithConcurrency(items, 2, async (item) => item * 2);

    expect(results).toHaveLength(5);
    expect(results).toEqual([
      { status: 'fulfilled', value: 20 },
      { status: 'fulfilled', value: 40 },
      { status: 'fulfilled', value: 60 },
      { status: 'fulfilled', value: 80 },
      { status: 'fulfilled', value: 100 },
    ]);
  });

  it('never exceeds the concurrency limit in flight simultaneously', async () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    let activeCount = 0;
    let peakConcurrency = 0;

    await mapWithConcurrency(items, 3, async (item) => {
      activeCount += 1;
      peakConcurrency = Math.max(peakConcurrency, activeCount);
      // Small delay
      await new Promise((resolve) => setTimeout(resolve, 10));
      activeCount -= 1;
      return item;
    });

    expect(peakConcurrency).toBeLessThanOrEqual(3);
    expect(activeCount).toBe(0);
  });

  it('continues processing when one worker rejects and does not stop others', async () => {
    const items = ['a', 'b', 'c', 'd'];
    const results = await mapWithConcurrency(items, 2, async (item) => {
      if (item === 'b') {
        throw new Error('Boom at b');
      }
      return `ok-${item}`;
    });

    expect(results).toEqual([
      { status: 'fulfilled', value: 'ok-a' },
      { status: 'rejected', reason: expect.any(Error) },
      { status: 'fulfilled', value: 'ok-c' },
      { status: 'fulfilled', value: 'ok-d' },
    ]);
  });
});

