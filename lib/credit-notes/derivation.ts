/**
 * API-004: pure, dependency-free derivation of credit-note lines from original invoice lines.
 * Authoritative on the server; the client form imports it for an identical read-only preview.
 * All limits use integer milli-units (quantity x 1000); all money is integer paise.
 */
export const QUANTITY_SCALE = 1000;
const MAX_QUANTITY_MILLI = 9_999_999_999; // numeric(10,3)

export type CreditNoteRuleCode =
  | 'INVALID_QUANTITY'
  | 'DUPLICATE_ITEM'
  | 'ITEM_MISMATCH'
  | 'QUANTITY_EXCEEDS_ORIGINAL'
  | 'VALUE_EXCEEDS_ORIGINAL'
  | 'LEGACY_CREDIT_UNLINKED'
  | 'CREDIT_NOTE_STALE';

export class CreditNoteRuleError extends Error {
  readonly code: CreditNoteRuleCode;
  constructor(code: CreditNoteRuleCode, message: string) {
    super(message);
    this.name = 'CreditNoteRuleError';
    this.code = code;
  }
}

export interface MoneyParts {
  discountPaise: number;
  taxableValuePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
}

export interface OriginalLineState extends MoneyParts {
  originalLineItemId: string;
  productId: string | null;
  description: string;
  hsnSacCode: string;
  unitOfMeasurement: string;
  unitPricePaise: number;
  taxRatePercentage: string; // stored numeric string, e.g. "18.00"
  quantityMilli: number;
  sortOrder: number;
}

export interface CreditedUsage extends MoneyParts {
  quantityMilli: number;
}

export interface CreditLineState {
  original: OriginalLineState;
  credited: CreditedUsage;
}

export interface CreditedLineRow extends MoneyParts {
  originalLineItemId: string | null;
  quantityMilli: number;
}

export interface CreditRequestLine {
  originalLineItemId: string;
  quantityMilli: number;
}

export interface DerivedCreditLine extends MoneyParts {
  originalLineItemId: string;
  productId: string | null;
  description: string;
  hsnSacCode: string;
  unitOfMeasurement: string;
  unitPricePaise: number;
  taxRatePercentage: string;
  quantityMilli: number;
  lineTotalPaise: number;
}

export interface CreditNoteTotals {
  subtotalPaise: number;
  totalCgstPaise: number;
  totalSgstPaise: number;
  totalIgstPaise: number;
  totalTaxPaise: number;
  exactTotalPaise: number;
}

const invalidQuantity = (): CreditNoteRuleError =>
  new CreditNoteRuleError('INVALID_QUANTITY', 'Quantity must be greater than 0 and have at most 3 decimal places.');

/** Accepts a stored numeric string ("2.500") or a client number (2.5). Throws INVALID_QUANTITY otherwise. */
export function quantityToMilli(value: number | string): number {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^\d{1,7}(\.\d{1,3})?$/.test(trimmed)) throw invalidQuantity();
    const [whole = '0', fraction = ''] = trimmed.split('.');
    const milli = Number(whole) * QUANTITY_SCALE + Number(fraction.padEnd(3, '0'));
    if (milli <= 0) throw invalidQuantity();
    return milli;
  }
  if (!Number.isFinite(value) || value <= 0) throw invalidQuantity();
  const scaled = Math.round(value * QUANTITY_SCALE);
  if (scaled <= 0 || scaled > MAX_QUANTITY_MILLI || Math.abs(value * QUANTITY_SCALE - scaled) > 1e-6) {
    throw invalidQuantity();
  }
  return scaled;
}

export function milliToQuantity(milli: number): number {
  return milli / QUANTITY_SCALE; // correctly-rounded division == parseFloat of the 3-dp decimal string
}

/** Fixed 3-dp string for the numeric(10,3) column, e.g. 2500 -> "2.500". */
export function milliToQuantityString(milli: number): string {
  const whole = Math.trunc(milli / QUANTITY_SCALE);
  const fraction = milli % QUANTITY_SCALE;
  return `${whole}.${String(fraction).padStart(3, '0')}`;
}

