import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { RateLimiter } from '@/lib/rate-limit/upstash';

const mockCheckRateLimit = vi.fn();
const mockGetClientIp = vi.fn().mockReturnValue('127.0.0.1');

vi.mock('@/lib/rate-limit/upstash', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  getClientIp: (...args: unknown[]) => mockGetClientIp(...args),
  sensitiveActionLimiter: { limit: vi.fn() },
}));

const mockGetCurrentAppUser = vi.fn();
vi.mock('@/lib/auth/session', () => ({
  getCurrentAppUser: () => mockGetCurrentAppUser(),
}));

const mockRequirePlatformAdmin = vi.fn();
vi.mock('@/lib/auth/admin', () => ({
  requirePlatformAdmin: () => mockRequirePlatformAdmin(),
}));

const mockLogError = vi.fn();
vi.mock('@/lib/actions/_shared/logger', () => ({
  logError: (...args: unknown[]) => mockLogError(...args),
}));

vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}));

import { createAuthenticatedAction, createAction } from '@/lib/actions/_shared/create-action';
import { defaultActionLimiter } from '@/lib/rate-limit/limiters';
import { ActionError } from '@/lib/actions/_shared/errors';
import * as enforceModule from '@/lib/rate-limit/enforce';

const dummyUserA = {
  id: 'user_a',
  auth_user_id: 'auth_a',
  business_id: 'biz_a',
  display_name: 'User A',
  email: 'a@example.com',
  role: 'owner' as const,
  created_at: new Date(),
  updated_at: new Date(),
};

const dummyUserB = {
  ...dummyUserA,
  id: 'user_b',
  auth_user_id: 'auth_b',
  email: 'b@example.com',
};

