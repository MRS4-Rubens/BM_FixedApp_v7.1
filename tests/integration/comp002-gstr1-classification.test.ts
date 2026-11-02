import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { ActionResult } from '@/lib/actions/_shared/types';
import * as schema from '@/lib/db/schema';

/**
 * COMP-002 integration tests. The REAL GSTR-1 server action and the REAL Excel builder run against a REAL in-process
 * PostgreSQL (PGlite) with every migration applied. Business is in Karnataka (state 29); "inter-State" invoices have
 * Place of Supply 27 (Maharashtra). All amounts are integer paise.
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
import { buildGstr1Workbook } from '@/lib/excel/build-gstr1-report';

const DRIZZLE_DIR = join(process.cwd(), 'drizzle');
const REGISTERED_GSTIN = '27AAAAA0000A1Z5';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function applyAllMigrations(pg: PGlite): Promise<void> {
  const raw: unknown = JSON.parse(readFileSync(join(DRIZZLE_DIR, 'meta', '_journal.json'), 'utf8'));
  if (!isRecord(raw) || !Array.isArray(raw.entries)) {
    throw new Error('journal has no entries array');
  }
  for (const entry of raw.entries as unknown[]) {
    if (!isRecord(entry) || typeof entry.tag !== 'string') {
      throw new Error('malformed journal entry');
    }
    const statements = readFileSync(join(DRIZZLE_DIR, `${entry.tag}.sql`), 'utf8')
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);
    for (const statement of statements) {
      await pg.exec(statement);
    }
  }
}

interface IdRow {
  id: string;
}

async function insertOne(pg: PGlite, sqlText: string, params: unknown[] = []): Promise<string> {
  const result = await pg.query<IdRow>(sqlText, params);
  const row = result.rows[0];
  if (!row) {
    throw new Error(`no row returned for: ${sqlText}`);
  }
  return row.id;
}

/** Splits a tax-inclusive value into taxable + tax using integer paise only (18% GST). */
function split18(grandPaise: number): { taxable: number; tax: number } {
  const taxable = Math.round((grandPaise * 100) / 118);
  return { taxable, tax: grandPaise - taxable };
}

let sequence = 0;

