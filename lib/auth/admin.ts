import { auth } from '@/lib/auth/server';
import { ActionError } from '@/lib/actions/_shared/errors';
import { logError } from '@/lib/actions/_shared/logger';
import { getAdminEnv } from '@/lib/env';
import { evaluatePlatformAdmin, type PlatformAdminDecision, type PlatformAdminIdentity } from '@/lib/auth/admin-policy';

export type { PlatformAdminDecision, PlatformAdminIdentity } from '@/lib/auth/admin-policy';

export async function getPlatformAdminDecision(): Promise<PlatformAdminDecision> {
  const session = await auth.getSession();
  const env = getAdminEnv();
  return evaluatePlatformAdmin(session?.data?.user, {
    emails: env.PLATFORM_ADMIN_EMAILS,
    userIds: env.PLATFORM_ADMIN_USER_IDS,
  });
}

/** Throws a generic UNAUTHORIZED_ACCESS ActionError; the reason is logged server-side only (no e-mails). */
export async function requirePlatformAdmin(): Promise<PlatformAdminIdentity> {
  const decision = await getPlatformAdminDecision();
  if (!decision.allowed) {
    logError('platform-admin', new Error('Platform admin access denied'), {
      reason: decision.reason,
      expected: true,
    });
    throw new ActionError('Unauthorized: Access denied.', { code: 'UNAUTHORIZED_ACCESS' });
  }
  return decision.identity;
}

/** Never throws. Unexpected failures are logged and treated as "not an admin" (fail closed). */
export async function isPlatformAdmin(): Promise<boolean> {
  try {
    return (await getPlatformAdminDecision()).allowed;
  } catch (error: unknown) {
    logError('platform-admin', error, { expected: false });
    return false;
  }
}
