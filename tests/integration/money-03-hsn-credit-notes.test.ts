import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { ActionResult } from '@/lib/actions/_shared/types';
import * as schema from '@/lib/db/schema';

/**
 * MONEY-03 integration test. The REAL GSTR-1 server action runs against a REAL in-process PostgreSQL (PGlite) with
 * every migration applied. A November credit note against an October sale of an HSN that has no November sales must
 * still reduce the November HSN summary (Table 12), so Table 12 reconciles with Tables 4/5/7/9B. Business in Karnataka
 * (29); all documents intra-State (CGST + SGST). All amounts are integer paise.
 */

const state = vi.hoisted(() => ({ db: undefined as unknown, businessId: '' }));

vi.mock('@/lib/db/client', () => ({
  get db() {
    return state.db;
  },
}));
vi.mock('@/lib/auth/session', () => ({
  getCurrentAppUser: async () => ({ id: '00000000-0000-0000-0000-000000000001', business_id: state.businessId }),
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('@/lib/rate-limit/upstash', () => ({
  sensitiveActionLimiter: {},
  checkRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }),
  getClientIp: () => '127.0.0.1',
}));
vi.mock('@/lib/actions/_shared/logger', () => ({ logError: () => undefined }));

import { getGstr1ExportData, type Gstr1ExportData } from '@/lib/actions/reports/get-gstr1-data';

const DRIZZLE_DIR = join(process.cwd(), 'drizzle');
const REGISTERED_GSTIN = '29AAAAA0000A1Z5';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function applyAllMigrations(pg: PGlite): Promise<void> {
  const raw: unknown = JSON.parse(readFileSync(join(DRIZZLE_DIR, 'meta', '_journal.json'), 'utf8'));
  if (!isRecord(raw) || !Array.isArray(raw.entries)) throw new Error('journal has no entries array');
  for (const entry of raw.entries as unknown[]) {
    if (!isRecord(entry) || typeof entry.tag !== 'string') throw new Error('malformed journal entry');
    const statements = readFileSync(join(DRIZZLE_DIR, `${entry.tag}.sql`), 'utf8')
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);
    for (const statement of statements) await pg.exec(statement);
  }
}

async function insertOne(pg: PGlite, sqlText: string, params: unknown[] = []): Promise<string> {
  const result = await pg.query<{ id: string }>(sqlText, params);
  const row = result.rows[0];
  if (!row) throw new Error(`no row returned for: ${sqlText}`);
  return row.id;
}

interface Line {
  readonly hsn: string;
  readonly quantity: string;
  readonly taxablePaise: number;
}

/** 18% intra-State tax on a taxable value, in integer paise. */
function tax18(taxablePaise: number): { cgst: number; sgst: number; total: number } {
  const total = Math.round((taxablePaise * 18) / 100);
  const cgst = Math.floor(total / 2);
  return { cgst, sgst: total - cgst, total };
}

let sequence = 0;

