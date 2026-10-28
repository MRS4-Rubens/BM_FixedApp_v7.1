import { describe, expect, it } from 'vitest';

import {
  assertCreditNoteMatchesDerivation,
  buildCreditLineStates,
  CreditLineState,
  CreditNoteRuleError,
  DerivedCreditLine,
  deriveCreditLines,
  OriginalLineState,
  prorateRoundHalfUp,
  quantityToMilli,
  resolveCreditNoteGrandTotal,
} from '@/lib/credit-notes/derivation';
import { creditNoteDraftSchema } from '@/lib/validations/credit-note';

describe('lib/credit-notes/derivation', () => {
  describe('1. quantityToMilli', () => {
    it('accepts valid string and number representations', () => {
      expect(quantityToMilli('2.500')).toBe(2500);
      expect(quantityToMilli('2.5')).toBe(2500);
      expect(quantityToMilli(2.5)).toBe(2500);
      expect(quantityToMilli('0.001')).toBe(1);
      expect(quantityToMilli(0.001)).toBe(1);
      expect(quantityToMilli('9999999.999')).toBe(9_999_999_999);
    });

    it('rejects invalid, negative, zero, and out-of-scale quantities', () => {
      const invalidInputs = [0, -1, NaN, Infinity, -0.001, 1.0005, '1.2345', '0', '-2.5', 'abc', 10_000_000];
      for (const input of invalidInputs) {
        expect(() => quantityToMilli(input)).toThrowError(CreditNoteRuleError);
        try {
          quantityToMilli(input);
        } catch (error) {
          expect((error as CreditNoteRuleError).code).toBe('INVALID_QUANTITY');
        }
      }
    });
  });

  describe('2. prorateRoundHalfUp', () => {
    it('applies round-half-up correctly', () => {
      // 1 * 1 / 2 = 0.5 -> 1
      expect(prorateRoundHalfUp(1, 1, 2)).toBe(1);
      // 1 * 1 / 4 = 0.25 -> 0
      expect(prorateRoundHalfUp(1, 1, 4)).toBe(0);
      // 3 * 1 / 4 = 0.75 -> 1
      expect(prorateRoundHalfUp(3, 1, 4)).toBe(1);
      // 3 * 1 / 2 = 1.5 -> 2
      expect(prorateRoundHalfUp(3, 1, 2)).toBe(2);
    });

    it('retains precision for large amounts without float truncation', () => {
      const amount = 2_000_000_000;
      const partMilli = 5_000_000_000;
      const wholeMilli = 9_999_999_999;
      // Exact calculation using BigInt: (2 * 2_000_000_000 * 5_000_000_000 + 9_999_999_999) / (2 * 9_999_999_999)
      // 2 * 10^19 = 20_000_000_000_000_000_000 + 9_999_999_999 = 20_000_000_009_999_999_999
      // Denominator: 19_999_999_998
      // Division: 1_000_000_000
      expect(prorateRoundHalfUp(amount, partMilli, wholeMilli)).toBe(1_000_000_000);
    });

    it('validates argument bounds', () => {
      expect(() => prorateRoundHalfUp(-1, 1, 2)).toThrow(RangeError);
      expect(() => prorateRoundHalfUp(100, 3, 2)).toThrow(RangeError);
      expect(() => prorateRoundHalfUp(100, 1, 0)).toThrow(RangeError);
    });
  });

  describe('3. Full-quantity credit exact reproduction', () => {
    it('reproduces intra-state line with discount exactly', () => {
      const original: OriginalLineState = {
        originalLineItemId: 'line-intra',
        productId: 'prod-1',
        description: 'Intra-state Item',
        hsnSacCode: '1234',
        unitOfMeasurement: 'NOS',
        unitPricePaise: 20000,
        taxRatePercentage: '18.00',
        quantityMilli: 5000, // qty 5
        discountPaise: 10000, // 100 Rs discount
        taxableValuePaise: 90000, // 900 Rs
        cgstPaise: 8100, // 81 Rs (9%)
        sgstPaise: 8100, // 81 Rs (9%)
        igstPaise: 0,
        sortOrder: 1,
      };
      const states = buildCreditLineStates([original], []);
      const [derived] = deriveCreditLines(states, [{ originalLineItemId: 'line-intra', quantityMilli: 5000 }]);

      expect(derived.discountPaise).toBe(original.discountPaise);
      expect(derived.taxableValuePaise).toBe(original.taxableValuePaise);
      expect(derived.cgstPaise).toBe(original.cgstPaise);
      expect(derived.sgstPaise).toBe(original.sgstPaise);
      expect(derived.igstPaise).toBe(0);
      expect(derived.lineTotalPaise).toBe(original.taxableValuePaise + original.cgstPaise + original.sgstPaise);
    });

    it('reproduces inter-state line exactly', () => {
      const original: OriginalLineState = {
        originalLineItemId: 'line-inter',
        productId: 'prod-2',
        description: 'Inter-state Item',
        hsnSacCode: '5678',
        unitOfMeasurement: 'KGS',
        unitPricePaise: 50000,
        taxRatePercentage: '18.00',
        quantityMilli: 2000, // qty 2
        discountPaise: 0,
        taxableValuePaise: 100000,
        cgstPaise: 0,
        sgstPaise: 0,
        igstPaise: 18000,
        sortOrder: 1,
      };
      const states = buildCreditLineStates([original], []);
      const [derived] = deriveCreditLines(states, [{ originalLineItemId: 'line-inter', quantityMilli: 2000 }]);

      expect(derived.discountPaise).toBe(0);
      expect(derived.taxableValuePaise).toBe(100000);
      expect(derived.cgstPaise).toBe(0);
      expect(derived.sgstPaise).toBe(0);
      expect(derived.igstPaise).toBe(18000);
      expect(derived.lineTotalPaise).toBe(118000);
    });
  });

  describe('4. Regression: discounted lines credited with discount', () => {
    it('credits line with 10% discount proportionally, not gross price', () => {
      const original: OriginalLineState = {
        originalLineItemId: 'line-discount',
        productId: null,
        description: 'Discounted Item',
        hsnSacCode: '9988',
        unitOfMeasurement: 'NOS',
        unitPricePaise: 10000, // 100 Rs
        taxRatePercentage: '18.00',
        quantityMilli: 10000, // qty 10 (Gross = 100,000 paise)
        discountPaise: 10000, // 10% discount = 10,000 paise
        taxableValuePaise: 90000, // 90,000 paise
        cgstPaise: 8100,
        sgstPaise: 8100,
        igstPaise: 0,
        sortOrder: 1,
      };
      const states = buildCreditLineStates([original], []);
      // Partial credit: 5 out of 10
      const [derived] = deriveCreditLines(states, [{ originalLineItemId: 'line-discount', quantityMilli: 5000 }]);

      expect(derived.discountPaise).toBe(5000);
      expect(derived.taxableValuePaise).toBe(45000); // 450 Rs, not 500 Rs
      expect(derived.lineTotalPaise).toBe(45000 + 4050 + 4050);
    });
  });

  describe('5. Property-style loop: partial credits and rounding trap', () => {
    it('sum of components <= original at every step and equals original at the end', () => {
      const original: OriginalLineState = {
        originalLineItemId: 'line-prop',
        productId: null,
        description: 'Property Item',
        hsnSacCode: '1111',
        unitOfMeasurement: 'NOS',
        unitPricePaise: 12345,
        taxRatePercentage: '18.00',
        quantityMilli: 17000, // qty 17
        discountPaise: 1543,
        taxableValuePaise: 208322,
        cgstPaise: 18749,
        sgstPaise: 18749,
        igstPaise: 0,
        sortOrder: 1,
      };

      // Deterministic slices that sum to 17000
      const slices = [2500, 3100, 4200, 1800, 5400]; // sum = 17000
      const creditedRows: {
        originalLineItemId: string;
        quantityMilli: number;
        discountPaise: number;
        taxableValuePaise: number;
        cgstPaise: number;
        sgstPaise: number;
        igstPaise: number;
      }[] = [];

      for (const slice of slices) {
        const states = buildCreditLineStates([original], creditedRows);
        const [derived] = deriveCreditLines(states, [{ originalLineItemId: 'line-prop', quantityMilli: slice }]);
        creditedRows.push({
          originalLineItemId: 'line-prop',
          quantityMilli: derived.quantityMilli,
          discountPaise: derived.discountPaise,
          taxableValuePaise: derived.taxableValuePaise,
          cgstPaise: derived.cgstPaise,
          sgstPaise: derived.sgstPaise,
          igstPaise: derived.igstPaise,
        });

        const cumDisc = creditedRows.reduce((s, r) => s + r.discountPaise, 0);
        const cumTaxable = creditedRows.reduce((s, r) => s + r.taxableValuePaise, 0);
        const cumCgst = creditedRows.reduce((s, r) => s + r.cgstPaise, 0);
        const cumSgst = creditedRows.reduce((s, r) => s + r.sgstPaise, 0);

        expect(cumDisc).toBeLessThanOrEqual(original.discountPaise);
        expect(cumTaxable).toBeLessThanOrEqual(original.taxableValuePaise);
        expect(cumCgst).toBeLessThanOrEqual(original.cgstPaise);
        expect(cumSgst).toBeLessThanOrEqual(original.sgstPaise);
      }

      const totalTaxable = creditedRows.reduce((s, r) => s + r.taxableValuePaise, 0);
      const totalDisc = creditedRows.reduce((s, r) => s + r.discountPaise, 0);
      const totalCgst = creditedRows.reduce((s, r) => s + r.cgstPaise, 0);
      const totalSgst = creditedRows.reduce((s, r) => s + r.sgstPaise, 0);

      expect(totalTaxable).toBe(original.taxableValuePaise);
      expect(totalDisc).toBe(original.discountPaise);
      expect(totalCgst).toBe(original.cgstPaise);
      expect(totalSgst).toBe(original.sgstPaise);
    });

    it('handles the rounding trap: original taxable = 3 paise, qty = 5 taken in 5 steps of 1', () => {
      const original: OriginalLineState = {
        originalLineItemId: 'line-trap',
        productId: null,
        description: 'Trap Item',
        hsnSacCode: '1111',
        unitOfMeasurement: 'NOS',
        unitPricePaise: 1,
        taxRatePercentage: '0.00',
        quantityMilli: 5000, // qty 5
        discountPaise: 0,
        taxableValuePaise: 3, // 3 paise total
        cgstPaise: 0,
        sgstPaise: 0,
        igstPaise: 0,
        sortOrder: 1,
      };

      const creditedRows: {
        originalLineItemId: string;
        quantityMilli: number;
        discountPaise: number;
        taxableValuePaise: number;
        cgstPaise: number;
        sgstPaise: number;
        igstPaise: number;
      }[] = [];

      for (let i = 0; i < 5; i++) {
        const states = buildCreditLineStates([original], creditedRows);
        const [derived] = deriveCreditLines(states, [{ originalLineItemId: 'line-trap', quantityMilli: 1000 }]);
        creditedRows.push({
          originalLineItemId: 'line-trap',
          quantityMilli: derived.quantityMilli,
          discountPaise: derived.discountPaise,
          taxableValuePaise: derived.taxableValuePaise,
          cgstPaise: derived.cgstPaise,
          sgstPaise: derived.sgstPaise,
          igstPaise: derived.igstPaise,
        });
      }

      const totalTaxable = creditedRows.reduce((s, r) => s + r.taxableValuePaise, 0);
      expect(totalTaxable).toBe(3);
      // Components per step: 1, 1, 1, 0, 0
      expect(creditedRows.map((r) => r.taxableValuePaise)).toEqual([1, 1, 1, 0, 0]);
    });
  });

  describe('6. Error handling in derivation', () => {
    const original: OriginalLineState = {
      originalLineItemId: 'line-err',
      productId: null,
      description: 'Error Item',
      hsnSacCode: '1111',
      unitOfMeasurement: 'NOS',
      unitPricePaise: 1000,
      taxRatePercentage: '18.00',
      quantityMilli: 5000,
      discountPaise: 0,
      taxableValuePaise: 5000,
      cgstPaise: 450,
      sgstPaise: 450,
      igstPaise: 0,
      sortOrder: 1,
    };

    it('rejects over-quantity with QUANTITY_EXCEEDS_ORIGINAL', () => {
      const states = buildCreditLineStates([original], []);
      expect(() => deriveCreditLines(states, [{ originalLineItemId: 'line-err', quantityMilli: 6000 }])).toThrowError(
        CreditNoteRuleError,
      );
      try {
        deriveCreditLines(states, [{ originalLineItemId: 'line-err', quantityMilli: 6000 }]);
      } catch (err) {
        expect((err as CreditNoteRuleError).code).toBe('QUANTITY_EXCEEDS_ORIGINAL');
      }
    });

    it('rejects duplicate item with DUPLICATE_ITEM', () => {
      const states = buildCreditLineStates([original], []);
      expect(() =>
        deriveCreditLines(states, [
          { originalLineItemId: 'line-err', quantityMilli: 1000 },
          { originalLineItemId: 'line-err', quantityMilli: 1000 },
        ]),
      ).toThrowError(CreditNoteRuleError);
      try {
        deriveCreditLines(states, [
          { originalLineItemId: 'line-err', quantityMilli: 1000 },
          { originalLineItemId: 'line-err', quantityMilli: 1000 },
        ]);
      } catch (err) {
        expect((err as CreditNoteRuleError).code).toBe('DUPLICATE_ITEM');
      }
    });

    it('rejects unknown item with ITEM_MISMATCH', () => {
      const states = buildCreditLineStates([original], []);
      expect(() => deriveCreditLines(states, [{ originalLineItemId: 'unknown-id', quantityMilli: 1000 }])).toThrowError(
        CreditNoteRuleError,
      );
      try {
        deriveCreditLines(states, [{ originalLineItemId: 'unknown-id', quantityMilli: 1000 }]);
      } catch (err) {
        expect((err as CreditNoteRuleError).code).toBe('ITEM_MISMATCH');
      }
    });

    it('rejects zero or negative quantityMilli with INVALID_QUANTITY', () => {
      const states = buildCreditLineStates([original], []);
      expect(() => deriveCreditLines(states, [{ originalLineItemId: 'line-err', quantityMilli: 0 }])).toThrowError(
        CreditNoteRuleError,
      );
      try {
        deriveCreditLines(states, [{ originalLineItemId: 'line-err', quantityMilli: 0 }]);
      } catch (err) {
        expect((err as CreditNoteRuleError).code).toBe('INVALID_QUANTITY');
      }
    });
  });

  describe('7. buildCreditLineStates', () => {
    const original: OriginalLineState = {
      originalLineItemId: 'line-orig',
      productId: null,
      description: 'Original Item',
      hsnSacCode: '1111',
      unitOfMeasurement: 'NOS',
      unitPricePaise: 1000,
      taxRatePercentage: '18.00',
      quantityMilli: 5000,
      discountPaise: 0,
      taxableValuePaise: 5000,
      cgstPaise: 450,
      sgstPaise: 450,
      igstPaise: 0,
      sortOrder: 1,
    };

    it('throws LEGACY_CREDIT_UNLINKED on null originalLineItemId', () => {
      expect(() =>
        buildCreditLineStates([original], [
          {
            originalLineItemId: null,
            quantityMilli: 1000,
            discountPaise: 0,
            taxableValuePaise: 1000,
            cgstPaise: 90,
            sgstPaise: 90,
            igstPaise: 0,
          },
        ]),
      ).toThrowError(CreditNoteRuleError);
      try {
        buildCreditLineStates([original], [
          {
            originalLineItemId: null,
            quantityMilli: 1000,
            discountPaise: 0,
            taxableValuePaise: 1000,
            cgstPaise: 90,
            sgstPaise: 90,
            igstPaise: 0,
          },
        ]);
      } catch (err) {
        expect((err as CreditNoteRuleError).code).toBe('LEGACY_CREDIT_UNLINKED');
      }
    });

    it('throws ITEM_MISMATCH on foreign line id', () => {
      expect(() =>
        buildCreditLineStates([original], [
          {
            originalLineItemId: 'foreign-line',
            quantityMilli: 1000,
            discountPaise: 0,
            taxableValuePaise: 1000,
            cgstPaise: 90,
            sgstPaise: 90,
            igstPaise: 0,
          },
        ]),
      ).toThrowError(CreditNoteRuleError);
      try {
        buildCreditLineStates([original], [
          {
            originalLineItemId: 'foreign-line',
            quantityMilli: 1000,
            discountPaise: 0,
            taxableValuePaise: 1000,
            cgstPaise: 90,
            sgstPaise: 90,
            igstPaise: 0,
          },
        ]);
      } catch (err) {
        expect((err as CreditNoteRuleError).code).toBe('ITEM_MISMATCH');
      }
    });

    it('correctly aggregates multiple prior credit notes per line', () => {
      const states = buildCreditLineStates([original], [
        {
          originalLineItemId: 'line-orig',
          quantityMilli: 1000,
          discountPaise: 10,
          taxableValuePaise: 1000,
          cgstPaise: 90,
          sgstPaise: 90,
          igstPaise: 0,
        },
        {
          originalLineItemId: 'line-orig',
          quantityMilli: 2000,
          discountPaise: 20,
          taxableValuePaise: 2000,
          cgstPaise: 180,
          sgstPaise: 180,
          igstPaise: 0,
        },
      ]);
      const state = states.get('line-orig');
      expect(state).toBeDefined();
      expect(state?.credited.quantityMilli).toBe(3000);
      expect(state?.credited.discountPaise).toBe(30);
      expect(state?.credited.taxableValuePaise).toBe(3000);
      expect(state?.credited.cgstPaise).toBe(270);
    });
  });

  describe('8. resolveCreditNoteGrandTotal', () => {
    it('applies standard rupee rounding to exact total', () => {
      const grand = resolveCreditNoteGrandTotal({
        exactTotalPaise: 10040,
        invoiceGrandTotalPaise: 100000,
        invoiceExactTotalPaise: 100040,
        otherCreditNotesGrandPaise: 0,
        otherCreditNotesExactPaise: 0,
      });
      expect(grand).toBe(10000);

      const grandUp = resolveCreditNoteGrandTotal({
        exactTotalPaise: 10060,
        invoiceGrandTotalPaise: 100000,
        invoiceExactTotalPaise: 100060,
        otherCreditNotesGrandPaise: 0,
        otherCreditNotesExactPaise: 0,
      });
      expect(grandUp).toBe(10100);
    });

    it('clamps to capacity when rounded exceeds remaining capacity within 1 rupee', () => {
      // Invoice grand 100000, others grand 50100 -> capacity 49900
      // Exact is 49910 -> rounded would be 50000 (exceeds capacity 49900 by 100 paise)
      // Clamps to capacity 49900
      const grand = resolveCreditNoteGrandTotal({
        exactTotalPaise: 49910,
        invoiceGrandTotalPaise: 100000,
        invoiceExactTotalPaise: 100000,
        otherCreditNotesGrandPaise: 50100,
        otherCreditNotesExactPaise: 50000,
      });
      expect(grand).toBe(49900);
    });

    it('throws VALUE_EXCEEDS_ORIGINAL on negative capacity or exact overrun', () => {
      expect(() =>
        resolveCreditNoteGrandTotal({
          exactTotalPaise: 1000,
          invoiceGrandTotalPaise: 100000,
          invoiceExactTotalPaise: 100000,
          otherCreditNotesGrandPaise: 100100, // capacity = -100
          otherCreditNotesExactPaise: 90000,
        }),
      ).toThrowError(CreditNoteRuleError);

      expect(() =>
        resolveCreditNoteGrandTotal({
          exactTotalPaise: 40001,
          invoiceGrandTotalPaise: 100000,
          invoiceExactTotalPaise: 100000,
          otherCreditNotesGrandPaise: 60000,
          otherCreditNotesExactPaise: 60000, // 60000 + 40001 > 100000
        }),
      ).toThrowError(CreditNoteRuleError);
    });
  });

  describe('9. assertCreditNoteMatchesDerivation', () => {
    const makeData = (): {
      header: { subtotalPaise: number; totalCgstPaise: number; totalSgstPaise: number; totalIgstPaise: number; totalTaxPaise: number; grandTotalPaise: number };
      lines: DerivedCreditLine[];
    } => ({
      header: {
        subtotalPaise: 10000,
        totalCgstPaise: 900,
        totalSgstPaise: 900,
        totalIgstPaise: 0,
        totalTaxPaise: 1800,
        grandTotalPaise: 11800,
      },
      lines: [
        {
          originalLineItemId: 'line-1',
          productId: null,
          description: 'Item 1',
          hsnSacCode: '1111',
          unitOfMeasurement: 'NOS',
          unitPricePaise: 10000,
          taxRatePercentage: '18.00',
          quantityMilli: 1000,
          discountPaise: 0,
          taxableValuePaise: 10000,
          cgstPaise: 900,
          sgstPaise: 900,
          igstPaise: 0,
          lineTotalPaise: 11800,
        },
      ],
    });

    it('passes when stored equals derived', () => {
      const data = makeData();
      expect(() => assertCreditNoteMatchesDerivation(data, data)).not.toThrow();
    });

    it('throws CREDIT_NOTE_STALE on any 1-paisa drift in lines or header', () => {
      const stored = makeData();
      const derived = makeData();
      // Drift in taxableValuePaise
      stored.lines[0].taxableValuePaise += 1;
      expect(() => assertCreditNoteMatchesDerivation(stored, derived)).toThrowError(CreditNoteRuleError);
      try {
        assertCreditNoteMatchesDerivation(stored, derived);
      } catch (err) {
        expect((err as CreditNoteRuleError).code).toBe('CREDIT_NOTE_STALE');
      }

      // Drift in header grandTotalPaise
      const stored2 = makeData();
      const derived2 = makeData();
      stored2.header.grandTotalPaise += 1;
      expect(() => assertCreditNoteMatchesDerivation(stored2, derived2)).toThrowError(CreditNoteRuleError);
    });
  });

  describe('10. Zod schema validation', () => {
    const validUuid1 = '11111111-1111-4111-a111-111111111111';
    const validUuid2 = '22222222-2222-4222-a222-222222222222';
    const invoiceUuid = '33333333-3333-4333-a333-333333333333';

    it('rejects extra fields such as unit_price, discount, tax_rate_id', () => {
      const result = creditNoteDraftSchema.safeParse({
        original_invoice_id: invoiceUuid,
        reason: '01-sales-return',
        line_items: [
          {
            original_line_item_id: validUuid1,
            quantity: 2,
            unit_price: 999999, // attack: 10x price injection
          },
        ],
      });
      expect(result.success).toBe(false);
    });

    it('rejects duplicate original_line_item_id', () => {
      const result = creditNoteDraftSchema.safeParse({
        original_invoice_id: invoiceUuid,
        reason: '01-sales-return',
        line_items: [
          { original_line_item_id: validUuid1, quantity: 1 },
          { original_line_item_id: validUuid1, quantity: 2 },
        ],
      });
      expect(result.success).toBe(false);
    });

    it('rejects quantity <= 0', () => {
      const result = creditNoteDraftSchema.safeParse({
        original_invoice_id: invoiceUuid,
        reason: '01-sales-return',
        line_items: [{ original_line_item_id: validUuid1, quantity: 0 }],
      });
      expect(result.success).toBe(false);
    });

    it('accepts valid input with unique items', () => {
      const result = creditNoteDraftSchema.safeParse({
        original_invoice_id: invoiceUuid,
        reason: '01-sales-return',
        line_items: [
          { original_line_item_id: validUuid1, quantity: 1.5 },
          { original_line_item_id: validUuid2, quantity: 2 },
        ],
      });
      expect(result.success).toBe(true);
    });
  });
});
