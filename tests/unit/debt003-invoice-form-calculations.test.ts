import { describe, it, expect } from 'vitest';
import {
  computeInvoiceTaxPreview,
  buildInvoiceNumberPreview,
  collectValidationErrors,
  formatINR,
} from '@/components/app/invoices/invoice-form/form-calculations';
import { roundToRupeePaise } from '@/lib/money';
import type { taxRates, financialYears } from '@/lib/db/schema';
import type { FieldErrors } from 'react-hook-form';
import type { InvoiceDraftInput } from '@/lib/validations/invoice';

describe('debt003-invoice-form-calculations', () => {
  const dbTaxRates: (typeof taxRates.$inferSelect)[] = [
    {
      id: 'tr-0',
      label: '0%',
      rate_percentage: '0.00',
      is_active: true,
      effective_from: '2017-07-01',
      effective_to: null,
      created_at: new Date('2020-01-01'),
      updated_at: new Date('2020-01-01'),
    },
    {
      id: 'tr-5',
      label: '5%',
      rate_percentage: '5.00',
      is_active: true,
      effective_from: '2017-07-01',
      effective_to: null,
      created_at: new Date('2020-01-01'),
      updated_at: new Date('2020-01-01'),
    },
    {
      id: 'tr-12',
      label: '12%',
      rate_percentage: '12.00',
      is_active: true,
      effective_from: '2017-07-01',
      effective_to: null,
      created_at: new Date('2020-01-01'),
      updated_at: new Date('2020-01-01'),
    },
    {
      id: 'tr-18',
      label: '18%',
      rate_percentage: '18.00',
      is_active: true,
      effective_from: '2017-07-01',
      effective_to: null,
      created_at: new Date('2020-01-01'),
      updated_at: new Date('2020-01-01'),
    },
    {
      id: 'tr-28',
      label: '28%',
      rate_percentage: '28.00',
      is_active: true,
      effective_from: '2017-07-01',
      effective_to: null,
      created_at: new Date('2020-01-01'),
      updated_at: new Date('2020-01-01'),
    },
  ];

  describe('computeInvoiceTaxPreview', () => {
    it('handles intra-state exclusive two rates (CGST + SGST)', () => {
      const lineItems = [
        { quantity: 2, unit_price: 100, discount: 0, tax_rate_id: 'tr-5' },
        { quantity: 1, unit_price: 200, discount: 10, tax_rate_id: 'tr-18' },
      ];

      const res = computeInvoiceTaxPreview({
        lineItems,
        taxRates: dbTaxRates,
        sellerStateCode: '27',
        placeOfSupplyStateCode: '27',
        gstRateType: 'exclusive',
      });

      expect(res.supplyType).toBe('intra_state');
      expect(res.totalCGST).toBeGreaterThan(0);
      expect(res.totalSGST).toBeGreaterThan(0);
      expect(res.totalIGST).toBe(0);
      expect(res.totalCGST).toBe(res.totalSGST);
      expect(res.totalTaxable).toBe(380); // 200 + 180
    });

    it('handles inter-state -> IGST only', () => {
      const lineItems = [
        { quantity: 1, unit_price: 1000, discount: 0, tax_rate_id: 'tr-18' },
      ];

      const res = computeInvoiceTaxPreview({
        lineItems,
        taxRates: dbTaxRates,
        sellerStateCode: '27',
        placeOfSupplyStateCode: '29',
        gstRateType: 'exclusive',
      });

      expect(res.supplyType).toBe('inter_state');
      expect(res.totalCGST).toBe(0);
      expect(res.totalSGST).toBe(0);
      expect(res.totalIGST).toBe(180);
      expect(res.totalTaxable).toBe(1000);
      expect(res.grandTotal).toBe(1180);
    });

    it('handles inclusive GST calculation', () => {
      const lineItems = [
        { quantity: 1, unit_price: 118, discount: 0, tax_rate_id: 'tr-18' },
      ];

      const res = computeInvoiceTaxPreview({
        lineItems,
        taxRates: dbTaxRates,
        sellerStateCode: '27',
        placeOfSupplyStateCode: '27',
        gstRateType: 'inclusive',
      });

      expect(res.totalTaxable).toBe(100);
      expect(res.totalCGST).toBe(9);
      expect(res.totalSGST).toBe(9);
      expect(res.grandTotal).toBe(118);
    });

    it('handles empty or invalid lines: zeros but breakdown lists every DB rate ascending', () => {
      const res = computeInvoiceTaxPreview({
        lineItems: [],
        taxRates: dbTaxRates,
        sellerStateCode: '27',
      });

      expect(res.taxResult).toBeNull();
      expect(res.totalTaxable).toBe(0);
      expect(res.totalCGST).toBe(0);
      expect(res.totalSGST).toBe(0);
      expect(res.totalIGST).toBe(0);
      expect(res.grandTotal).toBe(0);
      expect(res.roundOff).toBe(0);
      expect(res.sortedGstRates).toEqual([0, 5, 12, 18, 28]);
      for (const rate of [0, 5, 12, 18, 28]) {
        expect(res.gstBreakdownMap[rate]).toEqual({
          ratePercentage: rate,
          taxableValuePaise: 0,
          cgstPaise: 0,
          sgstPaise: 0,
          igstPaise: 0,
        });
      }
    });

    it('a line rate missing from DB still appears in gstBreakdownMap and sortedGstRates', () => {
      // tr-40 is 40%, not in dbTaxRates
      const customRates = [
        ...dbTaxRates,
        {
          id: 'tr-40',
          label: '40%',
          rate_percentage: '40.00',
          is_active: true,
          effective_from: '2017-07-01',
          effective_to: null,
          created_at: new Date('2020-01-01'),
          updated_at: new Date('2020-01-01'),
        },
      ];

      // pass dbTaxRates without tr-40, but line references tr-40
      const res = computeInvoiceTaxPreview({
        lineItems: [{ quantity: 1, unit_price: 100, discount: 0, tax_rate_id: 'tr-40' }],
        taxRates: customRates,
        sellerStateCode: '27',
      });

      expect(res.sortedGstRates).toContain(40);
      expect(res.gstBreakdownMap[40]).toBeDefined();
    });

    it('grandTotal and roundOff equal roundToRupeePaise of calculateInvoiceTax grandTotalPaise', () => {
      const lineItems = [
        { quantity: 3, unit_price: 33.33, discount: 5, tax_rate_id: 'tr-18' },
      ];

      const res = computeInvoiceTaxPreview({
        lineItems,
        taxRates: dbTaxRates,
        sellerStateCode: '27',
        placeOfSupplyStateCode: '27',
      });

      expect(res.taxResult).not.toBeNull();
      const rawPaise = res.taxResult!.grandTotalPaise;
      const roundedPaise = roundToRupeePaise(rawPaise);
      expect(res.grandTotal).toBe(roundedPaise / 100);
      expect(res.roundOff).toBe((roundedPaise - rawPaise) / 100);
    });
  });

  describe('buildInvoiceNumberPreview', () => {
    const activeFys: (typeof financialYears.$inferSelect)[] = [
      {
        id: 'fy-2026-27',
        business_id: 'biz-1',
        label: '2026-27',
        start_date: '2026-04-01',
        end_date: '2027-03-31',
        invoice_sequence_counter: 42,
        credit_note_sequence_counter: 0,
        is_current: true,
        created_at: new Date('2026-04-01'),
        updated_at: new Date('2026-04-01'),
      },
    ];

    it("returns 'DRAFT' for empty or invalid date", () => {
      expect(
        buildInvoiceNumberPreview({
          business: { invoice_number_format: 'INV/{FY}/{SEQ:3}' },
          invoiceDate: '',
          activeFys,
        })
      ).toBe('DRAFT');

      expect(
        buildInvoiceNumberPreview({
          business: { invoice_number_format: 'INV/{FY}/{SEQ:3}' },
          invoiceDate: 'not-a-valid-date',
          activeFys,
        })
      ).toBe('DRAFT');

      expect(
        buildInvoiceNumberPreview({
          business: null,
          invoiceDate: '2026-06-15',
          activeFys,
        })
      ).toBe('DRAFT');
    });

    it('uses previewSequence when given, else counter + 1', () => {
      const withSequence = buildInvoiceNumberPreview({
        business: { invoice_number_format: 'INV/{FY}/{SEQ:3}' },
        invoiceDate: '2026-06-15',
        activeFys,
        previewSequence: 99,
      });
      expect(withSequence).toBe('INV/26-27/099');

      const withoutSequence = buildInvoiceNumberPreview({
        business: { invoice_number_format: 'INV/{FY}/{SEQ:3}' },
        invoiceDate: '2026-06-15',
        activeFys,
        previewSequence: null,
      });
      expect(withoutSequence).toBe('INV/26-27/043'); // 42 + 1
    });
  });

  describe('collectValidationErrors', () => {
    it('returns exact strings and order for form field errors', () => {
      const errors: FieldErrors<InvoiceDraftInput> = {
        billing_name: { message: 'Customer name is required', type: 'required' },
        billing_gstin: { message: 'Invalid GSTIN format', type: 'custom' },
        place_of_supply_state_code: { message: 'State code is required', type: 'required' },
        invoice_date: { message: 'Date is required', type: 'required' },
        notes: { message: 'Notes too long', type: 'max' },
        line_items: Object.assign(
          [
            {
              description: { message: 'Item description is required', type: 'required' },
              hsn_sac_code: { message: 'Invalid HSN code', type: 'pattern' },
              quantity: { message: 'Quantity must be > 0', type: 'min' },
              unit_price: { message: 'Unit price must be >= 0', type: 'min' },
              discount: { message: 'Discount must be between 0 and 100', type: 'max' },
              tax_rate_id: { message: 'Tax rate is required', type: 'required' },
            },
          ],
          {
            root: { message: 'At least one line item is required', type: 'min' },
          }
        ),
      };

      const result = collectValidationErrors(errors);

      expect(result).toEqual([
        'Customer Name: Customer name is required',
        'Customer GSTIN: Invalid GSTIN format',
        'Place of Supply: State code is required',
        'Invoice Date: Date is required',
        'Notes: Notes too long',
        'Item Row #1: Item description is required',
        'Item Row #1: Invalid HSN code',
        'Item Row #1: Quantity must be > 0',
        'Item Row #1: Unit price must be >= 0',
        'Item Row #1: Discount must be between 0 and 100',
        'Item Row #1: Tax rate is required',
        'Line Items: At least one line item is required',
      ]);
    });
  });

  describe('formatINR', () => {
    it('formats rupees with comma separation and 2 decimals', () => {
      expect(formatINR(123456.78)).toBe('₹1,23,456.78');
      expect(formatINR(0)).toBe('₹0.00');
    });
  });
});
