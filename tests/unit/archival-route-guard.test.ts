import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { authorizeArchivalRequest, archivalResponse } from '@/lib/security/archival-route-guard';
import { createArchivalToken } from '@/lib/security/archival-token';
import { EnvConfigError } from '@/lib/env';

const TEST_SECRET = '0123456789abcdef0123456789abcdef';

const state = vi.hoisted(() => ({
  rateLimitAllowed: true,
  retryAfterSeconds: 0,
  replayOutcome: 'CONSUMED' as 'CONSUMED' | 'REPLAYED',
  replayError: null as Error | null,
  consumeSpy: vi.fn(),
  checkRateLimitSpy: vi.fn(),
  logErrorSpy: vi.fn(),
  secretThrowsEnvError: false,
}));

vi.mock('@/lib/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/env')>();
  return {
    ...actual,
    getArchivalEnv: vi.fn(() => {
      if (state.secretThrowsEnvError) {
        throw new EnvConfigError([{ group: 'ARCHIVAL', name: 'ARCHIVAL_SIGNING_SECRET', message: 'Missing secret' }]);
      }
      return { ARCHIVAL_SIGNING_SECRET: TEST_SECRET };
    }),
  };
});

vi.mock('@/lib/rate-limit/upstash', () => ({
  exportLimiter: {},
  checkRateLimit: async (...args: unknown[]) => {
    state.checkRateLimitSpy(...args);
    return { allowed: state.rateLimitAllowed, retryAfterSeconds: state.retryAfterSeconds };
  },
  getClientIp: () => '192.168.1.100',
}));

vi.mock('@/lib/security/archival-replay-guard', () => ({
  consumeArchivalJti: async (...args: unknown[]) => {
    state.consumeSpy(...args);
    if (state.replayError) {
      throw state.replayError;
    }
    return state.replayOutcome;
  },
}));

vi.mock('@/lib/actions/_shared/logger', () => ({
  logError: (...args: unknown[]) => {
    state.logErrorSpy(...args);
  },
}));

