import { and, eq, isNotNull, lt, ne, not, notInArray, type SQL } from 'drizzle-orm';
import { invoices } from '@/lib/db/schema';
import { getIstDateParts } from '@/lib/invoices/ist-date';

export const INVOICE_LIST_STATUSES = [
  'all',
  'draft',
  'sent',
  'partially_paid',
  'paid',
  'overdue',
] as const;

export type InvoiceListStatus = (typeof INVOICE_LIST_STATUSES)[number];

export interface PeriodRange {
  readonly startDate: string;
  readonly endDate: string;
  readonly isCurrentMonth: boolean;
}

/**
 * Returns the last day of a given month and year (1-based month).
 * Handles leap years properly.
 */
function getLastDayOfMonth(year: number, month: number): number {
  // Day 0 of next month is the last day of current month in UTC
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Resolves a 1-based month and 4-digit year into an ISO start and end date.
 * Uses IST to determine whether the requested period is the current calendar month.
 */
export function resolveListPeriod(
  input: { month: number; year: number },
  now?: Date,
): PeriodRange {
  const current = getIstDateParts(now || new Date());
  const month = Math.min(12, Math.max(1, input.month));
  const year = input.year;

  const mm = String(month).padStart(2, '0');
  const startDate = `${year}-${mm}-01`;
  const lastDay = getLastDayOfMonth(year, month);
  const endDate = `${year}-${mm}-${String(lastDay).padStart(2, '0')}`;

  const isCurrentMonth = current.year === year && current.month === month;

  return {
    startDate,
    endDate,
    isCurrentMonth,
  };
}

/** Default period is the current IST month and year. */
export function defaultListPeriod(now?: Date): { month: number; year: number } {
  const current = getIstDateParts(now || new Date());
  return {
    month: current.month,
    year: current.year,
  };
}

/**
 * Builds the exact SQL condition matching `getDisplayInvoiceStatus(invoice, todayIso)`.
 * - draft: lifecycle_status = 'draft'
 * - paid: lifecycle_status = 'finalized' AND payment_status = 'paid'
 * - overdue: lifecycle_status = 'finalized' AND payment_status <> 'paid' AND due_date IS NOT NULL AND due_date < todayIso
 * - partially_paid: lifecycle_status = 'finalized' AND payment_status = 'partially_paid' AND NOT (overdue)
 * - sent: lifecycle_status = 'finalized' AND payment_status NOT IN ('paid', 'partially_paid') AND NOT (overdue)
 * - all: undefined (no status filter)
 */
export function buildDisplayStatusCondition(
  status: InvoiceListStatus,
  todayIso: string,
): SQL | undefined {
  if (status === 'all') {
    return undefined;
  }

  const isFinalized = eq(invoices.lifecycle_status, 'finalized');
  const overdueCondition = and(
    isFinalized,
    ne(invoices.payment_status, 'paid'),
    isNotNull(invoices.due_date),
    lt(invoices.due_date, todayIso),
  );
  if (!overdueCondition) {
    return undefined;
  }

  switch (status) {
    case 'draft':
      return eq(invoices.lifecycle_status, 'draft');

    case 'paid':
      return and(isFinalized, eq(invoices.payment_status, 'paid'));

    case 'overdue':
      return overdueCondition;

    case 'partially_paid':
      return and(
        isFinalized,
        eq(invoices.payment_status, 'partially_paid'),
        not(overdueCondition),
      );

    case 'sent':
      return and(
        isFinalized,
        notInArray(invoices.payment_status, ['paid', 'partially_paid']),
        not(overdueCondition),
      );
  }
}
