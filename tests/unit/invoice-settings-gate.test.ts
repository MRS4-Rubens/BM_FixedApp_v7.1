import { describe, expect, it } from 'vitest';
import { getPlanEntitlements, type BusinessSubscriptionSource } from '@/lib/subscriptions/entitlements';
import {
  checkInvoiceSettingsEntitlement,
  FREE_PLAN_INVOICE_NUMBER_FORMATS,
} from '@/lib/subscriptions/invoice-settings-gate';

describe('invoice-settings-gate (API-007)', () => {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const future = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

  const freeSubscription: BusinessSubscriptionSource = {
    subscription_plan: 'trial',
    subscription_status: 'trial',
    trial_ends_at: yesterday,
  };

  const trialSubscription: BusinessSubscriptionSource = {
    subscription_plan: 'trial',
    subscription_status: 'trial',
    trial_ends_at: future,
  };

  const paidSubscription: BusinessSubscriptionSource = {
    subscription_plan: 'essentials',
    subscription_status: 'active',
    subscription_ends_at: future,
  };

  it('validates subscription tiers via getPlanEntitlements first', () => {
    expect(getPlanEntitlements(freeSubscription).tier).toBe('free');
    expect(getPlanEntitlements(trialSubscription).tier).toBe('trial');
    expect(getPlanEntitlements(paidSubscription).tier).toBe('essentials');
  });

  it('blocks free tier requesting premium template (template_3 -> TEMPLATE_LOCKED)', () => {
    const result = checkInvoiceSettingsEntitlement(freeSubscription, null, {
      default_invoice_template: 'template_3',
    });
    expect(result).toEqual({
      allowed: false,
      code: 'TEMPLATE_LOCKED',
      message:
        'Traditional, Carbon Pad, and Book Depot templates are exclusive to Essentials Pro. Upgrade to unlock all 4 premium templates.',
    });
  });

  it('allows free tier requesting default template (template_1)', () => {
    const result = checkInvoiceSettingsEntitlement(freeSubscription, null, {
      default_invoice_template: 'template_1',
    });
    expect(result).toEqual({ allowed: true });
  });

  it('blocks free tier requesting custom invoice format (ABC/{SEQ:5} -> INVOICE_FORMAT_LOCKED)', () => {
    const result = checkInvoiceSettingsEntitlement(freeSubscription, null, {
      invoice_number_format: 'ABC/{SEQ:5}',
    });
    expect(result).toEqual({
      allowed: false,
      code: 'INVOICE_FORMAT_LOCKED',
      message:
        'Custom invoice numbering formats and brand prefixes are exclusive to paid plans. Upgrade to Essentials Pro to customize your invoice format.',
    });
  });

  it('allows free tier if requested format equals current format even if not a standard free format', () => {
    const result = checkInvoiceSettingsEntitlement(freeSubscription, 'EXISTING/{SEQ:4}', {
      invoice_number_format: 'EXISTING/{SEQ:4}',
    });
    expect(result).toEqual({ allowed: true });
  });

  it('allows free tier using either built-in free format', () => {
    for (const format of FREE_PLAN_INVOICE_NUMBER_FORMATS) {
      const result = checkInvoiceSettingsEntitlement(freeSubscription, null, {
        invoice_number_format: format,
      });
      expect(result).toEqual({ allowed: true });
    }
  });

  it('allows paid and active-trial tiers with template_2 and custom format', () => {
    const paidResult = checkInvoiceSettingsEntitlement(paidSubscription, null, {
      default_invoice_template: 'template_2',
      invoice_number_format: 'CUSTOM/{FY}/{SEQ:5}',
    });
    expect(paidResult).toEqual({ allowed: true });

    const trialResult = checkInvoiceSettingsEntitlement(trialSubscription, null, {
      default_invoice_template: 'template_2',
      invoice_number_format: 'CUSTOM/{FY}/{SEQ:5}',
    });
    expect(trialResult).toEqual({ allowed: true });
  });

  it('allows request when no fields or null/undefined fields are provided', () => {
    expect(checkInvoiceSettingsEntitlement(freeSubscription, null, {})).toEqual({ allowed: true });
    expect(
      checkInvoiceSettingsEntitlement(freeSubscription, null, {
        invoice_number_format: null,
        default_invoice_template: null,
      })
    ).toEqual({ allowed: true });
  });
});

