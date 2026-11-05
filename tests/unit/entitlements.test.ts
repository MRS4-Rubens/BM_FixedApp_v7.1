import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PLAN_PRICING,
  canAddCustomer,
  canAddProduct,
  canCreateInvoice,
  canCustomizeInvoiceNumberFormat,
  canExportStatutoryReport,
  canUploadBusinessLogo,
  canUseTemplate,
  checkAccountNotSuspended,
  getPlanEntitlements,
  resolveBusinessPlan,
} from '@/lib/subscriptions/entitlements';

describe('Entitlements & Subscription Engine (TEST-001)', () => {
  const fixedNow = new Date('2026-10-15T12:00:00.000Z');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('SPEC: resolveBusinessPlan State Matrix', () => {
    it('null or undefined business resolves to free tier and active status', () => {
      const resNull = resolveBusinessPlan(null);
      expect(resNull.tier).toBe('free');
      expect(resNull.effectiveStatus).toBe('active');
      expect(resNull.daysRemaining).toBeNull();
      expect(resNull.targetExpiry).toBeNull();

      const resUndefined = resolveBusinessPlan(undefined);
      expect(resUndefined.tier).toBe('free');
      expect(resUndefined.effectiveStatus).toBe('active');
    });

    it('suspended status takes top precedence regardless of plan or future dates', () => {
      const futureDate = new Date('2026-11-15T12:00:00.000Z');
      const res = resolveBusinessPlan({
        subscription_plan: 'professional',
        subscription_status: 'suspended',
        subscription_ends_at: futureDate,
      });

      expect(res.tier).toBe('free');
      expect(res.effectiveStatus).toBe('suspended');
      expect(res.daysRemaining).toBe(0);
      expect(res.targetExpiry?.toISOString()).toBe(futureDate.toISOString());
    });

    it('active paid plan with future end date resolves to correct tier and remaining days', () => {
      // 10 days in the future
      const endTenDays = new Date('2026-10-25T12:00:00.000Z');
      const resEssentials = resolveBusinessPlan({
        subscription_plan: 'essentials',
        subscription_status: 'active',
        subscription_ends_at: endTenDays,
      });
      expect(resEssentials.tier).toBe('essentials');
      expect(resEssentials.effectiveStatus).toBe('active');
      expect(resEssentials.daysRemaining).toBe(10);
      expect(resEssentials.targetExpiry?.toISOString()).toBe(endTenDays.toISOString());

      const resPro = resolveBusinessPlan({
        subscription_plan: 'professional',
        subscription_status: 'active',
        subscription_ends_at: endTenDays,
      });
      expect(resPro.tier).toBe('professional');
      expect(resPro.effectiveStatus).toBe('active');
    });

    it('evaluates exact millisecond boundary conditions for active paid subscriptions', () => {
      // end = now + 24h -> 1 day
      const plus24h = new Date(fixedNow.getTime() + 24 * 60 * 60 * 1000);
      expect(
        resolveBusinessPlan({
          subscription_plan: 'essentials',
          subscription_status: 'active',
          subscription_ends_at: plus24h,
        }).daysRemaining
      ).toBe(1);

      // end = now + 24h + 1ms -> Math.ceil yields 2 days
      const plus24hPlus1ms = new Date(fixedNow.getTime() + 24 * 60 * 60 * 1000 + 1);
      expect(
        resolveBusinessPlan({
          subscription_plan: 'essentials',
          subscription_status: 'active',
          subscription_ends_at: plus24hPlus1ms,
        }).daysRemaining
      ).toBe(2);

      // end = now + 1ms -> 1 day
      const plus1ms = new Date(fixedNow.getTime() + 1);
      expect(
        resolveBusinessPlan({
          subscription_plan: 'essentials',
          subscription_status: 'active',
          subscription_ends_at: plus1ms,
        }).daysRemaining
      ).toBe(1);

      // end = now -> expired
      expect(
        resolveBusinessPlan({
          subscription_plan: 'essentials',
          subscription_status: 'active',
          subscription_ends_at: fixedNow,
        }).effectiveStatus
      ).toBe('expired');

      // end = now - 1ms -> expired
      const minus1ms = new Date(fixedNow.getTime() - 1);
      expect(
        resolveBusinessPlan({
          subscription_plan: 'essentials',
          subscription_status: 'active',
          subscription_ends_at: minus1ms,
        }).effectiveStatus
      ).toBe('expired');
    });

    it('active paid plan with no end date resolves as perpetual active', () => {
      const res = resolveBusinessPlan({
        subscription_plan: 'professional',
        subscription_status: 'active',
        subscription_ends_at: null,
      });
      expect(res.tier).toBe('professional');
      expect(res.effectiveStatus).toBe('active');
      expect(res.daysRemaining).toBeNull();
    });

    it('trial plan with future end date resolves to trial tier', () => {
      const future = new Date('2026-10-20T12:00:00.000Z');
      const res = resolveBusinessPlan({
        subscription_plan: 'trial',
        subscription_status: 'trial',
        trial_ends_at: future,
      });
      expect(res.tier).toBe('trial');
      expect(res.effectiveStatus).toBe('trial');
      expect(res.daysRemaining).toBe(5);
    });

    it('trial plan with past end date resolves to expired free tier', () => {
      const past = new Date('2026-10-10T12:00:00.000Z');
      const res = resolveBusinessPlan({
        subscription_plan: 'trial',
        subscription_status: 'trial',
        trial_ends_at: past,
      });
      expect(res.tier).toBe('free');
      expect(res.effectiveStatus).toBe('expired');
      expect(res.daysRemaining).toBe(0);
    });

    it('SPEC (API-010 updated policy): trial plan with null trial_ends_at fails closed to expired free tier', () => {
      const res = resolveBusinessPlan({
        subscription_plan: 'trial',
        subscription_status: 'trial',
        trial_ends_at: null,
      });
      expect(res.tier).toBe('free');
      expect(res.effectiveStatus).toBe('expired');
      expect(res.daysRemaining).toBe(0);
      expect(res.targetExpiry).toBeNull();
    });

    it('handles Date instances and ISO strings identically', () => {
      const isoStr = '2026-10-25T12:00:00.000Z';
      const dateObj = new Date(isoStr);

      const resIso = resolveBusinessPlan({
        subscription_plan: 'essentials',
        subscription_status: 'active',
        subscription_ends_at: isoStr,
      });

      const resObj = resolveBusinessPlan({
        subscription_plan: 'essentials',
        subscription_status: 'active',
        subscription_ends_at: dateObj,
      });

      expect(resIso).toEqual(resObj);
    });
  });

  describe('CHAR / Findings Characterization (F-ENT-1, F-ENT-2, F-ENT-3)', () => {
    it('CHAR F-ENT-1: plan "trial" with status "expired" and future trial_ends_at still resolves as active trial', () => {
      const res = resolveBusinessPlan({
        subscription_plan: 'trial',
        subscription_status: 'expired',
        trial_ends_at: new Date('2026-10-25T12:00:00.000Z'),
      });
      // Characterizes limitation: rawPlan === 'trial' check precedes rawStatus
      expect(res.tier).toBe('trial');
      expect(res.effectiveStatus).toBe('trial');
    });

    it.todo('F-ENT-1: plan trial with raw status expired should not resolve to active trial');

    it('CHAR F-ENT-2: unparseable subscription_ends_at string with active status fails open to perpetual active', () => {
      const res = resolveBusinessPlan({
        subscription_plan: 'essentials',
        subscription_status: 'active',
        subscription_ends_at: 'not-a-valid-date',
      });
      expect(res.tier).toBe('essentials');
      expect(res.effectiveStatus).toBe('active');
      expect(res.daysRemaining).toBeNull();
    });

    it.todo('F-ENT-2: unparseable subscription_ends_at string should fail closed or throw error');

    it('CHAR F-ENT-3: plan "free" with status "active" resolves to essentials tier', () => {
      const res = resolveBusinessPlan({
        subscription_plan: 'free',
        subscription_status: 'active',
      });
      // Characterizes limitation: rawPlan !== 'professional' defaults to 'essentials' when rawStatus === 'active'
      expect(res.tier).toBe('essentials');
    });

    it.todo('F-ENT-3: plan free with status active should resolve to free tier');
  });

  describe('SPEC: getPlanEntitlements Quotas and Flags per Tier', () => {
    it('free tier has 30/30/30/1 quotas and watermark', () => {
      const ent = getPlanEntitlements(null);
      expect(ent.tier).toBe('free');
      expect(ent.invoiceMonthlyLimit).toBe(30);
      expect(ent.customerLimit).toBe(30);
      expect(ent.productLimit).toBe(30);
      expect(ent.teamUserLimit).toBe(1);
      expect(ent.hasWatermark).toBe(true);
      expect(ent.canUseAllTemplates).toBe(false);
      expect(ent.canUploadLogo).toBe(false);
      expect(ent.canExportExcelReports).toBe(false);
      expect(ent.canCustomizeInvoiceFormat).toBe(false);
    });

    it('trial tier gets all Essentials features without quotas or watermark', () => {
      const ent = getPlanEntitlements({
        subscription_plan: 'trial',
        subscription_status: 'trial',
        trial_ends_at: new Date('2026-10-25T12:00:00.000Z'),
      });
      expect(ent.tier).toBe('trial');
      expect(ent.invoiceMonthlyLimit).toBeNull();
      expect(ent.customerLimit).toBeNull();
      expect(ent.productLimit).toBeNull();
      expect(ent.teamUserLimit).toBe(3);
      expect(ent.hasWatermark).toBe(false);
      expect(ent.canUseAllTemplates).toBe(true);
      expect(ent.canUploadLogo).toBe(true);
      expect(ent.canExportExcelReports).toBe(true);
      expect(ent.canCustomizeInvoiceFormat).toBe(true);
    });

    it('professional tier gets enterprise features and unlimited team seats', () => {
      const ent = getPlanEntitlements({
        subscription_plan: 'professional',
        subscription_status: 'active',
        subscription_ends_at: new Date('2026-10-25T12:00:00.000Z'),
      });
      expect(ent.tier).toBe('professional');
      expect(ent.teamUserLimit).toBeNull(); // Unlimited seats
      expect(ent.canAccessCaPortal).toBe(true);
      expect(ent.hasWatermark).toBe(false);
    });
  });

  describe('SPEC: Quota & Permission Guard Functions', () => {
    it('canCreateInvoice enforces monthly limit on free tier and suspension', () => {
      // Free tier at 29 -> allowed
      expect(canCreateInvoice(null, 29).allowed).toBe(true);
      // Free tier at 30 -> denied with INVOICE_QUOTA_EXCEEDED
      const at30 = canCreateInvoice(null, 30);
      expect(at30.allowed).toBe(false);
      expect(at30.code).toBe('INVOICE_QUOTA_EXCEEDED');
      // Free tier at 31 -> denied
      expect(canCreateInvoice(null, 31).allowed).toBe(false);

      // Suspended account denied regardless of count or tier
      const suspended = canCreateInvoice(
        { subscription_status: 'suspended', subscription_plan: 'professional' },
        0
      );
      expect(suspended.allowed).toBe(false);
      expect(suspended.code).toBe('ACCOUNT_SUSPENDED');
    });

    it('canAddCustomer and canAddProduct enforce 30 limits on free tier', () => {
      expect(canAddCustomer(null, 29).allowed).toBe(true);
      const cust30 = canAddCustomer(null, 30);
      expect(cust30.allowed).toBe(false);
      expect(cust30.code).toBe('CUSTOMER_QUOTA_EXCEEDED');

      expect(canAddProduct(null, 29).allowed).toBe(true);
      const prod30 = canAddProduct(null, 30);
      expect(prod30.allowed).toBe(false);
      expect(prod30.code).toBe('PRODUCT_QUOTA_EXCEEDED');
    });

    it('canUseTemplate allows template_1 for all, locks others on free tier', () => {
      expect(canUseTemplate(null, 'template_1').allowed).toBe(true);

      const template2Free = canUseTemplate(null, 'template_2');
      expect(template2Free.allowed).toBe(false);
      expect(template2Free.code).toBe('TEMPLATE_LOCKED');

      const template2Paid = canUseTemplate(
        { subscription_status: 'active', subscription_plan: 'essentials' },
        'template_2'
      );
      expect(template2Paid.allowed).toBe(true);
    });

    it('canUploadBusinessLogo, canExportStatutoryReport, canCustomizeInvoiceNumberFormat are locked on free', () => {
      const logo = canUploadBusinessLogo(null);
      expect(logo.allowed).toBe(false);
      expect(logo.code).toBe('LOGO_UPLOAD_LOCKED');

      const report = canExportStatutoryReport(null);
      expect(report.allowed).toBe(false);
      expect(report.code).toBe('REPORT_EXPORT_LOCKED');

      const format = canCustomizeInvoiceNumberFormat(null);
      expect(format.allowed).toBe(false);
      expect(format.code).toBe('INVOICE_FORMAT_LOCKED');
    });

    it('checkAccountNotSuspended pure function checks', () => {
      expect(checkAccountNotSuspended(null).allowed).toBe(true);
      const susp = checkAccountNotSuspended({ subscription_status: 'suspended' });
      expect(susp.allowed).toBe(false);
      expect(susp.code).toBe('ACCOUNT_SUSPENDED');
    });
  });

  describe('SPEC: Plan Pricing Integrity', () => {
    it('validates pricing constants, yearly savings discounts, and positive integers', () => {
      // Essentials
      expect(PLAN_PRICING.essentials.monthlyPaise).toBe(39_900);
      expect(PLAN_PRICING.essentials.yearlyPaise).toBe(349_900);
      expect(PLAN_PRICING.essentials.yearlyPaise).toBeLessThan(12 * PLAN_PRICING.essentials.monthlyPaise);
      const essSavings = Math.round(
        (1 - PLAN_PRICING.essentials.yearlyPaise / (12 * PLAN_PRICING.essentials.monthlyPaise)) * 100
      );
      expect(essSavings).toBe(27);

      // Professional
      expect(PLAN_PRICING.professional.monthlyPaise).toBe(59_900);
      expect(PLAN_PRICING.professional.yearlyPaise).toBe(499_900);
      expect(PLAN_PRICING.professional.yearlyPaise).toBeLessThan(12 * PLAN_PRICING.professional.monthlyPaise);
      const proSavings = Math.round(
        (1 - PLAN_PRICING.professional.yearlyPaise / (12 * PLAN_PRICING.professional.monthlyPaise)) * 100
      );
      expect(proSavings).toBe(30);
    });
  });
});
