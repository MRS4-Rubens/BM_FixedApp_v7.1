import { sql, type AnyColumn, type SQL } from 'drizzle-orm';

// Literals are developer-defined constants, never user input. The pattern is a defence-in-depth guard so a
// future edit can never smuggle a quote or SQL fragment into a CHECK definition.
const SAFE_LITERAL = /^[a-z][a-z0-9_]*$/;

/** Builds: <column> IN ('a', 'b', ...) for a CHECK constraint. */
export function inList(column: AnyColumn, values: readonly string[]): SQL {
  if (values.length === 0) {
    throw new Error('inList requires at least one allowed value.');
  }
  for (const value of values) {
    if (!SAFE_LITERAL.test(value)) {
      throw new Error(`Unsafe literal in CHECK constraint definition: "${value}"`);
    }
  }
  return sql`${column} IN (${sql.raw(values.map((value) => `'${value}'`).join(', '))})`;
}

