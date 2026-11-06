import { describe, expect, it } from 'vitest';
import { calculateInvoiceTax } from '@/lib/gst/calculate';
import { TaxCalculationInput } from '@/lib/gst/types';

describe('lib/gst/calculate exact integer tax arithmetic', () => {
  it('calculates exact intra-state GST without floating-point errors', () => {
    const input: TaxCalculationInput = {
      sellerStateCode: '27',
      placeOfSupplyStateCode: '27',
      lineItems: [
        {
          quantity: 2.5,
          unitPricePaise: 10000, // ₹100.00
          discountPaise: 2500, // ₹25.00
          taxRatePercentage: 18,
        },
      ],
    };

    // gross = 2.5 * 10,000 = 25,000 paise
    // taxable = 25,000 - 2,500 = 22,500 paise
    // tax = 18% of 22,500 = 4,050 paise
    // intra-state split: CGST 2,025 paise, SGST 2,025 paise
    // grand total = 22,500 + 4,050 = 26,550 paise
    const result = calculateInvoiceTax(input);

    expect(result.supplyType).toBe('intra_state');
    expect(result.subtotalPaise).toBe(22500);
    expect(result.lineItems[0].discountPaise).toBe(2500);
    expect(result.lineItems[0].taxableValuePaise).toBe(22500);
    expect(result.totalCgstPaise).toBe(2025);
    expect(result.totalSgstPaise).toBe(2025);
    expect(result.totalIgstPaise).toBe(0);
    expect(result.totalTaxPaise).toBe(4050);
    expect(result.grandTotalPaise).toBe(26550);
  });

  it('calculates exact inter-state GST with 3 decimal place quantity', () => {
    const input: TaxCalculationInput = {
      sellerStateCode: '27',
      placeOfSupplyStateCode: '29',
      lineItems: [
        {
          quantity: 1.333,
          unitPricePaise: 3000, // ₹30.00
          discountPaise: 0,
          taxRatePercentage: 12,
        },
      ],
    };

    // gross = roundHalfUp(1333 * 3000 / 1000) = 3999 paise
    // taxable = 3999 paise
    // igst = 12% of 3999 = roundHalfUp(3999 * 12 / 100) = 480 paise
    // grand total = 3999 + 480 = 4479 paise
    const result = calculateInvoiceTax(input);

    expect(result.supplyType).toBe('inter_state');
    expect(result.subtotalPaise).toBe(3999);
    expect(result.totalCgstPaise).toBe(0);
    expect(result.totalSgstPaise).toBe(0);
    expect(result.totalIgstPaise).toBe(480);
    expect(result.totalTaxPaise).toBe(480);
    expect(result.grandTotalPaise).toBe(4479);
  });

  it('applies half-up rounding for 0.5 paise gross amount', () => {
    const input: TaxCalculationInput = {
      sellerStateCode: '27',
      placeOfSupplyStateCode: '27',
      lineItems: [
        {
          quantity: 0.5,
          unitPricePaise: 1, // 1 paise
          discountPaise: 0,
          taxRatePercentage: 0,
        },
      ],
    };

    // 0.500 * 1 = 0.5 paise -> rounds UP to 1 paise
    const result = calculateInvoiceTax(input);
    expect(result.subtotalPaise).toBe(1);
    expect(result.grandTotalPaise).toBe(1);
  });
});
