import { z } from 'zod';
import { SUBSCRIPTION_PLANS, SUBSCRIPTION_STATUSES } from '@/lib/db/domain-values';

export const OVERRIDE_PLANS = SUBSCRIPTION_PLANS;
export const OVERRIDE_STATUSES = SUBSCRIPTION_STATUSES;
export type OverridePlan = (typeof OVERRIDE_PLANS)[number];
export type OverrideStatus = (typeof OVERRIDE_STATUSES)[number];
export const REJECT_REASON_MAX_LENGTH = 500;
export const MAX_OVERRIDE_HORIZON_DAYS = 3660; // ~10 years; documented policy constant

export const processSubscriptionRequestSchema = z.object({
  request_id: z.string().uuid('Invalid request ID'),
  action: z.enum(['approve', 'reject']),
  reject_reason: z
    .string()
    .trim()
    .max(REJECT_REASON_MAX_LENGTH, `Reject reason must be ${REJECT_REASON_MAX_LENGTH} characters or fewer`)
    .optional(),
});

export const updateBusinessSubscriptionSchema = z.object({
  business_id: z.string().uuid('Invalid business ID'),
  subscription_plan: z.enum(OVERRIDE_PLANS),
  subscription_status: z.enum(OVERRIDE_STATUSES),
  // The admin console sends '' for "no end date" and a full ISO string otherwise. Normalised to string | null.
  subscription_ends_at: z
    .union([z.literal(''), z.null(), z.iso.datetime({ offset: true })])
    .transform((value): string | null => (value === '' || value === null ? null : value)),
});

export class OverrideRuleError extends Error {
  readonly code = 'INVALID_OVERRIDE' as const;
  constructor(message: string) {
    super(message);
    this.name = 'OverrideRuleError';
  }
}

export const ALLOWED_STATUSES_BY_PLAN: Record<OverridePlan, readonly OverrideStatus[]> = {
  free: ['expired', 'suspended'],
  trial: ['trial', 'expired', 'suspended'],
  essentials: ['active', 'expired', 'suspended'],
  professional: ['active', 'expired', 'suspended'],
};

export function assertOverrideCoherent(args: {
  plan: OverridePlan;
  status: OverrideStatus;
  endsAt: Date | null;
  now: Date;
}): void {
  const allowedStatuses = ALLOWED_STATUSES_BY_PLAN[args.plan];
  if (!allowedStatuses.includes(args.status)) {
    throw new OverrideRuleError(
      `The "${args.plan}" plan cannot be set to "${args.status}". Allowed statuses: ${allowedStatuses.join(', ')}.`,
    );
  }

  if (args.plan === 'trial' && args.status === 'trial') {
    if (args.endsAt === null || args.endsAt.getTime() <= args.now.getTime()) {
      throw new OverrideRuleError('A Trial needs an end date in the future.');
    }
  }

  if (args.endsAt !== null) {
    if (Number.isNaN(args.endsAt.getTime())) {
      throw new OverrideRuleError('Invalid subscription end date.');
    }

    if (args.status === 'active' && args.endsAt.getTime() <= args.now.getTime()) {
      throw new OverrideRuleError(
        'An Active subscription needs an end date in the future (or leave it empty for no expiry).',
      );
    }

    const maxHorizonMs = MAX_OVERRIDE_HORIZON_DAYS * 24 * 60 * 60 * 1000;
    if (args.endsAt.getTime() > args.now.getTime() + maxHorizonMs) {
      throw new OverrideRuleError(
        `The end date is more than ${MAX_OVERRIDE_HORIZON_DAYS} days in the future.`,
      );
    }
  }
}
