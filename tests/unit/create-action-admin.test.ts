import { describe, expect, it, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { redirect } from 'next/navigation';
import { ActionError } from '@/lib/actions/_shared/errors';

vi.mock('@/lib/auth/session', () => ({
  getCurrentAppUser: vi.fn(),
}));

vi.mock('@/lib/auth/admin', () => ({
  requirePlatformAdmin: vi.fn(),
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
import { requirePlatformAdmin } from '@/lib/auth/admin';
import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';

describe('createAuthenticatedAction - Platform Admin & Redirects (AUTH-001)', () => {
  const dummyUser = {
    id: 'user_001',
    auth_user_id: 'auth_001',
    business_id: 'biz_001',
    display_name: 'Test User',
    email: 'test@example.com',
    role: 'owner' as const,
    created_at: new Date(),
    updated_at: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentAppUser).mockResolvedValue(dummyUser);
    vi.mocked(requirePlatformAdmin).mockResolvedValue({
      id: 'auth_001',
      email: 'admin@billmatrix.in',
      via: 'verified_email',
    });
  });

  it('(1) with requirePlatformAdmin: true and requirePlatformAdmin() rejecting -> returns UNAUTHORIZED_ACCESS and handler is not called', async () => {
    vi.mocked(requirePlatformAdmin).mockRejectedValue(
      new ActionError('Unauthorized: Access denied.', { code: 'UNAUTHORIZED_ACCESS' })
    );

    const handler = vi.fn().mockResolvedValue({ ok: true });
    const action = createAuthenticatedAction(
      z.object({}),
      handler,
      'test-scope',
      { requirePlatformAdmin: true }
    );

    const result = await action({});

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('UNAUTHORIZED_ACCESS');
      expect(result.error.message).toBe('Unauthorized: Access denied.');
    }
    expect(handler).not.toHaveBeenCalled();
    expect(requirePlatformAdmin).toHaveBeenCalledTimes(1);
  });

  it('(2) when requirePlatformAdmin resolves -> handler runs', async () => {
    const handler = vi.fn().mockResolvedValue({ processed: true });
    const action = createAuthenticatedAction(
      z.object({ name: z.string() }),
      handler,
      'test-scope',
      { requirePlatformAdmin: true }
    );

    const result = await action({ name: 'Bill' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ processed: true });
    }
    expect(requirePlatformAdmin).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('(3) without requirePlatformAdmin option -> requirePlatformAdmin is never called', async () => {
    const handler = vi.fn().mockResolvedValue({ done: true });
    const action = createAuthenticatedAction(
      z.object({}),
      handler,
      'test-scope'
    );

    const result = await action({});

    expect(result.success).toBe(true);
    expect(requirePlatformAdmin).not.toHaveBeenCalled();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('(4) when getCurrentAppUser throws a real Next.js redirect -> action REJECTS with that redirect error', async () => {
    vi.mocked(getCurrentAppUser).mockImplementation(() => {
      redirect('/login');
    });

    const handler = vi.fn().mockResolvedValue({ done: true });
    const action = createAuthenticatedAction(
      z.object({}),
      handler,
      'test-scope'
    );

    let caughtError: unknown = null;
    try {
      await action({});
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).not.toBeNull();
    // Next.js redirect errors have a digest starting with NEXT_REDIRECT
    expect((caughtError as { digest?: string })?.digest).toContain('NEXT_REDIRECT');
    expect(handler).not.toHaveBeenCalled();
  });
});
