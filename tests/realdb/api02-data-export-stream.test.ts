import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { streamDataExport } from '@/lib/account/data-export';
import { collectDataExport } from '@/tests/helpers/collect-data-export';
import {
  TestDb,
  TestBusiness,
  getTestDatabaseUrl,
  validateTestDatabaseUrl,
  createTestDbClient,
  createTestBusiness,
  createTestDraftInvoice,
  cleanupTestBusiness,
} from './helpers/db';

/**
 * API-02: the account data export (DPDP "download my data") is streamed in pages, so a large business never sits in
 * the 512 MB Render process all at once. 5,000 invoices with 2 lines each on REAL Postgres: the file is valid JSON
 * with every row, it arrives as many bounded chunks, and the heap stays well inside a budget while streaming.
 */
const INVOICES = 5_000;
const LINES_PER_INVOICE = 2;

describe('API-02: streamed account data export with 5,000 invoices (REAL Postgres)', () => {
  let testDb: TestDb;
  let testBusiness: TestBusiness;

  beforeAll(async () => {
    testDb = createTestDbClient(validateTestDatabaseUrl(getTestDatabaseUrl()));
    testBusiness = await createTestBusiness(testDb);
    const { financialYearId } = await createTestDraftInvoice(testDb, testBusiness.id);
    await testDb.execute(sql`
      INSERT INTO invoices (business_id, financial_year_id, invoice_number, lifecycle_status, place_of_supply_state_code,
        subtotal_paise, total_tax_paise, grand_total_paise, invoice_date, billing_name_snapshot, notes)
      SELECT ${testBusiness.id}::uuid, ${financialYearId}::uuid, 'DRAFT-API02-' || n, 'draft', '27',
        100000, 18000, 118000, CURRENT_DATE, 'Stream Test Buyer ' || n, repeat('note ', 40)
      FROM generate_series(1, ${INVOICES - 1}::int) n
    `);
    await testDb.execute(sql`
      INSERT INTO invoice_line_items (invoice_id, description, hsn_sac_code, quantity, unit_of_measurement, unit_price_paise,
        taxable_value_paise, tax_rate_percentage, line_total_paise, cgst_paise, sgst_paise, sort_order)
      SELECT i.id, 'Item ' || k || ' for ' || i.invoice_number, '8471', 1, 'NOS', 50000, 50000, '18.00', 59000, 4500, 4500, k
      FROM invoices i CROSS JOIN generate_series(0, ${LINES_PER_INVOICE - 1}::int) k
      WHERE i.business_id = ${testBusiness.id}::uuid
    `);
  }, 180_000);

  afterAll(async () => {
    if (testDb && testBusiness) await cleanupTestBusiness(testDb, testBusiness.id);
  }, 60_000);

  it('streams bounded chunks with a bounded heap, and the file holds every invoice and line', async () => {
    // Pass 1: consume like the HTTP response does (nothing kept), measuring chunk sizes and the heap.
    const baseline = process.memoryUsage().heapUsed;
    let peak = baseline;
    let chunks = 0;
    let bytes = 0;
    let largest = 0;
    for await (const chunk of streamDataExport(testDb, testBusiness.id)) {
      chunks += 1;
      bytes += chunk.length;
      largest = Math.max(largest, chunk.length);
      peak = Math.max(peak, process.memoryUsage().heapUsed);
    }
    const growthMb = (peak - baseline) / 1024 / 1024;

    expect(chunks).toBeGreaterThanOrEqual(INVOICES / 500); // at least one chunk per page of 500 invoices
    expect(largest).toBeLessThan(bytes / 5); // no chunk is a big share of the file
    expect(largest).toBeLessThan(4 * 1024 * 1024);
    // Budget: the whole file is ~10+ MB of text and the rows behind it several times that as objects; streaming keeps
    // only one page (plus GC slack) alive.
    expect(growthMb).toBeLessThan(96);

    // Pass 2: the downloaded text is valid JSON with every invoice (5,000) and line (10,000), in order.
    const { data } = await collectDataExport(testDb, testBusiness.id);
    expect(data.format).toBe('bill-matrix-data-export');
    expect(data.invoices).toHaveLength(INVOICES);
    const lineCount = data.invoices.reduce((sum, invoice) => sum + invoice.line_items.length, 0);
    const dbLines = await testDb.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM invoice_line_items l JOIN invoices i ON i.id = l.invoice_id
      WHERE i.business_id = ${testBusiness.id}::uuid
    `);
    // 2 per invoice, plus the starter draft's own line from createTestDraftInvoice.
    expect(lineCount).toBe(dbLines.rows[0]?.n);
    expect(lineCount).toBeGreaterThanOrEqual(INVOICES * LINES_PER_INVOICE);
    expect(new Set(data.invoices.map((invoice) => invoice.id)).size).toBe(INVOICES);
  }, 180_000);
});
