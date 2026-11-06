import { afterEach, describe, expect, it } from 'vitest';
import {
  getIndianFinancialYearForDate,
  getCurrentFinancialYearLabel,
  isCurrentFinancialYearLabel,
} from '@/lib/invoices/financial-year';
import { mulberry32, randomInt } from '../helpers/prng';

describe('Indian Financial Year Engine (TEST-001)', () => {
  const originalTz = process.env.TZ;

  afterEach(() => {
    process.env.TZ = originalTz;
  });

  describe('SPEC: Canonical Rollover Boundaries & UTC Traps', () => {
    it('resolves exact millisecond boundary between financial years', () => {
      // 2026-03-31T18:29:59.999Z -> IST 31 March 2026 23:59:59.999 -> FY 2025-26
      const lastMomentOfFy = new Date('2026-03-31T18:29:59.999Z');
      const fyOld = getIndianFinancialYearForDate(lastMomentOfFy);
      expect(fyOld.label).toBe('2025-26');
      expect(fyOld.startDate.toISOString()).toBe('2025-04-01T00:00:00.000Z');
      expect(fyOld.endDate.toISOString()).toBe('2026-03-31T00:00:00.000Z');

      // 2026-03-31T18:30:00.000Z -> IST 1 April 2026 00:00:00.000 -> FY 2026-27
      const firstMomentOfFy = new Date('2026-03-31T18:30:00.000Z');
      const fyNew = getIndianFinancialYearForDate(firstMomentOfFy);
      expect(fyNew.label).toBe('2026-27');
      expect(fyNew.startDate.toISOString()).toBe('2026-04-01T00:00:00.000Z');
      expect(fyNew.endDate.toISOString()).toBe('2027-03-31T00:00:00.000Z');
    });

    it('correctly classifies UTC trap instants into new financial year', () => {
      // UTC date says 31 March, but IST is 1 April 05:29:59
      const utcTrap1 = new Date('2026-03-31T23:59:59Z');
      expect(getIndianFinancialYearForDate(utcTrap1).label).toBe('2026-27');

      // UTC 1 April midnight -> IST 1 April 05:30:00
      const utcTrap2 = new Date('2026-04-01T00:00:00Z');
      expect(getIndianFinancialYearForDate(utcTrap2).label).toBe('2026-27');

      // Mid-day 1 April in UTC
      const utcTrap3 = new Date('2026-04-01T18:29:59Z');
      expect(getIndianFinancialYearForDate(utcTrap3).label).toBe('2026-27');
    });

    it('correctly evaluates mid-year and successive fiscal year boundaries', () => {
      // Mid-year January (Q4 of FY 2026-27)
      const midYear = new Date('2027-01-15T12:00:00Z');
      expect(getIndianFinancialYearForDate(midYear).label).toBe('2026-27');

      // End of FY 2026-27 boundary
      const endFy26 = new Date('2027-03-31T18:29:59.999Z');
      expect(getIndianFinancialYearForDate(endFy26).label).toBe('2026-27');

      // Start of FY 2027-28 boundary
      const startFy27 = new Date('2027-03-31T18:30:00Z');
      expect(getIndianFinancialYearForDate(startFy27).label).toBe('2027-28');
    });

    it('resolves century boundary labels and leap-year financial years', () => {
      // Century edge: 2099-00
      const centuryEdge = new Date('2099-07-01T12:00:00Z');
      expect(getIndianFinancialYearForDate(centuryEdge).label).toBe('2099-00');

      // Leap year FY 2023-24 containing 29 Feb 2024
      const leapDay = new Date('2024-02-29T12:00:00Z');
      expect(getIndianFinancialYearForDate(leapDay).label).toBe('2023-24');
    });
  });

  describe('PROP: Monotonicity & Invariants across 3,000 Instants (2017-2040)', () => {
    it('preserves start <= IST date <= end and monotonic year ordering', () => {
      const prng = mulberry32(10101);
      // Start from GST inception 2017-07-01 to 2040-12-31
      const startEpoch = new Date('2017-07-01T00:00:00Z').getTime();
      const endEpoch = new Date('2040-12-31T23:59:59Z').getTime();

      const instants: Date[] = [];
      for (let i = 0; i < 3000; i++) {
        instants.push(new Date(randomInt(prng, startEpoch, endEpoch)));
      }
      instants.sort((a, b) => a.getTime() - b.getTime());

      let previousStartYear = 2017;

      for (const d of instants) {
        const fy = getIndianFinancialYearForDate(d);
        const startYear = parseInt(fy.label.slice(0, 4), 10);
        const endYearShort = fy.label.slice(5);

        // Monotonic non-decreasing startYear
        expect(startYear).toBeGreaterThanOrEqual(previousStartYear);
        previousStartYear = startYear;

        // Label structure
        const expectedEndYearShort = String(startYear + 1).slice(-2);
        expect(endYearShort).toBe(expectedEndYearShort);

        // Start date is April 1 UTC, End date is March 31 UTC
        expect(fy.startDate.getUTCMonth()).toBe(3); // April
        expect(fy.startDate.getUTCDate()).toBe(1);
        expect(fy.endDate.getUTCMonth()).toBe(2); // March
        expect(fy.endDate.getUTCDate()).toBe(31);
      }
    });
  });

  describe('PROP: Timezone Independence across Process Environments', () => {
    it('produces identical results under UTC, America/Los_Angeles, and Asia/Kolkata', () => {
      const keyInstants = [
        new Date('2026-03-31T18:29:59.999Z'),
        new Date('2026-03-31T18:30:00.000Z'),
        new Date('2026-04-01T00:00:00Z'),
        new Date('2026-10-15T12:00:00Z'),
        new Date('2027-01-01T00:00:00Z'),
      ];

      process.env.TZ = 'UTC';
      const baseline = keyInstants.map((d) => getIndianFinancialYearForDate(d));

      for (const zone of ['America/Los_Angeles', 'Asia/Kolkata']) {
        process.env.TZ = zone;
        for (let i = 0; i < keyInstants.length; i++) {
          const res = getIndianFinancialYearForDate(keyInstants[i]);
          expect(res.label).toBe(baseline[i].label);
          expect(res.startDate.toISOString()).toBe(baseline[i].startDate.toISOString());
          expect(res.endDate.toISOString()).toBe(baseline[i].endDate.toISOString());
        }
      }
    });
  });

  describe('SPEC DB-008: current FY is computed from IST date', () => {
    it('computes current FY label at exact boundary milliseconds', () => {
      expect(getCurrentFinancialYearLabel(new Date('2027-03-31T18:29:59.999Z'))).toBe('2026-27');
      expect(getCurrentFinancialYearLabel(new Date('2027-03-31T18:30:00.000Z'))).toBe('2027-28');
    });

    it('matches current FY label with or without FY prefix and rejects prior years', () => {
      const fixedDate = new Date('2026-11-06T06:00:00Z');
      expect(isCurrentFinancialYearLabel('2026-27', fixedDate)).toBe(true);
      expect(isCurrentFinancialYearLabel('FY 2026-27', fixedDate)).toBe(true);
      expect(isCurrentFinancialYearLabel('2025-26', fixedDate)).toBe(false);
    });

    it('supports default arguments for runtime system time', () => {
      expect(isCurrentFinancialYearLabel(getCurrentFinancialYearLabel())).toBe(true);
    });
  });
});
