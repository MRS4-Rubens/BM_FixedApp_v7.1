import { describe, expect, it, vi } from 'vitest';

// LAUNCH-L1 (docs/LAUNCH_CHECKLIST.md 2.1, 2.2, 2.6).

const { getRequestSession } = vi.hoisted(() => ({
  getRequestSession: vi.fn(async () => {
    throw new Error('session must not be read while customer e-mails are switched off');
  }),
}));

vi.mock('@/lib/auth/request-session', () => ({ getRequestSession }));
vi.mock('@/lib/db/client', () => ({ db: {} }));
vi.mock('@/lib/rate-limit/enforce', () => ({ enforceRateLimit: vi.fn() }));
vi.mock('@/lib/rate-limit/upstash', () => ({ emailDailyCapLimiter: {} }));

import { CUSTOMER_EMAILS_ENABLED } from '@/lib/config/features';
import { assertMayEmailCustomers } from '@/lib/email/send-guards';
import { PLAN_CATALOG } from '@/lib/subscriptions/plan-catalog';
import { REFRESH_MS } from '@/components/app/notifications/notification-bell';

describe('LAUNCH-L1 pilot switches', () => {
  it('ships with customer e-mails switched off', () => {
    expect(CUSTOMER_EMAILS_ENABLED).toBe(false);
  });

  it('refuses customer e-mails (invoice + reminder share this guard) before any other check', async () => {
    const business = { subscription_tier: 'essentials' } as unknown as Parameters<typeof assertMayEmailCustomers>[0];
    await expect(assertMayEmailCustomers(business)).rejects.toMatchObject({ code: 'CUSTOMER_EMAILS_DISABLED' });
    expect(getRequestSession).not.toHaveBeenCalled();
  });

  it('no plan advertises e-mailing invoices or reminders to customers', () => {
    const labels = Object.values(PLAN_CATALOG).flatMap((plan) => plan.features.map((feature) => feature.label));
    for (const label of labels) {
      expect(label.toLowerCase()).not.toMatch(/e-?mail invoices|payment reminders/);
    }
    expect(labels).toContain('Download and print invoice PDFs');
  });

  it('bell backup timer is 30 minutes so the database can sleep between checks', () => {
    expect(REFRESH_MS).toBe(30 * 60_000);
  });
});
