/**
 * Effective-dated GST reporting thresholds (COMP-002).
 *
 * All money is INTEGER PAISE; dates are ISO calendar dates (YYYY-MM-DD) in IST, as stored in `invoices.invoice_date`.
 * ISO dates compare correctly as plain strings, so no Date arithmetic (and no timezone risk) is involved.
 *
 * B2CL (GSTR-1 Table 5): inter-State supplies to unregistered persons are reported invoice-wise only when the invoice
 * value is MORE THAN the threshold; at or below it they are reported state-wise in Table 7 (B2CS).
 *
 * To add a future change: append a new entry (ascending `from`); never edit past entries; add boundary tests.
 */
export interface EffectiveThreshold {
  /** First invoice date (inclusive, YYYY-MM-DD) on which this threshold applies. */
  readonly from: string;
  /** Threshold in paise. An invoice is "large" only when its value is strictly greater than this. */
  readonly paise: number;
  /** Legal source, for auditors and CAs. */
  readonly source: string;
}

export const B2CL_THRESHOLDS: readonly EffectiveThreshold[] = [
  {
    from: '2017-07-01',
    paise: 25_000_000,
    source: 'Rule 59(4) CGST Rules before Notification No. 12/2024-Central Tax: invoice value more than Rs 2,50,000',
  },
  {
    from: '2024-08-01',
    paise: 10_000_000,
    source:
      'Notification No. 12/2024-Central Tax dated 10 Jul 2024 (GSTN advisory 3 Sep 2024): invoice value more than Rs 1,00,000, with effect from 1 Aug 2024',
  },
];

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function assertValidIsoDate(value: string): void {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) {
    throw new RangeError(`Invalid invoice date "${value}": expected YYYY-MM-DD`);
  }
  const roundTrip = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(roundTrip.getTime()) || roundTrip.toISOString().slice(0, 10) !== value) {
    throw new RangeError(`Invalid invoice date "${value}": not a real calendar date`);
  }
}

/**
 * B2CL threshold (in paise) that applies to an invoice dated `invoiceDateIso`.
 * Dates before the first entry use the first entry. A missing date (never the case for a finalized invoice) uses the
 * most recent rule.
 */
export function b2clThresholdPaise(invoiceDateIso: string | null): number {
  const latest = B2CL_THRESHOLDS[B2CL_THRESHOLDS.length - 1];
  const earliest = B2CL_THRESHOLDS[0];
  if (!latest || !earliest) {
    throw new Error('B2CL_THRESHOLDS must not be empty');
  }
  if (invoiceDateIso === null) {
    return latest.paise;
  }
  assertValidIsoDate(invoiceDateIso);
  for (let index = B2CL_THRESHOLDS.length - 1; index >= 0; index -= 1) {
    const rule = B2CL_THRESHOLDS[index];
    if (rule && invoiceDateIso >= rule.from) {
      return rule.paise;
    }
  }
  return earliest.paise;
}

/** True when an inter-State, unregistered-recipient invoice of this value and date must be reported invoice-wise (B2CL). */
export function isB2clLargeInvoice(grandTotalPaise: number, invoiceDateIso: string | null): boolean {
  if (!Number.isSafeInteger(grandTotalPaise) || grandTotalPaise < 0) {
    throw new RangeError(`Invoice value must be a non-negative integer number of paise, got ${grandTotalPaise}`);
  }
  return grandTotalPaise > b2clThresholdPaise(invoiceDateIso);
}