describe('COMP-002: GSTR-1 B2CL threshold (effective-dated) and CDNUR', () => {
  let pg: PGlite;
  let businessId: string;
  let financialYearId: string;
  let data: Gstr1ExportData;
  const invoiceIds = new Map<string, string>();
  const invoiceGrand = new Map<string, number>();
  const creditNoteGrand = new Map<string, number>();

  async function plantInvoice(
    number: string,
    date: string,
    grandPaise: number,
    placeOfSupply: string,
    gstin: string | null,
  ): Promise<void> {
    const { taxable, tax } = split18(grandPaise);
    const interState = placeOfSupply !== '29';
    const cgst = interState ? 0 : Math.floor(tax / 2);
    const sgst = interState ? 0 : tax - cgst;
    const igst = interState ? tax : 0;
    const invoiceId = await insertOne(
      pg,
      `INSERT INTO invoices (business_id, financial_year_id, invoice_number, place_of_supply_state_code, billing_gstin_snapshot, billing_name_snapshot,
         subtotal_paise, total_tax_paise, total_cgst_paise, total_sgst_paise, total_igst_paise, grand_total_paise,
         seller_name_snapshot, seller_address_snapshot, seller_state_code_snapshot, seller_snapshot_source)
       VALUES ($1, $2, $3, $4, $5, 'Test Buyer', $6, $7, $8, $9, $10, $11,
         'Karnataka Shop', '{"city":"Bengaluru"}'::jsonb, '29', 'captured_at_finalization') RETURNING id`,
      [businessId, financialYearId, `DRAFT-${number}`, placeOfSupply, gstin, taxable, tax, cgst, sgst, igst, grandPaise],
    );
    await pg.query(
      `INSERT INTO invoice_line_items (invoice_id, description, hsn_sac_code, quantity, unit_of_measurement, unit_price_paise, taxable_value_paise, tax_rate_percentage, cgst_paise, sgst_paise, igst_paise, line_total_paise)
       VALUES ($1, 'Goods', '4820', 1.000, 'NOS', $2, $2, 18.00, $3, $4, $5, $6)`,
      [invoiceId, taxable, cgst, sgst, igst, grandPaise],
    );
    await pg.query(
      `UPDATE invoices SET invoice_number = $2, invoice_sequence = $3, lifecycle_status = 'finalized', invoice_date = $4, finalized_at = now() WHERE id = $1`,
      [invoiceId, number, ++sequence, date],
    );
    invoiceIds.set(number, invoiceId);
    invoiceGrand.set(number, grandPaise);
  }

  async function plantCreditNote(
    number: string,
    date: string,
    grandPaise: number,
    originalInvoiceNumber: string,
    voided = false,
  ): Promise<void> {
    const originalId = invoiceIds.get(originalInvoiceNumber);
    if (!originalId) {
      throw new Error(`unknown original invoice ${originalInvoiceNumber}`);
    }
    const originalPos = await pg.query<{ place_of_supply_state_code: string }>(`SELECT place_of_supply_state_code FROM invoices WHERE id = $1`, [originalId]);
    const interState = originalPos.rows[0]?.place_of_supply_state_code !== '29';
    const origLineRes = await pg.query<{ id: string }>(
      `SELECT id FROM invoice_line_items WHERE invoice_id = $1 LIMIT 1`,
      [originalId],
    );
    const origLineId = origLineRes.rows[0]?.id;
    if (!origLineId) {
      throw new Error(`original invoice ${originalInvoiceNumber} has no line items`);
    }
    const { taxable, tax } = split18(grandPaise);
    const cgst = interState ? 0 : Math.floor(tax / 2);
    const sgst = interState ? 0 : tax - cgst;
    const igst = interState ? tax : 0;
    const creditNoteId = await insertOne(
      pg,
      `INSERT INTO credit_notes (business_id, original_invoice_id, financial_year_id, credit_note_number, reason, subtotal_paise, total_tax_paise, total_cgst_paise, total_sgst_paise, total_igst_paise, grand_total_paise,
         seller_name_snapshot, seller_address_snapshot, seller_state_code_snapshot, seller_snapshot_source, seller_gstin_snapshot)
       VALUES ($1, $2, $3, $4, '01-sales-return', $5, $6, $7, $8, $9, $10,
         'Karnataka Shop', '{"city":"Bengaluru"}'::jsonb, '29', 'captured_at_finalization', '29ABCDE1234F1Z5') RETURNING id`,
      [businessId, originalId, financialYearId, `DRAFT-${number}`, taxable, tax, cgst, sgst, igst, grandPaise],
    );
    await pg.query(
      `INSERT INTO credit_note_line_items (credit_note_id, original_line_item_id, description, hsn_sac_code, quantity, unit_of_measurement, unit_price_paise, taxable_value_paise, tax_rate_percentage, cgst_paise, sgst_paise, igst_paise, line_total_paise)
       VALUES ($1, $2, 'Goods', '4820', 1.000, 'NOS', $3, $3, 18.00, $4, $5, $6, $7)`,
      [creditNoteId, origLineId, taxable, cgst, sgst, igst, grandPaise],
    );
    await pg.query(
      `UPDATE credit_notes SET credit_note_number = $2, credit_note_sequence = $3, lifecycle_status = 'finalized', issue_date = $4, finalized_at = now() WHERE id = $1`,
      [creditNoteId, number, ++sequence, date],
    );
    if (voided) {
      await pg.query(`UPDATE credit_notes SET status = 'voided', voided_at = now(), void_reason = 'test' WHERE id = $1`, [creditNoteId]);
    }
    creditNoteGrand.set(number, grandPaise);
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
      `INSERT INTO financial_years (business_id, label, start_date, end_date, is_current) VALUES ($1, '2024-25', '2024-04-01', '2025-03-31', true) RETURNING id`,
      [businessId],
    );
    state.businessId = businessId;

    // ---- invoices (all unregistered, inter-State, unless stated) ----
    await plantInvoice('INV-150K-NEW', '2024-10-10', 15_000_000, '27', null); // > 1 lakh, after 1-Aug-2024  -> B2CL (the audit scenario)
    await plantInvoice('INV-1L-EXACT', '2024-10-11', 10_000_000, '27', null); // exactly 1 lakh               -> B2CS
    await plantInvoice('INV-1L-PLUS1', '2024-10-12', 10_000_001, '27', null); // Rs 1,00,000.01               -> B2CL
    await plantInvoice('INV-99999', '2024-10-13', 9_999_999, '27', null); // Rs 99,999.99                      -> B2CS
    await plantInvoice('INV-150K-OLD', '2024-07-31', 15_000_000, '27', null); // 31-Jul-2024: old 2.5 lakh rule -> B2CS
    await plantInvoice('INV-150K-1AUG', '2024-08-01', 15_000_000, '27', null); // 1-Aug-2024: new rule           -> B2CL
    await plantInvoice('INV-250K-OLD', '2024-07-31', 25_000_000, '27', null); // exactly 2.5 lakh, old rule     -> B2CS
    await plantInvoice('INV-250K1-OLD', '2024-07-31', 25_000_001, '27', null); // Rs 2,50,000.01, old rule      -> B2CL
    await plantInvoice('INV-150K-INTRA', '2024-10-14', 15_000_000, '29', null); // same State: never B2CL        -> B2CS
    await plantInvoice('INV-B2B-5L', '2024-10-15', 50_000_000, '27', REGISTERED_GSTIN); // registered recipient    -> B2B

    // ---- credit notes ----
    await plantCreditNote('CN-A', '2024-10-20', 3_000_000, 'INV-150K-NEW'); // against B2CL        -> CDNUR
    await plantCreditNote('CN-B', '2024-10-21', 1_000_000, 'INV-1L-EXACT'); // against B2CS        -> netted in B2CS
    await plantCreditNote('CN-C', '2024-10-22', 2_000_000, 'INV-150K-OLD'); // original B2CS then  -> netted in B2CS
    await plantCreditNote('CN-D', '2024-10-23', 4_000_000, 'INV-150K-1AUG'); // against B2CL       -> CDNUR
    await plantCreditNote('CN-E', '2024-10-24', 5_000_000, 'INV-B2B-5L'); // registered recipient  -> CDNR
    await plantCreditNote('CN-F-VOID', '2024-10-25', 6_000_000, 'INV-150K-NEW', true); // voided   -> ignored
    await plantCreditNote('CN-G', '2024-10-26', 7_000_000, 'INV-150K-INTRA'); // intra-State        -> netted in B2CS (same State)

    const result: ActionResult<Gstr1ExportData> = await getGstr1ExportData({ startDate: '2024-07-01', endDate: '2024-12-31', label: 'Test period' });
    if (!result.success) {
      throw new Error(`GSTR-1 export failed: ${result.error.code}: ${result.error.message}`);
    }
    data = result.data;
  }, 180_000);

  afterAll(async () => {
    await pg.close();
  });

  const taxableOf = (grandPaise: number): number => split18(grandPaise).taxable;
  const grand = (number: string): number => {
    const value = invoiceGrand.get(number) ?? creditNoteGrand.get(number);
    if (value === undefined) {
      throw new Error(`unknown document ${number}`);
    }
    return value;
  };

  describe('Table 5 (B2CL) vs Table 7 (B2CS) classification of invoices', () => {
    it('reports exactly the large inter-State B2C invoices as B2CL, using the threshold in force on each invoice date', () => {
      const b2clNumbers = [...new Set(data.b2cl.map((row) => row.invoiceNumber))].sort();
      expect(b2clNumbers).toEqual(['INV-150K-1AUG', 'INV-150K-NEW', 'INV-1L-PLUS1', 'INV-250K1-OLD']);
    });

    it('keeps the boundary and intra-State invoices out of B2CL, and the registered one in B2B only', () => {
      const b2clNumbers = new Set(data.b2cl.map((row) => row.invoiceNumber));
      for (const number of ['INV-1L-EXACT', 'INV-99999', 'INV-150K-OLD', 'INV-250K-OLD', 'INV-150K-INTRA', 'INV-B2B-5L']) {
        expect(b2clNumbers.has(number), number).toBe(false);
      }
      expect([...new Set(data.b2b.map((row) => row.invoiceNumber))]).toEqual(['INV-B2B-5L']);
    });

    it('B2CL rows carry the invoice value and taxable value in integer paise', () => {
      const row = data.b2cl.find((candidate) => candidate.invoiceNumber === 'INV-150K-NEW');
      expect(row?.invoiceValuePaise).toBe(15_000_000);
      expect(row?.taxableValuePaise).toBe(taxableOf(15_000_000));
      expect(row?.invoiceDate).toBe('10-Oct-2024');
    });

    it('B2CS holds the small inter-State invoices and the intra-State invoice, net of the credit notes that follow them', () => {
      const interState = data.b2cs.find((row) => row.placeOfSupply.startsWith('27'));
      const intraState = data.b2cs.find((row) => row.placeOfSupply.startsWith('29'));
      const expectedInterState =
        taxableOf(grand('INV-1L-EXACT')) +
        taxableOf(grand('INV-99999')) +
        taxableOf(grand('INV-150K-OLD')) +
        taxableOf(grand('INV-250K-OLD')) -
        taxableOf(grand('CN-B')) -
        taxableOf(grand('CN-C'));
      expect(interState?.taxableValuePaise).toBe(expectedInterState);
      expect(intraState?.taxableValuePaise).toBe(taxableOf(grand('INV-150K-INTRA')) - taxableOf(grand('CN-G')));
    });
  });

  describe('Table 9B (CDNUR) for credit notes against B2CL invoices', () => {
    it('reports credit notes against B2CL invoices in CDNUR with the original invoice details, and nowhere else', () => {
      expect(data.cdnur.map((row) => row.noteNumber).sort()).toEqual(['CN-A', 'CN-D']);
      const rowA = data.cdnur.find((row) => row.noteNumber === 'CN-A');
      expect(rowA).toMatchObject({
        urType: 'B2CL',
        documentType: 'C',
        originalInvoiceNumber: 'INV-150K-NEW',
        originalInvoiceDate: '10-Oct-2024',
        noteDate: '20-Oct-2024',
        noteValuePaise: 3_000_000,
        taxableValuePaise: taxableOf(3_000_000),
        ratePercentage: 18,
      });
      const rowD = data.cdnur.find((row) => row.noteNumber === 'CN-D');
      expect(rowD?.originalInvoiceNumber).toBe('INV-150K-1AUG');
      expect(rowD?.originalInvoiceDate).toBe('01-Aug-2024');
    });

    it('follows the ORIGINAL invoice: a credit note against a pre-1-Aug-2024 invoice is netted in B2CS, not CDNUR', () => {
      expect(data.cdnur.some((row) => row.noteNumber === 'CN-C')).toBe(false);
    });

    it('ignores voided credit notes, keeps registered-recipient notes in CDNR, and does not net CDNUR notes against B2CS', () => {
      expect(data.cdnur.some((row) => row.noteNumber === 'CN-F-VOID')).toBe(false);
      expect(data.cdnr.map((row) => row.noteNumber)).toEqual(['CN-E']);
      const allB2csTaxable = data.b2cs.reduce((sum, row) => sum + row.taxableValuePaise, 0);
      const expected =
        taxableOf(grand('INV-1L-EXACT')) + taxableOf(grand('INV-99999')) + taxableOf(grand('INV-150K-OLD')) + taxableOf(grand('INV-250K-OLD')) + taxableOf(grand('INV-150K-INTRA')) -
        taxableOf(grand('CN-B')) - taxableOf(grand('CN-C')) - taxableOf(grand('CN-G'));
      expect(allB2csTaxable).toBe(expected);
    });

    it('keeps the B2CS summary equal to the B2CS rows (credit notes netted there exactly once, CDNUR notes never)', () => {
      const b2csInvoices = ['INV-1L-EXACT', 'INV-99999', 'INV-150K-OLD', 'INV-250K-OLD', 'INV-150K-INTRA'];
      const nettedNotes = ['CN-B', 'CN-C', 'CN-G'];
      const taxOf = (number: string): number => grand(number) - taxableOf(grand(number));
      const expectedTaxable =
        b2csInvoices.reduce((sum, number) => sum + taxableOf(grand(number)), 0) - nettedNotes.reduce((sum, number) => sum + taxableOf(grand(number)), 0);
      const expectedTax =
        b2csInvoices.reduce((sum, number) => sum + taxOf(number), 0) - nettedNotes.reduce((sum, number) => sum + taxOf(number), 0);
      expect(data.summary.b2csTaxablePaise).toBe(expectedTaxable);
      expect(data.summary.b2csTaxPaise).toBe(expectedTax);
      expect(data.summary.b2csTaxablePaise).toBe(data.b2cs.reduce((sum, row) => sum + row.taxableValuePaise, 0));
    });

    it('keeps the summary consistent with the rows and every unregistered credit note still reduces the outward totals', () => {
      expect(data.summary.cdnurCount).toBe(2);
      expect(data.summary.cdnurTaxablePaise).toBe(taxableOf(grand('CN-A')) + taxableOf(grand('CN-D')));
      expect(data.summary.cdnurTaxPaise).toBe(grand('CN-A') - taxableOf(grand('CN-A')) + (grand('CN-D') - taxableOf(grand('CN-D'))));
      const allInvoiceTaxable = [...invoiceGrand.values()].reduce((sum, value) => sum + taxableOf(value), 0);
      const unregisteredCreditNoteTaxable = ['CN-A', 'CN-B', 'CN-C', 'CN-D', 'CN-G'].reduce((sum, number) => sum + taxableOf(grand(number)), 0);
      expect(data.summary.totalTaxablePaise).toBe(allInvoiceTaxable - unregisteredCreditNoteTaxable);
    });
  });

  describe('Excel (offline utility) output', () => {
    it('writes the b2cl and cdnur sheets with the official column headers and the right rows', async () => {
      const workbook = await buildGstr1Workbook(data);
      const b2cl = workbook.getWorksheet('b2cl');
      const cdnur = workbook.getWorksheet('cdnur');
      expect(b2cl).toBeDefined();
      expect(cdnur).toBeDefined();

      const headers: string[] = [];
      cdnur?.getRow(1).eachCell((cell) => headers.push(String(cell.value)));
      expect(headers).toEqual([
        'UR Type',
        'Note/Refund Voucher Number',
        'Note/Refund Voucher date',
        'Document Type',
        'Invoice/Advance Receipt Number',
        'Invoice/Advance Receipt date',
        'Place Of Supply',
        'Note/Refund Voucher Value',
        'Applicable % of Tax Rate',
        'Rate',
        'Taxable Value',
        'Cess Amount',
      ]);

      const cdnurNotes: string[] = [];
      cdnur?.eachRow((row, rowNumber) => {
        if (rowNumber > 1) {
          cdnurNotes.push(String(row.getCell(2).value));
          expect(row.getCell(1).value).toBe('B2CL');
          expect(row.getCell(4).value).toBe('C');
        }
      });
      expect(cdnurNotes.sort()).toEqual(['CN-A', 'CN-D']);

      const b2clInvoices: string[] = [];
      b2cl?.eachRow((row, rowNumber) => {
        if (rowNumber > 1) {
          b2clInvoices.push(String(row.getCell(1).value));
        }
      });
      expect([...new Set(b2clInvoices)].sort()).toEqual(['INV-150K-1AUG', 'INV-150K-NEW', 'INV-1L-PLUS1', 'INV-250K1-OLD']);
    });
  });
});

