import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { describe, expect, it } from 'vitest';

const DRIZZLE_DIR = join(process.cwd(), 'drizzle');

interface PlanNode {
  'Node Type': string;
  'Index Name'?: string;
  Plans?: PlanNode[];
}

function hasNodeType(node: PlanNode, type: string): boolean {
  if (node['Node Type'] === type) return true;
  if (node.Plans) {
    return node.Plans.some((child) => hasNodeType(child, type));
  }
  return false;
}

function findIndexNames(node: PlanNode): string[] {
  const names: string[] = [];
  if (node['Index Name']) {
    names.push(node['Index Name']);
  }
  if (node.Plans) {
    for (const child of node.Plans) {
      names.push(...findIndexNames(child));
    }
  }
  return names;
}

const isEnabled = process.env.RUN_PERF_TESTS === '1';

describe.skipIf(!isEnabled)('PERF-001 Benchmark & EXPLAIN Index Plan Verification', () => {
  it('verifies index scans (no Sort, no Seq Scan) and sub-50ms keyset lookups with 10k rows', async () => {
    const pg = new PGlite({ extensions: { pg_trgm } });

    // Apply migrations
    const rawJournal: unknown = JSON.parse(readFileSync(join(DRIZZLE_DIR, 'meta', '_journal.json'), 'utf8'));
    const entries = (rawJournal as { entries: Array<{ tag: string }> }).entries;
    for (const entry of entries) {
      const sqlText = readFileSync(join(DRIZZLE_DIR, `${entry.tag}.sql`), 'utf8');
      const statements = sqlText
        .split('--> statement-breakpoint')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      for (const statement of statements) {
        await pg.exec(statement);
      }
    }

    // Seed 1 business & 1 financial year
    const bizRes = await pg.query<{ id: string }>(
      `INSERT INTO businesses (legal_name, gstin, address_line1, city, state_code, pincode)
       VALUES ('Performance Benchmark Corp', '29ABCDE1234F1Z5', '1 Tech Park', 'Bengaluru', '29', '560001')
       RETURNING id;`,
    );
    const businessId = bizRes.rows[0].id;

    const fyRes = await pg.query<{ id: string }>(
      `INSERT INTO financial_years (business_id, label, start_date, end_date)
       VALUES ($1, '2026-2027', '2026-04-01', '2027-03-31')
       RETURNING id;`,
      [businessId],
    );
    const fyId = fyRes.rows[0].id;

    // Seed 10,000 customers in bulk
    await pg.exec(
      `INSERT INTO customers (business_id, name, state_code)
       SELECT
         '${businessId}',
         'Customer benchmark #' || g,
         '29'
       FROM generate_series(1, 10000) AS g;`,
    );

    // Pick 1 customer id for invoices
    const anyCustomer = await pg.query<{ id: string }>(
      `SELECT id FROM customers WHERE business_id = $1 LIMIT 1;`,
      [businessId],
    );
    const customerId = anyCustomer.rows[0].id;

    // Seed 10,000 invoices in bulk with descending created_at
    await pg.exec(
      `INSERT INTO invoices (
         business_id, customer_id, financial_year_id, invoice_number, invoice_sequence,
         lifecycle_status, payment_status, invoice_date, grand_total_paise,
         finalized_at, seller_name_snapshot, seller_address_snapshot, seller_state_code_snapshot, seller_snapshot_source,
         created_at
       )
       SELECT
         '${businessId}',
         '${customerId}',
         '${fyId}',
         'INV-BENCH-' || g,
         g,
         'finalized',
         'unpaid',
         '2026-11-01',
         50000,
         NOW(),
         'Bench Seller',
         '{"line1":"1 Tech Park","city":"Bengaluru"}'::jsonb,
         '29',
         'captured_at_finalization',
         NOW() - (g || ' seconds')::interval
       FROM generate_series(1, 10000) AS g;`,
    );

    // Analyze tables so planner has accurate statistics
    await pg.exec(`ANALYZE invoices; ANALYZE customers;`);

    // 1. EXPLAIN invoices keyset seek
    const explainInvoice = await pg.query<{ 'QUERY PLAN': unknown }>(
      `EXPLAIN (FORMAT JSON)
       SELECT id, invoice_number, created_at
       FROM invoices
       WHERE business_id = $1
         AND (created_at, id) < (NOW() - interval '1000 seconds', 'ffffffff-ffff-ffff-ffff-ffffffffffff')
       ORDER BY created_at DESC, id DESC
       LIMIT 50;`,
      [businessId],
    );

    const invoicePlan = (explainInvoice.rows[0]['QUERY PLAN'] as [{ Plan: PlanNode }])[0].Plan;
    expect(hasNodeType(invoicePlan, 'Sort')).toBe(false);
    expect(hasNodeType(invoicePlan, 'Seq Scan')).toBe(false);
    const invoiceIndexes = findIndexNames(invoicePlan);
    expect(invoiceIndexes.some((name) => name.includes('invoices_biz_created_id_idx'))).toBe(true);

    // 2. EXPLAIN customers keyset seek
    const explainCustomer = await pg.query<{ 'QUERY PLAN': unknown }>(
      `EXPLAIN (FORMAT JSON)
       SELECT id, name
       FROM customers
       WHERE business_id = $1
         AND (name, id) > ('Customer benchmark #500', '00000000-0000-0000-0000-000000000000')
       ORDER BY name ASC, id ASC
       LIMIT 50;`,
      [businessId],
    );

    const customerPlan = (explainCustomer.rows[0]['QUERY PLAN'] as [{ Plan: PlanNode }])[0].Plan;
    expect(hasNodeType(customerPlan, 'Sort')).toBe(false);
    expect(hasNodeType(customerPlan, 'Seq Scan')).toBe(false);
    const customerIndexes = findIndexNames(customerPlan);
    expect(customerIndexes.some((name) => name.includes('customers_biz_name_id_idx'))).toBe(true);

    // 3. Repeated seek latency benchmark (20 iterations)
    const latenciesMs: number[] = [];
    for (let i = 0; i < 20; i++) {
      const start = performance.now();
      await pg.query(
        `SELECT id, invoice_number, created_at
         FROM invoices
         WHERE business_id = $1
           AND (created_at, id) < (NOW() - interval '2000 seconds', 'ffffffff-ffff-ffff-ffff-ffffffffffff')
         ORDER BY created_at DESC, id DESC
         LIMIT 50;`,
        [businessId],
      );
      latenciesMs.push(performance.now() - start);
    }

    latenciesMs.sort((a, b) => a - b);
    const p95 = latenciesMs[Math.floor(latenciesMs.length * 0.95)];
    expect(p95).toBeLessThanOrEqual(50);

    await pg.close();
  }, 120000);
});
