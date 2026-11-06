import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INVOICE_DISPLAY_PREFS,
  FIXED_ROWS_MAX,
  FIXED_ROWS_MIN,
  captureDisplayPrefsSnapshot,
  hasSavedDisplayPrefs,
  invoiceDisplayPrefsSchema,
  parseStoredDisplayPrefs,
  resolveDraftDisplayPrefs,
  resolveFinalizedDisplayPrefs,
} from '@/lib/invoices/display-prefs';
import { DEFAULT_GST_OPTIONS } from '@/lib/db/schema/_display_prefs';

describe('display-prefs pure logic (FE-001)', () => {
  it('exposes statutory default preferences', () => {
    expect(DEFAULT_INVOICE_DISPLAY_PREFS).toEqual({
      discEnabled: true,
      showHsn: true,
      showNextNo: true,
      showSignatory: true,
      enableFixedRows: true,
      fixedRowsCount: 13,
      defaultGst: '18',
    });
    expect(FIXED_ROWS_MIN).toBe(1);
    expect(FIXED_ROWS_MAX).toBe(50);
  });

  describe('parseStoredDisplayPrefs', () => {
    it('falls back entirely to defaults on null, undefined, or non-object primitives', () => {
      expect(parseStoredDisplayPrefs(null)).toEqual(DEFAULT_INVOICE_DISPLAY_PREFS);
      expect(parseStoredDisplayPrefs(undefined)).toEqual(DEFAULT_INVOICE_DISPLAY_PREFS);
      expect(parseStoredDisplayPrefs('invalid')).toEqual(DEFAULT_INVOICE_DISPLAY_PREFS);
      expect(parseStoredDisplayPrefs(12345)).toEqual(DEFAULT_INVOICE_DISPLAY_PREFS);
      expect(parseStoredDisplayPrefs(true)).toEqual(DEFAULT_INVOICE_DISPLAY_PREFS);
      expect(parseStoredDisplayPrefs([])).toEqual(DEFAULT_INVOICE_DISPLAY_PREFS);
      expect(parseStoredDisplayPrefs({})).toEqual(DEFAULT_INVOICE_DISPLAY_PREFS);
    });

    it('preserves valid fields and fills missing fields with defaults', () => {
      const partial = {
        showHsn: false,
        fixedRowsCount: 20,
      };
      const result = parseStoredDisplayPrefs(partial);
      expect(result).toEqual({
        discEnabled: true,
        showHsn: false,
        showNextNo: true,
        showSignatory: true,
        enableFixedRows: true,
        fixedRowsCount: 20,
        defaultGst: '18',
      });
    });

    it('falls back per-field when individual fields contain invalid types or values', () => {
      const corrupt = {
        discEnabled: 'true', // string, invalid
        showHsn: null,
        showNextNo: 1,
        showSignatory: false, // valid
        enableFixedRows: false, // valid
        fixedRowsCount: 999, // out of range [1, 50]
        defaultGst: '40', // not in DEFAULT_GST_OPTIONS
      };
      const result = parseStoredDisplayPrefs(corrupt);
      expect(result).toEqual({
        discEnabled: true,
        showHsn: true,
        showNextNo: true,
        showSignatory: false,
        enableFixedRows: false,
        fixedRowsCount: 13,
        defaultGst: '18',
      });
    });

    it('accepts boundary values for fixedRowsCount and all DEFAULT_GST_OPTIONS', () => {
      for (const gst of DEFAULT_GST_OPTIONS) {
        expect(parseStoredDisplayPrefs({ defaultGst: gst }).defaultGst).toBe(gst);
      }
      expect(parseStoredDisplayPrefs({ fixedRowsCount: 1 }).fixedRowsCount).toBe(1);
      expect(parseStoredDisplayPrefs({ fixedRowsCount: 50 }).fixedRowsCount).toBe(50);
      expect(parseStoredDisplayPrefs({ fixedRowsCount: 0 }).fixedRowsCount).toBe(13);
      expect(parseStoredDisplayPrefs({ fixedRowsCount: 51 }).fixedRowsCount).toBe(13);
    });

    it('is strictly idempotent: parse(parse(x)) === parse(x)', () => {
      const inputs: unknown[] = [
        null,
        {},
        { discEnabled: false, defaultGst: '12' },
        DEFAULT_INVOICE_DISPLAY_PREFS,
      ];
      for (const inp of inputs) {
        const once = parseStoredDisplayPrefs(inp);
        const twice = parseStoredDisplayPrefs(once);
        expect(twice).toEqual(once);
      }
    });
  });

  describe('hasSavedDisplayPrefs', () => {
    it('returns false for empty object or invalid values', () => {
      expect(hasSavedDisplayPrefs(null)).toBe(false);
      expect(hasSavedDisplayPrefs(undefined)).toBe(false);
      expect(hasSavedDisplayPrefs({})).toBe(false);
      expect(hasSavedDisplayPrefs([])).toBe(false);
      expect(hasSavedDisplayPrefs('{}')).toBe(false);
    });

    it('returns true when at least one property exists', () => {
      expect(hasSavedDisplayPrefs({ showHsn: true })).toBe(true);
      expect(hasSavedDisplayPrefs({ discEnabled: false })).toBe(true);
    });
  });

  describe('captureDisplayPrefsSnapshot & resolvers', () => {
    it('captureDisplayPrefsSnapshot always returns a full normalized object', () => {
      expect(captureDisplayPrefsSnapshot({})).toEqual(DEFAULT_INVOICE_DISPLAY_PREFS);
      expect(captureDisplayPrefsSnapshot({ showHsn: false })).toEqual({
        ...DEFAULT_INVOICE_DISPLAY_PREFS,
        showHsn: false,
      });
    });

    it('resolveFinalizedDisplayPrefs returns defaults for null legacy snapshot', () => {
      expect(resolveFinalizedDisplayPrefs(null)).toEqual(DEFAULT_INVOICE_DISPLAY_PREFS);
      expect(resolveFinalizedDisplayPrefs(undefined)).toEqual(DEFAULT_INVOICE_DISPLAY_PREFS);
    });

    it('resolveFinalizedDisplayPrefs preserves existing snapshot', () => {
      const snap = {
        ...DEFAULT_INVOICE_DISPLAY_PREFS,
        discEnabled: false,
        fixedRowsCount: 25,
      };
      expect(resolveFinalizedDisplayPrefs(snap)).toEqual(snap);
    });

    it('resolveDraftDisplayPrefs resolves account preferences', () => {
      expect(resolveDraftDisplayPrefs({ defaultGst: '5' })).toEqual({
        ...DEFAULT_INVOICE_DISPLAY_PREFS,
        defaultGst: '5',
      });
    });
  });

  describe('invoiceDisplayPrefsSchema (Zod write validation)', () => {
    it('parses valid complete display preferences', () => {
      const parsed = invoiceDisplayPrefsSchema.safeParse(DEFAULT_INVOICE_DISPLAY_PREFS);
      expect(parsed.success).toBe(true);
    });

    it('rejects unrecognized keys (strictObject)', () => {
      const withExtra = {
        ...DEFAULT_INVOICE_DISPLAY_PREFS,
        extraKey: true,
      };
      const result = invoiceDisplayPrefsSchema.safeParse(withExtra);
      expect(result.success).toBe(false);
    });

    it('rejects out of range fixedRowsCount or invalid defaultGst', () => {
      expect(
        invoiceDisplayPrefsSchema.safeParse({
          ...DEFAULT_INVOICE_DISPLAY_PREFS,
          fixedRowsCount: 0,
        }).success,
      ).toBe(false);

      expect(
        invoiceDisplayPrefsSchema.safeParse({
          ...DEFAULT_INVOICE_DISPLAY_PREFS,
          fixedRowsCount: 51,
        }).success,
      ).toBe(false);

      expect(
        invoiceDisplayPrefsSchema.safeParse({
          ...DEFAULT_INVOICE_DISPLAY_PREFS,
          defaultGst: '33',
        }).success,
      ).toBe(false);
    });
  });
});

