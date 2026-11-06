import { afterEach, describe, expect, it } from 'vitest';
import {
  IST_OFFSET_MINUTES,
  formatIstDateAsIso,
  getIstDateParts,
  isValidIsoDate,
  parseIsoDateToIstDate,
} from '@/lib/invoices/ist-date';
import { mulberry32, randomInt } from '../helpers/prng';

describe('India Standard Time (IST) Date Engine (TEST-001)', () => {
  const originalTz = process.env.TZ;

  afterEach(() => {
    process.env.TZ = originalTz;
  });

  describe('SPEC: IST Offset & Canonical UTC Instants', () => {
    it('IST_OFFSET_MINUTES is permanently 330 (+5:30)', () => {
      expect(IST_OFFSET_MINUTES).toBe(330);
    });

    it('converts statutory calendar boundaries across UTC and IST', () => {
      // 1. 2026-01-01T00:00:00Z -> IST is 2026-01-01 05:30:00
      expect(formatIstDateAsIso(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01-01');

      // 2. 2025-12-31T18:29:59.999Z -> IST is 2025-12-31 23:59:59.999
      expect(formatIstDateAsIso(new Date('2025-12-31T18:29:59.999Z'))).toBe('2025-12-31');

      // 3. 2025-12-31T18:30:00.000Z -> IST is 2026-01-01 00:00:00.000
      expect(formatIstDateAsIso(new Date('2025-12-31T18:30:00.000Z'))).toBe('2026-01-01');

      // 4. Non-leap year: 2026-02-28T18:30:00Z -> IST is 2026-03-01 00:00:00
      expect(formatIstDateAsIso(new Date('2026-02-28T18:30:00Z'))).toBe('2026-03-01');

      // 5. Leap year: 2028-02-28T18:30:00Z -> IST is 2028-02-29 00:00:00 (leap day)
      expect(formatIstDateAsIso(new Date('2028-02-28T18:30:00Z'))).toBe('2028-02-29');

      // 6. Leap year post-leap: 2028-02-29T18:30:00Z -> IST is 2028-03-01 00:00:00
      expect(formatIstDateAsIso(new Date('2028-02-29T18:30:00Z'))).toBe('2028-03-01');
    });

    it('formatIstDateAsIso zero-pads single-digit month and day', () => {
      const date = new Date('2026-05-04T00:00:00Z'); // May 4 -> 2026-05-04 in IST
      expect(formatIstDateAsIso(date)).toBe('2026-05-04');
    });

    it('parseIsoDateToIstDate returns UTC midnight date object', () => {
      const parsed = parseIsoDateToIstDate('2026-03-31');
      expect(parsed.toISOString()).toBe('2026-03-31T00:00:00.000Z');
      expect(parsed.getUTCFullYear()).toBe(2026);
      expect(parsed.getUTCMonth()).toBe(2); // 0-indexed March is 2
      expect(parsed.getUTCDate()).toBe(31);
    });
  });

  describe('SPEC: isValidIsoDate Strict Calendar Validation', () => {
    it('accepts valid calendar dates', () => {
      expect(isValidIsoDate('2024-02-29')).toBe(true); // Leap day
      expect(isValidIsoDate('2026-12-31')).toBe(true);
      expect(isValidIsoDate('2026-01-01')).toBe(true);
    });

    it('rejects invalid calendar dates and malformed strings', () => {
      expect(isValidIsoDate('2026-02-29')).toBe(false); // 2026 is non-leap
      expect(isValidIsoDate('2026-02-31')).toBe(false);
      expect(isValidIsoDate('2026-13-01')).toBe(false);
      expect(isValidIsoDate('2026-00-10')).toBe(false);
      expect(isValidIsoDate('2026-04-31')).toBe(false); // April has 30 days
      expect(isValidIsoDate('2026-1-1')).toBe(false);   // Not padded
      expect(isValidIsoDate('26-01-01')).toBe(false);
      expect(isValidIsoDate('')).toBe(false);
      expect(isValidIsoDate('2026-01-01T00:00:00Z')).toBe(false);
      expect(isValidIsoDate('2026/01/01')).toBe(false);
    });
  });

  describe('PROP: Timezone Independence across 200 Instants', () => {
    it('computes identical IST date parts regardless of host process.env.TZ setting', () => {
      const targetZones = [
        'UTC',
        'Asia/Kolkata',
        'America/Los_Angeles',
        'Pacific/Kiritimati',
        'Pacific/Pago_Pago',
      ];

      const prng = mulberry32(777);
      const testInstants: Date[] = [];
      for (let i = 0; i < 200; i++) {
        // Random epoch between 2020 and 2030
        const ms = randomInt(prng, 1577836800000, 1893456000000);
        testInstants.push(new Date(ms));
      }

      // Baseline results under UTC
      process.env.TZ = 'UTC';
      const baselineResults = testInstants.map((d) => ({
        parts: getIstDateParts(d),
        iso: formatIstDateAsIso(d),
      }));

      for (const zone of targetZones) {
        process.env.TZ = zone;
        for (let i = 0; i < testInstants.length; i++) {
          const d = testInstants[i];
          const parts = getIstDateParts(d);
          const iso = formatIstDateAsIso(d);

          expect(parts).toEqual(baselineResults[i].parts);
          expect(iso).toBe(baselineResults[i].iso);
        }
      }
    });
  });

  describe('CHAR / F-IST-1: Invalid Date Input', () => {
    it('CHAR F-IST-1: getIstDateParts returns NaN on invalid Date', () => {
      const parts = getIstDateParts(new Date(NaN));
      expect(Number.isNaN(parts.year)).toBe(true);
      expect(Number.isNaN(parts.month)).toBe(true);
      expect(Number.isNaN(parts.day)).toBe(true);
    });
  });
});
