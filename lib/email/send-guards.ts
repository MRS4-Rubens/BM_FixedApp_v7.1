import { eq } from 'drizzle-orm';
import { ActionError } from '@/lib/actions/_shared/errors';
import { auth } from '@/lib/auth/server';
import { db } from '@/lib/db/client';
import { businesses } from '@/lib/db/schema';
import type { DbTransaction } from '@/lib/db/client';
import {
  EMAIL_DAILY_CAP_PER_BUSINESS,
  evaluateSenderVerification,
} from '@/lib/email/send-policy';
import { enforceRateLimit } from '@/lib/rate-limit/enforce';
import { emailDailyCapLimiter } from '@/lib/rate-limit/upstash';
import {
  getPlanEntitlements,
  type BusinessSubscriptionSource,
} from '@/lib/subscriptions/entitlements';

export interface SenderBusiness extends BusinessSubscriptionSource {
  readonly id: string;
  readonly legal_name: string;
  readonly gstin: string;
  readonly city: string;
  readonly email: string | null;
  readonly phone: string | null;
}

export async function loadSenderBusiness(
  businessId: string,
  executor?: Pick<DbTransaction, 'select'>,
): Promise<SenderBusiness> {
  const client = executor ?? db;
  const rows = await client
    .select({
      id: businesses.id,
      legal_name: businesses.legal_name,
      gstin: businesses.gstin,
      city: businesses.city,
      email: businesses.email,
      phone: businesses.phone,
      subscription_plan: businesses.subscription_plan,
      subscription_status: businesses.subscription_status,
      trial_ends_at: businesses.trial_ends_at,
      subscription_ends_at: businesses.subscription_ends_at,
    })
    .from(businesses)
    .where(eq(businesses.id, businessId));

  const business = rows[0];
  if (!business) {
    throw new ActionError('Business profile not found.', { code: 'NOT_FOUND' });
  }

  return business;
}

export async function assertMayEmailCustomers(business: BusinessSubscriptionSource): Promise<void> {
  const ent = getPlanEntitlements(business);
  if (ent.isSuspended) {
    throw new ActionError('Your account has been suspended. Please contact platform support.', {
      code: 'ACCOUNT_SUSPENDED',
    });
  }

  const session = await auth.getSession();
  const sessionUser = session?.data?.user as { emailVerified?: unknown } | undefined;
  const decision = evaluateSenderVerification({
    isPaidTier: ent.tier === 'essentials' || ent.tier === 'professional',
    emailVerified: sessionUser?.emailVerified,
  });

  if (!decision.allowed) {
    throw new ActionError(decision.message, { code: decision.code });
  }
}

export async function enforceDailyEmailCap(businessId: string): Promise<void> {
  const outcome = await enforceRateLimit({
    limiter: emailDailyCapLimiter,
    identifier: `email-daily:${businessId}`,
    policy: 'fail-closed',
    scope: 'customer-email-daily-cap',
  });

  if (outcome.allowed) return;

  if (outcome.reason === 'limited') {
    throw new ActionError(
      `Your business has reached today's limit of ${EMAIL_DAILY_CAP_PER_BUSINESS} customer e-mails. Please try again tomorrow.`,
      { code: 'DAILY_EMAIL_LIMIT' },
    );
  }

  throw new ActionError('E-mail sending is temporarily unavailable. Please try again in a few minutes.', {
    code: 'EMAIL_UNAVAILABLE',
  });
}

