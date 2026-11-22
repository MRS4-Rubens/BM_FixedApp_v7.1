import { describe, expect, it } from 'vitest';
import { HsnSummaryAccumulator, quantityToThousandths, type HsnLine } from '@/lib/reports/hsn-summary';

/** MONEY-03: Table 12 nets every credit note of the period and sums quantities exactly. */
const line = (hsn: string, quantity: string, taxablePaise: number, unit: string | null = 'NOS'): HsnLine => ({
  hsn_sac_code: hsn,
  description: `Item ${hsn}`,
  unit_of_measurement: unit,
  quantity,
  tax_rate_percentage: '18.00',
  taxable_value_paise: taxablePaise,
  cgst_paise: Math.floor((taxablePaise * 9) / 100),
  sgst_paise: Math.floor((taxablePaise * 9) / 100),
  igst_paise: 0,
});

describe('MONEY-03: HSN summary accumulator', () => {
  it('a credit note for an HSN with no sales in the period becomes a negative row (not dropped)', () => {
    const acc = new HsnSummaryAccumulator();
    acc.subtractCreditNoteLine(line('8471', '1.000', 4_000_000));
    expect(acc.rows()).toEqual([
      expect.objectContaining({ hsnSacCode: '8471', totalQuantity: -1, taxableValuePaise: -4_000_000, centralTaxPaise: -360_000 }),
    ]);
  });

  it('sums quantities exactly (0.1 + 0.2 = 0.3, not 0.30000000000000004)', () => {
    const acc = new HsnSummaryAccumulator();
    acc.addInvoiceLine(line('4820', '0.100', 100));
    acc.addInvoiceLine(line('4820', '0.200', 200));
    expect(acc.rows()[0]?.totalQuantity).toBe(0.3);
  });

  it('nets a same-key credit note and lets quantity go below zero together with the money', () => {
    const acc = new HsnSummaryAccumulator();
    acc.addInvoiceLine(line('4820', '1.000', 1_000));
    acc.subtractCreditNoteLine(line('4820', '3.000', 3_000));
    const [row] = acc.rows();
    expect(row?.totalQuantity).toBe(-2);
    expect(row?.taxableValuePaise).toBe(-2_000);
  });

  it('keeps separate rows per HSN, unit (UQC) and rate, sorted by HSN, with OTH for a missing unit', () => {
    const acc = new HsnSummaryAccumulator();
    acc.addInvoiceLine(line('9983', '1', 500, null));
    acc.addInvoiceLine(line('4820', '1', 500, 'kgs'));
    acc.addInvoiceLine(line('4820', '1', 500, 'NOS'));
    expect(acc.rows().map((row) => `${row.hsnSacCode}/${row.uqc}`)).toEqual(['4820/KGS', '4820/NOS', '9983/OTH']);
  });

  it('parses stored quantities exactly', () => {
    expect(quantityToThousandths('2.500')).toBe(2500);
    expect(quantityToThousandths('7')).toBe(7000);
    expect(quantityToThousandths(0.1)).toBe(100);
    expect(quantityToThousandths('-1.25')).toBe(-1250);
  });
});
