import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '@/lib/db/schema';
import { saveInvoiceDraft } from '@/lib/actions/invoices/save-invoice-draft';
import { createCustomer } from '@/lib/actions/customers/create-customer';

const state = vi.hoisted(() => ({
  db: undefined as unknown,
  userId: '00000000-0000-0000-0000-000000000001',
  businessId: '00000000-0000-0000-0000-000000000010',
}));

vi.mock('@/lib/db/client', () => ({
  get db() {
    return state.db;
  },
  getDb() {
    return state.db;
  },
}));

vi.mock('@/lib/auth/session', () => ({
  getCurrentAppUser: async () => ({
    id: state.userId,
    business_id: state.businessId,
    email: 'user@test.dev',
    display_name: 'Test Actor',
  }),
}));

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: () => undefined,
}));

vi.mock('@/lib/rate-limit/upstash', () => ({
  invoiceLimiter: {},
  sensitiveActionLimiter: {},
  checkRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }),
  getClientIp: () => '127.0.0.1',
}));

const DRIZZLE_DIR = join(process.cwd(), 'drizzle');

interface JournalEntry {
  readonly idx: number;
  readonly tag: string;
}

function readJournal(): readonly JournalEntry[] {
  const raw = JSON.parse(readFileSync(join(DRIZZLE_DIR, 'meta', '_journal.json'), 'utf8')) as {
    entries: JournalEntry[];
  };
  return raw.entries;
}

async function applyMigrations(pg: PGlite, entries: readonly JournalEntry[]): Promise<void> {
  for (const entry of entries) {
    const rawSql = readFileSync(join(DRIZZLE_DIR, `${entry.tag}.sql`), 'utf8');
    const statements = rawSql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const statement of statements) {
      await pg.exec(statement);
    }
  }
}

describe('API-006: validation and exact math integration', () => {
  let pg: PGlite;
  let taxRate18Id: string;
  let inactiveTaxRateId: string;
  let customerId: string;

  beforeAll(async () => {
    pg = new PGlite();
    await applyMigrations(pg, readJournal());
    const drizzleDb = drizzle({ client: pg, schema });
    state.db = drizzleDb;

    // Seed business
    await pg.query(
      `INSERT INTO businesses (id, legal_name, gstin, address_line1, city, state_code, pincode)
       VALUES ($1, 'Karnataka Corp', '29ABCDE1234F1ZW', '1 Test Road', 'Bengaluru', '29', '560001')`,
      [state.businessId]
    );

    // Seed user
    await pg.query(
      `INSERT INTO users (id, auth_user_id, business_id, role, display_name, email)
       VALUES ($1, 'auth-user-1', $2, 'owner', 'Test Actor', 'user@test.dev')`,
      [state.userId, state.businessId]
    );

    // Seed financial year
    await pg.query(
      `INSERT INTO financial_years (id, business_id, label, start_date, end_date, is_current)
       VALUES ('00000000-0000-0000-0000-000000000020', $1, '2026-27', '2026-04-01', '2027-03-31', true)`,
      [state.businessId]
    );

    // Seed customer
    const custRes = await pg.query<{ id: string }>(
      `INSERT INTO customers (business_id, name, state_code)
       VALUES ($1, 'Customer One', '29') RETURNING id`,
      [state.businessId]
    );
    customerId = custRes.rows[0].id;

    // Seed active 18% tax rate
    const tr18 = await pg.query<{ id: string }>(
      `INSERT INTO tax_rates (label, rate_percentage, is_active, effective_from)
       VALUES ('GST 18%', '18.00', true, '2017-07-01') RETURNING id`
    );
    taxRate18Id = tr18.rows[0].id;

    // Seed inactive tax rate
    const trInactive = await pg.query<{ id: string }>(
      `INSERT INTO tax_rates (label, rate_percentage, is_active, effective_from)
       VALUES ('GST Inactive', '18.00', false, '2017-07-01') RETURNING id`
    );
    inactiveTaxRateId = trInactive.rows[0].id;
  }, 120_000);

  afterAll(async () => {
    await pg.close();
  });

  it('saves an invoice draft with exact integer math', async () => {
    const res = await saveInvoiceDraft({
      customer_id: customerId,
      billing_name: 'Customer One',
      invoice_date: '2026-11-02',
      due_date: '2026-11-15',
      place_of_supply_state_code: '29',
      invoice_template: 'template_1',
      line_items: [
        {
          description: 'Consulting',
          hsn_sac_code: '998311',
          quantity: 2.5,
          unit_price: 100, // ₹100.00 -> 10,000 paise
          discount: 10, // 10%
          tax_rate_id: taxRate18Id,
          unit_of_measurement: 'NOS',
        },
      ],
    });

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.invoiceId).toBeDefined();
      const invoiceRow = await pg.query<{
        subtotal_paise: number;
        total_tax_paise: number;
        grand_total_paise: number;
      }>(`SELECT subtotal_paise, total_tax_paise, grand_total_paise FROM invoices WHERE id = $1`, [
        res.data.invoiceId,
      ]);
      expect(invoiceRow.rows.length).toBe(1);
      // gross = 25000, disc = 2500, taxable = 22500
      // tax = 18% of 22500 = 4050
      // rounded grand total = 26550 rounded to nearest rupee = 26600 paise
      expect(invoiceRow.rows[0].subtotal_paise).toBe(22500);
      expect(invoiceRow.rows[0].total_tax_paise).toBe(4050);
      expect(Number(invoiceRow.rows[0].grand_total_paise)).toBe(26600);
    }
  });

  it('rejects invoice draft with inactive tax rate', async () => {
    const res = await saveInvoiceDraft({
      customer_id: customerId,
      billing_name: 'Customer One',
      invoice_date: '2026-11-02',
      due_date: '2026-11-15',
      place_of_supply_state_code: '29',
      invoice_template: 'template_1',
      line_items: [
        {
          description: 'Inactive Rate Item',
          hsn_sac_code: '998311',
          quantity: 1,
          unit_price: 100,
          discount: 0,
          tax_rate_id: inactiveTaxRateId,
          unit_of_measurement: 'NOS',
        },
      ],
    });

    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.code).toBe('INVALID_TAX_RATE');
    }
  });

  it('rejects customer creation with invalid GSTIN checksum', async () => {
    const res = await createCustomer({
      name: 'Bad GSTIN Customer',
      gstin: '29ABCDE1234F1Z5', // invalid checksum
      state_code: '29',
    });

    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.code).toBe('VALIDATION_ERROR');
      expect(res.error.fieldErrors?.gstin).toBeDefined();
    }
  });

  it('accepts customer creation with valid GSTIN checksum', async () => {
    const res = await createCustomer({
      name: 'Good GSTIN Customer',
      gstin: '29ABCDE1234F1ZW', // valid checksum
      state_code: '29',
    });

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.success).toBe(true);
    }
  });
});
