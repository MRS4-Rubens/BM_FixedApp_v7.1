import { describe, expect, it } from 'vitest';
import {
  buildTaxLineInput,
  buildPreviewTaxLineInput,
  assertTaxResultWithinCeiling,
  LineMathError,
} from '@/lib/invoices/line-math';
import { MAX_DOCUMENT_TOTAL_PAISE } from '@/lib/validations/limits';
import { TaxCalculationResult } from '@/lib/gst/types';

describe('lib/invoices/line-math', () => {
  describe('buildTaxLineInput vs buildPreviewTaxLineInput parity', () => {
    it('produces identical TaxLineItemInput for valid inputs', () => {
      const serverInput = buildTaxLineInput({
        quantity: 2.5,
        unitPriceRupees: 100,
        discountPercent: 10,
        taxRatePercentage: 18,
      });

      const previewInput = buildPreviewTaxLineInput({
        quantity: 2.5,
        unitPriceRupees: 100,
        discountPercent: 10,
        taxRatePercentage: 18,
      });

      expect(serverInput).not.toBeNull();
      expect(previewInput).not.toBeNull();
      expect(serverInput).toEqual(previewInput);
      // gross = 2.500 * 10,000 paise = 25,000 paise
      // discount = 10% of 25,000 = 2,500 paise
      expect(serverInput).toEqual({
        quantity: 2.5,
        unitPricePaise: 10000,
        discountPaise: 2500,
        taxRatePercentage: 18,
      });
    });

    it('exhibits exact browser/server parity across 5,000 pseudo-random cases', () => {
      for (let i = 1; i <= 5000; i++) {
        const qty = ((i * 17) % 500 + 1) / 10; // 0.1 to 50.0
        const price = (i * 23) % 1000 + 1; // 1 to 1000 rupees
        const disc = (i * 7) % 50; // 0 to 49%
        const rate = (i % 2 === 0) ? 18 : 12;

        const serverRes = buildTaxLineInput({
          quantity: qty,
          unitPriceRupees: price,
          discountPercent: disc,
          taxRatePercentage: rate,
        });

        const previewRes = buildPreviewTaxLineInput({
          quantity: qty,
          unitPriceRupees: price,
          discountPercent: disc,
          taxRatePercentage: rate,
        });

        expect(serverRes).toEqual(previewRes);
      }
    });

    it('buildTaxLineInput throws LineMathError on invalid or zero quantity', () => {
      expect(() =>
        buildTaxLineInput({
          quantity: 0,
          unitPriceRupees: 100,
          discountPercent: 0,
          taxRatePercentage: 18,
        })
      ).toThrow(LineMathError);

      expect(() =>
        buildTaxLineInput({
          quantity: -1,
          unitPriceRupees: 100,
          discountPercent: 0,
          taxRatePercentage: 18,
        })
      ).toThrow(LineMathError);

      expect(() =>
        buildTaxLineInput({
          quantity: 1.2345, // > 3 decimals
          unitPriceRupees: 100,
          discountPercent: 0,
          taxRatePercentage: 18,
        })
      ).toThrow(LineMathError);
    });

    it('buildPreviewTaxLineInput returns null on invalid or zero quantity without throwing', () => {
      expect(
        buildPreviewTaxLineInput({
          quantity: 0,
          unitPriceRupees: 100,
          discountPercent: 0,
          taxRatePercentage: 18,
        })
      ).toBeNull();

      expect(
        buildPreviewTaxLineInput({
          quantity: -1,
          unitPriceRupees: 100,
          discountPercent: 0,
          taxRatePercentage: 18,
        })
      ).toBeNull();

      expect(
        buildPreviewTaxLineInput({
          quantity: 1.2345,
          unitPriceRupees: 100,
          discountPercent: 0,
          taxRatePercentage: 18,
        })
      ).toBeNull();
    });
  });

  describe('assertTaxResultWithinCeiling', () => {
    it('accepts tax results within the document ceiling', () => {
      const mockResult: TaxCalculationResult = {
        supplyType: 'intra_state',
        lineItems: [],
        subtotalPaise: 100000,
        totalCgstPaise: 9000,
        totalSgstPaise: 9000,
        totalIgstPaise: 0,
        totalTaxPaise: 18000,
        grandTotalPaise: 118000,
        gstRateType: 'exclusive',
      };

      expect(() => assertTaxResultWithinCeiling(mockResult)).not.toThrow();
    });

    it('throws LineMathError when grand total exceeds MAX_DOCUMENT_TOTAL_PAISE', () => {
      const mockResult: TaxCalculationResult = {
        supplyType: 'intra_state',
        lineItems: [],
        subtotalPaise: MAX_DOCUMENT_TOTAL_PAISE + 1,
        totalCgstPaise: 0,
        totalSgstPaise: 0,
        totalIgstPaise: 0,
        totalTaxPaise: 0,
        grandTotalPaise: MAX_DOCUMENT_TOTAL_PAISE + 1,
        gstRateType: 'exclusive',
      };

      expect(() => assertTaxResultWithinCeiling(mockResult)).toThrow(LineMathError);
      try {
        assertTaxResultWithinCeiling(mockResult);
      } catch (err) {
        expect(err).toBeInstanceOf(LineMathError);
        expect((err as LineMathError).code).toBe('DOCUMENT_TOTAL_TOO_LARGE');
      }
    });
  });
});
