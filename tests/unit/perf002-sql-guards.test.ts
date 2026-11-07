import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * PERF-002 guard: no correlated subquery inside a Drizzle `sql` template may reference columns via `${table.column}`.
 *
 * Drizzle renders a column reference in a select WITHOUT its table name (e.g. "id", "business_id"). Inside a raw
 * `(select ... where x = ${invoices.id})` the bare name binds to the INNER table, silently breaking the correlation.
 * This bug made the dashboard ignore every payment/credit note and the admin directory show 0 invoices/users.
 * Use pre-grouped derived tables (db.select(...).groupBy(...).as('alias') + leftJoin) or explicit SQL aliases.
 */

const ROOTS = ['lib', 'app'];

function collect(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return collect(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

/** Contents of every sql`...` tagged template in the source (no nesting of backticks inside them in this codebase). */
function sqlTemplates(source: string): string[] {
  const out: string[] = [];
  const re = /\bsql(?:<[^>]*>)?`([^`]*)`/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) out.push(match[1]);
  return out;
}

export function findCorrelatedColumnSubqueries(source: string): string[] {
  return sqlTemplates(source).filter(
    (body) => /\(\s*select\b/i.test(body) && /\$\{\s*[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*\s*\}/.test(body),
  );
}

describe('PERF-002: no table-column interpolation inside raw SQL subqueries', () => {
  it('detects the broken pattern (self-test)', () => {
    const bad = 'sql`(select count(*) from ${invoices} where ${invoices.business_id} = ${businesses.id})`';
    const ok = 'sql`coalesce(${invoiceCounts.count}, 0)::int`';
    const okSubquery = 'sql`SELECT x FROM (SELECT 1 WHERE business_id = ${businessId}) t`';
    expect(findCorrelatedColumnSubqueries(bad)).toHaveLength(1);
    expect(findCorrelatedColumnSubqueries(ok)).toHaveLength(0);
    expect(findCorrelatedColumnSubqueries(okSubquery)).toHaveLength(0);
  });

  it('has no occurrences in lib/ or app/', () => {
    const offenders = ROOTS.flatMap((root) => collect(root))
      .filter((file) => findCorrelatedColumnSubqueries(readFileSync(file, 'utf8')).length > 0)
      .map((file) => relative(process.cwd(), file).replace(/\\/g, '/'));
    expect(offenders).toEqual([]);
  });
});
