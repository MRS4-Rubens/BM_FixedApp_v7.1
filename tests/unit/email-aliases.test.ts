import { beforeEach, describe, expect, it, vi } from 'vitest';

// Launch 3.8 follow-up: per-kind sender names and Gmail plus-alias routing (one verified Brevo sender).

const state = vi.hoisted(() => ({ emailFrom: 'Invoice BizFolio <yourapp@gmail.com>', billing: undefined as string | undefined }));

vi.mock('@/lib/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/env')>();
  return {
    ...actual,
    getEmailEnv: () => ({ BREVO_API_KEY: 'k', EMAIL_FROM: state.emailFrom }),
    getContactEnv: () => (state.billing ? { BILLING_EMAIL: state.billing } : {}),
  };
});

import { appSender, billingInbox, supportReplyTo } from '@/lib/email/addresses';
import { checkCoreEnv } from '@/lib/env';

describe('appSender', () => {
  beforeEach(() => {
    state.emailFrom = 'Invoice BizFolio <yourapp@gmail.com>';
  });

  it('keeps the one verified sender address and only changes the display name per kind', () => {
    expect(appSender('general')).toBe('Invoice BizFolio <yourapp@gmail.com>');
    expect(appSender('alerts')).toBe('Invoice BizFolio Alerts <yourapp@gmail.com>');
    expect(appSender('billing')).toBe('Invoice BizFolio Billing <yourapp@gmail.com>');
  });

  it('works with a bare EMAIL_FROM address too', () => {
    state.emailFrom = 'yourapp@gmail.com';
    expect(appSender('alerts')).toBe('Invoice BizFolio Alerts <yourapp@gmail.com>');
  });
});

describe('billingInbox', () => {
  it('uses BILLING_EMAIL when set, otherwise null (payment claims then go to the admins)', () => {
    state.billing = 'yourapp+billing@gmail.com';
    expect(billingInbox()).toBe('yourapp+billing@gmail.com');
    state.billing = undefined;
    expect(billingInbox()).toBeNull();
  });
});

describe('supportReplyTo', () => {
  it('is undefined while only the development placeholder is configured (mailer then replies to the sender)', () => {
    // The test environment has no NEXT_PUBLIC_SUPPORT_EMAIL, so SUPPORT_EMAIL is the dev placeholder.
    expect(supportReplyTo()).toBeUndefined();
  });
});

describe('BILLING_EMAIL validation (lib/env.ts contact group)', () => {
  const contact = (extra: Record<string, string>) =>
    checkCoreEnv({ NODE_ENV: 'production', NEXT_PUBLIC_SUPPORT_EMAIL: 'yourapp+support@gmail.com', ...extra }).filter((i) => i.group === 'contact');

  it('accepts a Gmail plus-alias, and is optional', () => {
    expect(contact({ BILLING_EMAIL: 'yourapp+billing@gmail.com' })).toEqual([]);
    expect(contact({})).toEqual([]);
  });

  it('rejects anything that is not one address', () => {
    expect(contact({ BILLING_EMAIL: 'a@b.co, c@d.co' })).toEqual([
      { group: 'contact', name: 'BILLING_EMAIL', message: 'must be a single e-mail address' },
    ]);
  });
});
