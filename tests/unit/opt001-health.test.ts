import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockDbExecute = vi.fn();
vi.mock('@/lib/db/client', () => ({
  db: {
    execute: (...args: unknown[]) => mockDbExecute(...args),
  },
}));

const mockRedisPing = vi.fn();
vi.mock('@/lib/rate-limit/upstash', () => ({
  getRedis: () => ({
    ping: (...args: unknown[]) => mockRedisPing(...args),
  }),
}));

const mockLogError = vi.fn();
vi.mock('@/lib/actions/_shared/logger', () => ({
  logError: (...args: unknown[]) => mockLogError(...args),
}));

import { GET } from '@/app/api/health/route';
import { resetHealthCacheForTests } from '@/lib/observability/health';

describe('OPT-001: /api/health endpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetHealthCacheForTests();
    mockDbExecute.mockResolvedValue([{ '?column?': 1 }]);
    mockRedisPing.mockResolvedValue('PONG');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns 200 with exact body and no-store headers when both database and redis are healthy', async () => {
    const req = new NextRequest('http://localhost:3000/api/health', {
      headers: { 'x-request-id': 'health-check-req-1' },
    });

    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('x-request-id')).toBe('health-check-req-1');

    const body = await res.json();
    expect(body).toEqual({
      status: 'ok',
      checks: {
        database: 'ok',
        redis: 'ok',
      },
    });
    expect(Object.keys(body)).toEqual(['status', 'checks']);
    expect(Object.keys(body.checks)).toEqual(['database', 'redis']);
    expect(mockLogError).not.toHaveBeenCalled();
  });

  it('returns 503 with database:error when database rejects, never exposing error message', async () => {
    const SECRET_ERROR_MSG = 'connection to server at neon.tech:5432 failed: password auth failed for user app_prod';
    mockDbExecute.mockRejectedValue(new Error(SECRET_ERROR_MSG));

    const req = new NextRequest('http://localhost:3000/api/health');
    const res = await GET(req);

    expect(res.status).toBe(503);
    expect(res.headers.get('Cache-Control')).toBe('no-store');

    const text = await res.text();
    expect(text).not.toContain(SECRET_ERROR_MSG);
    expect(text).not.toContain('neon.tech');
    expect(text).not.toContain('password');

    const body = JSON.parse(text);
    expect(body).toEqual({
      status: 'error',
      checks: {
        database: 'error',
        redis: 'ok',
      },
    });

    expect(mockLogError).toHaveBeenCalledWith(
      'health-check',
      expect.any(Error),
      { check: 'database' },
    );
  });

  it('returns 503 with redis:error when Redis hangs past 3000ms timeout', async () => {
    vi.useFakeTimers();

    // Redis hangs forever
    mockRedisPing.mockImplementation(() => new Promise(() => {}));

    const req = new NextRequest('http://localhost:3000/api/health');
    const getPromise = GET(req);

    // Advance fake timers by 3001 ms
    await vi.advanceTimersByTimeAsync(3001);

    const res = await getPromise;
    expect(res.status).toBe(503);

    const body = await res.json();
    expect(body).toEqual({
      status: 'error',
      checks: {
        database: 'ok',
        redis: 'error',
      },
    });

    expect(mockLogError).toHaveBeenCalledWith(
      'health-check',
      expect.objectContaining({ message: expect.stringContaining('timed out') }),
      { check: 'redis' },
    );
  });

  it('memoizes the computed result for 10 seconds and re-runs after 10 seconds', async () => {
    vi.useFakeTimers();

    const req1 = new NextRequest('http://localhost:3000/api/health');
    const res1 = await GET(req1);
    expect(res1.status).toBe(200);
    expect(mockDbExecute).toHaveBeenCalledTimes(1);
    expect(mockRedisPing).toHaveBeenCalledTimes(1);

    // Advance 5 seconds (within 10s TTL)
    await vi.advanceTimersByTimeAsync(5000);
    const req2 = new NextRequest('http://localhost:3000/api/health');
    const res2 = await GET(req2);
    expect(res2.status).toBe(200);
    // Checks NOT re-run
    expect(mockDbExecute).toHaveBeenCalledTimes(1);
    expect(mockRedisPing).toHaveBeenCalledTimes(1);

    // Advance another 6 seconds (total 11s > 10s TTL)
    await vi.advanceTimersByTimeAsync(6000);
    const req3 = new NextRequest('http://localhost:3000/api/health');
    const res3 = await GET(req3);
    expect(res3.status).toBe(200);
    // Checks re-run
    expect(mockDbExecute).toHaveBeenCalledTimes(2);
    expect(mockRedisPing).toHaveBeenCalledTimes(2);
  });

  it('logs failure only once per computation, not on cached hits', async () => {
    vi.useFakeTimers();
    mockDbExecute.mockRejectedValue(new Error('db outage'));

    // First call computes and fails
    const req1 = new NextRequest('http://localhost:3000/api/health');
    const res1 = await GET(req1);
    expect(res1.status).toBe(503);
    expect(mockLogError).toHaveBeenCalledTimes(1);

    // Second call within 10s uses cache
    await vi.advanceTimersByTimeAsync(5000);
    const req2 = new NextRequest('http://localhost:3000/api/health');
    const res2 = await GET(req2);
    expect(res2.status).toBe(503);
    expect(mockLogError).toHaveBeenCalledTimes(1); // Still 1

    // After 10s, next call re-runs and logs again
    await vi.advanceTimersByTimeAsync(6000);
    const req3 = new NextRequest('http://localhost:3000/api/health');
    const res3 = await GET(req3);
    expect(res3.status).toBe(503);
    expect(mockLogError).toHaveBeenCalledTimes(2);
  });
});

