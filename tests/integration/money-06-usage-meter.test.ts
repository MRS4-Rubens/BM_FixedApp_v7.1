import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '@/lib/db/schema';
import { countFinalizedInvoicesInRange } from '@/lib/invoices/invoice-quota';

/**
 * MONEY-06: the Settings usage meter must show the same "invoices used" number the finalize quota enforces:
 * finalized invoices of THIS business dated in the month. Drafts never use up the limit.
 */
const DRIZZLE_DIR = join(process.cwd(), 'drizzle');

async function applyAllMigrations(pg: PGlite): Promise<void> {
  const journal = JSON.parse(readFileSync(join(DRIZZLE_DIR, 'meta', '_journal.json'), 'utf8')) as { entries: Array<{ tag: string }> };
  for (const entry of journal.entries) {
    const statements = readFileSync(join(DRIZZLE_DIR, `${entry.tag}.sql`), 'utf8')
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);
    for (const statement of statements) await pg.exec(statement);
  }
}

async function insertOne(pg: PGlite, sqlText: string, params: unknown[] = []): Promise<string> {
  const row = (await pg.query<{ id: string }>(sqlText, params)).rows[0];
  if (!row) throw new Error(`no row returned for: ${sqlText}`);
  return row.id;
}

describe('MONEY-06: invoices used this month = finalized only', () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let shopA: string;
  let seq = 0;

  async function business(gstin: string): Promise<{ id: string; fy: string }> {
    const id = await insertOne(
      pg,
      `INSERT INTO businesses (legal_name, gstin, address_line1, city, state_code, pincode)
       VALUES ('Shop', $1, '1 Road', 'Mumbai', '27', '400001') RETURNING id`,
      [gstin],
    );
    const fy = await insertOne(
      pg,
      `INSERT INTO financial_years (business_id, label, start_date, end_date) VALUES ($1, '2026-27', '2026-04-01', '2027-03-31') RETURNING id`,
      [id],
    );
    return { id, fy };
  }

  async function invoice(owner: { id: string; fy: string }, status: 'draft' | 'finalized', date: string): Promise<void> {
    seq += 1;
    if (status === 'draft') {
      await pg.query(
        `INSERT INTO invoices (business_id, financial_year_id, invoice_number, lifecycle_status, invoice_date,
           subtotal_paise, total_tax_paise, grand_total_paise)
         VALUES ($1, $2, $3, 'draft', $4, 10000, 1800, 11800)`,
        [owner.id, owner.fy, `DRAFT-${seq}`, date],
      );
      return;
    }
    await pg.query(
      `INSERT INTO invoices (business_id, financial_year_id, invoice_number, invoice_sequence, lifecycle_status,
         invoice_date, due_date, finalized_at, subtotal_paise, total_tax_paise, grand_total_paise,
         seller_name_snapshot, seller_address_snapshot, seller_state_code_snapshot, seller_snapshot_source, seller_gstin_snapshot)
       VALUES ($1, $2, $3, $4, 'finalized', $5, $5, now(), 10000, 1800, 11800,
         'Shop', '{"city":"Mumbai"}'::jsonb, '27', 'captured_at_finalization', '27AAPFU0939F1ZV')`,
      [owner.id, owner.fy, `INV-${seq}`, seq, date],
    );
  }

  beforeAll(async () => {
    pg = new PGlite();
    db = drizzle(pg, { schema });
    await applyAllMigrations(pg);
    const a = await business('27AAPFU0939F1ZV');
    const b = await business('29ABCDE1234F1Z5');
    shopA = a.id;
    await invoice(a, 'draft', '2026-11-05');
    await invoice(a, 'draft', '2026-11-20');
    await invoice(a, 'finalized', '2026-11-10'); // the only one that counts
    await invoice(a, 'finalized', '2026-10-31'); // previous month
    await invoice(b, 'finalized', '2026-11-12'); // another business
  }, 180_000);

  afterAll(async () => {
    await pg.close();
  });

  it('2 drafts + 1 finalized this month (+ last month, + another shop) → 1 used', async () => {
    const used = await countFinalizedInvoicesInRange(db as never, shopA, { startDate: '2026-11-01', endDate: '2026-11-30' });
    expect(used).toBe(1);
  });

  it('includes both month edges (1st and last day)', async () => {
    const edges = await countFinalizedInvoicesInRange(db as never, shopA, { startDate: '2026-10-31', endDate: '2026-11-10' });
    expect(edges).toBe(2);
  });
});
