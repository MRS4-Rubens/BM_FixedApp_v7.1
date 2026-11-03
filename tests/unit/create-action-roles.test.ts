import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { OWNER_ONLY, FORBIDDEN_ROLE_CODE, FORBIDDEN_ROLE_MESSAGE } from '@/lib/auth/rbac';

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
import { checkRateLimit } from '@/lib/rate-limit/upstash';
import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';

describe('createAuthenticatedAction - Role-based Access Control (AUTH-003)', () => {
  const dummyOwner = {
    id: 'user_owner_001',
    auth_user_id: 'auth_owner_001',
    business_id: 'biz_001',
    display_name: 'Owner User',
    email: 'owner@example.com',
    role: 'owner' as const,
    created_at: new Date(),
    updated_at: new Date(),
  };

  const dummyStaff = {
    id: 'user_staff_001',
    auth_user_id: 'auth_staff_001',
    business_id: 'biz_001',
    display_name: 'Staff User',
    email: 'staff@example.com',
    role: 'staff' as const,
    created_at: new Date(),
    updated_at: new Date(),
  };

  /**
   * Helper simulating a data layer anomaly where the role column contains an unknown string.
   * This is the only permitted cast in test code per the AUTH-003 specification.
   */
  function makeUserWithInvalidRole(invalidRoleString: string) {
    return {
      ...dummyStaff,
      role: invalidRoleString as unknown as 'owner' | 'staff',
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentAppUser).mockResolvedValue(dummyOwner);
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
    vi.mocked(requirePlatformAdmin).mockResolvedValue({
      id: 'auth_admin_001',
      email: 'admin@billmatrix.in',
      via: 'verified_email',
    });
  });

  it('1. Staff + roles: OWNER_ONLY -> forbidden, handler/rate-limit/admin not called', async () => {
    vi.mocked(getCurrentAppUser).mockResolvedValue(dummyStaff);

    const handler = vi.fn().mockResolvedValue({ ok: true });
    const action = createAuthenticatedAction(
      z.object({}),
      handler,
      'test-owner-action',
      {
        roles: OWNER_ONLY,
        rateLimit: {
          limiter: {} as unknown as Parameters<typeof checkRateLimit>[0],
          keyPrefix: 'test',
        },
      }
    );

    const result = await action({});

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(FORBIDDEN_ROLE_CODE);
      expect(result.error.message).toBe(FORBIDDEN_ROLE_MESSAGE);
    }
    expect(handler).not.toHaveBeenCalled();
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(requirePlatformAdmin).not.toHaveBeenCalled();
  });

  it('2. Owner + roles: OWNER_ONLY -> handler called once and succeeds', async () => {
    vi.mocked(getCurrentAppUser).mockResolvedValue(dummyOwner);

    const handler = vi.fn().mockResolvedValue({ status: 'done' });
    const action = createAuthenticatedAction(
      z.object({ val: z.string() }),
      handler,
      'test-owner-action',
      { roles: OWNER_ONLY }
    );

    const result = await action({ val: 'hello' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ status: 'done' });
    }
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('3. Staff with no roles option -> success (backward compatible)', async () => {
    vi.mocked(getCurrentAppUser).mockResolvedValue(dummyStaff);

    const handler = vi.fn().mockResolvedValue({ allowed: true });
    const action = createAuthenticatedAction(
      z.object({}),
      handler,
      'test-open-action'
    );

    const result = await action({});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ allowed: true });
    }
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('4. Invalid role value from data layer -> FORBIDDEN_ROLE', async () => {
    vi.mocked(getCurrentAppUser).mockResolvedValue(makeUserWithInvalidRole('unrecognized_role'));

    const handler = vi.fn().mockResolvedValue({ ok: true });
    const action = createAuthenticatedAction(
      z.object({}),
      handler,
      'test-owner-action',
      { roles: OWNER_ONLY }
    );

    const result = await action({});

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(FORBIDDEN_ROLE_CODE);
      expect(result.error.message).toBe(FORBIDDEN_ROLE_MESSAGE);
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it('5. roles: [] throws synchronously at action-definition time with documented message', () => {
    const handler = vi.fn();
    expect(() =>
      createAuthenticatedAction(
        z.object({}),
        handler,
        'test-empty-roles',
        { roles: [] }
      )
    ).toThrow('createAuthenticatedAction("test-empty-roles"): "roles" must not be an empty list.');
  });

  it('6. Order check: role denial happens before platform-admin check', async () => {
    vi.mocked(getCurrentAppUser).mockResolvedValue(dummyStaff);

    const handler = vi.fn().mockResolvedValue({ ok: true });
    const action = createAuthenticatedAction(
      z.object({}),
      handler,
      'test-order-action',
      {
        roles: OWNER_ONLY,
        requirePlatformAdmin: true,
      }
    );

    const result = await action({});

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(FORBIDDEN_ROLE_CODE);
    }
    expect(requirePlatformAdmin).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });
});

