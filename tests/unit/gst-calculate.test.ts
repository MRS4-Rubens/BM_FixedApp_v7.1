import { describe, expect, it } from 'vitest';
import {
  calculateInvoiceTax,
  getSupplyType,
} from '@/lib/gst/calculate';
import { GstCalculationError, MoneyLimitError } from '@/lib/gst/errors';
import { INDIAN_GST_STATES, UTGST_STATE_CODES, stateTaxLabel } from '@/lib/gst/indian-states';
import {
  oracleExclusive,
  oracleInclusive,
  findTieTaxables,
} from '../helpers/gst-oracle';
import { mulberry32, pick, randomInt } from '../helpers/prng';

const MAHARASHTRA = '27';
const KARNATAKA = '29';

describe('GST Calculation Engine (TEST-001)', () => {
  describe('SPEC: Hand-Calculated Statutory Tax Tables', () => {
    it('SPEC 1: Exclusive intra 18%, qty 1 x 100000 paise -> taxable 100000, cgst 9000, sgst 9000, lineTotal 118000', () => {
      // taxable = 100000 paise (Rs 1,000.00)
      // cgst = round(100000 * 900 / 10000) = 9000 paise (Rs 90.00)
      // sgst = round(100000 * 900 / 10000) = 9000 paise (Rs 90.00)
      // lineTotal = 100000 + 9000 + 9000 = 118000 paise (Rs 1,180.00)
      const res = calculateInvoiceTax({
        sellerStateCode: MAHARASHTRA,
        placeOfSupplyStateCode: MAHARASHTRA,
        gstRateType: 'exclusive',
        lineItems: [{ quantity: 1, unitPricePaise: 100_000, taxRatePercentage: 18 }],
      });

      expect(res.supplyType).toBe('intra_state');
      expect(res.subtotalPaise).toBe(100_000);
      expect(res.totalCgstPaise).toBe(9_000);
      expect(res.totalSgstPaise).toBe(9_000);
      expect(res.totalIgstPaise).toBe(0);
      expect(res.totalTaxPaise).toBe(18_000);
      expect(res.grandTotalPaise).toBe(118_000);
      expect(res.lineItems[0].lineTotalPaise).toBe(118_000);
    });

    it('SPEC 2: Exclusive inter 18%, qty 1 x 100000 paise -> taxable 100000, igst 18000, lineTotal 118000', () => {
      // taxable = 100000 paise
      // igst = round(100000 * 1800 / 10000) = 18000 paise (Rs 180.00)
      // lineTotal = 100000 + 18000 = 118000 paise
      const res = calculateInvoiceTax({
        sellerStateCode: MAHARASHTRA,
        placeOfSupplyStateCode: KARNATAKA,
        gstRateType: 'exclusive',
        lineItems: [{ quantity: 1, unitPricePaise: 100_000, taxRatePercentage: 18 }],
      });

      expect(res.supplyType).toBe('inter_state');
      expect(res.subtotalPaise).toBe(100_000);
      expect(res.totalCgstPaise).toBe(0);
      expect(res.totalSgstPaise).toBe(0);
      expect(res.totalIgstPaise).toBe(18_000);
      expect(res.totalTaxPaise).toBe(18_000);
      expect(res.grandTotalPaise).toBe(118_000);
      expect(res.lineItems[0].lineTotalPaise).toBe(118_000);
    });

    it('SPEC 3: Inclusive intra 18%, 118000 paise gross -> taxable 100000, cgst 9000, sgst 9000, total 118000', () => {
      // lineTotal = 118000 paise
      // taxableRaw = round(118000 * 10000 / 11800) = 100000 paise
      // cgst = round(100000 * 900 / 10000) = 9000 paise
      // sgst = round(100000 * 900 / 10000) = 9000 paise
      // taxableAdjusted = 118000 - (9000 + 9000) = 100000 paise
      const res = calculateInvoiceTax({
        sellerStateCode: MAHARASHTRA,
        placeOfSupplyStateCode: MAHARASHTRA,
        gstRateType: 'inclusive',
        lineItems: [{ quantity: 1, unitPricePaise: 118_000, taxRatePercentage: 18 }],
      });

      expect(res.subtotalPaise).toBe(100_000);
      expect(res.totalCgstPaise).toBe(9_000);
      expect(res.totalSgstPaise).toBe(9_000);
      expect(res.totalIgstPaise).toBe(0);
      expect(res.grandTotalPaise).toBe(118_000);
    });

    it('SPEC 4: Inclusive inter 5%, 10500 paise gross -> taxable 10000, igst 500, total 10500', () => {
      // lineTotal = 10500 paise
      // taxableRaw = round(10500 * 10000 / 10500) = 10000 paise
      // igst = round(10000 * 500 / 10000) = 500 paise
      // taxableAdjusted = 10500 - 500 = 10000 paise
      const res = calculateInvoiceTax({
        sellerStateCode: MAHARASHTRA,
        placeOfSupplyStateCode: KARNATAKA,
        gstRateType: 'inclusive',
        lineItems: [{ quantity: 1, unitPricePaise: 10_500, taxRatePercentage: 5 }],
      });

      expect(res.subtotalPaise).toBe(10_000);
      expect(res.totalIgstPaise).toBe(500);
      expect(res.grandTotalPaise).toBe(10_500);
    });

    it('SPEC 5: Rates 0, 0.25, 3, 5, 12, 18, 28 on 1,000,000 paise exclusive intra and inter', () => {
      const rates = [0, 0.25, 3, 5, 12, 18, 28];
      const gross = 1_000_000;

      for (const r of rates) {
        const bp = Math.round(r * 100);
        // Intra
        const expectedCgst = Math.round((gross * (bp / 2)) / 10000);
        const intraRes = calculateInvoiceTax({
          sellerStateCode: MAHARASHTRA,
          placeOfSupplyStateCode: MAHARASHTRA,
          gstRateType: 'exclusive',
          lineItems: [{ quantity: 1, unitPricePaise: gross, taxRatePercentage: r }],
        });
        expect(intraRes.totalCgstPaise).toBe(expectedCgst);
        expect(intraRes.totalSgstPaise).toBe(expectedCgst);
        expect(intraRes.totalIgstPaise).toBe(0);
        expect(intraRes.grandTotalPaise).toBe(gross + 2 * expectedCgst);

        // Inter
        const expectedIgst = Math.round((gross * bp) / 10000);
        const interRes = calculateInvoiceTax({
          sellerStateCode: MAHARASHTRA,
          placeOfSupplyStateCode: KARNATAKA,
          gstRateType: 'exclusive',
          lineItems: [{ quantity: 1, unitPricePaise: gross, taxRatePercentage: r }],
        });
        expect(interRes.totalCgstPaise).toBe(0);
        expect(interRes.totalSgstPaise).toBe(0);
        expect(interRes.totalIgstPaise).toBe(expectedIgst);
        expect(interRes.grandTotalPaise).toBe(gross + expectedIgst);
      }
    });

    it('SPEC 6: 100% discount (gross === discount) -> taxable 0, taxes 0, total 0 for both modes and supplies', () => {
      for (const mode of ['exclusive', 'inclusive'] as const) {
        for (const pos of [MAHARASHTRA, KARNATAKA]) {
          const res = calculateInvoiceTax({
            sellerStateCode: MAHARASHTRA,
            placeOfSupplyStateCode: pos,
            gstRateType: mode,
            lineItems: [{ quantity: 5, unitPricePaise: 2000, discountPaise: 10000, taxRatePercentage: 18 }],
          });
          expect(res.subtotalPaise).toBe(0);
          expect(res.totalCgstPaise).toBe(0);
          expect(res.totalSgstPaise).toBe(0);
          expect(res.totalIgstPaise).toBe(0);
          expect(res.totalTaxPaise).toBe(0);
          expect(res.grandTotalPaise).toBe(0);
        }
      }
    });

    it('SPEC 7: Partial discount: 50000 gross, 10000 discount, 18% inter -> taxable 40000, igst 7200', () => {
      // taxable = 50000 - 10000 = 40000 paise
      // igst = round(40000 * 1800 / 10000) = 7200 paise
      const res = calculateInvoiceTax({
        sellerStateCode: MAHARASHTRA,
        placeOfSupplyStateCode: KARNATAKA,
        gstRateType: 'exclusive',
        lineItems: [{ quantity: 1, unitPricePaise: 50_000, discountPaise: 10_000, taxRatePercentage: 18 }],
      });
      expect(res.subtotalPaise).toBe(40_000);
      expect(res.totalIgstPaise).toBe(7_200);
      expect(res.grandTotalPaise).toBe(47_200);
    });

    it('SPEC 8: Fractional quantities with exact binary fractions: 2.5 x 4000 = 10000; 0.125 x 80000 = 10000', () => {
      const res1 = calculateInvoiceTax({
        sellerStateCode: MAHARASHTRA,
        placeOfSupplyStateCode: MAHARASHTRA,
        gstRateType: 'exclusive',
        lineItems: [{ quantity: 2.5, unitPricePaise: 4000, taxRatePercentage: 0 }],
      });
      expect(res1.subtotalPaise).toBe(10_000);

      const res2 = calculateInvoiceTax({
        sellerStateCode: MAHARASHTRA,
        placeOfSupplyStateCode: MAHARASHTRA,
        gstRateType: 'exclusive',
        lineItems: [{ quantity: 0.125, unitPricePaise: 80_000, taxRatePercentage: 0 }],
      });
      expect(res2.subtotalPaise).toBe(10_000);
    });

    it('SPEC 9: Exact half-paisa ties (half-up rounding)', () => {
      // 1. Inter 5% on 10 paise: taxable 10 * 500 / 10000 = 0.5 paise -> rounds UP to 1 paisa
      const t1 = calculateInvoiceTax({
        sellerStateCode: MAHARASHTRA,
        placeOfSupplyStateCode: KARNATAKA,
        gstRateType: 'exclusive',
        lineItems: [{ quantity: 1, unitPricePaise: 10, taxRatePercentage: 5 }],
      });
      expect(t1.totalIgstPaise).toBe(1);
      expect(t1.grandTotalPaise).toBe(11);

      // Just-below tie: 9 paise * 5% = 0.45 paise -> rounds to 0
      const t1Below = calculateInvoiceTax({
        sellerStateCode: MAHARASHTRA,
        placeOfSupplyStateCode: KARNATAKA,
        gstRateType: 'exclusive',
        lineItems: [{ quantity: 1, unitPricePaise: 9, taxRatePercentage: 5 }],
      });
      expect(t1Below.totalIgstPaise).toBe(0);

      // Just-above tie: 11 paise * 5% = 0.55 paise -> rounds to 1
      const t1Above = calculateInvoiceTax({
        sellerStateCode: MAHARASHTRA,
        placeOfSupplyStateCode: KARNATAKA,
        gstRateType: 'exclusive',
        lineItems: [{ quantity: 1, unitPricePaise: 11, taxRatePercentage: 5 }],
      });
      expect(t1Above.totalIgstPaise).toBe(1);

      // 2. Intra 5% on 20 paise: rateBp/2 = 250 bp. 20 * 250 / 10000 = 0.5 paise -> cgst 1, sgst 1 (total tax 2)
      const t2 = calculateInvoiceTax({
        sellerStateCode: MAHARASHTRA,
        placeOfSupplyStateCode: MAHARASHTRA,
        gstRateType: 'exclusive',
        lineItems: [{ quantity: 1, unitPricePaise: 20, taxRatePercentage: 5 }],
      });
      expect(t2.totalCgstPaise).toBe(1);
      expect(t2.totalSgstPaise).toBe(1);
      expect(t2.totalTaxPaise).toBe(2);

      // 3. Intra 1% on 100 paise: rateBp/2 = 50 bp. 100 * 50 / 10000 = 0.5 paise -> 1 + 1 = 2 paise
      const t3 = calculateInvoiceTax({
        sellerStateCode: MAHARASHTRA,
        placeOfSupplyStateCode: MAHARASHTRA,
        gstRateType: 'exclusive',
        lineItems: [{ quantity: 1, unitPricePaise: 100, taxRatePercentage: 1 }],
      });
      expect(t3.totalCgstPaise).toBe(1);
      expect(t3.totalSgstPaise).toBe(1);

      // 4. Inter 0.25% on 200 paise: 200 * 25 / 10000 = 0.5 paise -> 1 paisa
      const t4 = calculateInvoiceTax({
        sellerStateCode: MAHARASHTRA,
        placeOfSupplyStateCode: KARNATAKA,
        gstRateType: 'exclusive',
        lineItems: [{ quantity: 1, unitPricePaise: 200, taxRatePercentage: 0.25 }],
      });
      expect(t4.totalIgstPaise).toBe(1);

      // 5. Intra 0.25% on 400 paise: rateBp/2 = 12.5. 400 * 12.5 / 10000 = 0.5 paise -> 1 + 1 = 2 paise
      const t5 = calculateInvoiceTax({
        sellerStateCode: MAHARASHTRA,
        placeOfSupplyStateCode: MAHARASHTRA,
        gstRateType: 'exclusive',
        lineItems: [{ quantity: 1, unitPricePaise: 400, taxRatePercentage: 0.25 }],
      });
      expect(t5.totalCgstPaise).toBe(1);
      expect(t5.totalSgstPaise).toBe(1);
    });

    it('SPEC 10: Multi-line invoice (intra, exclusive) across mixed rates', () => {
      // Line 1: 100.00 (10000 paise) @18% -> CGST: round(10000 * 900 / 10000) = 900; SGST: 900; Line: 11800
      // Line 2: 250.00 (25000 paise) @5%  -> CGST: round(25000 * 250 / 10000) = 625; SGST: 625; Line: 26250
      // Line 3: 999.99 (99999 paise) @12% -> CGST: round(99999 * 600 / 10000) = 6000; SGST: 6000; Line: 111999
      // Total taxable: 10000 + 25000 + 99999 = 134999 paise
      // Total CGST: 900 + 625 + 6000 = 7525 paise
      // Total SGST: 900 + 625 + 6000 = 7525 paise
      // Total Tax: 7525 + 7525 = 15050 paise
      // Grand Total: 134999 + 15050 = 150049 paise
      // Note: roundToRupeePaise(150049) = 150000 paise (round-off difference = -49 paise)
      const res = calculateInvoiceTax({
        sellerStateCode: MAHARASHTRA,
        placeOfSupplyStateCode: MAHARASHTRA,
        gstRateType: 'exclusive',
        lineItems: [
          { quantity: 1, unitPricePaise: 10_000, taxRatePercentage: 18 },
          { quantity: 1, unitPricePaise: 25_000, taxRatePercentage: 5 },
          { quantity: 1, unitPricePaise: 99_999, taxRatePercentage: 12 },
        ],
      });

      expect(res.lineItems[0].lineTotalPaise).toBe(11_800);
      expect(res.lineItems[1].lineTotalPaise).toBe(26_250);
      expect(res.lineItems[2].lineTotalPaise).toBe(111_999);
      expect(res.subtotalPaise).toBe(134_999);
      expect(res.totalCgstPaise).toBe(7_525);
      expect(res.totalSgstPaise).toBe(7_525);
      expect(res.totalIgstPaise).toBe(0);
      expect(res.totalTaxPaise).toBe(15_050);
      expect(res.grandTotalPaise).toBe(150_049);
    });

    it('SPEC 11: Multi-line invoice (inter, exclusive) across same three lines', () => {
      // Line 1: IGST = 1800; Line: 11800
      // Line 2: IGST = 1250; Line: 26250
      // Line 3: IGST = 12000; Line: 111999
      // Total IGST = 1800 + 1250 + 12000 = 15050 paise
      // Grand Total = 134999 + 15050 = 150049 paise
      const res = calculateInvoiceTax({
        sellerStateCode: MAHARASHTRA,
        placeOfSupplyStateCode: KARNATAKA,
        gstRateType: 'exclusive',
        lineItems: [
          { quantity: 1, unitPricePaise: 10_000, taxRatePercentage: 18 },
          { quantity: 1, unitPricePaise: 25_000, taxRatePercentage: 5 },
          { quantity: 1, unitPricePaise: 99_999, taxRatePercentage: 12 },
        ],
      });

      expect(res.subtotalPaise).toBe(134_999);
      expect(res.totalCgstPaise).toBe(0);
      expect(res.totalSgstPaise).toBe(0);
      expect(res.totalIgstPaise).toBe(15_050);
      expect(res.totalTaxPaise).toBe(15_050);
      expect(res.grandTotalPaise).toBe(150_049);
    });

    it('SPEC 12: gstRateType omitted defaults to exclusive and is echoed in output', () => {
      const res = calculateInvoiceTax({
        sellerStateCode: MAHARASHTRA,
        placeOfSupplyStateCode: MAHARASHTRA,
        lineItems: [{ quantity: 1, unitPricePaise: 10_000, taxRatePercentage: 18 }],
      });
      expect(res.gstRateType).toBe('exclusive');
    });
  });

  describe('Validation & Error Handling', () => {
    it('rejects empty lineItems', () => {
      expect(() =>
        calculateInvoiceTax({
          sellerStateCode: MAHARASHTRA,
          placeOfSupplyStateCode: MAHARASHTRA,
          lineItems: [],
        })
      ).toThrow(GstCalculationError);
      expect(() =>
        calculateInvoiceTax({
          sellerStateCode: MAHARASHTRA,
          placeOfSupplyStateCode: MAHARASHTRA,
          lineItems: [],
        })
      ).toThrow('At least one line item is required');
    });

    it('rejects quantity <= 0', () => {
      expect(() =>
        calculateInvoiceTax({
          sellerStateCode: MAHARASHTRA,
          placeOfSupplyStateCode: MAHARASHTRA,
          lineItems: [{ quantity: 0, unitPricePaise: 100, taxRatePercentage: 18 }],
        })
      ).toThrow('Quantity must be greater than 0');

      expect(() =>
        calculateInvoiceTax({
          sellerStateCode: MAHARASHTRA,
          placeOfSupplyStateCode: MAHARASHTRA,
          lineItems: [{ quantity: -1, unitPricePaise: 100, taxRatePercentage: 18 }],
        })
      ).toThrow('Quantity must be greater than 0');
    });

    it('rejects negative unit price', () => {
      expect(() =>
        calculateInvoiceTax({
          sellerStateCode: MAHARASHTRA,
          placeOfSupplyStateCode: MAHARASHTRA,
          lineItems: [{ quantity: 1, unitPricePaise: -1, taxRatePercentage: 18 }],
        })
      ).toThrow('Unit price must be non-negative');
    });

    it('rejects tax rates outside [0, 100]', () => {
      expect(() =>
        calculateInvoiceTax({
          sellerStateCode: MAHARASHTRA,
          placeOfSupplyStateCode: MAHARASHTRA,
          lineItems: [{ quantity: 1, unitPricePaise: 100, taxRatePercentage: -0.01 }],
        })
      ).toThrow('Tax rate percentage must be between 0 and 100');

      expect(() =>
        calculateInvoiceTax({
          sellerStateCode: MAHARASHTRA,
          placeOfSupplyStateCode: MAHARASHTRA,
          lineItems: [{ quantity: 1, unitPricePaise: 100, taxRatePercentage: 100.01 }],
        })
      ).toThrow('Tax rate percentage must be between 0 and 100');
    });

    it('rejects negative discount and discount > gross', () => {
      expect(() =>
        calculateInvoiceTax({
          sellerStateCode: MAHARASHTRA,
          placeOfSupplyStateCode: MAHARASHTRA,
          lineItems: [{ quantity: 1, unitPricePaise: 1000, discountPaise: -1, taxRatePercentage: 18 }],
        })
      ).toThrow('Discount must be non-negative');

      expect(() =>
        calculateInvoiceTax({
          sellerStateCode: MAHARASHTRA,
          placeOfSupplyStateCode: MAHARASHTRA,
          lineItems: [{ quantity: 1, unitPricePaise: 1000, discountPaise: 1001, taxRatePercentage: 18 }],
        })
      ).toThrow("Discount cannot exceed the line item's gross value");
    });

    it('rejects invalid state codes', () => {
      expect(() =>
        calculateInvoiceTax({
          sellerStateCode: '99',
          placeOfSupplyStateCode: MAHARASHTRA,
          lineItems: [{ quantity: 1, unitPricePaise: 1000, taxRatePercentage: 18 }],
        })
      ).toThrow('Invalid sellerStateCode: 99');

      expect(() =>
        calculateInvoiceTax({
          sellerStateCode: MAHARASHTRA,
          placeOfSupplyStateCode: 'XX',
          lineItems: [{ quantity: 1, unitPricePaise: 1000, taxRatePercentage: 18 }],
        })
      ).toThrow('Invalid placeOfSupplyStateCode: XX');
    });

    it('rejects non-finite quantity and non-safe-integer unitPricePaise', () => {
      expect(() =>
        calculateInvoiceTax({
          sellerStateCode: MAHARASHTRA,
          placeOfSupplyStateCode: MAHARASHTRA,
          lineItems: [{ quantity: NaN, unitPricePaise: 1000, taxRatePercentage: 18 }],
        })
      ).toThrow('Quantity must be a finite number');

      expect(() =>
        calculateInvoiceTax({
          sellerStateCode: MAHARASHTRA,
          placeOfSupplyStateCode: MAHARASHTRA,
          // Simulate invalid float unit price at runtime
          lineItems: [{ quantity: 1, unitPricePaise: 10.5 as unknown as number, taxRatePercentage: 18 }],
        })
      ).toThrow('Unit price must be a whole number of paise');
    });

    it('rejects quantity and money limit breaches', () => {
      expect(() =>
        calculateInvoiceTax({
          sellerStateCode: MAHARASHTRA,
          placeOfSupplyStateCode: MAHARASHTRA,
          lineItems: [{ quantity: 10_000_000, unitPricePaise: 1000, taxRatePercentage: 18 }],
        })
      ).toThrow(MoneyLimitError);

      expect(() =>
        calculateInvoiceTax({
          sellerStateCode: MAHARASHTRA,
          placeOfSupplyStateCode: MAHARASHTRA,
          lineItems: [{ quantity: 1, unitPricePaise: 2_000_000_000, taxRatePercentage: 18 }],
        })
      ).toThrow(MoneyLimitError);
    });
  });

  describe('getSupplyType (PROP, exhaustive state pairs)', () => {
    it('returns intra_state iff sellerStateCode === placeOfSupplyStateCode for all states', () => {
      for (const seller of INDIAN_GST_STATES) {
        for (const pos of INDIAN_GST_STATES) {
          const type = getSupplyType(seller.code, pos.code);
          if (seller.code === pos.code) {
            expect(type).toBe('intra_state');
          } else {
            expect(type).toBe('inter_state');
          }
        }
      }
    });
  });

  describe('ORACLE: Differential Testing vs Exact Reference Model (10,000 lines)', () => {
    const quantities = [1, 2, 3, 0.5, 0.25, 0.125, 1.5, 2.5, 10, 12.75, 100];
    const rates = [0, 0.1, 0.25, 1, 1.5, 3, 5, 7.5, 12, 18, 28, 100];

    it('matches exact BigInt reference model across seeds 1..5 (2,500 lines per combo)', () => {
      let seedCounter = 1;
      for (const mode of ['exclusive', 'inclusive'] as const) {
        for (const isIntra of [true, false]) {
          const prng = mulberry32(seedCounter++);
          const pos = isIntra ? MAHARASHTRA : KARNATAKA;

          for (let i = 0; i < 2500; i++) {
            const qty = pick(prng, quantities);
            const unitPrice = randomInt(prng, 0, 999_999);
            const gross = Math.round(qty * unitPrice);
            const discount = randomInt(prng, 0, gross);
            const rate = pick(prng, rates);
            const rateBp = BigInt(Math.round(rate * 100));

            const res = calculateInvoiceTax({
              sellerStateCode: MAHARASHTRA,
              placeOfSupplyStateCode: pos,
              gstRateType: mode,
              lineItems: [{ quantity: qty, unitPricePaise: unitPrice, discountPaise: discount, taxRatePercentage: rate }],
            });

            const oracle = mode === 'exclusive'
              ? oracleExclusive({ grossPaise: BigInt(gross), discountPaise: BigInt(discount), rateBp, intraState: isIntra })
              : oracleInclusive({ grossPaise: BigInt(gross), discountPaise: BigInt(discount), rateBp, intraState: isIntra });

            const line = res.lineItems[0];
            expect(BigInt(line.taxableValuePaise)).toBe(oracle.taxable);
            expect(BigInt(line.cgstPaise)).toBe(oracle.cgst);
            expect(BigInt(line.sgstPaise)).toBe(oracle.sgst);
            expect(BigInt(line.igstPaise)).toBe(oracle.igst);
            expect(BigInt(line.lineTotalPaise)).toBe(oracle.lineTotal);
          }
        }
      }
    });

    it('TIE-focused ORACLE: matches exact half-up oracle on generated ties', () => {
      for (const r of [0.25, 1, 3, 5, 12, 18, 28]) {
        const bp = Math.round(r * 100);
        const ties = findTieTaxables(bp, 10000, 20);

        for (const taxable of ties) {
          const res = calculateInvoiceTax({
            sellerStateCode: MAHARASHTRA,
            placeOfSupplyStateCode: KARNATAKA,
            gstRateType: 'exclusive',
            lineItems: [{ quantity: 1, unitPricePaise: taxable, taxRatePercentage: r }],
          });
          const oracle = oracleExclusive({
            grossPaise: BigInt(taxable),
            discountPaise: BigInt(0),
            rateBp: BigInt(bp),
            intraState: false,
          });
          expect(BigInt(res.totalIgstPaise)).toBe(oracle.igst);
        }
      }
    });
  });

  describe('PROP: Random Multi-Line Invariants (300 invoices)', () => {
    it('preserves statutory arithmetic invariants across random multi-line invoices', () => {
      const prng = mulberry32(42);
      const rates = [0, 0.25, 3, 5, 12, 18, 28];

      for (let i = 0; i < 300; i++) {
        const numLines = randomInt(prng, 1, 12);
        const mode = pick(prng, ['exclusive', 'inclusive'] as const);
        const isIntra = pick(prng, [true, false]);
        const pos = isIntra ? MAHARASHTRA : KARNATAKA;

        const lineInputs = [];
        for (let l = 0; l < numLines; l++) {
          const qty = randomInt(prng, 1, 10);
          const price = randomInt(prng, 100, 100_000);
          const gross = qty * price;
          const discount = randomInt(prng, 0, Math.floor(gross * 0.3));
          const rate = pick(prng, rates);
          lineInputs.push({ quantity: qty, unitPricePaise: price, discountPaise: discount, taxRatePercentage: rate });
        }

        const res = calculateInvoiceTax({
          sellerStateCode: MAHARASHTRA,
          placeOfSupplyStateCode: pos,
          gstRateType: mode,
          lineItems: lineInputs,
        });

        // (a) subtotal + totalCgst + totalSgst + totalIgst === grandTotal
        expect(res.subtotalPaise + res.totalCgstPaise + res.totalSgstPaise + res.totalIgstPaise).toBe(res.grandTotalPaise);

        // (b) grandTotal === sum(line.lineTotalPaise)
        const sumLineTotals = res.lineItems.reduce((acc, line) => acc + line.lineTotalPaise, 0);
        expect(res.grandTotalPaise).toBe(sumLineTotals);

        // (c) totalTax === cgst + sgst + igst
        expect(res.totalTaxPaise).toBe(res.totalCgstPaise + res.totalSgstPaise + res.totalIgstPaise);

        // (d) every paise field is a non-negative safe integer
        expect(Number.isSafeInteger(res.subtotalPaise) && res.subtotalPaise >= 0).toBe(true);
        expect(Number.isSafeInteger(res.totalTaxPaise) && res.totalTaxPaise >= 0).toBe(true);
        expect(Number.isSafeInteger(res.grandTotalPaise) && res.grandTotalPaise >= 0).toBe(true);

        // (e) supply type symmetry
        if (isIntra) {
          expect(res.totalIgstPaise).toBe(0);
          for (const line of res.lineItems) {
            expect(line.cgstPaise).toBe(line.sgstPaise);
            expect(line.igstPaise).toBe(0);
          }
        } else {
          expect(res.totalCgstPaise).toBe(0);
          expect(res.totalSgstPaise).toBe(0);
          for (const line of res.lineItems) {
            expect(line.cgstPaise).toBe(0);
            expect(line.sgstPaise).toBe(0);
          }
        }

        // (f) & (g) line error bounds
        for (const line of res.lineItems) {
          const bp = Math.round(line.taxRatePercentage * 100);
          const lineTax = line.cgstPaise + line.sgstPaise + line.igstPaise;
          if (mode === 'inclusive') {
            expect(line.taxableValuePaise + lineTax).toBe(line.lineTotalPaise);
            const theoreticalTax = (line.lineTotalPaise * bp) / (10000 + bp);
            expect(Math.abs(lineTax - theoreticalTax)).toBeLessThanOrEqual(1.5);
          } else {
            const theoreticalTax = (line.taxableValuePaise * bp) / 10000;
            expect(Math.abs(lineTax - theoreticalTax)).toBeLessThanOrEqual(1.0);
          }
        }
      }
    });
  });

  describe('CHAR / Findings characterization', () => {
    it('SPEC (F-GST-1 fixed): 1.005 x 100 uses exact milli-arithmetic and yields 101 paise', () => {
      const res = calculateInvoiceTax({
        sellerStateCode: MAHARASHTRA,
        placeOfSupplyStateCode: MAHARASHTRA,
        gstRateType: 'exclusive',
        lineItems: [{ quantity: 1.005, unitPricePaise: 100, taxRatePercentage: 0 }],
      });
      // 1.005 * 100 = 100.5 -> exact half-up is 101 paise
      expect(res.lineItems[0].taxableValuePaise).toBe(101);
    });

    describe('SPEC (F-GST-3 fixed / COMP-UTGST): UTGST label and calculation rules', () => {
      it('stateTaxLabel maps UTs without legislature to UTGST and others to SGST', () => {
        // UTs without legislature -> UTGST
        for (const code of ['04', '26', '31', '35', '38']) {
          expect(stateTaxLabel(code)).toBe('UTGST');
        }

        // UTs with legislature and states -> SGST
        for (const code of ['07', '34', '01', '27', '29']) {
          expect(stateTaxLabel(code)).toBe('SGST');
        }

        // null, undefined, unknown -> SGST
        expect(stateTaxLabel(null)).toBe('SGST');
        expect(stateTaxLabel(undefined)).toBe('SGST');
        expect(stateTaxLabel('99')).toBe('SGST');
        expect(stateTaxLabel('')).toBe('SGST');
      });

      it('calculateInvoiceTax for seller 04 / place of supply 04 (intra) returns identical paise split as seller 27/27', () => {
        const lineItems = [
          { quantity: 2, unitPricePaise: 50_000, taxRatePercentage: 18 },
          { quantity: 1, unitPricePaise: 125_000, taxRatePercentage: 5 },
          { quantity: 3.5, unitPricePaise: 20_000, taxRatePercentage: 12 },
        ];

        const utgstRes = calculateInvoiceTax({
          sellerStateCode: '04',
          placeOfSupplyStateCode: '04',
          gstRateType: 'exclusive',
          lineItems,
        });

        const sgstRes = calculateInvoiceTax({
          sellerStateCode: '27',
          placeOfSupplyStateCode: '27',
          gstRateType: 'exclusive',
          lineItems,
        });

        expect(utgstRes.supplyType).toBe('intra_state');
        expect(sgstRes.supplyType).toBe('intra_state');
        expect(utgstRes.subtotalPaise).toBe(sgstRes.subtotalPaise);
        expect(utgstRes.totalCgstPaise).toBe(sgstRes.totalCgstPaise);
        expect(utgstRes.totalSgstPaise).toBe(sgstRes.totalSgstPaise);
        expect(utgstRes.totalIgstPaise).toBe(0);
        expect(utgstRes.totalTaxPaise).toBe(sgstRes.totalTaxPaise);
        expect(utgstRes.grandTotalPaise).toBe(sgstRes.grandTotalPaise);

        // Verify line by line
        for (let i = 0; i < lineItems.length; i++) {
          expect(utgstRes.lineItems[i].taxableValuePaise).toBe(sgstRes.lineItems[i].taxableValuePaise);
          expect(utgstRes.lineItems[i].cgstPaise).toBe(sgstRes.lineItems[i].cgstPaise);
          expect(utgstRes.lineItems[i].sgstPaise).toBe(sgstRes.lineItems[i].sgstPaise);
          expect(utgstRes.lineItems[i].igstPaise).toBe(0);
          expect(utgstRes.lineItems[i].lineTotalPaise).toBe(sgstRes.lineItems[i].lineTotalPaise);
        }
      });

      it('seller 04 -> place of supply 07 is inter-state (IGST only)', () => {
        const res = calculateInvoiceTax({
          sellerStateCode: '04',
          placeOfSupplyStateCode: '07',
          gstRateType: 'exclusive',
          lineItems: [{ quantity: 1, unitPricePaise: 100_000, taxRatePercentage: 18 }],
        });

        expect(res.supplyType).toBe('inter_state');
        expect(res.totalCgstPaise).toBe(0);
        expect(res.totalSgstPaise).toBe(0);
        expect(res.totalIgstPaise).toBe(18_000);
      });

      it('UTGST_STATE_CODES is a subset of INDIAN_GST_STATES codes', () => {
        const allCodes = new Set(INDIAN_GST_STATES.map((s) => s.code));
        for (const code of UTGST_STATE_CODES) {
          expect(allCodes.has(code)).toBe(true);
        }
      });
    });
  });
});