describe('Archival Route Guard (SEC-004)', () => {
  const documentId = '11111111-2222-4333-8444-555555555555';

  beforeEach(() => {
    vi.clearAllMocks();
    state.rateLimitAllowed = true;
    state.retryAfterSeconds = 0;
    state.replayOutcome = 'CONSUMED';
    state.replayError = null;
    state.secretThrowsEnvError = false;
  });

  const assertSecurityHeaders = (res: Response) => {
    expect(res.headers.get('Cache-Control')).toBe('no-store, max-age=0');
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow, noarchive');
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  };

  it('rejects missing token with 401 and security headers', async () => {
    const req = new NextRequest(`http://localhost:3000/api/invoices/${documentId}/archival-render`);
    const result = await authorizeArchivalRequest(req, 'invoice', documentId);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
      assertSecurityHeaders(result.response);
      await expect(result.response.text()).resolves.toBe('Unauthorized');
    }
  });

  it('rejects empty token with 401', async () => {
    const req = new NextRequest(`http://localhost:3000/api/invoices/${documentId}/archival-render?token=`);
    const result = await authorizeArchivalRequest(req, 'invoice', documentId);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
      assertSecurityHeaders(result.response);
    }
  });

  it('rejects two token parameters with 401', async () => {
    const token1 = createArchivalToken('invoice', documentId);
    const token2 = createArchivalToken('invoice', documentId);
    const req = new NextRequest(
      `http://localhost:3000/api/invoices/${documentId}/archival-render?token=${token1}&token=${token2}`,
    );
    const result = await authorizeArchivalRequest(req, 'invoice', documentId);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
      assertSecurityHeaders(result.response);
    }
  });

  it('rejects invalid token with 401 without touching rate limiter or Redis', async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/invoices/${documentId}/archival-render?token=invalid.token`,
    );
    const result = await authorizeArchivalRequest(req, 'invoice', documentId);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
      assertSecurityHeaders(result.response);
    }
    expect(state.checkRateLimitSpy).not.toHaveBeenCalled();
    expect(state.consumeSpy).not.toHaveBeenCalled();
  });

  it('returns 429 when rate limited with Retry-After and does NOT consume jti, succeeding on later retry', async () => {
    const token = createArchivalToken('invoice', documentId);
    const req = new NextRequest(
      `http://localhost:3000/api/invoices/${documentId}/archival-render?token=${token}`,
    );

    // Rate limited
    state.rateLimitAllowed = false;
    state.retryAfterSeconds = 45;

    const rateLimitedResult = await authorizeArchivalRequest(req, 'invoice', documentId);
    expect(rateLimitedResult.ok).toBe(false);
    if (!rateLimitedResult.ok) {
      expect(rateLimitedResult.response.status).toBe(429);
      expect(rateLimitedResult.response.headers.get('Retry-After')).toBe('45');
      assertSecurityHeaders(rateLimitedResult.response);
    }
    expect(state.consumeSpy).not.toHaveBeenCalled();

    // Later call with same token when rate limiter allows
    state.rateLimitAllowed = true;
    const retryResult = await authorizeArchivalRequest(req, 'invoice', documentId);
    expect(retryResult.ok).toBe(true);
    expect(state.consumeSpy).toHaveBeenCalledTimes(1);
  });

  it('consumes jti with ex equal to remaining lifetime plus 60 seconds on success', async () => {
    const nowMs = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(nowMs);

    const token = createArchivalToken('invoice', documentId, 120, nowMs);
    const req = new NextRequest(
      `http://localhost:3000/api/invoices/${documentId}/archival-render?token=${token}`,
    );

    const result = await authorizeArchivalRequest(req, 'invoice', documentId);
    expect(result.ok).toBe(true);

    expect(state.consumeSpy).toHaveBeenCalledTimes(1);
    // remaining is 120, plus 60 grace = 180s
    expect(state.consumeSpy).toHaveBeenCalledWith(expect.any(String), 180);
  });

  it('rejects replay with 401 and logs once with expected: true without logging token', async () => {
    const token = createArchivalToken('invoice', documentId);
    const req = new NextRequest(
      `http://localhost:3000/api/invoices/${documentId}/archival-render?token=${token}`,
    );

    state.replayOutcome = 'REPLAYED';
    const result = await authorizeArchivalRequest(req, 'invoice', documentId);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
      assertSecurityHeaders(result.response);
    }

    expect(state.logErrorSpy).toHaveBeenCalledTimes(1);
    const [scope, err, meta] = state.logErrorSpy.mock.calls[0] as [string, Error, Record<string, unknown>];
    expect(scope).toBe('archival-render');
    expect(err.message).toBe('Archival token replay rejected');
    expect(meta.expected).toBe(true);
    expect(meta.documentType).toBe('invoice');
    expect(meta.documentId).toBe(documentId);
    // Token must never appear in log
    expect(JSON.stringify(meta)).not.toContain(token);
    expect(JSON.stringify(meta)).not.toContain(token.split('.')[2]);
  });

  it('fails closed with 503 and Retry-After: 5 on Redis store failure', async () => {
    const token = createArchivalToken('invoice', documentId);
    const req = new NextRequest(
      `http://localhost:3000/api/invoices/${documentId}/archival-render?token=${token}`,
    );

    state.replayError = new Error('Redis connection refused');
    const result = await authorizeArchivalRequest(req, 'invoice', documentId);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(503);
      expect(result.response.headers.get('Retry-After')).toBe('5');
      assertSecurityHeaders(result.response);
      await expect(result.response.text()).resolves.toBe('Service Unavailable');
    }

    expect(state.logErrorSpy).toHaveBeenCalledTimes(1);
    const [scope, err, meta] = state.logErrorSpy.mock.calls[0] as [string, Error, Record<string, unknown>];
    expect(scope).toBe('archival-render');
    expect(err.message).toBe('Redis connection refused');
    expect(meta.stage).toBe('authorize');
  });

  it('fails closed with 503 when signing secret throws EnvConfigError', async () => {
    state.secretThrowsEnvError = true;
    const validShapeToken = `inv.${documentId}.${'A'.repeat(22)}.1700000120.${'B'.repeat(43)}`;
    const req = new NextRequest(
      `http://localhost:3000/api/invoices/${documentId}/archival-render?token=${validShapeToken}`,
    );

    const result = await authorizeArchivalRequest(req, 'invoice', documentId);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(503);
      expect(result.response.headers.get('Retry-After')).toBe('5');
      assertSecurityHeaders(result.response);
    }
    expect(state.logErrorSpy).toHaveBeenCalledTimes(1);
  });

  it('archivalResponse helper embeds all four security headers', () => {
    const res = archivalResponse('Hello', { status: 200, headers: { 'Content-Type': 'text/plain' } });
    assertSecurityHeaders(res);
    expect(res.headers.get('Content-Type')).toBe('text/plain');
    expect(res.status).toBe(200);
  });
});