/** round-half-up(amount * partMilli / wholeMilli) in exact integer arithmetic. */
export function prorateRoundHalfUp(amount: number, partMilli: number, wholeMilli: number): number {
  if (!Number.isSafeInteger(amount) || amount < 0 || !Number.isSafeInteger(partMilli) || partMilli < 0 ||
    !Number.isSafeInteger(wholeMilli) || wholeMilli <= 0 || partMilli > wholeMilli) {
    throw new RangeError('prorateRoundHalfUp: invalid arguments');
  }
  const two = BigInt(2);
  const numerator = BigInt(amount) * BigInt(partMilli);
  const denominator = BigInt(wholeMilli);
  return Number((two * numerator + denominator) / (two * denominator));
}

export function roundToRupeePaise(paise: number): number {
  return Math.round(paise / 100) * 100; // same rule the app already uses for document grand totals
}

/** Builds per-original-line state. Fails closed on legacy/unlinked or foreign credited lines. */
export function buildCreditLineStates(
  originals: readonly OriginalLineState[],
  creditedRows: readonly CreditedLineRow[],
): Map<string, CreditLineState> {
  const states = new Map<string, CreditLineState>();
  for (const original of originals) {
    states.set(original.originalLineItemId, {
      original,
      credited: { quantityMilli: 0, discountPaise: 0, taxableValuePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0 },
    });
  }
  for (const row of creditedRows) {
    if (row.originalLineItemId === null) {
      throw new CreditNoteRuleError(
        'LEGACY_CREDIT_UNLINKED',
        'This invoice has a credit note (or draft) created before item-level validation that could not be linked automatically. Delete the draft or contact support before issuing another credit note.',
      );
    }
    const state = states.get(row.originalLineItemId);
    if (!state) {
      throw new CreditNoteRuleError('ITEM_MISMATCH', 'A credit note line references an item that is not on the original invoice.');
    }
    state.credited.quantityMilli += row.quantityMilli;
    state.credited.discountPaise += row.discountPaise;
    state.credited.taxableValuePaise += row.taxableValuePaise;
    state.credited.cgstPaise += row.cgstPaise;
    state.credited.sgstPaise += row.sgstPaise;
    state.credited.igstPaise += row.igstPaise;
  }
  return states;
}

export function deriveCreditLines(
  states: ReadonlyMap<string, CreditLineState>,
  requests: readonly CreditRequestLine[],
): DerivedCreditLine[] {
  const seen = new Set<string>();
  return requests.map((request): DerivedCreditLine => {
    if (seen.has(request.originalLineItemId)) {
      throw new CreditNoteRuleError('DUPLICATE_ITEM', 'Each invoice line can only appear once on a credit note.');
    }
    seen.add(request.originalLineItemId);
    const state = states.get(request.originalLineItemId);
    if (!state) {
      throw new CreditNoteRuleError('ITEM_MISMATCH', 'One or more items do not belong to the original invoice.');
    }
    if (!Number.isSafeInteger(request.quantityMilli) || request.quantityMilli <= 0) throw invalidQuantity();

    const { original, credited } = state;
    const remainingMilli = original.quantityMilli - credited.quantityMilli;
    if (request.quantityMilli > remainingMilli) {
      throw new CreditNoteRuleError(
        'QUANTITY_EXCEEDS_ORIGINAL',
        `Quantity for "${original.description}" (${milliToQuantityString(request.quantityMilli)}) exceeds the remaining creditable quantity (${milliToQuantityString(Math.max(0, remainingMilli))}).`,
      );
    }
    const isFinalSlice = request.quantityMilli === remainingMilli;
    const take = (originalAmount: number, creditedAmount: number): number => {
      const remainingAmount = originalAmount - creditedAmount;
      if (remainingAmount < 0) {
        throw new CreditNoteRuleError('VALUE_EXCEEDS_ORIGINAL', `Credits already issued for "${original.description}" exceed its invoiced value.`);
      }
      if (isFinalSlice) return remainingAmount;
      return Math.min(prorateRoundHalfUp(originalAmount, request.quantityMilli, original.quantityMilli), remainingAmount);
    };

    const discountPaise = take(original.discountPaise, credited.discountPaise);
    const taxableValuePaise = take(original.taxableValuePaise, credited.taxableValuePaise);
    const cgstPaise = take(original.cgstPaise, credited.cgstPaise);
    const sgstPaise = take(original.sgstPaise, credited.sgstPaise);
    const igstPaise = take(original.igstPaise, credited.igstPaise);

    return {
      originalLineItemId: original.originalLineItemId,
      productId: original.productId,
      description: original.description,
      hsnSacCode: original.hsnSacCode,
      unitOfMeasurement: original.unitOfMeasurement,
      unitPricePaise: original.unitPricePaise,
      taxRatePercentage: original.taxRatePercentage,
      quantityMilli: request.quantityMilli,
      discountPaise,
      taxableValuePaise,
      cgstPaise,
      sgstPaise,
      igstPaise,
      lineTotalPaise: taxableValuePaise + cgstPaise + sgstPaise + igstPaise,
    };
  });
}

