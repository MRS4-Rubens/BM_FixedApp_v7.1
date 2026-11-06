import { describe, expect, it } from 'vitest';
import {
  DisplayInvoiceStatus,
  getDisplayInvoiceStatus,
  getDisplayStatusLabel,
} from '@/lib/invoices/status';
import { INVOICE_LIST_STATUSES } from '@/lib/invoices/list-filters';

describe('Invoice Display Status Engine (TEST-001)', () => {
  // Fixed as-of date: 2026-10-15 12:00:00 UTC -> IST 2026-10-15 17:30:00
  const asOfDate = new Date('2026-10-15T12:00:00.000Z');

  describe('SPEC: Lifecycle & Payment Status Combinations Matrix', () => {
    it('draft invoices always resolve to "draft" status regardless of payment or due date', () => {
      const paymentStatuses = ['unpaid', 'partially_paid', 'paid', 'overdue'] as const;
      const dueDates = [null, '2026-10-01', '2026-10-15', '2026-10-30', new Date('2026-10-01')];

      for (const payment_status of paymentStatuses) {
        for (const due_date of dueDates) {
          const status = getDisplayInvoiceStatus(
            { lifecycle_status: 'draft', payment_status, due_date },
            asOfDate
          );
          expect(status).toBe('draft');
        }
      }
    });

    it('finalized invoice with payment_status "paid" always resolves to "paid", even if past due', () => {
      const pastDue = '2026-10-01';
      expect(
        getDisplayInvoiceStatus(
          { lifecycle_status: 'finalized', payment_status: 'paid', due_date: pastDue },
          asOfDate
        )
      ).toBe('paid');

      expect(
        getDisplayInvoiceStatus(
          { lifecycle_status: 'finalized', payment_status: 'paid', due_date: null },
          asOfDate
        )
      ).toBe('paid');
    });

    it('finalized invoice past due date resolves to "overdue" unless fully paid', () => {
      const pastDue = '2026-10-10'; // 5 days past asOfDate

      expect(
        getDisplayInvoiceStatus(
          { lifecycle_status: 'finalized', payment_status: 'unpaid', due_date: pastDue },
          asOfDate
        )
      ).toBe('overdue');

      // partially_paid is overridden by overdue if past due
      expect(
        getDisplayInvoiceStatus(
          { lifecycle_status: 'finalized', payment_status: 'partially_paid', due_date: pastDue },
          asOfDate
        )
      ).toBe('overdue');

      // Date object input
      expect(
        getDisplayInvoiceStatus(
          { lifecycle_status: 'finalized', payment_status: 'unpaid', due_date: new Date('2026-10-10T00:00:00Z') },
          asOfDate
        )
      ).toBe('overdue');

      // ISO with time suffix
      expect(
        getDisplayInvoiceStatus(
          { lifecycle_status: 'finalized', payment_status: 'unpaid', due_date: '2026-10-10T15:30:00Z' },
          asOfDate
        )
      ).toBe('overdue');
    });

    it('due date matching today (as-of date in IST) is NOT overdue', () => {
      const dueToday = '2026-10-15';
      expect(
        getDisplayInvoiceStatus(
          { lifecycle_status: 'finalized', payment_status: 'unpaid', due_date: dueToday },
          asOfDate
        )
      ).toBe('sent');

      expect(
        getDisplayInvoiceStatus(
          { lifecycle_status: 'finalized', payment_status: 'partially_paid', due_date: dueToday },
          asOfDate
        )
      ).toBe('partially_paid');
    });

    it('due date in the future is NOT overdue', () => {
      const futureDue = '2026-10-25';
      expect(
        getDisplayInvoiceStatus(
          { lifecycle_status: 'finalized', payment_status: 'unpaid', due_date: futureDue },
          asOfDate
        )
      ).toBe('sent');

      expect(
        getDisplayInvoiceStatus(
          { lifecycle_status: 'finalized', payment_status: 'partially_paid', due_date: futureDue },
          asOfDate
        )
      ).toBe('partially_paid');
    });

    it('DB payment_status "overdue" without a past due date falls back to "sent"', () => {
      // The app never writes 'overdue' to DB; if legacy data has it without due_date, it resolves to sent
      expect(
        getDisplayInvoiceStatus(
          { lifecycle_status: 'finalized', payment_status: 'overdue', due_date: null },
          asOfDate
        )
      ).toBe('sent');

      expect(
        getDisplayInvoiceStatus(
          { lifecycle_status: 'finalized', payment_status: 'overdue', due_date: '2026-10-20' }, // future
          asOfDate
        )
      ).toBe('sent');
    });
  });

  describe('SPEC: IST Day Boundary Resolution for Overdue Checks', () => {
    it('evaluates overdue status exactly on IST midnight transition', () => {
      const due = '2026-10-15';

      // 2026-10-15T18:29:59.999Z -> IST is 2026-10-15 23:59:59.999 (Still 15 Oct -> not overdue)
      const justBeforeMidnight = new Date('2026-10-15T18:29:59.999Z');
      expect(
        getDisplayInvoiceStatus(
          { lifecycle_status: 'finalized', payment_status: 'unpaid', due_date: due },
          justBeforeMidnight
        )
      ).toBe('sent');

      // 2026-10-15T18:30:00.000Z -> IST is 2026-10-16 00:00:00.000 (Now 16 Oct -> overdue!)
      const atMidnight = new Date('2026-10-15T18:30:00.000Z');
      expect(
        getDisplayInvoiceStatus(
          { lifecycle_status: 'finalized', payment_status: 'unpaid', due_date: due },
          atMidnight
        )
      ).toBe('overdue');
    });
  });

  describe('SPEC: getDisplayStatusLabel Formatting', () => {
    it('returns documented UI label and color classes for every status', () => {
      expect(getDisplayStatusLabel('draft').label).toBe('Draft');
      expect(getDisplayStatusLabel('sent').label).toBe('Sent');
      expect(getDisplayStatusLabel('partially_paid').label).toBe('Partially Paid');
      expect(getDisplayStatusLabel('paid').label).toBe('Paid');
      expect(getDisplayStatusLabel('overdue').label).toBe('Overdue');

      // Fallback default branch for unexpected input
      // Permitted cast simulating invalid enum value at runtime
      const unknown = getDisplayStatusLabel('bogus' as unknown as DisplayInvoiceStatus);
      expect(unknown.label).toBe('Unknown');
    });
  });

  describe('Parity Guard: PERF-001 list filter consistency', () => {
    it('INVOICE_LIST_STATUSES contains all valid filter statuses', () => {
      expect(INVOICE_LIST_STATUSES).toEqual([
        'all',
        'draft',
        'sent',
        'partially_paid',
        'paid',
        'overdue',
      ]);
    });
  });

  describe('CHAR / F-STATUS-1: Malformed Due Date Handling', () => {
    it('CHAR F-STATUS-1: malformed due_date strings are compared lexicographically without validation', () => {
      // '2026-13-99' is not a valid date, but lexicographically '2026-10-15' < '2026-13-99' -> not overdue
      expect(
        getDisplayInvoiceStatus(
          { lifecycle_status: 'finalized', payment_status: 'unpaid', due_date: '2026-13-99' },
          asOfDate
        )
      ).toBe('sent');

      // '2026-09-99' < '2026-10-15' -> overdue
      expect(
        getDisplayInvoiceStatus(
          { lifecycle_status: 'finalized', payment_status: 'unpaid', due_date: '2026-09-99' },
          asOfDate
        )
      ).toBe('overdue');
    });
  });
});
