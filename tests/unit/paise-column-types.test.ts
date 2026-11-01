import { is } from 'drizzle-orm';
import { PgTable, getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import * as schema from '@/lib/db/schema';

// Columns that are intentionally 32-bit. Adding to this list requires a written reason.
const INTENTIONALLY_INTEGER: ReadonlyMap<string, string> = new Map([
  ['products.default_sale_price_paise', 'Zod-capped at INR 99,99,999.99 = 999,999,999 paise < 2^31'],
  ['subscription_requests.amount_paise', 'Plan prices are at most a few thousand rupees'],
]);

describe('DB-003 paise column types', () => {
  it('every *_paise column is bigint(number) unless explicitly allow-listed', () => {
    const offenders: string[] = [];
    for (const value of Object.values(schema)) {
      if (!is(value, PgTable)) continue;
      const config = getTableConfig(value);
      for (const column of config.columns) {
        if (!column.name.endsWith('_paise')) continue;
        const key = `${config.name}.${column.name}`;
        if (INTENTIONALLY_INTEGER.has(key)) continue;
        if (column.columnType !== 'PgBigInt53') {
          offenders.push(`${key} (${column.columnType})`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('allow-listed columns are still genuinely integer (stale allow-list guard)', () => {
    const verifiedColumns = new Set<string>();

    for (const value of Object.values(schema)) {
      if (!is(value, PgTable)) continue;
      const config = getTableConfig(value);
      for (const column of config.columns) {
        const key = `${config.name}.${column.name}`;
        if (INTENTIONALLY_INTEGER.has(key)) {
          expect(column.columnType).toBe('PgInteger');
          verifiedColumns.add(key);
        }
      }
    }

    expect(verifiedColumns.size).toBe(INTENTIONALLY_INTEGER.size);
    for (const key of INTENTIONALLY_INTEGER.keys()) {
      expect(verifiedColumns.has(key)).toBe(true);
    }
  });
});

