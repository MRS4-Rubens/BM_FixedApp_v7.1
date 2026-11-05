import { readFirst } from '@/lib/pagination/url';
import { normalizeSearchTerm } from '@/lib/pagination/search';
import { decodeCursor, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, MIN_PAGE_SIZE } from '@/lib/pagination/keyset';
import { defaultListPeriod, INVOICE_LIST_STATUSES, type InvoiceListStatus } from './list-filters';
import { getIstDateParts } from './ist-date';

export type RawSearchParams = Record<string, string | string[] | undefined>;

export interface InvoiceListParams {
  readonly tab: 'invoices' | 'credit_notes';
  readonly q: string | null;
  readonly status: InvoiceListStatus;
  readonly month: number;
  readonly year: number;
  readonly size: number;
  readonly after?: string;
  readonly before?: string;
}

export interface CustomerListParams {
  readonly q: string | null;
  readonly includeInactive: boolean;
  readonly size: number;
  readonly after?: string;
  readonly before?: string;
}

export interface ProductListParams {
  readonly q: string | null;
  readonly includeInactive: boolean;
  readonly kind: 'all' | 'product' | 'service';
  readonly size: number;
  readonly after?: string;
  readonly before?: string;
}

export interface CreditNoteListParams {
  readonly q: string | null;
  readonly month: number;
  readonly year: number;
  readonly size: number;
  readonly after?: string;
  readonly before?: string;
}

function clampSize(raw: string | undefined): number {
  if (!raw) return DEFAULT_PAGE_SIZE;
  const num = parseInt(raw, 10);
  if (Number.isNaN(num)) return DEFAULT_PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, num));
}

function resolveCursors(
  afterRaw: string | undefined,
  beforeRaw: string | undefined,
): { after?: string; before?: string } {
  const afterValid = afterRaw && decodeCursor(afterRaw) ? afterRaw : undefined;
  const beforeValid = beforeRaw && decodeCursor(beforeRaw) ? beforeRaw : undefined;

  // If both present, after wins (mutually exclusive)
  if (afterValid) {
    return { after: afterValid };
  }
  if (beforeValid) {
    return { before: beforeValid };
  }
  return {};
}

export function parseInvoiceListParams(rawParams: RawSearchParams, now?: Date): InvoiceListParams {
  const defaults = defaultListPeriod(now);
  const currentYear = getIstDateParts(now || new Date()).year;

  // 1. Tab
  const rawTab = readFirst(rawParams.tab);
  const tab: 'invoices' | 'credit_notes' = rawTab === 'credit_notes' ? 'credit_notes' : 'invoices';

  // 2. Search
  const q = normalizeSearchTerm(readFirst(rawParams.q));

  // 3. Status
  const rawStatus = readFirst(rawParams.status);
  const status: InvoiceListStatus = (INVOICE_LIST_STATUSES as readonly string[]).includes(rawStatus ?? '')
    ? (rawStatus as InvoiceListStatus)
    : 'all';

  // 4. Month
  const rawMonth = readFirst(rawParams.month);
  let month = defaults.month;
  if (rawMonth) {
    const parsed = parseInt(rawMonth, 10);
    if (!Number.isNaN(parsed) && parsed >= 1 && parsed <= 12) {
      month = parsed;
    }
  }

  // 5. Year
  const rawYear = readFirst(rawParams.year);
  let year = defaults.year;
  if (rawYear) {
    const parsed = parseInt(rawYear, 10);
    if (!Number.isNaN(parsed) && parsed >= 2017 && parsed <= currentYear + 1) {
      year = parsed;
    }
  }

  // 6. Size
  const size = clampSize(readFirst(rawParams.size));

  // 7. Cursors
  const cursors = resolveCursors(readFirst(rawParams.after), readFirst(rawParams.before));

  return {
    tab,
    q,
    status,
    month,
    year,
    size,
    ...cursors,
  };
}

export function parseCustomerListParams(rawParams: RawSearchParams): CustomerListParams {
  const q = normalizeSearchTerm(readFirst(rawParams.q) ?? readFirst(rawParams.search));
  const rawInactive = readFirst(rawParams.inactive) ?? readFirst(rawParams.includeInactive);
  const includeInactive = rawInactive === '1' || rawInactive === 'true';
  const size = clampSize(readFirst(rawParams.size));
  const cursors = resolveCursors(readFirst(rawParams.after), readFirst(rawParams.before));

  return {
    q,
    includeInactive,
    size,
    ...cursors,
  };
}

export function parseProductListParams(rawParams: RawSearchParams): ProductListParams {
  const q = normalizeSearchTerm(readFirst(rawParams.q) ?? readFirst(rawParams.search));
  const rawInactive = readFirst(rawParams.inactive) ?? readFirst(rawParams.includeInactive);
  const includeInactive = rawInactive === '1' || rawInactive === 'true';

  const rawKind = readFirst(rawParams.kind);
  const kind: 'all' | 'product' | 'service' =
    rawKind === 'product' || rawKind === 'service' ? rawKind : 'all';

  const size = clampSize(readFirst(rawParams.size));
  const cursors = resolveCursors(readFirst(rawParams.after), readFirst(rawParams.before));

  return {
    q,
    includeInactive,
    kind,
    size,
    ...cursors,
  };
}

export function parseCreditNoteListParams(rawParams: RawSearchParams, now?: Date): CreditNoteListParams {
  const defaults = defaultListPeriod(now);
  const currentYear = getIstDateParts(now || new Date()).year;

  const q = normalizeSearchTerm(readFirst(rawParams.q));

  const rawMonth = readFirst(rawParams.month);
  let month = defaults.month;
  if (rawMonth) {
    const parsed = parseInt(rawMonth, 10);
    if (!Number.isNaN(parsed) && parsed >= 1 && parsed <= 12) {
      month = parsed;
    }
  }

  const rawYear = readFirst(rawParams.year);
  let year = defaults.year;
  if (rawYear) {
    const parsed = parseInt(rawYear, 10);
    if (!Number.isNaN(parsed) && parsed >= 2017 && parsed <= currentYear + 1) {
      year = parsed;
    }
  }

  const size = clampSize(readFirst(rawParams.size));
  const cursors = resolveCursors(readFirst(rawParams.after), readFirst(rawParams.before));

  return {
    q,
    month,
    year,
    size,
    ...cursors,
  };
}
