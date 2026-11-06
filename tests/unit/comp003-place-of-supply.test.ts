import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ActionError } from '@/lib/actions/_shared/errors';
import { isValidStateCode } from '@/lib/gst/indian-states';
import {
  assertDraftTotalsMatch,
  findTotalsMismatches,
  resolveDraftPlaceOfSupply,
  type StoredInvoiceTotals,
} from '@/lib/invoices/place-of-supply';
import type { TaxCalculationResult } from '@/lib/gst/types';

describe('COMP-003: Place of supply unit tests', () => {
  describe('isValidStateCode', () => {
    it('returns true for real GST state/UT codes', () => {
      expect(isValidStateCode('27')).toBe(true);
      expect(isValidStateCode('29')).toBe(true);
      expect(isValidStateCode('01')).toBe(true);
      expect(isValidStateCode('38')).toBe(true);
    });

    it('returns false for invalid codes, empty string, or non-strings', () => {
      expect(isValidStateCode('99')).toBe(false);
      expect(isValidStateCode('')).toBe(false);
      expect(isValidStateCode('1')).toBe(false);
      expect(isValidStateCode('ZZ')).toBe(false);
      expect(isValidStateCode(null)).toBe(false);
      expect(isValidStateCode(undefined)).toBe(false);
    });
  });

  describe('resolveDraftPlaceOfSupply', () => {
    it('returns the valid state code directly', () => {
      expect(resolveDraftPlaceOfSupply('27')).toBe('27');
      expect(resolveDraftPlaceOfSupply('29')).toBe('29');
    });

    it('throws ActionError with code INVALID_PLACE_OF_SUPPLY for missing or invalid values', () => {
      const cases = [null, undefined, '', '99', 'ZZ'];
      for (const val of cases) {
        expect(() => resolveDraftPlaceOfSupply(val)).toThrowError(ActionError);
        try {
          resolveDraftPlaceOfSupply(val);
        } catch (err) {
          expect(err).toBeInstanceOf(ActionError);
          expect((err as ActionError).code).toBe('INVALID_PLACE_OF_SUPPLY');
        }
      }
    });
  });

  describe('findTotalsMismatches & assertDraftTotalsMatch', () => {
    const baseStored: StoredInvoiceTotals = {
      subtotal_paise: 10000,
      total_cgst_paise: 900,
      total_sgst_paise: 900,
      total_igst_paise: 0,
      total_tax_paise: 1800,
      grand_total_paise: 11800,
    };

    const baseRecalculated: TaxCalculationResult = {
      subtotalPaise: 10000,
      totalCgstPaise: 900,
      totalSgstPaise: 900,
      totalIgstPaise: 0,
      totalTaxPaise: 1800,
      grandTotalPaise: 11800,
      supplyType: 'intra_state',
      gstRateType: 'exclusive',
      lineItems: [],
    };

    it('returns empty array when stored totals match recalculated', () => {
      expect(findTotalsMismatches(baseStored, baseRecalculated)).toEqual([]);
      expect(() => assertDraftTotalsMatch(baseStored, baseRecalculated)).not.toThrow();
    });

    it('identifies individual field mismatches precisely', () => {
      expect(findTotalsMismatches({ ...baseStored, subtotal_paise: 9999 }, baseRecalculated)).toEqual(['subtotal']);
      expect(findTotalsMismatches({ ...baseStored, total_cgst_paise: 901 }, baseRecalculated)).toEqual(['CGST']);
      expect(findTotalsMismatches({ ...baseStored, total_sgst_paise: 899 }, baseRecalculated)).toEqual(['SGST']);
      expect(findTotalsMismatches({ ...baseStored, total_igst_paise: 10 }, baseRecalculated)).toEqual(['IGST']);
      expect(findTotalsMismatches({ ...baseStored, total_tax_paise: 1801 }, baseRecalculated)).toEqual(['total tax']);
      expect(findTotalsMismatches({ ...baseStored, grand_total_paise: 11900 }, baseRecalculated)).toEqual(['grand total']);
    });

    it('handles rupee-rounding equivalence on grand total correctly', () => {
      // Recalculated exact total 11849 -> rounded to rupee paise is 11800
      const recalc49: TaxCalculationResult = {
        ...baseRecalculated,
        grandTotalPaise: 11849,
      };
      expect(findTotalsMismatches(baseStored, recalc49)).toEqual([]);

      // Recalculated exact total 11850 -> rounded to rupee paise is 11900 -> mismatch
      const recalc50: TaxCalculationResult = {
        ...baseRecalculated,
        grandTotalPaise: 11850,
      };
      expect(findTotalsMismatches(baseStored, recalc50)).toEqual(['grand total']);
    });

    it('throws ActionError with code DRAFT_TOTALS_MISMATCH listing mismatched fields', () => {
      const tampered: StoredInvoiceTotals = {
        ...baseStored,
        total_igst_paise: 100,
      };
      expect(() => assertDraftTotalsMatch(tampered, baseRecalculated)).toThrowError(ActionError);
      try {
        assertDraftTotalsMatch(tampered, baseRecalculated);
      } catch (err) {
        expect(err).toBeInstanceOf(ActionError);
        const actionError = err as ActionError;
        expect(actionError.code).toBe('DRAFT_TOTALS_MISMATCH');
        expect(actionError.message).toContain('IGST');
      }
    });
  });

  describe('finalize-invoice-tx.ts source-order and purity contract', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'lib/invoices/finalize-invoice-tx.ts'),
      'utf8',
    );

    it('calls resolveDraftPlaceOfSupply and does not override PoS with customer.state_code', () => {
      expect(source).toContain('resolveDraftPlaceOfSupply(');
      expect(source).not.toMatch(/customer\s*\?\s*customer\.state_code/);
      expect(source).not.toContain('|| business.state_code');
    });

    it('orders checks correctly: findOwnedCustomer < resolveDraftPlaceOfSupply < calculateInvoiceTax < assertDraftTotalsMatch < line item update', () => {
      const idxFindCustomer = source.indexOf('findOwnedCustomer(');
      const idxResolvePoS = source.indexOf('resolveDraftPlaceOfSupply(');
      const idxCalcTax = source.indexOf('calculateInvoiceTaxOrActionError(');
      const idxAssertTotals = source.indexOf('assertDraftTotalsMatch(');
      const idxUpdateLineItems = source.indexOf('tx.update(invoiceLineItems)');

      expect(idxFindCustomer).toBeGreaterThan(0);
      expect(idxResolvePoS).toBeGreaterThan(idxFindCustomer);
      expect(idxCalcTax).toBeGreaterThan(idxResolvePoS);
      expect(idxAssertTotals).toBeGreaterThan(idxCalcTax);
      expect(idxUpdateLineItems).toBeGreaterThan(idxAssertTotals);
    });

    it('remains pure and does not import revalidatePath', () => {
      expect(source).not.toContain('revalidatePath');
      expect(source).not.toContain('next/cache');
    });
  });
});

