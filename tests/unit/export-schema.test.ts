import { describe, expect, it } from 'vitest';
import { exportRangeSchema, exportQuerySchema } from '@/lib/validations/export';

describe('lib/validations/export', () => {
  describe('exportRangeSchema', () => {
    it('accepts valid date ranges within 366 days', () => {
      const result = exportRangeSchema.safeParse({
        startDate: '2024-01-01',
        endDate: '2024-12-31', // 366 days (leap year)
        label: 'FY 2024-25',
      });
      expect(result.success).toBe(true);
    });

    it('accepts same-day date ranges', () => {
      const result = exportRangeSchema.safeParse({
        startDate: '2026-11-02',
        endDate: '2026-11-02',
        label: 'Daily',
      });
      expect(result.success).toBe(true);
    });

    it('rejects date range exceeding 366 days', () => {
      const result = exportRangeSchema.safeParse({
        startDate: '2024-01-01',
        endDate: '2025-01-02', // 368 days
        label: 'Too long',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const hasRangeIssue = result.error.issues.some((i) =>
          typeof i.message === 'string' && i.message.includes('366 days')
        );
        expect(hasRangeIssue).toBe(true);
      }
    });

    it('rejects startDate after endDate', () => {
      const result = exportRangeSchema.safeParse({
        startDate: '2026-12-01',
        endDate: '2026-11-01',
        label: 'Inverted',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const hasOrderIssue = result.error.issues.some((i) =>
          typeof i.message === 'string' && i.message.includes('cannot be before start date')
        );
        expect(hasOrderIssue).toBe(true);
      }
    });

    it('validates label constraints', () => {
      expect(
        exportRangeSchema.safeParse({
          startDate: '2026-11-01',
          endDate: '2026-11-02',
          label: '',
        }).success
      ).toBe(false);

      expect(
        exportRangeSchema.safeParse({
          startDate: '2026-11-01',
          endDate: '2026-11-02',
          label: '   ',
        }).success
      ).toBe(false);

      expect(
        exportRangeSchema.safeParse({
          startDate: '2026-11-01',
          endDate: '2026-11-02',
          label: 'A'.repeat(101),
        }).success
      ).toBe(false);
    });
  });

  describe('exportQuerySchema', () => {
    it('defaults type to sales_register when type is omitted', () => {
      const result = exportQuerySchema.safeParse({
        startDate: '2026-11-01',
        endDate: '2026-11-02',
        label: 'November',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('sales_register');
      }
    });

    it('accepts valid report types', () => {
      const types = ['sales_register', 'gstr1', 'itr_report', 'hsn_summary'] as const;
      for (const t of types) {
        const result = exportQuerySchema.safeParse({
          startDate: '2026-11-01',
          endDate: '2026-11-02',
          label: 'November',
          type: t,
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.type).toBe(t);
        }
      }
    });

    it('rejects unsupported report types', () => {
      const result = exportQuerySchema.safeParse({
        startDate: '2026-11-01',
        endDate: '2026-11-02',
        label: 'November',
        type: 'invalid_type',
      });
      expect(result.success).toBe(false);
    });
  });
});
