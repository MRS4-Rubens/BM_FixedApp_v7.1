import { describe, expect, it } from 'vitest';
import { isTaxRateEffectiveOn, TaxRateValidityFields } from '@/lib/gst/tax-rate-validity';

describe('lib/gst/tax-rate-validity isTaxRateEffectiveOn', () => {
  it('returns true for active rates when date is within effective range', () => {
    const rate: TaxRateValidityFields = {
      is_active: true,
      effective_from: '2017-07-01',
      effective_to: null,
    };

    expect(isTaxRateEffectiveOn(rate, '2017-07-01')).toBe(true);
    expect(isTaxRateEffectiveOn(rate, '2024-01-01')).toBe(true);
    expect(isTaxRateEffectiveOn(rate, '2026-11-02')).toBe(true);
  });

  it('returns false when rate is inactive', () => {
    const rate: TaxRateValidityFields = {
      is_active: false,
      effective_from: '2017-07-01',
      effective_to: null,
    };

    expect(isTaxRateEffectiveOn(rate, '2026-11-02')).toBe(false);
  });

  it('returns false when date is before effective_from', () => {
    const rate: TaxRateValidityFields = {
      is_active: true,
      effective_from: '2024-01-01',
      effective_to: null,
    };

    expect(isTaxRateEffectiveOn(rate, '2023-12-31')).toBe(false);
    expect(isTaxRateEffectiveOn(rate, '2024-01-01')).toBe(true);
  });

  it('returns false when date is after effective_to', () => {
    const rate: TaxRateValidityFields = {
      is_active: true,
      effective_from: '2020-01-01',
      effective_to: '2024-12-31',
    };

    expect(isTaxRateEffectiveOn(rate, '2024-12-31')).toBe(true);
    expect(isTaxRateEffectiveOn(rate, '2025-01-01')).toBe(false);
  });
});
