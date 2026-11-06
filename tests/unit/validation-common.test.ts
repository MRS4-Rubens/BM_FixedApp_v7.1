import { describe, expect, it } from 'vitest';
import {
  isoDate,
  moneyRupees,
  hasValidQuantityPrecision,
  quantity,
  stateCode,
  templateId,
  gstin,
} from '@/lib/validations/common';
import { MAX_QUANTITY, MAX_UNIT_PRICE_PAISE } from '@/lib/validations/limits';

describe('lib/validations/common', () => {
  describe('isoDate', () => {
    it('accepts valid YYYY-MM-DD dates', () => {
      expect(isoDate.safeParse('2024-02-29').success).toBe(true); // leap year
      expect(isoDate.safeParse('2026-11-02').success).toBe(true);
      expect(isoDate.safeParse('2025-12-31').success).toBe(true);
    });

    it('rejects invalid calendar dates', () => {
      expect(isoDate.safeParse('2025-02-29').success).toBe(false); // non-leap year Feb 29
      expect(isoDate.safeParse('2026-04-31').success).toBe(false); // April has 30 days
      expect(isoDate.safeParse('2026-13-01').success).toBe(false); // month 13
      expect(isoDate.safeParse('2026-00-10').success).toBe(false); // month 0
      expect(isoDate.safeParse('2026-05-00').success).toBe(false); // day 0
      expect(isoDate.safeParse('2026-05-32').success).toBe(false); // day 32
    });

    it('rejects malformed date strings', () => {
      expect(isoDate.safeParse('2026/11/02').success).toBe(false);
      expect(isoDate.safeParse('02-11-2026').success).toBe(false);
      expect(isoDate.safeParse('2026-1-2').success).toBe(false);
      expect(isoDate.safeParse('not-a-date').success).toBe(false);
    });
  });

  describe('moneyRupees', () => {
    const maxRupees = MAX_UNIT_PRICE_PAISE / 100;
    const priceSchema = moneyRupees({ label: 'Unit price', max: maxRupees });

    it('accepts valid currency amounts coerced from string or number', () => {
      expect(priceSchema.safeParse('0').success).toBe(true);
      expect(priceSchema.safeParse(0).success).toBe(true);
      expect(priceSchema.safeParse('10.5').success).toBe(true);
      expect(priceSchema.safeParse('100.25').success).toBe(true);
      expect(priceSchema.safeParse(100.25).success).toBe(true);
    });

    it('rejects more than 2 decimal places', () => {
      expect(priceSchema.safeParse('10.555').success).toBe(false);
      expect(priceSchema.safeParse(10.555).success).toBe(false);
      expect(priceSchema.safeParse('0.001').success).toBe(false);
    });

    it('rejects negative amounts', () => {
      expect(priceSchema.safeParse('-1').success).toBe(false);
      expect(priceSchema.safeParse(-5).success).toBe(false);
    });

    it('rejects amounts exceeding max limit', () => {
      expect(priceSchema.safeParse(maxRupees).success).toBe(true);
      expect(priceSchema.safeParse(maxRupees + 1).success).toBe(false);
    });
  });

  describe('hasValidQuantityPrecision & quantity', () => {
    it('validates quantity precision up to 3 decimal places', () => {
      expect(hasValidQuantityPrecision(1)).toBe(true);
      expect(hasValidQuantityPrecision(1.5)).toBe(true);
      expect(hasValidQuantityPrecision(1.234)).toBe(true);
      expect(hasValidQuantityPrecision(1.2345)).toBe(false);
    });

    it('accepts valid quantities in quantity schema', () => {
      expect(quantity.safeParse('1').success).toBe(true);
      expect(quantity.safeParse(1).success).toBe(true);
      expect(quantity.safeParse('1.234').success).toBe(true);
      expect(quantity.safeParse(1.234).success).toBe(true);
    });

    it('rejects zero, negative, or excessive quantities', () => {
      expect(quantity.safeParse(0).success).toBe(false);
      expect(quantity.safeParse(-1).success).toBe(false);
      expect(quantity.safeParse(MAX_QUANTITY + 1).success).toBe(false);
      expect(quantity.safeParse(1.2345).success).toBe(false);
    });
  });

  describe('stateCode', () => {
    it('accepts valid 2-digit Indian GST state codes', () => {
      expect(stateCode.safeParse('27').success).toBe(true); // Maharashtra
      expect(stateCode.safeParse('29').success).toBe(true); // Karnataka
      expect(stateCode.safeParse('07').success).toBe(true); // Delhi
      expect(stateCode.safeParse('37').success).toBe(true); // Andhra Pradesh
    });

    it('rejects invalid or non-existent state codes', () => {
      expect(stateCode.safeParse('00').success).toBe(false);
      expect(stateCode.safeParse('99').success).toBe(false);
      expect(stateCode.safeParse('MH').success).toBe(false);
      expect(stateCode.safeParse('2').success).toBe(false);
      expect(stateCode.safeParse('270').success).toBe(false);
    });
  });

  describe('templateId', () => {
    it('accepts recognized invoice template IDs', () => {
      expect(templateId.safeParse('template_1').success).toBe(true);
      expect(templateId.safeParse('template_2').success).toBe(true);
      expect(templateId.safeParse('template_3').success).toBe(true);
      expect(templateId.safeParse('template_4').success).toBe(true);
    });

    it('rejects arbitrary or unknown template strings', () => {
      expect(templateId.safeParse('unknown').success).toBe(false);
      expect(templateId.safeParse('classic').success).toBe(false);
      expect(templateId.safeParse('').success).toBe(false);
    });
  });

  describe('gstin', () => {
    it('accepts valid 15-character GSTIN with valid checksum', () => {
      expect(gstin.safeParse('29ABCDE1234F1ZW').success).toBe(true);
      expect(gstin.safeParse('33GSPTN0462P1ZU').success).toBe(true);
    });

    it('rejects GSTIN with invalid checksum', () => {
      expect(gstin.safeParse('29ABCDE1234F1Z5').success).toBe(false);
    });

    it('rejects malformed GSTIN format', () => {
      expect(gstin.safeParse('29ABCDE1234F1Z').success).toBe(false);
      expect(gstin.safeParse('29ABCDE1234F1ZW5').success).toBe(false);
      expect(gstin.safeParse('INVALIDGSTIN123').success).toBe(false);
    });
  });
});
