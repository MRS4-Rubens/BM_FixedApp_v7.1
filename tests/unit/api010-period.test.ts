import { describe, expect, it } from 'vitest';
import { getMonthRangeForIsoDate } from '@/lib/reports/period';

describe('API-010: getMonthRangeForIsoDate', () => {
  it('returns January range for 2026-01-31', () => {
    const range = getMonthRangeForIsoDate('2026-01-31');
    expect(range.startDate).toBe('2026-01-01');
    expect(range.endDate).toBe('2026-01-31');
    expect(range.label).toBe('January 2026');
  });

  it('returns February leap range (29 days) for 2028-02-10', () => {
    const range = getMonthRangeForIsoDate('2028-02-10');
    expect(range.startDate).toBe('2028-02-01');
    expect(range.endDate).toBe('2028-02-29');
    expect(range.label).toBe('February 2028');
  });

  it('returns December range for 2026-12-01', () => {
    const range = getMonthRangeForIsoDate('2026-12-01');
    expect(range.startDate).toBe('2026-12-01');
    expect(range.endDate).toBe('2026-12-31');
    expect(range.label).toBe('December 2026');
  });

  it('throws RangeError on malformed inputs', () => {
    expect(() => getMonthRangeForIsoDate('2026-13-01')).toThrowError(RangeError);
    expect(() => getMonthRangeForIsoDate('2026-02-3')).toThrowError(RangeError);
    expect(() => getMonthRangeForIsoDate('')).toThrowError(RangeError);
    expect(() => getMonthRangeForIsoDate('not-a-date')).toThrowError(RangeError);
    expect(() => getMonthRangeForIsoDate('2026-02-31')).toThrowError(RangeError);
  });
});

