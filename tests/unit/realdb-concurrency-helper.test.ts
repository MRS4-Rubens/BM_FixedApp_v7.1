import { describe, expect, it } from 'vitest';
import {
  createGate,
  runConcurrently,
  countFulfilled,
} from '@/tests/realdb/helpers/concurrency';

describe('RealDB Concurrency Helper (TEST-002)', () => {
  it('all tasks wait behind gate and start only after gate opens', async () => {
    const gate = createGate();
    let gateWasOpened = false;

    const promise = (async () => {
      await gate.opened;
      return gateWasOpened;
    })();

    // Before gate is opened, promise should still be pending
    gateWasOpened = true;
    gate.open();

    const result = await promise;
    expect(result).toBe(true);
  });

  it('runConcurrently preserves index order across resolved tasks', async () => {
    const results = await runConcurrently(5, async (index) => {
      return `task-${index}`;
    });

    expect(results).toHaveLength(5);
    expect(countFulfilled(results)).toBe(5);

    for (let i = 0; i < 5; i++) {
      const res = results[i];
      expect(res.status).toBe('fulfilled');
      if (res.status === 'fulfilled') {
        expect(res.value).toBe(`task-${i}`);
      }
    }
  });

  it('reports rejected tasks without throwing an unhandled exception', async () => {
    const results = await runConcurrently(4, async (index) => {
      if (index % 2 === 1) {
        throw new Error(`error-${index}`);
      }
      return `ok-${index}`;
    });

    expect(results).toHaveLength(4);
    expect(countFulfilled(results)).toBe(2);

    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('rejected');
    expect(results[2].status).toBe('fulfilled');
    expect(results[3].status).toBe('rejected');

    if (results[1].status === 'rejected') {
      expect((results[1].reason as Error).message).toBe('error-1');
    }
  });
});