describe('createAuthenticatedAction rate limiting (SEC-005)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enforceModule.resetOutageLogThrottleForTests();
    mockGetCurrentAppUser.mockResolvedValue(dummyUserA);
    mockCheckRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 60 });
  });

  it('an action without options calls enforceRateLimit once with defaultActionLimiter, default:<scope>:<userId>, fail-open, and action-default', async () => {
    const spy = vi.spyOn(enforceModule, 'enforceRateLimit');
    const handler = vi.fn().mockResolvedValue('ok');
    const action = createAuthenticatedAction(z.object({}), handler, 'test-default-action');

    const result = await action({});
    expect(result.success).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({
      limiter: defaultActionLimiter,
      identifier: 'default:test-default-action:user_a',
      policy: 'fail-open',
      scope: 'action-default',
    });
  });

  it('an action with an explicit limiter calls it with its prefix and policy and does not call defaultActionLimiter', async () => {
    const spy = vi.spyOn(enforceModule, 'enforceRateLimit');
    const customLimiter: RateLimiter = { limit: vi.fn() };
    const handler = vi.fn().mockResolvedValue('ok');
    const action = createAuthenticatedAction(z.object({}), handler, 'test-explicit-action', {
      rateLimit: {
        limiter: customLimiter,
        keyPrefix: 'custom-prefix',
        outage: 'fail-closed',
      },
    });

    const result = await action({});
    expect(result.success).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({
      limiter: customLimiter,
      identifier: 'custom-prefix:user_a',
      policy: 'fail-closed',
      scope: 'custom-prefix',
    });
  });

  it('rateLimit: false calls neither the default nor an explicit limiter', async () => {
    const spy = vi.spyOn(enforceModule, 'enforceRateLimit');
    const handler = vi.fn().mockResolvedValue('ok');
    const action = createAuthenticatedAction(z.object({}), handler, 'test-optout-action', {
      rateLimit: false,
    });

    const result = await action({});
    expect(result.success).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('maps limited outcome to RATE_LIMITED with retryAfterSeconds in message', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 42 });
    const handler = vi.fn().mockResolvedValue('ok');
    const action = createAuthenticatedAction(z.object({}), handler, 'test-limited');

    const result = await action({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('RATE_LIMITED');
      expect(result.error.message).toContain('42 seconds');
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it('maps unavailable outcome (under fail-closed) to SERVICE_UNAVAILABLE', async () => {
    mockCheckRateLimit.mockRejectedValue(new Error('Redis connection refused'));
    const customLimiter: RateLimiter = { limit: vi.fn() };
    const handler = vi.fn().mockResolvedValue('ok');
    const action = createAuthenticatedAction(z.object({}), handler, 'test-unavailable', {
      rateLimit: {
        limiter: customLimiter,
        keyPrefix: 'crit',
        outage: 'fail-closed',
      },
    });

    const result = await action({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('SERVICE_UNAVAILABLE');
      expect(result.error.message).toBe(
        'We are temporarily unable to process this request. Please try again in a moment.'
      );
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it('degraded outcome proceeds and handler runs', async () => {
    mockCheckRateLimit.mockRejectedValue(new Error('Redis timeout'));
    const handler = vi.fn().mockResolvedValue({ status: 'done' });
    const action = createAuthenticatedAction(z.object({}), handler, 'test-degraded');

    const result = await action({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ status: 'done' });
    }
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('denies non-admin calling requirePlatformAdmin before any rate limiter call', async () => {
    const spy = vi.spyOn(enforceModule, 'enforceRateLimit');
    mockRequirePlatformAdmin.mockRejectedValue(
      new ActionError('Platform admin privileges required.', { code: 'FORBIDDEN' })
    );

    const handler = vi.fn().mockResolvedValue('ok');
    const action = createAuthenticatedAction(z.object({}), handler, 'test-admin-gate', {
      requirePlatformAdmin: true,
    });

    const result = await action({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('FORBIDDEN');
    }
    expect(spy).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it('STATEFUL BURST: 200 sequential calls give 120 successes and 80 RATE_LIMITED; other user and other scope are unaffected', async () => {
    const counts = new Map<string, number>();
    mockCheckRateLimit.mockImplementation(async (_limiter: unknown, identifier: string) => {
      const current = counts.get(identifier) ?? 0;
      if (current >= 120) {
        return { allowed: false, retryAfterSeconds: 30 };
      }
      counts.set(identifier, current + 1);
      return { allowed: true, retryAfterSeconds: 60 };
    });

    const handler = vi.fn().mockResolvedValue('ok');
    const action1 = createAuthenticatedAction(z.object({}), handler, 'action-one');

    let successCount = 0;
    let rateLimitedCount = 0;

    for (let i = 0; i < 200; i++) {
      const res = await action1({});
      if (res.success) successCount++;
      else if (res.error.code === 'RATE_LIMITED') rateLimitedCount++;
    }

    expect(successCount).toBe(120);
    expect(rateLimitedCount).toBe(80);

    // Different user is unaffected
    mockGetCurrentAppUser.mockResolvedValue(dummyUserB);
    const userBRes = await action1({});
    expect(userBRes.success).toBe(true);

    // Different action scope for same user (User A) is unaffected
    mockGetCurrentAppUser.mockResolvedValue(dummyUserA);
    const action2 = createAuthenticatedAction(z.object({}), handler, 'action-two');
    const action2Res = await action2({});
    expect(action2Res.success).toBe(true);
  });

  it('OUTAGE: checkRateLimit rejects: fail-open action succeeds, throttles logError to 1 per min; fail-closed returns SERVICE_UNAVAILABLE', async () => {
    mockCheckRateLimit.mockRejectedValue(new Error('Upstash connection refused'));

    const handler = vi.fn().mockResolvedValue('ok');
    const defaultAction = createAuthenticatedAction(z.object({}), handler, 'scope-fail-open');

    // First call: degraded allowed, logs outage once
    const res1 = await defaultAction({});
    expect(res1.success).toBe(true);

    // Second call immediately: degraded allowed, log is throttled (still 1 call)
    const res2 = await defaultAction({});
    expect(res2.success).toBe(true);

    const outageLogs = mockLogError.mock.calls.filter(([scope]) =>
      (scope as string).startsWith('rate-limit-unavailable:action-default')
    );
    expect(outageLogs.length).toBe(1);

    // Explicit fail-closed action
    const failClosedAction = createAuthenticatedAction(z.object({}), handler, 'scope-fail-closed', {
      rateLimit: {
        limiter: { limit: vi.fn() },
        keyPrefix: 'closed-prefix',
        outage: 'fail-closed',
      },
    });

    const failClosedRes = await failClosedAction({});
    expect(failClosedRes.success).toBe(false);
    if (!failClosedRes.success) {
      expect(failClosedRes.error.code).toBe('SERVICE_UNAVAILABLE');
    }
  });

  it('createAction unauthenticated applies explicit limiter with IP and outage policy', async () => {
    mockGetClientIp.mockReturnValue('203.0.113.1');
    const customLimiter: RateLimiter = { limit: vi.fn() };
    const spy = vi.spyOn(enforceModule, 'enforceRateLimit');
    const handler = vi.fn().mockResolvedValue('public-ok');

    const publicAction = createAction(z.object({}), handler, 'public-test', {
      rateLimit: {
        limiter: customLimiter,
        keyPrefix: 'pub',
        outage: 'fail-closed',
      },
    });

    const res = await publicAction({});
    expect(res.success).toBe(true);
    expect(spy).toHaveBeenCalledWith({
      limiter: customLimiter,
      identifier: 'pub:203.0.113.1',
      policy: 'fail-closed',
      scope: 'pub',
    });
  });
});

