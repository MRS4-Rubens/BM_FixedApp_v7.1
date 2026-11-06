import { describe, expect, it } from 'vitest';
import {
  evaluateInvoiceDate,
  isValidIsoCalendarDate,
  INVOICE_BACKDATE_WINDOW_DAYS,
} from '@/lib/invoices/invoice-date-policy';
import { formatIstDateAsIso } from '@/lib/invoices/ist-date';

describe('COMP-001: invoice-date-policy pure module', () => {
  it('exports and uses INVOICE_BACKDATE_WINDOW_DAYS = 30', () => {
    expect(INVOICE_BACKDATE_WINDOW_DAYS).toBe(30);
  });

  describe('isValidIsoCalendarDate', () => {
    it('accepts valid calendar dates', () => {
      expect(isValidIsoCalendarDate('2026-04-15')).toBe(true);
      expect(isValidIsoCalendarDate('2024-02-29')).toBe(true); // Leap year
      expect(isValidIsoCalendarDate('2026-12-31')).toBe(true);
      expect(isValidIsoCalendarDate('2026-01-01')).toBe(true);
    });

    it('rejects non-existent calendar dates like 2026-02-31 and non-leap Feb 29', () => {
      expect(isValidIsoCalendarDate('2026-02-31')).toBe(false);
      expect(isValidIsoCalendarDate('2026-02-29')).toBe(false); // Not a leap year
      expect(isValidIsoCalendarDate('2026-04-31')).toBe(false); // April has 30 days
      expect(isValidIsoCalendarDate('2026-13-01')).toBe(false); // Invalid month
      expect(isValidIsoCalendarDate('2026-00-10')).toBe(false);
      expect(isValidIsoCalendarDate('2026-05-00')).toBe(false);
    });

    it('rejects malformed strings', () => {
      expect(isValidIsoCalendarDate('not-a-date')).toBe(false);
      expect(isValidIsoCalendarDate('2026/04/15')).toBe(false);
      expect(isValidIsoCalendarDate('15-04-2026')).toBe(false);
      expect(isValidIsoCalendarDate('')).toBe(false);
    });
  });

  describe('evaluateInvoiceDate', () => {
    const todayIso = '2026-05-15'; // Financial Year 2026-27

    it('rejects invalid calendar dates with INVOICE_DATE_INVALID', () => {
      const res = evaluateInvoiceDate({
        invoiceDateIso: '2026-02-31',
        todayIso,
        latestFinalizedDateIso: null,
        confirmCrossFinancialYear: false,
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe('INVOICE_DATE_INVALID');
      }
    });

    it('rejects tomorrow (IST) with INVOICE_DATE_FUTURE', () => {
      const res = evaluateInvoiceDate({
        invoiceDateIso: '2026-05-16',
        todayIso: '2026-05-15',
        latestFinalizedDateIso: null,
        confirmCrossFinancialYear: false,
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe('INVOICE_DATE_FUTURE');
        expect(res.message).toContain('Today (IST) is 15/05/2026');
      }
    });

    it('accepts today (IST)', () => {
      const res = evaluateInvoiceDate({
        invoiceDateIso: '2026-05-15',
        todayIso: '2026-05-15',
        latestFinalizedDateIso: null,
        confirmCrossFinancialYear: false,
      });
      expect(res.ok).toBe(true);
    });

    it('rejects a previous FY date without confirmation with INVOICE_DATE_CROSS_FY', () => {
      const res = evaluateInvoiceDate({
        invoiceDateIso: '2026-03-25', // FY 2025-26
        todayIso: '2026-05-15', // FY 2026-27
        latestFinalizedDateIso: null,
        confirmCrossFinancialYear: false,
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe('INVOICE_DATE_CROSS_FY');
        expect(res.message).toContain('2025-26');
        expect(res.message).toContain('2026-27');
        expect(res.message).toContain('Confirmation is required');
      }
    });

    it('accepts a previous FY date when cross-FY confirmation is provided', () => {
      const res = evaluateInvoiceDate({
        invoiceDateIso: '2026-03-25', // FY 2025-26
        todayIso: '2026-05-15', // FY 2026-27
        latestFinalizedDateIso: null,
        confirmCrossFinancialYear: true,
      });
      expect(res.ok).toBe(true);
    });

    it('accepts invoice date when there is no prior finalized invoice in the series', () => {
      const res = evaluateInvoiceDate({
        invoiceDateIso: '2026-04-01',
        todayIso: '2026-05-15',
        latestFinalizedDateIso: null,
        confirmCrossFinancialYear: false,
      });
      expect(res.ok).toBe(true);
    });

    it('accepts date exactly latest - 30 days', () => {
      // Latest: 2026-05-15. 30 days earlier: 2026-04-15
      const res = evaluateInvoiceDate({
        invoiceDateIso: '2026-04-15',
        todayIso: '2026-05-15',
        latestFinalizedDateIso: '2026-05-15',
        confirmCrossFinancialYear: false,
      });
      expect(res.ok).toBe(true);
    });

    it('rejects date latest - 31 days with INVOICE_DATE_TOO_OLD', () => {
      // Latest: 2026-05-15. 31 days earlier: 2026-04-14
      const res = evaluateInvoiceDate({
        invoiceDateIso: '2026-04-14',
        todayIso: '2026-05-15',
        latestFinalizedDateIso: '2026-05-15',
        confirmCrossFinancialYear: false,
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe('INVOICE_DATE_TOO_OLD');
        expect(res.message).toContain('15/04/2026');
      }
    });

    it('uses IST date correctly across UTC day boundary (23:59 UTC)', () => {
      // 2026-05-15T23:59:00Z in UTC is 2026-05-16T05:29:00 in IST.
      const utcLate = new Date(Date.UTC(2026, 4, 15, 23, 59, 0));
      const istIso = formatIstDateAsIso(utcLate);
      expect(istIso).toBe('2026-05-16');

      // Now evaluating 2026-05-16 against that todayIso should be OK
      const res = evaluateInvoiceDate({
        invoiceDateIso: '2026-05-16',
        todayIso: istIso,
        latestFinalizedDateIso: null,
        confirmCrossFinancialYear: false,
      });
      expect(res.ok).toBe(true);
    });
  });
});
