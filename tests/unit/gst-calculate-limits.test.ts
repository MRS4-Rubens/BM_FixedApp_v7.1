import { describe, expect, it } from 'vitest';
import { calculateInvoiceTax } from '@/lib/gst/calculate';
import { GstCalculationError, MoneyLimitError } from '@/lib/gst/errors';
import {
  MAX_AMOUNT_LABEL,
  MAX_DOCUMENT_TOTAL_PAISE,
  MAX_INVOICE_LINE_ITEMS,
  MAX_LINE_GROSS_PAISE,
  MAX_QUANTITY,
  MAX_QUANTITY_LABEL,
  MAX_UNIT_PRICE_LABEL,
  MAX_UNIT_PRICE_PAISE,
} from '@/lib/money-limits';
import { amountInWordsIndian } from '@/lib/pdf/number-to-words';

describe('GST calculation monetary limits and defense-in-depth (DB-003)', () => {
  it('computes ₹5 crore invoice accurately beyond 32-bit int4 capacity (intra-state)', () => {
    // 10 units at ₹50,00,000 (500,000,000 paise each) = ₹5,00,00,000 taxable value
    // 18% GST (9% CGST + 9% SGST) = ₹45,00,000 + ₹45,00,000 = ₹90,00,000 tax
    // Grand Total = ₹5,90,00,000 = 5,900,000,000 paise
    const result = calculateInvoiceTax({
      sellerStateCode: '27', // Maharashtra
      placeOfSupplyStateCode: '27', // Intra-state
      gstRateType: 'exclusive',
      lineItems: [
        {
          quantity: 10,
          unitPricePaise: 500_000_000,
          taxRatePercentage: 18,
          discountPaise: 0,
        },
      ],
    });

    expect(result.subtotalPaise).toBe(5_000_000_000);
    expect(result.totalCgstPaise).toBe(450_000_000);
    expect(result.totalSgstPaise).toBe(450_000_000);
    expect(result.totalIgstPaise).toBe(0);
    expect(result.totalTaxPaise).toBe(900_000_000);
    expect(result.grandTotalPaise).toBe(5_900_000_000);
    expect(result.grandTotalPaise).toBeGreaterThan(2_147_483_647);
  });

  it('computes ₹5 crore invoice accurately for inter-state supply', () => {
    const result = calculateInvoiceTax({
      sellerStateCode: '27', // Maharashtra
      placeOfSupplyStateCode: '29', // Karnataka (Inter-state)
      gstRateType: 'exclusive',
      lineItems: [
        {
          quantity: 10,
          unitPricePaise: 500_000_000,
          taxRatePercentage: 18,
          discountPaise: 0,
        },
      ],
    });

    expect(result.subtotalPaise).toBe(5_000_000_000);
    expect(result.totalCgstPaise).toBe(0);
    expect(result.totalSgstPaise).toBe(0);
    expect(result.totalIgstPaise).toBe(900_000_000);
    expect(result.totalTaxPaise).toBe(900_000_000);
    expect(result.grandTotalPaise).toBe(5_900_000_000);
  });

  it('rejects input with MoneyLimitError when quantity exceeds MAX_QUANTITY', () => {
    let thrownError: unknown = null;
    try {
      calculateInvoiceTax({
        sellerStateCode: '27',
        placeOfSupplyStateCode: '27',
        lineItems: [
          {
            quantity: MAX_QUANTITY + 1,
            unitPricePaise: 1000,
            taxRatePercentage: 18,
          },
        ],
      });
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(MoneyLimitError);
    expect(thrownError).toBeInstanceOf(GstCalculationError);
    expect(thrownError).not.toBeInstanceOf(RangeError);
    expect((thrownError as Error).message).toContain(`Quantity cannot exceed ${MAX_QUANTITY_LABEL}`);
  });

  it('rejects input with MoneyLimitError when unit price exceeds MAX_UNIT_PRICE_PAISE', () => {
    let thrownError: unknown = null;
    try {
      calculateInvoiceTax({
        sellerStateCode: '27',
        placeOfSupplyStateCode: '27',
        lineItems: [
          {
            quantity: 1,
            unitPricePaise: MAX_UNIT_PRICE_PAISE + 1,
            taxRatePercentage: 18,
          },
        ],
      });
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(MoneyLimitError);
    expect(thrownError).toBeInstanceOf(GstCalculationError);
    expect(thrownError).not.toBeInstanceOf(RangeError);
    expect((thrownError as Error).message).toContain(`Rate cannot exceed ${MAX_UNIT_PRICE_LABEL}`);
  });

  it('rejects input with MoneyLimitError on extreme line gross (MAX_QUANTITY * MAX_UNIT_PRICE_PAISE)', () => {
    let thrownError: unknown = null;
    try {
      calculateInvoiceTax({
        sellerStateCode: '27',
        placeOfSupplyStateCode: '27',
        lineItems: [
          {
            quantity: MAX_QUANTITY,
            unitPricePaise: MAX_UNIT_PRICE_PAISE,
            taxRatePercentage: 18,
          },
        ],
      });
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(MoneyLimitError);
    expect(thrownError).toBeInstanceOf(GstCalculationError);
    expect(thrownError).not.toBeInstanceOf(RangeError);
    expect((thrownError as Error).message).toContain(`A line amount cannot exceed ${MAX_AMOUNT_LABEL}`);
  });

  it('rejects document with MoneyLimitError when line items exceed MAX_INVOICE_LINE_ITEMS (201 lines)', () => {
    const lineItems = Array.from({ length: MAX_INVOICE_LINE_ITEMS + 1 }, () => ({
      quantity: 1,
      unitPricePaise: 100,
      taxRatePercentage: 18,
    }));

    let thrownError: unknown = null;
    try {
      calculateInvoiceTax({
        sellerStateCode: '27',
        placeOfSupplyStateCode: '27',
        lineItems,
      });
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(MoneyLimitError);
    expect(thrownError).toBeInstanceOf(GstCalculationError);
    expect(thrownError).not.toBeInstanceOf(RangeError);
    expect((thrownError as Error).message).toContain(
      `A document cannot have more than ${MAX_INVOICE_LINE_ITEMS} line items`
    );
  });

  it('rejects document with MoneyLimitError when grand total exceeds MAX_DOCUMENT_TOTAL_PAISE even if each line is individually valid', () => {
    // 2 lines of 500,000,000,000 paise (500000000000 * 2 = 1,000,000,000,000 > MAX_DOCUMENT_TOTAL_PAISE)
    // each line gross = 500 * 100,000,000 paise <= MAX_LINE_GROSS_PAISE
    let thrownError: unknown = null;
    try {
      calculateInvoiceTax({
        sellerStateCode: '27',
        placeOfSupplyStateCode: '27',
        lineItems: [
          {
            quantity: 1000,
            unitPricePaise: 500_000_000, // 500,000,000,000 paise gross <= MAX_LINE_GROSS_PAISE
            taxRatePercentage: 18,
          },
          {
            quantity: 1000,
            unitPricePaise: 500_000_000, // 500,000,000,000 paise gross <= MAX_LINE_GROSS_PAISE
            taxRatePercentage: 18,
          },
        ],
      });
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(MoneyLimitError);
    expect(thrownError).toBeInstanceOf(GstCalculationError);
    expect(thrownError).not.toBeInstanceOf(RangeError);
    expect((thrownError as Error).message).toContain(
      `The document total cannot exceed ${MAX_AMOUNT_LABEL}`
    );
  });

  it('accepts a line exactly at MAX_LINE_GROSS_PAISE with 0% tax, but rejects when tax pushes total over', () => {
    const exactQty = MAX_LINE_GROSS_PAISE / MAX_UNIT_PRICE_PAISE; // exactly yields MAX_LINE_GROSS_PAISE when multiplied
    const validResult = calculateInvoiceTax({
      sellerStateCode: '27',
      placeOfSupplyStateCode: '27',
      lineItems: [
        {
          quantity: exactQty,
          unitPricePaise: MAX_UNIT_PRICE_PAISE,
          taxRatePercentage: 0,
        },
      ],
    });
    expect(validResult.grandTotalPaise).toBe(MAX_LINE_GROSS_PAISE);

    // Same line with 5% tax pushes grand total over MAX_DOCUMENT_TOTAL_PAISE
    let thrownError: unknown = null;
    try {
      calculateInvoiceTax({
        sellerStateCode: '27',
        placeOfSupplyStateCode: '27',
        lineItems: [
          {
            quantity: exactQty,
            unitPricePaise: MAX_UNIT_PRICE_PAISE,
            taxRatePercentage: 5,
          },
        ],
      });
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(MoneyLimitError);
    expect(thrownError).toBeInstanceOf(GstCalculationError);
  });

  it('throws GstCalculationError (not MoneyLimitError) for non-finite or non-integer inputs', () => {
    // NaN quantity
    let nanError: unknown = null;
    try {
      calculateInvoiceTax({
        sellerStateCode: '27',
        placeOfSupplyStateCode: '27',
        lineItems: [
          {
            quantity: NaN,
            unitPricePaise: 1000,
            taxRatePercentage: 18,
          },
        ],
      });
    } catch (err) {
      nanError = err;
    }
    expect(nanError).toBeInstanceOf(GstCalculationError);
    expect(nanError).not.toBeInstanceOf(MoneyLimitError);

    // Non-integer paise
    let nonIntError: unknown = null;
    try {
      calculateInvoiceTax({
        sellerStateCode: '27',
        placeOfSupplyStateCode: '27',
        lineItems: [
          {
            quantity: 1,
            unitPricePaise: 1.5,
            taxRatePercentage: 18,
          },
        ],
      });
    } catch (err) {
      nonIntError = err;
    }
    expect(nonIntError).toBeInstanceOf(GstCalculationError);
    expect(nonIntError).not.toBeInstanceOf(MoneyLimitError);
  });

  it('preserves existing tax calculation behavior for standard exclusive and inclusive cases', () => {
    // Representative exclusive case
    const exclusiveResult = calculateInvoiceTax({
      sellerStateCode: '27',
      placeOfSupplyStateCode: '27',
      gstRateType: 'exclusive',
      lineItems: [
        {
          quantity: 2,
          unitPricePaise: 10000,
          taxRatePercentage: 18,
          discountPaise: 0,
        },
      ],
    });
    expect(exclusiveResult.subtotalPaise).toBe(20000);
    expect(exclusiveResult.totalCgstPaise).toBe(1800);
    expect(exclusiveResult.totalSgstPaise).toBe(1800);
    expect(exclusiveResult.totalTaxPaise).toBe(3600);
    expect(exclusiveResult.grandTotalPaise).toBe(23600);

    // Representative inclusive case
    const inclusiveResult = calculateInvoiceTax({
      sellerStateCode: '27',
      placeOfSupplyStateCode: '27',
      gstRateType: 'inclusive',
      lineItems: [
        {
          quantity: 1,
          unitPricePaise: 11800,
          taxRatePercentage: 18,
          discountPaise: 0,
        },
      ],
    });
    expect(inclusiveResult.subtotalPaise).toBe(10000);
    expect(inclusiveResult.totalCgstPaise).toBe(900);
    expect(inclusiveResult.totalSgstPaise).toBe(900);
    expect(inclusiveResult.totalTaxPaise).toBe(1800);
    expect(inclusiveResult.grandTotalPaise).toBe(11800);
  });

  it('couples safely with amountInWordsIndian at the maximum document total ceiling', () => {
    const rupees = Math.floor(MAX_DOCUMENT_TOTAL_PAISE / 100);
    const paise = MAX_DOCUMENT_TOTAL_PAISE % 100;
    const words = amountInWordsIndian(rupees, paise);

    expect(words).not.toContain('undefined');
    expect(words.startsWith('Nine Hundred Ninety Nine Crore')).toBe(true);
  });
});
