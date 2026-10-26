import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Static regression guard for API-001 (tenant isolation).
 *
 * Customers and products are referenced by id from many places. Every by-id lookup and every join of these two
 * tables MUST be scoped by business_id, otherwise one business can read (or be linked to) another business's rows.
 * This guard scans the source tree so that a new unscoped query fails CI instead of becoming a data leak.
 *
 * Rule 1: every `eq(customers.id, ...)` / `eq(products.id, ...)` must sit inside a call (normally `and(...)`) that also
 *         contains `business_id`.
 * Rule 2: every join of `customers` / `products` must contain `business_id` inside the join call itself (its ON condition).
 * Invoices, payments and credit notes are verified by an explicit business_id check right after the lookup and are
 * covered by the integration tests instead.
 */

const BY_ID_LOOKUP = /\beq\(\s*(?:customers|products)\.id\b/g;
const JOIN_OF_TENANT_TABLE = /\.(?:left|inner|right|full)?[Jj]oin\(\s*(?:customers|products)\b/g;

/** Returns the text of the parenthesised call that starts at `openIndex` (an opening parenthesis). */
function balancedFrom(source: string, openIndex: number): string {
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    const char = source[i];
    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openIndex, i + 1);
      }
    }
  }
  return source.slice(openIndex);
}

/** Returns the text of the innermost call that CONTAINS `position` (e.g. the `and(...)` or `.where(...)` around it). */
function enclosingCallText(source: string, position: number): string {
  let depth = 0;
  for (let i = position - 1; i >= 0; i -= 1) {
    const char = source[i];
    if (char === ')') {
      depth += 1;
    } else if (char === '(') {
      if (depth === 0) {
        return balancedFrom(source, i);
      }
      depth -= 1;
    }
  }
  return '';
}

function lineNumberAt(source: string, position: number): number {
  return source.slice(0, position).split('\n').length;
}

export function findTenantScopingViolations(source: string): string[] {
  const violations: string[] = [];

  for (const match of source.matchAll(BY_ID_LOOKUP)) {
    const position = match.index ?? 0;
    if (!enclosingCallText(source, position).includes('business_id')) {
      violations.push(`line ${lineNumberAt(source, position)}: by-id lookup without business_id scope: ${match[0]}`);
    }
  }

  for (const match of source.matchAll(JOIN_OF_TENANT_TABLE)) {
    const position = match.index ?? 0;
    const openIndex = position + match[0].indexOf('(');
    if (!balancedFrom(source, openIndex).includes('business_id')) {
      violations.push(`line ${lineNumberAt(source, position)}: join without business_id in the ON condition: ${match[0]}`);
    }
  }

  return violations;
}

function collectSourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(directory)) {
    if (name === 'node_modules' || name === '.next' || name.startsWith('.')) {
      continue;
    }
    const fullPath = join(directory, name);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
    } else if (/\.(ts|tsx)$/.test(name)) {
      files.push(fullPath);
    }
  }
  return files;
}

describe('tenant scoping guard (API-001)', () => {
  describe('the checker itself', () => {
    it('flags an unscoped customer lookup', () => {
      const source = `const c = await db.select().from(customers).where(eq(customers.id, invoice.customer_id));`;
      expect(findTenantScopingViolations(source)).toHaveLength(1);
    });

    it('flags an unscoped product lookup and unscoped joins', () => {
      const source = [
        `.where(eq(products.id, id))`,
        `.leftJoin(customers, eq(invoices.customer_id, customers.id))`,
        `.innerJoin(products, eq(items.product_id, products.id))`,
      ].join('\n');
      expect(findTenantScopingViolations(source)).toHaveLength(3);
    });

    it('is not fooled by a business_id filter that sits elsewhere in the same query', () => {
      const source = [
        `.from(invoices)`,
        `.leftJoin(customers, eq(invoices.customer_id, customers.id))`,
        `.where(eq(invoices.business_id, businessId))`,
        `.then(() => db.select().from(customers).where(eq(customers.id, x)))`,
        `.where(eq(invoices.business_id, businessId));`,
      ].join('\n');
      expect(findTenantScopingViolations(source)).toHaveLength(2);
    });

    it('accepts scoped lookups (single-line and multi-line) and scoped joins', () => {
      const source = [
        `.where(and(eq(customers.id, id), eq(customers.business_id, businessId)))`,
        `.where(and(`,
        `  eq(products.id, id),`,
        `  eq(products.business_id, appUser.business_id)`,
        `))`,
        `.leftJoin(customers, and(eq(invoices.customer_id, customers.id), eq(customers.business_id, invoices.business_id)))`,
        `.leftJoin(products, and(`,
        `  eq(invoiceLineItems.product_id, products.id),`,
        `  eq(products.business_id, invoices.business_id)`,
        `))`,
      ].join('\n');
      expect(findTenantScopingViolations(source)).toEqual([]);
    });
  });

  it('finds no unscoped customer/product lookups or joins in lib/ and app/', () => {
    const root = process.cwd();
    const offenders: string[] = [];
    for (const directory of ['lib', 'app']) {
      for (const file of collectSourceFiles(join(root, directory))) {
        for (const violation of findTenantScopingViolations(readFileSync(file, 'utf8'))) {
          offenders.push(`${relative(root, file)}: ${violation}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
