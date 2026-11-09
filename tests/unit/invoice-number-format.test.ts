import { describe, expect, it } from 'vitest';
import {
  InvoiceNumberFormatError,
  getPeriodKey,
  getResetGranularity,
  parseInvoiceNumberFormat,
  resolveInvoiceNumber,
  validateInvoiceNumberFormat,
} from '@/lib/invoices/number-format';

describe('Invoice Number Formatting Engine (TEST-001)', () => {
  describe('SPEC: Preset Formats Validation', () => {
    // Presets from components/app/settings/invoice-format-guide-modal.tsx, FREE_PLAN_INVOICE_NUMBER_FORMATS, and businesses.ts
    const presets: Array<[string, number]> = [
      ['BMA/{FY}/{SEQ:4}', 14], // 'BMA/' (4) + '{FY}' (5) + '/' (1) + '{SEQ:4}' (4) = 14
      ['INV/{FY}/{SEQ:4}', 14], // 'INV/' (4) + '{FY}' (5) + '/' (1) + '{SEQ:4}' (4) = 14
      ['INV-{FY}-{SEQ:3}', 13], // 'INV-' (4) + '{FY}' (5) + '-' (1) + '{SEQ:3}' (3) = 13
      ['INV/{YY}{MM}/{SEQ:4}', 13], // 'INV/' (4) + '{YY}' (2) + '{MM}' (2) + '/' (1) + '{SEQ:4}' (4) = 13
      ['INV-{DD}/{MM}/{YY}/{SEQ:3}', 16], // 'INV-' (4) + 2 + 1 + 2 + 1 + 2 + 1 + 3 = 16
      ['INV/{FYYYY}/{SEQ:4}', 16], // 'INV/' (4) + '{FYYYY}' (7) + '/' (1) + '{SEQ:4}' (4) = 16
      ['MBS/{FY}/{SEQ:4}', 14], // 'MBS/' (4) + 5 + 1 + 4 = 14
    ];

    it.each(presets)('preset %s validates successfully with maxResolvedLength %i', (format, expectedLength) => {
      const res = validateInvoiceNumberFormat(format);
      expect(res.valid).toBe(true);
      if (res.valid) {
        expect(res.maxResolvedLength).toBe(expectedLength);
      }
    });
  });

  describe('SPEC: Token Resolution', () => {
    it('resolves standard FY format with 4-digit sequence padding', () => {
      const res = resolveInvoiceNumber('BMA/{FY}/{SEQ:4}', {
        invoiceDate: new Date('2026-03-05T10:00:00Z'),
        fyLabel: '2025-26',
        sequenceValue: 7,
      });
      expect(res).toBe('BMA/25-26/0007');
    });

    it('resolves date tokens {DD}/{MM}/{YY} with 3-digit sequence padding', () => {
      const res = resolveInvoiceNumber('INV-{DD}/{MM}/{YY}/{SEQ:3}', {
        invoiceDate: new Date('2026-03-05T10:00:00Z'), // IST 15:30 on 05-03-2026
        fyLabel: '2025-26',
        sequenceValue: 1,
      });
      expect(res).toBe('INV-05/03/26/001');
    });

    it('resolves {FYYYY} full financial year token', () => {
      const res = resolveInvoiceNumber('INV/{FYYYY}/{SEQ:4}', {
        invoiceDate: new Date('2026-03-05T10:00:00Z'),
        fyLabel: '2025-26',
        sequenceValue: 1,
      });
      expect(res).toBe('INV/2025-26/0001');
    });

    it('resolves {YY}{MM} date-prefix format', () => {
      const res = resolveInvoiceNumber('INV/{YY}{MM}/{SEQ:4}', {
        invoiceDate: new Date('2026-03-05T10:00:00Z'),
        fyLabel: '2025-26',
        sequenceValue: 1,
      });
      expect(res).toBe('INV/2603/0001');
    });

    it('resolves {YYYY} 4-digit year token', () => {
      const res = resolveInvoiceNumber('INV/{YYYY}/{SEQ:4}', {
        invoiceDate: new Date('2026-03-05T10:00:00Z'),
        fyLabel: '2025-26',
        sequenceValue: 1,
      });
      expect(res).toBe('INV/2026/0001');
    });

    it('normalizes lowercase format and trims whitespace inside braces', () => {
      const res = resolveInvoiceNumber('inv/{ fy }/{ seq:3 }', {
        invoiceDate: new Date('2026-03-05T10:00:00Z'),
        fyLabel: '2025-26',
        sequenceValue: 1,
      });
      expect(res).toBe('INV/25-26/001');
    });
  });

  describe('SPEC: 16-Character Legal Limit under CGST Rule 46(b)', () => {
    it('accepts format resolving to exactly 16 characters', () => {
      // 'ABCDEFGHI/' (10) + '{SEQ:6}' (6) = 16
      const res = validateInvoiceNumberFormat('ABCDEFGHI/{SEQ:6}');
      expect(res.valid).toBe(true);
      if (res.valid) {
        expect(res.maxResolvedLength).toBe(16);
      }
    });

    it('rejects format resolving to 17 characters with character count guidance', () => {
      // 'ABCDEFGHIJ/' (11) + '{SEQ:6}' (6) = 17
      const res = validateInvoiceNumberFormat('ABCDEFGHIJ/{SEQ:6}');
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.error).toContain('exceeds the 16-character legal limit');
        expect(res.error).toContain('Shorten it by 1 character(s)');
      }
    });
  });

  describe('Invalid Tokens & Syntax Validation', () => {
    const invalidSyntaxFormats: Array<[string, string]> = [
      ['', 'Invoice format cannot be empty'],
      ['   ', 'Invoice format cannot be empty'],
      ['INV {FY}/{SEQ:4}', 'Spaces are not permitted'],
      ['INV#{FY}/{SEQ:4}', 'Invalid character(s) "#"'],
      ['INV_{FY}/{SEQ:4}', 'Invalid character(s) "_"'],
      ['INV.{FY}/{SEQ:4}', 'Invalid character(s) "."'],
      ['INV\\{FY}/{SEQ:4}', 'Invalid character(s) "\\"'],
      ['INV@{FY}/{SEQ:4}', 'Invalid character(s) "@"'],
      ['INV${FY}/{SEQ:4}', 'Invalid character(s) "$"'],
      ['INV/{FY}/{SEQ:4}}', 'Invalid character(s) "}"'],
      ['INV/{FY', 'Unclosed placeholder brace'],
      ['INV/{}/{SEQ:4}', 'Empty placeholder'],
      ['INV/{FOO}/{SEQ:4}', 'Unrecognized placeholder "{FOO}"'],
      ['INV/{SEQ:0}', 'Width must be a single digit between 1 and 6'],
      ['INV/{SEQ:7}', 'Width must be a single digit between 1 and 6'],
      ['INV/{SEQ:abc}', 'Width must be a single digit between 1 and 6'],
      ['INV/{SEQ:04}', 'Width must be a single digit between 1 and 6'],
      ['INV/{SEQ:-1}', 'Width must be a single digit between 1 and 6'],
      ['INV/{SEQ:4.5}', 'Width must be a single digit between 1 and 6'],
    ];

    it.each(invalidSyntaxFormats)('rejects invalid syntax %s with error matching %s', (format, expectedSubstring) => {
      const valRes = validateInvoiceNumberFormat(format);
      expect(valRes.valid).toBe(false);
      if (!valRes.valid) {
        expect(valRes.error).toContain(expectedSubstring);
      }

      expect(() => parseInvoiceNumberFormat(format)).toThrow(InvoiceNumberFormatError);
      expect(() => parseInvoiceNumberFormat(format)).toThrow(expectedSubstring);
    });

    it('rejects formats missing sequential counter in validateInvoiceNumberFormat', () => {
      const valRes = validateInvoiceNumberFormat('INV/{FY}/STATIC');
      expect(valRes.valid).toBe(false);
      if (!valRes.valid) {
        expect(valRes.error).toContain('Missing sequential counter');
      }
      // Note: parseInvoiceNumberFormat successfully parses tokens; sequential counter validation is semantic
      expect(() => parseInvoiceNumberFormat('INV/{FY}/STATIC')).not.toThrow();
    });

    it('rejects formats with multiple sequential counters in validateInvoiceNumberFormat', () => {
      const valRes = validateInvoiceNumberFormat('INV/{SEQ:3}/{SEQ:4}');
      expect(valRes.valid).toBe(false);
      if (!valRes.valid) {
        expect(valRes.error).toContain('Multiple counter placeholders found');
      }
      // Note: parseInvoiceNumberFormat successfully parses tokens; sequential counter uniqueness is semantic
      expect(() => parseInvoiceNumberFormat('INV/{SEQ:3}/{SEQ:4}')).not.toThrow();
    });
  });

  describe('SPEC: getResetGranularity', () => {
    it('returns daily when {DD} is present regardless of other tokens', () => {
      expect(getResetGranularity('INV-{DD}/{MM}/{YY}/{SEQ:3}')).toBe('daily');
      expect(getResetGranularity('INV/{DD}/{SEQ:4}')).toBe('daily');
    });

    it('returns monthly when {MM} is present without {DD}', () => {
      expect(getResetGranularity('INV/{YY}{MM}/{SEQ:4}')).toBe('monthly');
      expect(getResetGranularity('INV/{MM}/{SEQ:4}')).toBe('monthly');
    });

    it('returns yearly when neither {DD} nor {MM} are present', () => {
      expect(getResetGranularity('INV/{FY}/{SEQ:4}')).toBe('yearly');
      expect(getResetGranularity('INV/{FYYYY}/{SEQ:4}')).toBe('yearly');
      expect(getResetGranularity('INV/{YYYY}/{SEQ:4}')).toBe('yearly');
      expect(getResetGranularity('INV/{YY}/{SEQ:4}')).toBe('yearly');
    });

    it('falls back to yearly on invalid format', () => {
      expect(getResetGranularity('invalid format')).toBe('yearly');
    });
  });

  describe('SPEC: getPeriodKey', () => {
    it('returns financialYearId unchanged for yearly granularity', () => {
      expect(getPeriodKey('yearly', 'fy_2025_26', new Date('2026-03-31T19:00:00Z'))).toBe('fy_2025_26');
    });

    it('constructs period key with IST calendar date crossing UTC midnight', () => {
      // 2026-03-31T19:00:00Z -> IST is 2026-04-01 00:30:00
      const instant1 = new Date('2026-03-31T19:00:00Z');
      expect(getPeriodKey('monthly', 'fy_2026_27', instant1)).toBe('fy_2026_27:2026-04');
      expect(getPeriodKey('daily', 'fy_2026_27', instant1)).toBe('fy_2026_27:2026-04-01');

      // 2026-03-31T18:29:59.999Z -> IST is 2026-03-31 23:59:59.999
      const instant2 = new Date('2026-03-31T18:29:59.999Z');
      expect(getPeriodKey('monthly', 'fy_2025_26', instant2)).toBe('fy_2025_26:2026-03');
      expect(getPeriodKey('daily', 'fy_2025_26', instant2)).toBe('fy_2025_26:2026-03-31');
    });
  });

  describe('SPEC: IST Boundary Token Resolution', () => {
    it('resolves {DD}/{MM} on exact boundary of month rollover', () => {
      const beforeMidnight = new Date('2026-03-31T18:29:59.999Z');
      const atMidnight = new Date('2026-03-31T18:30:00.000Z');

      const resBefore = resolveInvoiceNumber('{DD}/{MM}/{SEQ:4}', {
        invoiceDate: beforeMidnight,
        fyLabel: '2025-26',
        sequenceValue: 1,
      });
      expect(resBefore).toBe('31/03/0001');

      const resAt = resolveInvoiceNumber('{DD}/{MM}/{SEQ:4}', {
        invoiceDate: atMidnight,
        fyLabel: '2026-27',
        sequenceValue: 1,
      });
      expect(resAt).toBe('01/04/0001');
    });

    it('resolves year rollover across calendar boundary in IST', () => {
      // 2025-12-31T18:30:00Z -> IST 2026-01-01 00:00:00
      const newYear = new Date('2025-12-31T18:30:00Z');
      const res = resolveInvoiceNumber('{YYYY}-{YY}-{SEQ:4}', {
        invoiceDate: newYear,
        fyLabel: '2025-26',
        sequenceValue: 1,
      });
      expect(res).toBe('2026-26-0001');
    });

    it('resolves century boundary for {YY}', () => {
      const year2099 = new Date('2099-06-15T12:00:00Z');
      const year2100 = new Date('2100-06-15T12:00:00Z');

      expect(resolveInvoiceNumber('{YY}-{SEQ:4}', { invoiceDate: year2099, fyLabel: '2099-00', sequenceValue: 1 })).toBe('99-0001');
      expect(resolveInvoiceNumber('{YY}-{SEQ:4}', { invoiceDate: year2100, fyLabel: '2100-01', sequenceValue: 1 })).toBe('00-0001');
    });
  });

  describe('SPEC / F-NUM-1: Sequence Counter Limitation', () => {
    it('SPEC F-NUM-1: resolveInvoiceNumber rejects non-positive or non-safe-integer sequences with RangeError', () => {
      const baseParams = {
        invoiceDate: new Date('2026-03-05T10:00:00Z'),
        fyLabel: '2025-26',
      };

      // Non-positive integers
      expect(() => resolveInvoiceNumber('{SEQ:4}', { ...baseParams, sequenceValue: -1 })).toThrow(RangeError);
      expect(() => resolveInvoiceNumber('{SEQ:4}', { ...baseParams, sequenceValue: 0 })).toThrow(RangeError);

      // Floats, NaN, and unsafe integers
      expect(() => resolveInvoiceNumber('{SEQ:4}', { ...baseParams, sequenceValue: 1.5 })).toThrow(RangeError);
      expect(() => resolveInvoiceNumber('{SEQ:4}', { ...baseParams, sequenceValue: NaN })).toThrow(RangeError);
      expect(() => resolveInvoiceNumber('{SEQ:4}', { ...baseParams, sequenceValue: Number.MAX_SAFE_INTEGER + 1 })).toThrow(RangeError);
    });

    it('F-NUM-1: resolveInvoiceNumber resolves valid sequences and allows overflow beyond width', () => {
      const baseParams = {
        invoiceDate: new Date('2026-03-05T10:00:00Z'),
        fyLabel: '2025-26',
      };

      // 1 and 99999 still resolve
      expect(resolveInvoiceNumber('INV/{SEQ:4}', { ...baseParams, sequenceValue: 1 })).toBe('INV/0001');
      expect(resolveInvoiceNumber('INV/{SEQ:4}', { ...baseParams, sequenceValue: 99999 })).toBe('INV/99999');

      // {SEQ:3} with 1000 gives "1000" (overflow allowed)
      expect(resolveInvoiceNumber('{SEQ:3}', { ...baseParams, sequenceValue: 1000 })).toBe('1000');
      expect(resolveInvoiceNumber('{SEQ:4}', { ...baseParams, sequenceValue: 10_000 })).toBe('10000');
    });
  });
});
