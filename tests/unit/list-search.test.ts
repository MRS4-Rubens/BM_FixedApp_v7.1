import { describe, expect, it } from 'vitest';
import {
  buildContainsPattern,
  buildPrefixPattern,
  escapeLikeLiteral,
  normalizeSearchTerm,
} from '@/lib/pagination/search';
import { buildListHref, readFirst } from '@/lib/pagination/url';

describe('list search and URL utilities (PERF-001)', () => {
  describe('normalizeSearchTerm', () => {
    it('trims leading/trailing and collapses internal whitespace', () => {
      expect(normalizeSearchTerm('   hello    world   ')).toBe('hello world');
      expect(normalizeSearchTerm('Acme\t\nCorporation')).toBe('Acme Corporation');
    });

    it('returns null for empty or whitespace-only strings', () => {
      expect(normalizeSearchTerm(null)).toBeNull();
      expect(normalizeSearchTerm(undefined)).toBeNull();
      expect(normalizeSearchTerm('')).toBeNull();
      expect(normalizeSearchTerm('   \n\t  ')).toBeNull();
    });

    it('caps strings exceeding MAX_SEARCH_LENGTH (100 chars)', () => {
      const longString = 'a'.repeat(150);
      const normalized = normalizeSearchTerm(longString);
      expect(normalized?.length).toBe(100);
    });
  });

  describe('escapeLikeLiteral', () => {
    it('escapes %, _, and \\ with backslashes', () => {
      expect(escapeLikeLiteral('100%')).toBe('100\\%');
      expect(escapeLikeLiteral('invoice_123')).toBe('invoice\\_123');
      expect(escapeLikeLiteral('c:\\path\\file')).toBe('c:\\\\path\\\\file');
      expect(escapeLikeLiteral('10%_discount\\tax')).toBe('10\\%\\_discount\\\\tax');
    });

    it('preserves unicode characters, emojis, and plain text untouched', () => {
      expect(escapeLikeLiteral('Acme Enterprises')).toBe('Acme Enterprises');
      expect(escapeLikeLiteral('भारतीय स्टेट बैंक')).toBe('भारतीय स्टेट बैंक');
      expect(escapeLikeLiteral('Invoice #42 🧾')).toBe('Invoice #42 🧾');
    });

    it('builds contains and prefix patterns correctly', () => {
      expect(buildContainsPattern('50%')).toBe('%50\\%%');
      expect(buildPrefixPattern('INV_')).toBe('INV\\_%');
    });
  });

  describe('buildListHref', () => {
    it('drops null, undefined, and empty string params', () => {
      const href = buildListHref('/invoices', {
        month: 11,
        year: 2026,
        q: '',
        status: null,
        after: undefined,
      });
      expect(href).toBe('/invoices?month=11&year=2026');
    });

    it('sorts query keys deterministically', () => {
      const href = buildListHref('/customers', {
        z: 'last',
        a: 'first',
        m: 'middle',
      });
      expect(href).toBe('/customers?a=first&m=middle&z=last');
    });

    it('properly URL-encodes special characters', () => {
      const href = buildListHref('/invoices', {
        q: 'Acme & Sons / 100%',
      });
      expect(href).toBe('/invoices?q=Acme+%26+Sons+%2F+100%25');
    });

    it('returns basePath when all params are empty', () => {
      expect(buildListHref('/invoices', {})).toBe('/invoices');
      expect(buildListHref('/invoices', { q: '', status: null })).toBe('/invoices');
    });
  });

  describe('readFirst', () => {
    it('extracts first item if array or returns scalar', () => {
      expect(readFirst(['first', 'second'])).toBe('first');
      expect(readFirst('scalar')).toBe('scalar');
      expect(readFirst(undefined)).toBeUndefined();
    });
  });
});

