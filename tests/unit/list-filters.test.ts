import { describe, expect, it } from 'vitest';
import {
  buildDisplayStatusCondition,
  defaultListPeriod,
  resolveListPeriod,
} from '@/lib/invoices/list-filters';

describe('list filters & period resolution (PERF-001)', () => {
  it('resolves normal 31-day months (e.g. December, March)', () => {
    const dec = resolveListPeriod({ month: 12, year: 2026 });
    expect(dec.startDate).toBe('2026-12-01');
    expect(dec.endDate).toBe('2026-12-31');

    const mar = resolveListPeriod({ month: 3, year: 2026 });
    expect(mar.startDate).toBe('2026-03-01');
    expect(mar.endDate).toBe('2026-03-31');
  });

  it('resolves normal 30-day months (e.g. April, November)', () => {
    const nov = resolveListPeriod({ month: 11, year: 2026 });
    expect(nov.startDate).toBe('2026-11-01');
    expect(nov.endDate).toBe('2026-11-30');
  });

  it('resolves February in leap and non-leap years correctly', () => {
    // 2024 is leap year (29 days)
    const feb2024 = resolveListPeriod({ month: 2, year: 2024 });
    expect(feb2024.startDate).toBe('2024-02-01');
    expect(feb2024.endDate).toBe('2024-02-29');

    // 2025 is non-leap year (28 days)
    const feb2025 = resolveListPeriod({ month: 2, year: 2025 });
    expect(feb2025.startDate).toBe('2025-02-01');
    expect(feb2025.endDate).toBe('2025-02-28');
  });

  it('determines isCurrentMonth using IST timezone', () => {
    // UTC 2026-11-30 20:00:00 -> IST 2026-12-01 01:30:00 (already December in IST!)
    const nearMidnightUtc = new Date('2026-11-30T20:00:00.000Z');

    const decPeriod = resolveListPeriod({ month: 12, year: 2026 }, nearMidnightUtc);
    expect(decPeriod.isCurrentMonth).toBe(true);

    const novPeriod = resolveListPeriod({ month: 11, year: 2026 }, nearMidnightUtc);
    expect(novPeriod.isCurrentMonth).toBe(false);
  });

  it('provides current IST default period', () => {
    const fixedNow = new Date('2026-08-15T12:00:00.000Z');
    const period = defaultListPeriod(fixedNow);
    expect(period).toEqual({ month: 8, year: 2026 });
  });

  it('builds display status conditions for all defined statuses', () => {
    const today = '2026-11-05';
    expect(buildDisplayStatusCondition('all', today)).toBeUndefined();
    expect(buildDisplayStatusCondition('draft', today)).toBeDefined();
    expect(buildDisplayStatusCondition('paid', today)).toBeDefined();
    expect(buildDisplayStatusCondition('overdue', today)).toBeDefined();
    expect(buildDisplayStatusCondition('partially_paid', today)).toBeDefined();
    expect(buildDisplayStatusCondition('sent', today)).toBeDefined();
  });
});

