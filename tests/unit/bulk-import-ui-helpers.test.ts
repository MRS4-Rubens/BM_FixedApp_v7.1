import { describe, it, expect } from 'vitest';
import { IMPORT_MAX_BYTES } from '@/lib/import/columns';
import {
  validateImportFileMeta,
  fileToBase64,
  filterRows,
  importButtonLabel,
} from '@/components/app/import/bulk-import-helpers';

describe('bulk-import-ui-helpers', () => {
  describe('validateImportFileMeta', () => {
    it('accepts .xlsx and uppercase .CSV extensions', () => {
      expect(validateImportFileMeta('customers.xlsx', 1024)).toEqual({ ok: true });
      expect(validateImportFileMeta('PRODUCTS.CSV', 500)).toEqual({ ok: true });
    });

    it('refuses legacy .xls and text .txt files', () => {
      expect(validateImportFileMeta('data.xls', 1024)).toEqual({
        ok: false,
        message: 'Choose an Excel (.xlsx) or CSV (.csv) file.',
      });
      expect(validateImportFileMeta('list.txt', 1024)).toEqual({
        ok: false,
        message: 'Choose an Excel (.xlsx) or CSV (.csv) file.',
      });
    });

    it('refuses 0 byte empty files', () => {
      expect(validateImportFileMeta('empty.csv', 0)).toEqual({
        ok: false,
        message: 'The file is empty.',
      });
    });

    it('accepts exactly 2 MB files and refuses 2 MB + 1 byte', () => {
      expect(validateImportFileMeta('valid.xlsx', IMPORT_MAX_BYTES)).toEqual({ ok: true });
      expect(validateImportFileMeta('large.xlsx', IMPORT_MAX_BYTES + 1)).toEqual({
        ok: false,
        message: 'The file is larger than 2 MB. Split it into smaller files.',
      });
    });
  });

  describe('fileToBase64', () => {
    it('correctly encodes small and large (>100 KB) files to base64', async () => {
      // Small file
      const smallBytes = new TextEncoder().encode('Name,GSTIN\nAcme,29ABCDE1234F1ZW\n');
      const smallFile = new File([smallBytes], 'small.csv', { type: 'text/csv' });
      const smallB64 = await fileToBase64(smallFile);
      const decodedSmall = Buffer.from(smallB64, 'base64');
      expect(decodedSmall.toString('utf-8')).toBe('Name,GSTIN\nAcme,29ABCDE1234F1ZW\n');

      // Large file > 100 KB
      const largeSize = 150 * 1024;
      const largeBytes = new Uint8Array(largeSize);
      for (let i = 0; i < largeSize; i++) {
        largeBytes[i] = i % 256;
      }
      const largeFile = new File([largeBytes], 'large.csv', { type: 'text/csv' });
      const largeB64 = await fileToBase64(largeFile);
      const decodedLarge = Buffer.from(largeB64, 'base64');
      expect(Buffer.compare(Buffer.from(largeBytes), decodedLarge)).toBe(0);
    });
  });

  describe('filterRows', () => {
    const sampleRows = [
      { id: 1, status: 'ready' as const },
      { id: 2, status: 'duplicate' as const },
      { id: 3, status: 'error' as const },
      { id: 4, status: 'ready' as const },
    ];

    it('returns all rows for filter "all"', () => {
      expect(filterRows(sampleRows, 'all')).toEqual(sampleRows);
    });

    it('filters rows matching ready, duplicate, and error', () => {
      expect(filterRows(sampleRows, 'ready')).toEqual([
        { id: 1, status: 'ready' },
        { id: 4, status: 'ready' },
      ]);
      expect(filterRows(sampleRows, 'duplicate')).toEqual([{ id: 2, status: 'duplicate' }]);
      expect(filterRows(sampleRows, 'error')).toEqual([{ id: 3, status: 'error' }]);
    });
  });

  describe('importButtonLabel', () => {
    it('returns "Nothing to import" when ready is 0', () => {
      expect(importButtonLabel('customers', 0)).toBe('Nothing to import');
      expect(importButtonLabel('products', 0)).toBe('Nothing to import');
    });

    it('returns singular form for 1 item', () => {
      expect(importButtonLabel('customers', 1)).toBe('Import 1 customer');
      expect(importButtonLabel('products', 1)).toBe('Import 1 product');
    });

    it('returns plural form for multiple items', () => {
      expect(importButtonLabel('customers', 12)).toBe('Import 12 customers');
      expect(importButtonLabel('products', 3)).toBe('Import 3 products');
    });
  });
});
