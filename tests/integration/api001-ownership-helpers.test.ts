import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ActionError } from '@/lib/actions/_shared/errors';
import {
  assertOwnedCustomer,
  assertOwnedProducts,
  findOwnedCustomer,
  type DbExecutor,
} from '@/lib/actions/_shared/ownership';
import * as schema from '@/lib/db/schema';

/**
 * Unit-level integration tests for the ownership helpers, run against the real schema created from the real migrations.
 * The pglite-backed drizzle instance exposes the same query builder as the production client; the casts to
 * DbExecutor below are the only place the driver difference is bridged.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function migrate(pg: PGlite): Promise<void> {
  const raw: unknown = JSON.parse(readFileSync(join(process.cwd(), 'drizzle', 'meta', '_journal.json'), 'utf8'));
  if (!isRecord(raw) || !Array.isArray(raw.entries)) {
    throw new Error('journal has no entries array');
  }
  for (const entry of raw.entries as unknown[]) {
    if (!isRecord(entry) || typeof entry.tag !== 'string') {
      throw new Error('malformed journal entry');
    }
    const sqlText = readFileSync(join(process.cwd(), 'drizzle', `${entry.tag}.sql`), 'utf8');
    for (const statement of sqlText.split('--> statement-breakpoint').map((s) => s.trim()).filter((s) => s.length > 0)) {
      await pg.exec(statement);
    }
  }
}

async function insertId(pg: PGlite, sqlText: string, params: unknown[]): Promise<string> {
  const result = await pg.query<{ id: string }>(sqlText, params);
  const row = result.rows[0];
  if (!row) {
    throw new Error('no row returned');
  }
  return row.id;
}

describe('ownership helpers (API-001)', () => {
  let pg: PGlite;
  let executor: DbExecutor;
  let businessA: string;
  let businessB: string;
  let customerA: string;
  let customerB: string;
  let productA1: string;
  let productA2: string;
  let productB: string;

  beforeAll(async () => {
    pg = new PGlite();
    await migrate(pg);
    executor = drizzle(pg, { schema }) as unknown as DbExecutor;
    const biz = (gstin: string, name: string): Promise<string> =>
      insertId(pg, `INSERT INTO businesses (legal_name, gstin, address_line1, city, state_code, pincode) VALUES ($1, $2, 'x', 'x', '29', '560001') RETURNING id`, [name, gstin]);
    businessA = await biz('29ABCDE1234F1Z5', 'A');
    businessB = await biz('27ABCDE1234F1Z5', 'B');
    const customer = (business: string, name: string): Promise<string> =>
      insertId(pg, `INSERT INTO customers (business_id, name, state_code) VALUES ($1, $2, '29') RETURNING id`, [business, name]);
    customerA = await customer(businessA, 'Customer A');
    customerB = await customer(businessB, 'Customer B');
    const product = (business: string, name: string): Promise<string> =>
      insertId(pg, `INSERT INTO products (business_id, name, hsn_sac_code, default_sale_price_paise) VALUES ($1, $2, '4820', 100) RETURNING id`, [business, name]);
    productA1 = await product(businessA, 'A1');
    productA2 = await product(businessA, 'A2');
    productB = await product(businessB, 'B1');
  }, 120_000);

  afterAll(async () => {
    await pg.close();
  });

  describe('findOwnedCustomer / assertOwnedCustomer', () => {
    it('returns the customer for its own business', async () => {
      const row = await findOwnedCustomer(executor, businessA, customerA);
      expect(row?.id).toBe(customerA);
      expect((await assertOwnedCustomer(executor, businessA, customerA)).name).toBe('Customer A');
    });

    it("returns null / throws NOT_FOUND for another business's customer and for an unknown id (indistinguishable)", async () => {
      const unknownId = '00000000-0000-4000-8000-000000000000';
      expect(await findOwnedCustomer(executor, businessA, customerB)).toBeNull();
      expect(await findOwnedCustomer(executor, businessA, unknownId)).toBeNull();
      const errors: ActionError[] = [];
      for (const id of [customerB, unknownId]) {
        try {
          await assertOwnedCustomer(executor, businessA, id);
        } catch (error: unknown) {
          if (error instanceof ActionError) {
            errors.push(error);
          }
        }
      }
      expect(errors).toHaveLength(2);
      expect(errors.map((error) => error.code)).toEqual(['NOT_FOUND', 'NOT_FOUND']);
      expect(errors[0]?.message).toBe(errors[1]?.message);
    });
  });

  describe('assertOwnedProducts', () => {
    it('accepts an empty list, empty values (ad-hoc lines), own products and duplicates', async () => {
      await expect(assertOwnedProducts(executor, businessA, [])).resolves.toBeUndefined();
      await expect(assertOwnedProducts(executor, businessA, [null, undefined, ''])).resolves.toBeUndefined();
      await expect(assertOwnedProducts(executor, businessA, [productA1, productA2])).resolves.toBeUndefined();
      await expect(assertOwnedProducts(executor, businessA, [productA1, productA1, null, productA2, ''])).resolves.toBeUndefined();
    });

    it('rejects when ANY id is foreign or unknown, even if the others are own', async () => {
      await expect(assertOwnedProducts(executor, businessA, [productB])).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(assertOwnedProducts(executor, businessA, [productA1, productB])).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(assertOwnedProducts(executor, businessA, [productA1, '00000000-0000-4000-8000-000000000000'])).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('works with a transaction handle', async () => {
      const db = drizzle(pg, { schema });
      await db.transaction(async (tx) => {
        const txExecutor = tx as unknown as DbExecutor;
        await expect(assertOwnedProducts(txExecutor, businessA, [productA1])).resolves.toBeUndefined();
        await expect(assertOwnedProducts(txExecutor, businessA, [productB])).rejects.toBeInstanceOf(ActionError);
      });
    });
  });
});
