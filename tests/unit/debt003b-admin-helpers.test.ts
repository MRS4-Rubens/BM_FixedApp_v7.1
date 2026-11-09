import { describe, it, expect } from 'vitest';
import { getVisiblePageNumbers } from '@/app/(admin)/admin/admin-console/pagination';
import { buildRevenueChartData } from '@/app/(admin)/admin/admin-console/chart-data';
import { buildBusinessesCsv } from '@/app/(admin)/admin/admin-console/businesses-csv';
import type { BusinessItem } from '@/app/(admin)/admin/admin-console/types';

describe('debt003b-admin-helpers', () => {
  describe('getVisiblePageNumbers', () => {
    it('returns exact array for 1 page', () => {
      expect(getVisiblePageNumbers(1, 1)).toEqual([1]);
    });

    it('returns exact array for 5 pages', () => {
      expect(getVisiblePageNumbers(1, 5)).toEqual([1, 2, 3, 4, 5]);
      expect(getVisiblePageNumbers(3, 5)).toEqual([1, 2, 3, 4, 5]);
      expect(getVisiblePageNumbers(5, 5)).toEqual([1, 2, 3, 4, 5]);
    });

    it('returns exact array for 20 pages at start (<= 4)', () => {
      expect(getVisiblePageNumbers(1, 20)).toEqual([1, 2, 3, 4, 5, '...', 20]);
      expect(getVisiblePageNumbers(4, 20)).toEqual([1, 2, 3, 4, 5, '...', 20]);
    });

    it('returns exact array for 20 pages at middle', () => {
      expect(getVisiblePageNumbers(10, 20)).toEqual([1, '...', 9, 10, 11, '...', 20]);
    });

    it('returns exact array for 20 pages at end (>= total - 3)', () => {
      expect(getVisiblePageNumbers(17, 20)).toEqual([1, '...', 16, 17, 18, 19, 20]);
      expect(getVisiblePageNumbers(20, 20)).toEqual([1, '...', 16, 17, 18, 19, 20]);
    });
  });

  describe('buildRevenueChartData', () => {
    it('returns empty array when undefined or empty', () => {
      expect(buildRevenueChartData(undefined)).toEqual([]);
      expect(buildRevenueChartData([])).toEqual([]);
    });

    it('returns formatted points for several months', () => {
      const input = [
        { month: 'Jan 2026', revenuePaise: 150000, claimCount: 3 },
        { month: 'Feb 2026', revenuePaise: 250000, claimCount: 5 },
      ];
      expect(buildRevenueChartData(input)).toEqual([
        { name: 'Jan 2026', revenue: 1500, claims: 3 },
        { name: 'Feb 2026', revenue: 2500, claims: 5 },
      ]);
    });
  });

  describe('buildBusinessesCsv', () => {
    it('formats CSV with exact header row and handles quotes, commas, and null fields', () => {
      const row: BusinessItem = {
        id: 'biz-1',
        legalName: 'Acme, "Corp"',
        tradeName: null,
        gstin: '29ABCDE1234F1Z5',
        stateCode: '29',
        email: 'billing@acme.com',
        phone: null,
        subscriptionPlan: 'essentials',
        subscriptionStatus: 'active',
        subscriptionEndsAt: null,
        activeUtrNo: null,
        invoiceCount: 42,
        userCount: 2,
        createdAt: '2026-01-15T10:00:00Z',
      };

      const csv = buildBusinessesCsv([row]);
      const lines = csv.split('\n');

      expect(lines[0]).toBe(
        'Legal Name,Trade Name,GSTIN,Email,Phone,Plan,Status,Expires At,Invoices,Staff,Joined Date'
      );
      expect(lines[1]).toBe(
        '"Acme, ""Corp"""' +
          ',""' +
          ',"29ABCDE1234F1Z5"' +
          ',"billing@acme.com"' +
          ',""' +
          ',"essentials"' +
          ',"active"' +
          ',"N/A"' +
          ',42' +
          ',2' +
          ',"15/1/2026"'
      );
    });
  });
});
