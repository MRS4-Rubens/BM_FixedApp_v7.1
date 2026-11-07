import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '@/lib/db/schema';

/**
 * PERF-002: the platform-admin business directory must report real invoice and user counts per business.
 * The previous correlated subqueries rendered as `"business_id" = "id"` (both resolved to the inner table), so every
 * count was 0. listBusinessesWithCounts uses pre-grouped, explicitly aliased derived tables instead.
 */

const state = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock('@/lib/db/client', () => ({
  get db() {
    return state.db;
  },
}));

import { listBusinessesWithCounts } from '@/lib/subscriptions/business-directory';

const DRIZZLE_DIR = join(process.cwd(), 'drizzle');

async function applyMigrations(pg: PGlite): Promise<void> {
  const journal = JSON.parse(readFileSync(join(DRIZZLE_DIR, 'meta', '_journal.json'), 'utf8')) as {
    entries: Array<{ tag: string }>;
  };
  for (const { tag } of journal.entries) {
    const statements = readFileSync(join(DRIZZLE_DIR, `${tag}.sql`), 'utf8')
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const statement of statements) await pg.exec(statement);
  }
}

async function insertBusiness(pg: PGlite, name: string, gstin: string): Promise<{ id: string; fyId: string }> {
  const biz = await pg.query<{ id: string }>(
    `INSERT INTO businesses (legal_name, gstin, address_line1, city, state_code, pincode)
     VALUES ($1, $2, '1 Road', 'Bengaluru', '29', '560001') RETURNING id`,
    [name, gstin],
  );
  const id = biz.rows[0].id;
  const fy = await pg.query<{ id: string }>(
    `INSERT INTO financial_years (business_id, label, start_date, end_date)
     VALUES ($1, '2026-2027', '2026-04-01', '2027-03-31') RETURNING id`,
    [id],
  );
  return { id, fyId: fy.rows[0].id };
}

let draftSeq = 0;
async function insertDraftInvoice(pg: PGlite, businessId: string, fyId: string): Promise<void> {
  draftSeq += 1;
  await pg.query(
    `INSERT INTO invoices (business_id, financial_year_id, invoice_number, lifecycle_status, payment_status,
       invoice_date, grand_total_paise, subtotal_paise, total_tax_paise)
     VALUES ($1, $2, $3, 'draft', 'unpaid', '2026-11-01', 1000, 1000, 0)`,
    [businessId, fyId, `DRAFT-${draftSeq}`],
  );
}

let userSeq = 0;
async function insertUser(pg: PGlite, businessId: string | null): Promise<void> {
  userSeq += 1;
  await pg.query(`INSERT INTO users (auth_user_id, business_id) VALUES ($1, $2)`, [`auth-user-${userSeq}`, businessId]);
}

describe('PERF-002: platform-admin business directory counts', () => {
  let pg: PGlite;
  let a: { id: string; fyId: string };
  let b: { id: string; fyId: string };
  let c: { id: string; fyId: string };

  beforeAll(async () => {
    pg = new PGlite();
    await applyMigrations(pg);
    state.db = drizzle(pg, { schema });

    a = await insertBusiness(pg, 'Alpha Traders', '29ABCDE1234F1Z5');
    b = await insertBusiness(pg, 'Beta Stores', '27ABCDE1234F1Z5');
    c = await insertBusiness(pg, 'Gamma Empty', '24ABCDE1234F1Z5');

    for (let i = 0; i < 3; i += 1) await insertDraftInvoice(pg, a.id, a.fyId);
    await insertDraftInvoice(pg, b.id, b.fyId);
    await insertUser(pg, a.id);
    await insertUser(pg, a.id);
    await insertUser(pg, b.id);
    await insertUser(pg, null); // a user without a business must not be attributed to anyone
  }, 60_000);

  afterAll(async () => {
    await pg.close();
  });

  it('returns the real invoice and user count for every business (0 only when there are none)', async () => {
    const rows = await listBusinessesWithCounts();
    const byId = new Map(rows.map((row) => [row.id, row]));

    expect(rows).toHaveLength(3);
    expect(byId.get(a.id)).toMatchObject({ legalName: 'Alpha Traders', invoiceCount: 3, userCount: 2 });
    expect(byId.get(b.id)).toMatchObject({ legalName: 'Beta Stores', invoiceCount: 1, userCount: 1 });
    expect(byId.get(c.id)).toMatchObject({ legalName: 'Gamma Empty', invoiceCount: 0, userCount: 0 });
    for (const row of rows) {
      expect(typeof row.invoiceCount).toBe('number');
      expect(typeof row.userCount).toBe('number');
    }
  });

  it('keeps newest-first ordering', async () => {
    const rows = await listBusinessesWithCounts();
    const times = rows.map((row) => new Date(row.createdAt).getTime());
    expect([...times].sort((x, y) => y - x)).toEqual(times);
  });
});
