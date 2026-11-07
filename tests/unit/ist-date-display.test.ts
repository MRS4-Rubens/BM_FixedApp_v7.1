import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatIstDate, formatIstTime } from '@/lib/invoices/ist-date';

describe('formatIstDate / formatIstTime (FE-002 hydration-safe display dates)', () => {
  // 20:06 UTC on 6 Nov is 01:36 IST on 7 Nov: the case that printed different days on server (UTC) and browser.
  const lateUtc = new Date('2026-11-06T20:06:00.000Z');

  it('uses the India calendar day regardless of the machine time zone', () => {
    expect(formatIstDate(lateUtc)).toBe('7/11/2026');
    expect(formatIstDate(lateUtc.toISOString())).toBe('7/11/2026');
    expect(formatIstDate(lateUtc.getTime())).toBe('7/11/2026');
  });

  it('keeps the en-IN default and option formats', () => {
    expect(formatIstDate('2026-11-07', { day: '2-digit', month: 'short', year: 'numeric' })).toBe('07 Nov 2026');
    expect(formatIstDate(lateUtc, { day: '2-digit', month: 'short' })).toBe('07 Nov');
  });

  it('date-only values (UTC midnight) stay on the same calendar day', () => {
    expect(formatIstDate('2026-04-01')).toBe('1/4/2026');
  });

  it('formats the time of day in IST', () => {
    expect(formatIstTime(lateUtc).toLowerCase()).toBe('01:36 am');
  });
});

describe('no time-zone-dependent date formatting in rendered code', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) return walk(full);
      return /\.tsx?$/.test(name) ? [full] : [];
    });
  const files = ['app', 'components'].flatMap((root) => walk(root));

  it('uses formatIstDate/formatIstTime instead of toLocaleDateString/toLocaleTimeString', () => {
    const offenders = files
      .filter((file) => /\.toLocale(Date|Time)String\(/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(process.cwd(), file).replace(/\\/g, '/'));
    expect(offenders).toEqual([]);
  });
});