describe('MONEY-03: GSTR-1 HSN summary nets every credit note of the period', () => {
  let pg: PGlite;
  let businessId: string;
  let financialYearId: string;
  let november: Gstr1ExportData;
  const invoiceIds = new Map<string, string>();

  async function plantInvoice(number: string, date: string, gstin: string | null, lines: readonly Line[]): Promise<void> {
    const taxable = lines.reduce((sum, line) => sum + line.taxablePaise, 0);
    const taxes = lines.map((line) => tax18(line.taxablePaise));
    const cgst = taxes.reduce((sum, t) => sum + t.cgst, 0);
    const sgst = taxes.reduce((sum, t) => sum + t.sgst, 0);
    const invoiceId = await insertOne(
      pg,
      `INSERT INTO invoices (business_id, financial_year_id, invoice_number, place_of_supply_state_code, billing_gstin_snapshot, billing_name_snapshot,
         subtotal_paise, total_tax_paise, total_cgst_paise, total_sgst_paise, total_igst_paise, grand_total_paise,
         seller_name_snapshot, seller_address_snapshot, seller_state_code_snapshot, seller_snapshot_source)
       VALUES ($1, $2, $3, '29', $4, 'Test Buyer', $5, $6, $7, $8, 0, $9,
         'Karnataka Shop', '{"city":"Bengaluru"}'::jsonb, '29', 'captured_at_finalization') RETURNING id`,
      [businessId, financialYearId, `DRAFT-${number}`, gstin, taxable, cgst + sgst, cgst, sgst, taxable + cgst + sgst],
    );
    for (const [index, line] of lines.entries()) {
      const t = taxes[index]!;
      await pg.query(
        `INSERT INTO invoice_line_items (invoice_id, description, hsn_sac_code, quantity, unit_of_measurement, unit_price_paise, taxable_value_paise, tax_rate_percentage, cgst_paise, sgst_paise, igst_paise, line_total_paise, sort_order)
         VALUES ($1, $2, $3, $4, 'NOS', $5, $5, 18.00, $6, $7, 0, $8, $9)`,
        [invoiceId, `Item ${line.hsn}`, line.hsn, line.quantity, line.taxablePaise, t.cgst, t.sgst, line.taxablePaise + t.total, index],
      );
    }
    await pg.query(
      `UPDATE invoices SET invoice_number = $2, invoice_sequence = $3, lifecycle_status = 'finalized', invoice_date = $4, finalized_at = now() WHERE id = $1`,
      [invoiceId, number, ++sequence, date],
    );
    invoiceIds.set(number, invoiceId);
  }

  async function plantCreditNote(number: string, date: string, originalInvoiceNumber: string, line: Line): Promise<void> {
    const originalId = invoiceIds.get(originalInvoiceNumber);
    if (!originalId) throw new Error(`unknown original invoice ${originalInvoiceNumber}`);
    const original = await pg.query<{ id: string }>(
      `SELECT id FROM invoice_line_items WHERE invoice_id = $1 AND hsn_sac_code = $2 LIMIT 1`,
      [originalId, line.hsn],
    );
    const originalLineId = original.rows[0]?.id;
    if (!originalLineId) throw new Error(`original invoice ${originalInvoiceNumber} has no ${line.hsn} line`);
    const t = tax18(line.taxablePaise);
    const creditNoteId = await insertOne(
      pg,
      `INSERT INTO credit_notes (business_id, original_invoice_id, financial_year_id, credit_note_number, reason, subtotal_paise, total_tax_paise, total_cgst_paise, total_sgst_paise, total_igst_paise, grand_total_paise,
         seller_name_snapshot, seller_address_snapshot, seller_state_code_snapshot, seller_snapshot_source, seller_gstin_snapshot)
       VALUES ($1, $2, $3, $4, '01-sales-return', $5, $6, $7, $8, 0, $9,
         'Karnataka Shop', '{"city":"Bengaluru"}'::jsonb, '29', 'captured_at_finalization', '29ABCDE1234F1Z5') RETURNING id`,
      [businessId, originalId, financialYearId, `DRAFT-${number}`, line.taxablePaise, t.total, t.cgst, t.sgst, line.taxablePaise + t.total],
    );
    await pg.query(
      `INSERT INTO credit_note_line_items (credit_note_id, original_line_item_id, description, hsn_sac_code, quantity, unit_of_measurement, unit_price_paise, taxable_value_paise, tax_rate_percentage, cgst_paise, sgst_paise, igst_paise, line_total_paise)
       VALUES ($1, $2, $3, $4, $5, 'NOS', $6, $6, 18.00, $7, $8, 0, $9)`,
      [creditNoteId, originalLineId, `Item ${line.hsn}`, line.hsn, line.quantity, line.taxablePaise, t.cgst, t.sgst, line.taxablePaise + t.total],
    );
    await pg.query(
      `UPDATE credit_notes SET credit_note_number = $2, credit_note_sequence = $3, lifecycle_status = 'finalized', issue_date = $4, finalized_at = now() WHERE id = $1`,
      [creditNoteId, number, ++sequence, date],
    );
  }

  beforeAll(async () => {
    pg = new PGlite();
    state.db = drizzle(pg, { schema });
    await applyAllMigrations(pg);
    businessId = await insertOne(
      pg,
      `INSERT INTO businesses (legal_name, gstin, address_line1, city, state_code, pincode) VALUES ('Karnataka Shop', '29ABCDE1234F1Z5', '1 Test Road', 'Bengaluru', '29', '560001') RETURNING id`,
    );
    financialYearId = await insertOne(
      pg,
      `INSERT INTO financial_years (business_id, label, start_date, end_date, is_current) VALUES ($1, '2026-27', '2026-04-01', '2027-03-31', true) RETURNING id`,
      [businessId],
    );
    state.businessId = businessId;

    // October: a registered (B2B) sale of laptops (8471) and an unregistered (B2CS) sale of notebooks (4820).
    await plantInvoice('INV-OCT-B2B', '2026-10-05', REGISTERED_GSTIN, [{ hsn: '8471', quantity: '2.000', taxablePaise: 8_000_000 }]);
    await plantInvoice('INV-OCT-B2C', '2026-10-06', null, [{ hsn: '4820', quantity: '10.000', taxablePaise: 100_000 }]);
    // November: only notebooks are sold (two fractional lines: 0.100 + 0.200), no laptops.
    await plantInvoice('INV-NOV-B2C', '2026-11-03', null, [
      { hsn: '4820', quantity: '0.100', taxablePaise: 1_000 },
      { hsn: '4820', quantity: '0.200', taxablePaise: 2_000 },
    ]);
    // November credit notes: one laptop returned from the October B2B sale (HSN 8471 has NO November sales: the bug),
    // and 3 notebooks returned from the October B2C sale (HSN 4820 has November sales).
    await plantCreditNote('CN-NOV-8471', '2026-11-10', 'INV-OCT-B2B', { hsn: '8471', quantity: '1.000', taxablePaise: 4_000_000 });
    await plantCreditNote('CN-NOV-4820', '2026-11-11', 'INV-OCT-B2C', { hsn: '4820', quantity: '3.000', taxablePaise: 30_000 });

    const result: ActionResult<Gstr1ExportData> = await getGstr1ExportData({
      startDate: '2026-11-01',
      endDate: '2026-11-30',
      label: 'November 2026',
    });
    if (!result.success) throw new Error(`GSTR-1 export failed: ${result.error.code}: ${result.error.message}`);
    november = result.data;
  }, 180_000);

  afterAll(async () => {
    await pg.close();
  });

  it('includes the cross-period credit note as a negative HSN row (it used to be dropped)', () => {
    const laptops = november.hsn.find((row) => row.hsnSacCode === '8471');
    expect(laptops).toBeDefined();
    expect(laptops?.taxableValuePaise).toBe(-4_000_000);
    expect(laptops?.centralTaxPaise).toBe(-tax18(4_000_000).cgst);
    expect(laptops?.stateUtTaxPaise).toBe(-tax18(4_000_000).sgst);
    expect(laptops?.totalQuantity).toBe(-1);
    expect(laptops?.totalValuePaise).toBe(-(4_000_000 + tax18(4_000_000).total));
  });

  it('nets the same-HSN credit note with exact quantities and no clamp at zero', () => {
    const notebooks = november.hsn.find((row) => row.hsnSacCode === '4820');
    // 0.100 + 0.200 sold − 3.000 returned = −2.700 (money and quantity move together).
    expect(notebooks?.totalQuantity).toBe(-2.7);
    expect(notebooks?.taxableValuePaise).toBe(1_000 + 2_000 - 30_000);
  });

  it('Table 12 taxable total equals B2B + B2CL + B2CS − CDNR − CDNUR (the portal reconciliation)', () => {
    const sum = (rows: ReadonlyArray<{ taxableValuePaise: number }>) => rows.reduce((total, row) => total + row.taxableValuePaise, 0);
    const hsnTotal = sum(november.hsn);
    const tablesTotal = sum(november.b2b) + sum(november.b2cl) + sum(november.b2cs) - sum(november.cdnr) - sum(november.cdnur);
    expect(november.cdnr.length).toBe(1); // the laptop credit note is reported in Table 9B...
    expect(hsnTotal).toBe(tablesTotal); // ...and now also in Table 12
  });
});
