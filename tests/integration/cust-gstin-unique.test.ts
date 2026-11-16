import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '@/lib/db/client';

// CUST-GSTIN-UNIQUE: a business can never hold two customers with the same GSTIN.
// The database refuses it (partial unique index customers_biz_gstin_uq) and the
// customer actions turn that refusal into a clear form error on the GSTIN field.

const state = vi.hoisted(() => ({
  db: undefined as unknown,
  userId: '00000000-0000-4000-8000-000000000001',
  businessId: '',
}));

vi.mock('@/lib/db/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db/client')>();
  return {
    ...actual,
    get db() {
      return state.db;
    },
  };
});

vi.mock('@/lib/auth/session', () => ({
  getCurrentAppUser: async () => ({ id: state.userId, business_id: state.businessId, role: 'owner' }),
}));

vi.mock('@/lib/auth/server', () => ({
  auth: {
    getSession: async () => ({
      data: { user: { id: '00000000-0000-4000-8000-000000000001', email: 'owner@test.dev', emailVerified: true } },
    }),
  },
}));

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('@/lib/rate-limit/upstash', () => ({
  sensitiveActionLimiter: {},
  checkRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }),
  getClientIp: () => '127.0.0.1',
}));
vi.mock('@/lib/actions/_shared/logger', () => ({ logError: () => undefined }));

import { createCustomer } from '@/lib/actions/customers/create-customer';
import { updateCustomer } from '@/lib/actions/customers/update-customer';

const DRIZZLE_DIR = join(process.cwd(), 'drizzle');
const GSTIN_A = '29ABCDE1234F1ZW';
const GSTIN_B = '27AAACR5055K1Z7';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function journalTags(): readonly string[] {
  const raw: unknown = JSON.parse(readFileSync(join(DRIZZLE_DIR, 'meta', '_journal.json'), 'utf8'));
  if (!isRecord(raw) || !Array.isArray(raw.entries)) throw new Error('journal has no entries array');
  return raw.entries.map((entry: unknown) => {
    if (!isRecord(entry) || typeof entry.tag !== 'string') throw new Error('malformed journal entry');
    return entry.tag;
  });
}

async function applyMigrations(pg: PGlite): Promise<void> {
  for (const tag of journalTags()) {
    const statements = readFileSync(join(DRIZZLE_DIR, `${tag}.sql`), 'utf8')
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const statement of statements) await pg.exec(statement);
  }
}

