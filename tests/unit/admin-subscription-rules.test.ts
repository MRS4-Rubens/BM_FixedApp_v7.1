import { describe, expect, it } from 'vitest';
import {
  assertOverrideCoherent,
  ALLOWED_STATUSES_BY_PLAN,
  MAX_OVERRIDE_HORIZON_DAYS,
  OVERRIDE_PLANS,
  OVERRIDE_STATUSES,
  OverrideRuleError,
  processSubscriptionRequestSchema,
  updateBusinessSubscriptionSchema,
} from '@/lib/validations/admin-subscription';

describe('admin-subscription-rules (API-009)', () => {
  const validBizId = 'a0000000-0000-4000-8000-000000000001';
  const now = new Date('2026-10-15T12:00:00.000Z');
  const futureDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  it('updateBusinessSubscriptionSchema rejects invalid plan, status, and invalid ISO dates', () => {
    expect(
      updateBusinessSubscriptionSchema.safeParse({
        business_id: validBizId,
        subscription_plan: 'platinum',
        subscription_status: 'active',
        subscription_ends_at: null,
      }).success,
    ).toBe(false);

    expect(
      updateBusinessSubscriptionSchema.safeParse({
        business_id: validBizId,
        subscription_plan: 'essentials',
        subscription_status: 'bogus',
        subscription_ends_at: null,
      }).success,
    ).toBe(false);

    expect(
      updateBusinessSubscriptionSchema.safeParse({
        business_id: validBizId,
        subscription_plan: 'essentials',
        subscription_status: 'active',
        subscription_ends_at: 'garbage',
      }).success,
    ).toBe(false);

    expect(
      updateBusinessSubscriptionSchema.safeParse({
        business_id: validBizId,
        subscription_plan: 'essentials',
        subscription_status: 'active',
        subscription_ends_at: '2026-13-45T00:00:00Z',
      }).success,
    ).toBe(false);
  });

  it('updateBusinessSubscriptionSchema normalizes empty string and null to null, and accepts valid ISO string', () => {
    const emptyRes = updateBusinessSubscriptionSchema.safeParse({
      business_id: validBizId,
      subscription_plan: 'essentials',
      subscription_status: 'active',
      subscription_ends_at: '',
    });
    expect(emptyRes.success).toBe(true);
    if (emptyRes.success) expect(emptyRes.data.subscription_ends_at).toBeNull();

    const nullRes = updateBusinessSubscriptionSchema.safeParse({
      business_id: validBizId,
      subscription_plan: 'essentials',
      subscription_status: 'active',
      subscription_ends_at: null,
    });
    expect(nullRes.success).toBe(true);
    if (nullRes.success) expect(nullRes.data.subscription_ends_at).toBeNull();

    const isoRes = updateBusinessSubscriptionSchema.safeParse({
      business_id: validBizId,
      subscription_plan: 'essentials',
      subscription_status: 'active',
      subscription_ends_at: '2026-10-29T10:00:00.000Z',
    });
    expect(isoRes.success).toBe(true);
    if (isoRes.success) expect(isoRes.data.subscription_ends_at).toBe('2026-10-29T10:00:00.000Z');
  });

  it('processSubscriptionRequestSchema enforces reject_reason length and trimming', () => {
    const ok500 = processSubscriptionRequestSchema.safeParse({
      request_id: validBizId,
      action: 'reject',
      reject_reason: 'a'.repeat(500),
    });
    expect(ok500.success).toBe(true);

    const fail501 = processSubscriptionRequestSchema.safeParse({
      request_id: validBizId,
      action: 'reject',
      reject_reason: 'a'.repeat(501),
    });
    expect(fail501.success).toBe(false);

    const trimmed = processSubscriptionRequestSchema.safeParse({
      request_id: validBizId,
      action: 'reject',
      reject_reason: '   Verification failed. Check UTR.   ',
    });
    expect(trimmed.success).toBe(true);
    if (trimmed.success) {
      expect(trimmed.data.reject_reason).toBe('Verification failed. Check UTR.');
    }
  });

  it('assertOverrideCoherent validates every plan x status pair against ALLOWED_STATUSES_BY_PLAN', () => {
    for (const plan of OVERRIDE_PLANS) {
      for (const status of OVERRIDE_STATUSES) {
        const isAllowed = ALLOWED_STATUSES_BY_PLAN[plan].includes(status);
        if (isAllowed) {
          expect(() =>
            assertOverrideCoherent({
              plan,
              status,
              endsAt: futureDate,
              now,
            }),
          ).not.toThrow();
        } else {
          expect(() =>
            assertOverrideCoherent({
              plan,
              status,
              endsAt: futureDate,
              now,
            }),
          ).toThrowError(
            `The "${plan}" plan cannot be set to "${status}". Allowed statuses: ${ALLOWED_STATUSES_BY_PLAN[
              plan
            ].join(', ')}.`,
          );
        }
      }
    }
  });

  it('explicitly rejects dangerous plan/status combinations', () => {
    expect(() =>
      assertOverrideCoherent({ plan: 'free', status: 'active', endsAt: futureDate, now }),
    ).toThrow(OverrideRuleError);

    expect(() =>
      assertOverrideCoherent({ plan: 'free', status: 'trial', endsAt: futureDate, now }),
    ).toThrow(OverrideRuleError);

    expect(() =>
      assertOverrideCoherent({ plan: 'trial', status: 'active', endsAt: futureDate, now }),
    ).toThrow(OverrideRuleError);

    expect(() =>
      assertOverrideCoherent({ plan: 'essentials', status: 'trial', endsAt: futureDate, now }),
    ).toThrow(OverrideRuleError);
  });

  it('rejects Active with past or equal end date, but allows Active with null end date', () => {
    const past = new Date(now.getTime() - 1000);
    expect(() =>
      assertOverrideCoherent({ plan: 'essentials', status: 'active', endsAt: past, now }),
    ).toThrowError(
      'An Active subscription needs an end date in the future (or leave it empty for no expiry).',
    );

    expect(() =>
      assertOverrideCoherent({ plan: 'essentials', status: 'active', endsAt: now, now }),
    ).toThrowError(
      'An Active subscription needs an end date in the future (or leave it empty for no expiry).',
    );

    expect(() =>
      assertOverrideCoherent({ plan: 'essentials', status: 'active', endsAt: null, now }),
    ).not.toThrow();
  });

  it('allows non-active statuses with past end dates', () => {
    const past = new Date(now.getTime() - 1000);
    expect(() =>
      assertOverrideCoherent({ plan: 'free', status: 'expired', endsAt: past, now }),
    ).not.toThrow();

    expect(() =>
      assertOverrideCoherent({ plan: 'trial', status: 'suspended', endsAt: past, now }),
    ).not.toThrow();
  });

  it('enforces horizon boundary: now+3660d is allowed, now+3661d is rejected', () => {
    const dayMs = 24 * 60 * 60 * 1000;
    const boundary = new Date(now.getTime() + MAX_OVERRIDE_HORIZON_DAYS * dayMs);
    expect(() =>
      assertOverrideCoherent({ plan: 'essentials', status: 'active', endsAt: boundary, now }),
    ).not.toThrow();

    const beyond = new Date(now.getTime() + (MAX_OVERRIDE_HORIZON_DAYS + 1) * dayMs);
    expect(() =>
      assertOverrideCoherent({ plan: 'essentials', status: 'active', endsAt: beyond, now }),
    ).toThrowError(`The end date is more than ${MAX_OVERRIDE_HORIZON_DAYS} days in the future.`);
  });
});
