import { describe, expect, it, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { ActionError } from '@/lib/actions/_shared/errors';

vi.mock('@/lib/auth/session', () => ({
  getCurrentAppUser: vi.fn(),
}));

vi.mock('@/lib/actions/_shared/subscription-guard', () => ({
  assertBusinessNotSuspended: vi.fn(),
}));

vi.mock('@/lib/rate-limit/upstash', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
}));

vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}));

vi.mock('@/lib/actions/_shared/logger', () => ({
  logError: vi.fn(),
}));

import { getCurrentAppUser } from '@/lib/auth/session';
import { assertBusinessNotSuspended } from '@/lib/actions/_shared/subscription-guard';
import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';

describe('createAuthenticatedAction - Subscription Guard (API-010)', () => {
  const dummyUser = {
    id: 'user_001',
    auth_user_id: 'auth_001',
    business_id: 'biz_001',
    display_name: 'Test User',
    email: 'test@example.com',
    role: 'owner' as const,
    created_at: new Date(),
    updated_at: new Date(),
    notification_prefs: {},
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentAppUser).mockResolvedValue(dummyUser);
    vi.mocked(assertBusinessNotSuspended).mockResolvedValue(undefined);
  });

  it('option true + suspended business -> handler NOT called, returns ACCOUNT_SUSPENDED', async () => {
    vi.mocked(assertBusinessNotSuspended).mockRejectedValue(
      new ActionError('Your account has been suspended. Please contact platform support.', {
        code: 'ACCOUNT_SUSPENDED',
      }),
    );

    const handler = vi.fn().mockResolvedValue({ ok: true });
    const action = createAuthenticatedAction(
      z.object({}),
      handler,
      'test-subscription-scope',
      { requireActiveSubscription: true },
    );

    const result = await action({});

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('ACCOUNT_SUSPENDED');
      expect(result.error.message).toContain('Your account has been suspended');
    }
    expect(handler).not.toHaveBeenCalled();
    expect(assertBusinessNotSuspended).toHaveBeenCalledWith('biz_001');
  });

  it('option true + active business -> handler runs', async () => {
    vi.mocked(assertBusinessNotSuspended).mockResolvedValue(undefined);

    const handler = vi.fn().mockResolvedValue({ processed: true });
    const action = createAuthenticatedAction(
      z.object({ name: z.string() }),
      handler,
      'test-subscription-scope',
      { requireActiveSubscription: true },
    );

    const result = await action({ name: 'Acme Corp' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ processed: true });
    }
    expect(handler).toHaveBeenCalledTimes(1);
    expect(assertBusinessNotSuspended).toHaveBeenCalledWith('biz_001');
  });

  it('option absent -> subscription guard is never invoked', async () => {
    const handler = vi.fn().mockResolvedValue({ ok: true });
    const action = createAuthenticatedAction(
      z.object({}),
      handler,
      'test-subscription-scope',
    );

    const result = await action({});

    expect(result.success).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(assertBusinessNotSuspended).not.toHaveBeenCalled();
  });

  it('user without business -> subscription check is skipped', async () => {
    vi.mocked(getCurrentAppUser).mockResolvedValue({
      ...dummyUser,
      business_id: null,
    });

    const handler = vi.fn().mockResolvedValue({ ok: true });
    const action = createAuthenticatedAction(
      z.object({}),
      handler,
      'test-subscription-scope',
      { requireActiveSubscription: true },
    );

    const result = await action({});

    expect(result.success).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(assertBusinessNotSuspended).not.toHaveBeenCalled();
  });
});