describe('CUST-GSTIN-UNIQUE: one GSTIN per customer within a business (PGlite)', () => {
  let pg: PGlite;
  let bizOne = '';
  let bizTwo = '';

  async function insertBusiness(name: string, gstin: string): Promise<string> {
    const res = await pg.query<{ id: string }>(
      `INSERT INTO businesses (legal_name, gstin, address_line1, city, state_code, pincode,
         subscription_plan, subscription_status, subscription_ends_at)
       VALUES ($1, $2, '1 Main Rd', 'Bengaluru', '29', '560001', 'professional', 'active', now() + interval '30 days')
       RETURNING id`,
      [name, gstin],
    );
    const id = res.rows[0]?.id;
    if (!id) throw new Error('business insert returned no id');
    return id;
  }

  async function customersOf(businessId: string): Promise<readonly { id: string; name: string; gstin: string | null }[]> {
    const res = await pg.query<{ id: string; name: string; gstin: string | null }>(
      'SELECT id, name, gstin FROM customers WHERE business_id = $1 ORDER BY name',
      [businessId],
    );
    return res.rows;
  }

  const customer = (name: string, gstin: string, state_code: string) => ({
    name,
    gstin,
    email: '',
    phone: '',
    address_line1: '',
    address_line2: '',
    city: '',
    state_code,
    pincode: '',
  });

  beforeAll(async () => {
    pg = new PGlite();
    await applyMigrations(pg);
    state.db = drizzle(pg, { schema });
    bizOne = await insertBusiness('Business One', '29AAPFU0939F1ZV');
    bizTwo = await insertBusiness('Business Two', '29AAPFU0939F1ZW');
  }, 60_000);

  afterAll(async () => {
    await pg.close();
  });

  beforeEach(async () => {
    await pg.query('DELETE FROM customers');
    state.businessId = bizOne;
  });

  it('the index exists with the name the error mapping expects, and is partial', async () => {
    const res = await pg.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'customers' AND indexname = 'customers_biz_gstin_uq'`,
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]?.indexdef).toMatch(/UNIQUE INDEX/);
    expect(res.rows[0]?.indexdef).toMatch(/WHERE \(gstin IS NOT NULL\)/);
  });

  it('createCustomer refuses a second customer with the same GSTIN in the same business', async () => {
    const first = await createCustomer(customer('First Co', GSTIN_A, '29'));
    expect(first.success).toBe(true);

    const second = await createCustomer(customer('Second Co', GSTIN_A, '29'));
    expect(second.success).toBe(false);
    if (second.success) return;
    expect(second.error.code).toBe('DUPLICATE_CUSTOMER_GSTIN');
    expect(second.error.fieldErrors?.gstin?.[0]).toBe('A customer with this GSTIN already exists in your account.');
    expect(second.error.message).not.toContain('customers_biz_gstin_uq');
    expect(second.error.message).not.toContain('duplicate key');

    expect((await customersOf(bizOne)).map((c) => c.name)).toEqual(['First Co']);
  });

  it('updateCustomer refuses changing a GSTIN to one another customer already has', async () => {
    expect((await createCustomer(customer('Alpha', GSTIN_A, '29'))).success).toBe(true);
    expect((await createCustomer(customer('Beta', GSTIN_B, '27'))).success).toBe(true);
    const beta = (await customersOf(bizOne)).find((c) => c.name === 'Beta');
    if (!beta) throw new Error('Beta missing');

    const res = await updateCustomer({ id: beta.id, ...customer('Beta', GSTIN_A, '29') });
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error.code).toBe('DUPLICATE_CUSTOMER_GSTIN');
    expect(res.error.fieldErrors?.gstin).toBeDefined();

    // Beta keeps its own GSTIN; saving a customer with its unchanged GSTIN still works.
    expect((await customersOf(bizOne)).find((c) => c.name === 'Beta')?.gstin).toBe(GSTIN_B);
    const resave = await updateCustomer({ id: beta.id, ...customer('Beta Renamed', GSTIN_B, '27') });
    expect(resave.success).toBe(true);
  });

  it('allows the same GSTIN in two different businesses', async () => {
    expect((await createCustomer(customer('Shared Buyer', GSTIN_A, '29'))).success).toBe(true);
    state.businessId = bizTwo;
    expect((await createCustomer(customer('Shared Buyer', GSTIN_A, '29'))).success).toBe(true);

    expect(await customersOf(bizOne)).toHaveLength(1);
    expect(await customersOf(bizTwo)).toHaveLength(1);
  });

  it('leaves customers without a GSTIN unaffected', async () => {
    for (const name of ['Walk-in 1', 'Walk-in 2', 'Walk-in 3']) {
      expect((await createCustomer(customer(name, '', '29'))).success).toBe(true);
    }
    const rows = await customersOf(bizOne);
    expect(rows).toHaveLength(3);
    expect(rows.every((c) => c.gstin === null)).toBe(true);
  });

  it('a raw concurrent-style insert of a duplicate fails at the database (23505)', async () => {
    await pg.query(`INSERT INTO customers (business_id, name, gstin, state_code) VALUES ($1, 'One', $2, '29')`, [bizOne, GSTIN_A]);
    await expect(
      pg.query(`INSERT INTO customers (business_id, name, gstin, state_code) VALUES ($1, 'Two', $2, '29')`, [bizOne, GSTIN_A]),
    ).rejects.toMatchObject({ code: '23505', constraint: 'customers_biz_gstin_uq' });
  });
});
