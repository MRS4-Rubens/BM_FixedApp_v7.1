import { describe, expect, it } from 'vitest';
import {
  gstinChecksumChar,
  isValidGstin,
  makeGstin,
  GSTIN_REGEX,
} from '@/e2e/support/gstin';
import {
  computeLineGst,
  divideRoundHalfUp,
  formatPaiseToInr,
  parseInrToPaise,
  FIXTURES,
} from '@/e2e/support/money';
import {
  getIndianFinancialYear,
  getExpectedInvoiceNumberPattern,
  parseDateToIstParts,
} from '@/e2e/support/financial-year';
import {
  assertSafeTarget,
  e2eEnvSchema,
  E2eSafetyError,
  type E2eEnv,
} from '@/e2e/support/env';
import { diffAgainstBaseline } from '@/e2e/support/a11y-baseline';
import {
  generateRunId,
  generateTestIdentity,
  generateTestPassword,
  generateUtr,
} from '@/e2e/support/identity';
import { subscriptionClaimSchema } from '@/lib/validations/subscription';
import { validatePasswordPolicy } from '@/lib/auth/password-policy';

describe('e2e support helpers', () => {
  describe('GSTIN helpers', () => {
    it('verifies standard checksum test vector 27AAPFU0939F1ZV and rejects mutated last char', () => {
      const valid = '27AAPFU0939F1ZV';
      expect(isValidGstin(valid)).toBe(true);
      expect(gstinChecksumChar(valid.slice(0, 14))).toBe('V');

      // Mutate last character
      const mutated = '27AAPFU0939F1ZW';
      expect(isValidGstin(mutated)).toBe(false);

      // Throws on malformed base length
      expect(() => gstinChecksumChar('INVALID')).toThrow();
    });

    it('generates 1,000 valid, unique GSTINs matching GSTIN_REGEX', () => {
      const seen = new Set<string>();
      for (let i = 0; i < 1000; i += 1) {
        const gstin = makeGstin('27');
        expect(gstin).toMatch(GSTIN_REGEX);
        expect(isValidGstin(gstin)).toBe(true);
        seen.add(gstin);
      }
      expect(seen.size).toBe(1000);
    });
  });

  describe('Money oracle and INR parser', () => {
    it('computes exact fixture amounts matching Section 3.4', () => {
      // Invoice: 3 units @ ₹1,000 (100000 paise), 18% intra-state
      const inv = computeLineGst(
        FIXTURES.PRODUCT_UNIT_PRICE_PAISE,
        FIXTURES.INVOICE_QTY,
        FIXTURES.GST_RATE_BP,
        true,
      );
      expect(inv.taxablePaise).toBe(300000);
      expect(inv.cgstPaise).toBe(27000);
      expect(inv.sgstPaise).toBe(27000);
      expect(inv.totalPaise).toBe(354000);

      // Payment 1: 150000 paise -> balance 204000
      const balance1 = inv.totalPaise - FIXTURES.PAYMENT_1_PAISE;
      expect(balance1).toBe(204000);

      // Credit Note: 1 unit @ ₹1,000, 18% intra-state
      const cn = computeLineGst(
        FIXTURES.PRODUCT_UNIT_PRICE_PAISE,
        FIXTURES.CREDIT_NOTE_QTY,
        FIXTURES.GST_RATE_BP,
        true,
      );
      expect(cn.taxablePaise).toBe(100000);
      expect(cn.cgstPaise).toBe(9000);
      expect(cn.sgstPaise).toBe(9000);
      expect(cn.totalPaise).toBe(118000);

      // Net bill after CN = 354000 - 118000 = 236000
      const netBill = inv.totalPaise - cn.totalPaise;
      expect(netBill).toBe(236000);

      // Balance after payment 1 and CN = 236000 - 150000 = 86000
      const balanceAfterCnAndP1 = netBill - FIXTURES.PAYMENT_1_PAISE;
      expect(balanceAfterCnAndP1).toBe(86000);

      // Payment 2 = 86000 -> final balance = 0
      const balanceFinal = balanceAfterCnAndP1 - FIXTURES.PAYMENT_2_PAISE;
      expect(balanceFinal).toBe(0);
    });

    it('handles rounding edge cases with integer half-up math', () => {
      // 10 paise / 3 = 3.333 -> 3
      expect(divideRoundHalfUp(BigInt(10), BigInt(3))).toBe(BigInt(3));
      // 5 paise / 2 = 2.5 -> 3 (half-up)
      expect(divideRoundHalfUp(BigInt(5), BigInt(2))).toBe(BigInt(3));
      // 15 paise / 2 = 7.5 -> 8
      expect(divideRoundHalfUp(BigInt(15), BigInt(2))).toBe(BigInt(8));
    });

    it('parses formatted INR currency strings including Indian grouping and rejects garbage', () => {
      expect(parseInrToPaise('₹3,540.00')).toBe(354000);
      expect(parseInrToPaise('₹0.05')).toBe(5);
      expect(parseInrToPaise('₹1,00,000.00')).toBe(10000000);
      expect(parseInrToPaise('10,00,000.50')).toBe(100000050);
      expect(parseInrToPaise('-₹1,180.00')).toBe(-118000);
      expect(parseInrToPaise('₹3540')).toBe(354000);

      // Rejections
      expect(() => parseInrToPaise('')).toThrow(RangeError);
      expect(() => parseInrToPaise('abc')).toThrow(RangeError);
      expect(() => parseInrToPaise('₹3,540.000')).toThrow(RangeError);
      expect(() => parseInrToPaise('₹')).toThrow(RangeError);
    });

    it('formats paise to INR currency strings accurately', () => {
      expect(formatPaiseToInr(354000)).toBe('₹3,540.00');
      expect(formatPaiseToInr(5)).toBe('₹0.05');
      expect(formatPaiseToInr(-118000)).toBe('-₹1,180.00');
    });
  });

  describe('Financial Year oracle', () => {
    it('evaluates boundary dates in Asia/Kolkata correctly', () => {
      // End of FY 2026-27: 31 March 2027 23:59:59 IST (+05:30)
      const endOfFy26 = '2027-03-31T23:59:59+05:30';
      expect(getIndianFinancialYear(endOfFy26)).toBe('2026-27');

      // Start of FY 2027-28: 1 April 2027 00:00:00 IST (+05:30)
      const startOfFy27 = '2027-04-01T00:00:00+05:30';
      expect(getIndianFinancialYear(startOfFy27)).toBe('2027-28');

      const parts = parseDateToIstParts(startOfFy27);
      expect(parts.year).toBe(2027);
      expect(parts.month).toBe(4);
      expect(parts.day).toBe(1);
      expect(parts.hour).toBe(0);
    });

    it('produces valid expected invoice number regex', () => {
      const pattern = getExpectedInvoiceNumberPattern(1, '2026-27');
      expect(pattern.test('BMA/26-27/0001')).toBe(true);
      expect(pattern.test('BMA/26-27/0002')).toBe(false);
      expect(pattern.test('BMA/25-26/0001')).toBe(false);
      expect(pattern.test('INV/2026-27/0001')).toBe(false);
    });
  });

  describe('Environment safety guards and schema', () => {
    const validConfig: E2eEnv = {
      E2E_BASE_URL: 'https://bm-preview-staging.vercel.app',
      E2E_CONFIRM_STAGING: 'yes-this-is-not-production',
      E2E_FORBIDDEN_HOSTS: 'billmatrix.in,app.billmatrix.in',
      E2E_DATABASE_URL: 'postgresql://usr:pwd@ep-staging.aws.neon.tech/neondb?sslmode=require',
      E2E_DB_HOST_ALLOWLIST: 'ep-staging.aws.neon.tech',
      E2E_FORBIDDEN_DB_HOSTS: 'ep-prod.aws.neon.tech',
      E2E_VERIFY_MODE: 'db',
      E2E_EXPECT_VERIFICATION_REQUIRED: true,
      E2E_ADMIN_EMAIL: 'admin@staging.test',
      E2E_ADMIN_PASSWORD: 'Password12345!',
      E2E_UPSTASH_ALLOW_FLUSH: false,
      E2E_UPDATE_A11Y_BASELINE: false,
      E2E_EXPECT_ARCHIVAL: false,
    };

    it('passes for a valid staging configuration', () => {
      expect(() => assertSafeTarget(validConfig)).not.toThrow();
    });

    it('throws when E2E_CONFIRM_STAGING is missing or incorrect', () => {
      expect(() =>
        assertSafeTarget({ ...validConfig, E2E_CONFIRM_STAGING: 'no' }),
      ).toThrow(E2eSafetyError);
    });

    it('throws when E2E_BASE_URL points to a forbidden host', () => {
      expect(() =>
        assertSafeTarget({
          ...validConfig,
          E2E_BASE_URL: 'https://app.billmatrix.in/dashboard',
        }),
      ).toThrow(E2eSafetyError);
    });

    it('throws when E2E_DATABASE_URL points to a forbidden DB host', () => {
      expect(() =>
        assertSafeTarget({
          ...validConfig,
          E2E_DATABASE_URL: 'postgresql://usr:pwd@ep-prod.aws.neon.tech/neondb',
        }),
      ).toThrow(E2eSafetyError);
    });

    it('throws when E2E_DATABASE_URL host is not in allowlist', () => {
      expect(() =>
        assertSafeTarget({
          ...validConfig,
          E2E_DATABASE_URL: 'postgresql://usr:pwd@ep-unknown.aws.neon.tech/neondb',
        }),
      ).toThrow(E2eSafetyError);
    });

    it('Upstash flush needs the host in a NON-EMPTY allowlist (empty never means "any host")', () => {
      const flush = { ...validConfig, E2E_UPSTASH_ALLOW_FLUSH: true, E2E_UPSTASH_REST_URL: 'https://test-redis.upstash.io' };
      expect(() => assertSafeTarget({ ...flush, E2E_UPSTASH_HOST_ALLOWLIST: 'test-redis.upstash.io' })).not.toThrow();
      expect(() => assertSafeTarget({ ...flush, E2E_UPSTASH_HOST_ALLOWLIST: 'other.upstash.io' })).toThrow(E2eSafetyError);
      expect(() => assertSafeTarget({ ...flush, E2E_UPSTASH_HOST_ALLOWLIST: '' })).toThrow(E2eSafetyError);
      expect(() => assertSafeTarget(flush)).toThrow(E2eSafetyError);
      // Flush off: no Upstash check needed.
      expect(() => assertSafeTarget({ ...flush, E2E_UPSTASH_ALLOW_FLUSH: false })).not.toThrow();
    });

    it('schema rejects missing required fields such as E2E_FORBIDDEN_HOSTS', () => {
      const invalid = { ...validConfig, E2E_FORBIDDEN_HOSTS: '' };
      const parsed = e2eEnvSchema.safeParse(invalid);
      expect(parsed.success).toBe(false);
    });
  });

  describe('a11y ratchet baseline diff', () => {
    it('detects regressions for new violation rules or higher counts', () => {
      const baseline = { 'color-contrast': 2, 'aria-required': 1 };
      const current = { 'color-contrast': 3, 'aria-required': 1, 'image-alt': 1 };

      const diff = diffAgainstBaseline(current, baseline);
      expect(diff.isClean).toBe(false);
      expect(diff.regressions).toEqual([
        { ruleId: 'color-contrast', expectedCount: 2, actualCount: 3 },
        { ruleId: 'image-alt', expectedCount: 0, actualCount: 1 },
      ]);
    });

    it('detects improvements when violation counts decrease or disappear', () => {
      const baseline = { 'color-contrast': 2, 'aria-required': 1 };
      const current = { 'color-contrast': 1 };

      const diff = diffAgainstBaseline(current, baseline);
      expect(diff.isClean).toBe(true);
      expect(diff.improvements).toHaveLength(2);
      expect(diff.improvements).toContainEqual({
        ruleId: 'color-contrast',
        previousCount: 2,
        currentCount: 1,
      });
      expect(diff.improvements).toContainEqual({
        ruleId: 'aria-required',
        previousCount: 1,
        currentCount: 0,
      });
    });

    it('reports clean when current exactly matches baseline', () => {
      const baseline = { 'color-contrast': 2 };
      const current = { 'color-contrast': 2 };
      const diff = diffAgainstBaseline(current, baseline);
      expect(diff.isClean).toBe(true);
      expect(diff.regressions).toHaveLength(0);
      expect(diff.improvements).toHaveLength(0);
    });
  });

  describe('Identity and UTR generators', () => {
    it('generates identities meeting application validation schemas', () => {
      const identity = generateTestIdentity();
      expect(identity.runId).toBeTruthy();
      expect(identity.email).toMatch(/^e2e\+.*@example\.test$/);

      // Password policy check
      const pwCheck = validatePasswordPolicy(identity.password, { email: identity.email });
      expect(pwCheck.ok).toBe(true);

      // Subscription claim UTR check
      const claimParsed = subscriptionClaimSchema.safeParse({
        plan_name: 'essentials',
        billing_cycle: 'monthly',
        payment_method: 'upi_qr',
        payment_reference: identity.utr,
      });
      expect(claimParsed.success).toBe(true);
    });

    it('generates unique run IDs and passwords', () => {
      const r1 = generateRunId();
      const r2 = generateRunId();
      expect(r1).not.toBe(r2);

      const p1 = generateTestPassword();
      const p2 = generateTestPassword();
      expect(p1).not.toBe(p2);
      expect(p1.length).toBe(20);

      const u1 = generateUtr();
      const u2 = generateUtr();
      expect(u1).not.toBe(u2);
      expect(u1).toMatch(/^\d{12}$/);
    });
  });
});