export function sumDerivedLines(lines: readonly DerivedCreditLine[]): CreditNoteTotals {
  let subtotalPaise = 0;
  let totalCgstPaise = 0;
  let totalSgstPaise = 0;
  let totalIgstPaise = 0;
  for (const line of lines) {
    subtotalPaise += line.taxableValuePaise;
    totalCgstPaise += line.cgstPaise;
    totalSgstPaise += line.sgstPaise;
    totalIgstPaise += line.igstPaise;
  }
  const totalTaxPaise = totalCgstPaise + totalSgstPaise + totalIgstPaise;
  return { subtotalPaise, totalCgstPaise, totalSgstPaise, totalIgstPaise, totalTaxPaise, exactTotalPaise: subtotalPaise + totalTaxPaise };
}

/** Invoice-level cap: sum of all credit notes can never exceed the invoice (exact and rupee-rounded). */
export function resolveCreditNoteGrandTotal(args: {
  exactTotalPaise: number;
  invoiceGrandTotalPaise: number;
  invoiceExactTotalPaise: number;
  otherCreditNotesGrandPaise: number;
  otherCreditNotesExactPaise: number;
}): number {
  if (args.otherCreditNotesExactPaise + args.exactTotalPaise > args.invoiceExactTotalPaise) {
    throw new CreditNoteRuleError('VALUE_EXCEEDS_ORIGINAL', 'Total credited value would exceed the original invoice value.');
  }
  const capacity = args.invoiceGrandTotalPaise - args.otherCreditNotesGrandPaise;
  if (capacity < 0) {
    throw new CreditNoteRuleError('VALUE_EXCEEDS_ORIGINAL', 'Total credited value would exceed the original invoice total.');
  }
  const rounded = roundToRupeePaise(args.exactTotalPaise);
  const grand = Math.min(rounded, capacity);
  if (rounded - grand > 100) {
    throw new CreditNoteRuleError('VALUE_EXCEEDS_ORIGINAL', 'Total credited value would exceed the original invoice total.');
  }
  return grand;
}

export interface StoredCreditLine extends MoneyParts {
  originalLineItemId: string;
  quantityMilli: number;
  unitPricePaise: number;
}
export interface CreditNoteHeaderTotals extends Omit<CreditNoteTotals, 'exactTotalPaise'> {
  grandTotalPaise: number;
}

/** Finalize-time guard: stored draft must equal a fresh derivation under the lock, else fail closed. */
export function assertCreditNoteMatchesDerivation(
  stored: { header: CreditNoteHeaderTotals; lines: readonly StoredCreditLine[] },
  derived: { header: CreditNoteHeaderTotals; lines: readonly DerivedCreditLine[] },
): void {
  const stale = (): CreditNoteRuleError =>
    new CreditNoteRuleError('CREDIT_NOTE_STALE', 'The creditable amounts for this invoice changed after this draft was saved (another credit note was issued or removed). Delete this draft and create a new one.');
  if (stored.lines.length !== derived.lines.length) throw stale();
  const byId = new Map(stored.lines.map((line) => [line.originalLineItemId, line] as const));
  for (const d of derived.lines) {
    const s = byId.get(d.originalLineItemId);
    if (!s || s.quantityMilli !== d.quantityMilli || s.unitPricePaise !== d.unitPricePaise ||
      s.discountPaise !== d.discountPaise || s.taxableValuePaise !== d.taxableValuePaise ||
      s.cgstPaise !== d.cgstPaise || s.sgstPaise !== d.sgstPaise || s.igstPaise !== d.igstPaise) {
      throw stale();
    }
  }
  const a = stored.header;
  const b = derived.header;
  if (a.subtotalPaise !== b.subtotalPaise || a.totalCgstPaise !== b.totalCgstPaise || a.totalSgstPaise !== b.totalSgstPaise ||
    a.totalIgstPaise !== b.totalIgstPaise || a.totalTaxPaise !== b.totalTaxPaise || a.grandTotalPaise !== b.grandTotalPaise) {
    throw stale();
  }
}
