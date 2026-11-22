/**
 * GSTR-1 Table 12 (HSN-wise summary). MONEY-03:
 *  - A credit note is netted into its HSN / UQC / rate row EVEN WHEN that row has no invoice sales in the period
 *    (a November credit note against an October sale). Before, such a credit note was silently dropped from Table 12
 *    while still being netted in B2B / B2CS / CDNR, so the tables no longer reconciled on the portal.
 *  - Quantities are summed exactly in thousandths (stored quantities have at most 3 decimals) instead of floats
 *    (0.1 + 0.2 printed 0.30000000000000004), and quantity moves together with the money (no clamp at zero).
 */
export interface HsnSummaryRow {
  hsnSacCode: string;
  description: string;
  uqc: string;
  totalQuantity: number;
  totalValuePaise: number;
  ratePercentage: number;
  taxableValuePaise: number;
  integratedTaxPaise: number;
  centralTaxPaise: number;
  stateUtTaxPaise: number;
  cessAmountPaise: number;
}

export interface HsnLine {
  readonly hsn_sac_code: string | null;
  readonly description: string;
  readonly unit_of_measurement: string | null;
  readonly quantity: string | number;
  readonly tax_rate_percentage: string | number;
  readonly taxable_value_paise: number;
  readonly cgst_paise: number;
  readonly sgst_paise: number;
  readonly igst_paise: number;
}

const QUANTITY_SCALE = 1000;

/** Exact thousandths of a stored quantity ("2.500", 2.5). Stored quantities never exceed 3 decimals. */
export function quantityToThousandths(quantity: string | number): number {
  const text = String(quantity).trim();
  const match = /^(-?)(\d+)(?:\.(\d{1,3}))?$/.exec(text);
  if (match) {
    const value = Number(match[2]) * QUANTITY_SCALE + Number((match[3] ?? '').padEnd(3, '0'));
    return match[1] === '-' ? -value : value;
  }
  // Defensive fallback for an unexpected shape (e.g. exponent notation): round to thousandths.
  const numeric = Number(text);
  return Number.isFinite(numeric) ? Math.round(numeric * QUANTITY_SCALE) : 0;
}

interface Bucket {
  row: Omit<HsnSummaryRow, 'totalQuantity'>;
  quantityThousandths: number;
}

export class HsnSummaryAccumulator {
  private readonly buckets = new Map<string, Bucket>();

  addInvoiceLine(line: HsnLine): void {
    this.apply(line, 1);
  }

  subtractCreditNoteLine(line: HsnLine): void {
    this.apply(line, -1);
  }

  /** Rows sorted by HSN code (same order as before). */
  rows(): HsnSummaryRow[] {
    return [...this.buckets.values()]
      .map(({ row, quantityThousandths }) => ({ ...row, totalQuantity: quantityThousandths / QUANTITY_SCALE }))
      .sort((a, b) => a.hsnSacCode.localeCompare(b.hsnSacCode));
  }

  private apply(line: HsnLine, sign: 1 | -1): void {
    const hsnSacCode = (line.hsn_sac_code || 'N/A').trim();
    const ratePercentage = Number(line.tax_rate_percentage);
    const uqc = line.unit_of_measurement ? line.unit_of_measurement.toUpperCase() : 'OTH';
    const key = `${hsnSacCode}_${uqc}_${ratePercentage}`;

    let bucket = this.buckets.get(key);
    if (bucket === undefined) {
      bucket = {
        row: {
          hsnSacCode,
          description: line.description,
          uqc,
          totalValuePaise: 0,
          ratePercentage,
          taxableValuePaise: 0,
          integratedTaxPaise: 0,
          centralTaxPaise: 0,
          stateUtTaxPaise: 0,
          cessAmountPaise: 0,
        },
        quantityThousandths: 0,
      };
      this.buckets.set(key, bucket);
    }

    const tax = line.igst_paise + line.cgst_paise + line.sgst_paise;
    bucket.quantityThousandths += sign * quantityToThousandths(line.quantity);
    bucket.row.taxableValuePaise += sign * line.taxable_value_paise;
    bucket.row.integratedTaxPaise += sign * line.igst_paise;
    bucket.row.centralTaxPaise += sign * line.cgst_paise;
    bucket.row.stateUtTaxPaise += sign * line.sgst_paise;
    bucket.row.totalValuePaise += sign * (line.taxable_value_paise + tax);
  }
}
