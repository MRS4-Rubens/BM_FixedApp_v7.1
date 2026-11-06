import { describe, expect, it } from 'vitest';
import { bigintPaise } from '@/e2e/support/db';

describe('bigintPaise (E2E DB assertions on BIGINT money columns)', () => {
  it('parses the string form Postgres returns for BIGINT and SUM(BIGINT)', () => {
    expect(bigintPaise.parse('240000')).toBe(240000);
    expect(bigintPaise.parse('-150')).toBe(-150);
    expect(bigintPaise.parse(42)).toBe(42);
  });

  it.each(['12.5', '', 'abc', '1e3', 12.5, '9007199254740993'])('rejects %s', (value) => {
    expect(bigintPaise.safeParse(value).success).toBe(false);
  });
});
