import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, sql, type SQL } from 'drizzle-orm';
import type { getDb } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import { getOrCreateCurrentFinancialYear } from '@/lib/invoices/financial-year-rollover';
import { formatIstDateAsIso } from '@/lib/invoices/ist-date';
import { makeValidGstin, randomPan } from './fixtures';

export { validateTestDatabaseUrl } from './url-guard';

/**
 * Same Drizzle type the application uses. The runtime client is node-postgres over plain TCP (works against a
 * CI service container and a Neon branch). This single cast is the only type boundary: both clients are Drizzle's
 * PG dialect and the code under test uses no driver-specific API.
 */
export type TestDb = ReturnType<typeof getDb>;

const poolRegistry = new WeakMap<object, Pool>();

export function getTestDatabaseUrl(): string | undefined {
  return process.env.TEST_DATABASE_URL;
}

export function createTestDbClient(connectionString: string): TestDb {
  const pool = new Pool({ connectionString, max: 12 });
  const db = drizzle(pool, { schema }) as unknown as TestDb;
  poolRegistry.set(db as object, pool);
  return db;
}

export async function closeTestDb(testDb: TestDb): Promise<void> {
  const pool = poolRegistry.get(testDb as object);
  if (pool) {
    await pool.end();
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Postgres cannot bind parameters inside DDL (CREATE TRIGGER ... WHEN (...)), so test triggers must embed the
 * id as a literal. The value is validated as a UUID first, which makes the raw literal injection-safe.
 */
export function uuidLiteral(id: string): SQL {
  if (!UUID_PATTERN.test(id)) {
    throw new Error(`uuidLiteral: not a UUID: ${id}`);
  }
  return sql.raw(`'${id}'::uuid`);
}

/** Message of an error plus every nested `cause` (Drizzle wraps driver errors as "Failed query: ..."). */
export function errorChainText(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current !== undefined && current !== null; depth += 1) {
    parts.push(current instanceof Error ? current.message : String(current));
    current = current instanceof Error ? current.cause : undefined;
  }
  return parts.join(' <- ');
}

export interface TestBusiness {
  readonly id: string;
  readonly gstin: string;
  readonly legalName: string;
}

export async function createTestBusiness(testDb: TestDb): Promise<TestBusiness> {
  const hex = randomBytes(4).toString('hex').toUpperCase();
  // Real 15-char GSTIN: state(2) + PAN(10) + entity(1) + 'Z' + Mod-36 check char. businesses.gstin is varchar(15).
  const gstin = makeValidGstin('27', randomPan());
  const legalName = `API002 Test Business ${hex}`;

  const [inserted] = await testDb
    .insert(schema.businesses)
    .values({
      legal_name: legalName,
      gstin,
      address_line1: '123 Concurrency Way',
      city: 'Mumbai',
      state_code: '27',
      pincode: '400001',
      subscription_plan: 'professional',
      subscription_status: 'active',
      invoice_number_format: 'INV-{YY}/{SEQ:4}',
      credit_note_number_prefix: 'CN',
      default_invoice_template: 'template_1',
      default_gst_rate_type: 'exclusive',
      payment_due_days: 30,
    })
    .returning();

  if (!inserted) {
    throw new Error('Failed to insert test business');
  }

  return {
    id: inserted.id,
    gstin: inserted.gstin,
    legalName: inserted.legal_name,
  };
}

export async function createTestDraftInvoice(
  testDb: TestDb,
  businessId: string,
  options?: { readonly invoiceDate?: Date },
): Promise<{ readonly invoiceId: string; readonly financialYearId: string }> {
  const dateObj = options?.invoiceDate ?? new Date();

  const fy = await testDb.transaction(async (tx) => {
    return getOrCreateCurrentFinancialYear(tx, businessId, dateObj);
  });

  const [invoice] = await testDb
    .insert(schema.invoices)
    .values({
      business_id: businessId,
      financial_year_id: fy.id,
      invoice_number: `DRAFT-${randomBytes(6).toString('hex')}`,
      lifecycle_status: 'draft',
      // Same IST calendar day the financial year was resolved for, so the date policy (no future dates,
      // bounded backdating) holds whenever the suite runs.
      invoice_date: formatIstDateAsIso(dateObj),
      place_of_supply_state_code: '27',
      subtotal_paise: 10000,
      total_cgst_paise: 900,
      total_sgst_paise: 900,
      total_igst_paise: 0,
      total_tax_paise: 1800,
      grand_total_paise: 11800,
      gst_rate_type: 'exclusive',
    })
    .returning();

  if (!invoice) {
    throw new Error('Failed to create draft invoice');
  }

  await testDb.insert(schema.invoiceLineItems).values({
    invoice_id: invoice.id,
    description: 'Test Item',
    hsn_sac_code: '998311',
    quantity: '1.000',
    unit_of_measurement: 'NOS',
    unit_price_paise: 10000,
    discount_paise: 0,
    taxable_value_paise: 10000,
    tax_rate_percentage: '18.00',
    cgst_paise: 900,
    sgst_paise: 900,
    igst_paise: 0,
    line_total_paise: 11800,
    sort_order: 0,
  });

  return {
    invoiceId: invoice.id,
    financialYearId: fy.id,
  };
}

export async function createTestDraftCreditNote(
  testDb: TestDb,
  businessId: string,
  originalInvoiceId: string,
  financialYearId: string,
): Promise<{ readonly creditNoteId: string }> {
  // API-004: every credit-note line must reference a line of the original invoice
  // (CHECK cnli_original_line_required), and finalize re-derives amounts from that line.
  const [originalLine] = await testDb
    .select({ id: schema.invoiceLineItems.id })
    .from(schema.invoiceLineItems)
    .where(eq(schema.invoiceLineItems.invoice_id, originalInvoiceId))
    .orderBy(schema.invoiceLineItems.sort_order)
    .limit(1);
  if (!originalLine) {
    throw new Error('createTestDraftCreditNote: the original invoice has no line items');
  }

  const [cn] = await testDb
    .insert(schema.creditNotes)
    .values({
      business_id: businessId,
      original_invoice_id: originalInvoiceId,
      financial_year_id: financialYearId,
      credit_note_number: `DRAFT-CN-${randomBytes(6).toString('hex')}`,
      reason: 'Overbilling correction',
      lifecycle_status: 'draft',
      status: 'active',
      issue_date: formatIstDateAsIso(new Date()),
      subtotal_paise: 5000,
      total_cgst_paise: 450,
      total_sgst_paise: 450,
      total_igst_paise: 0,
      total_tax_paise: 900,
      grand_total_paise: 5900,
    })
    .returning();

  if (!cn) {
    throw new Error('Failed to create draft credit note');
  }

  await testDb.insert(schema.creditNoteLineItems).values({
    credit_note_id: cn.id,
    original_line_item_id: originalLine.id,
    description: 'Test Item',
    hsn_sac_code: '998311',
    quantity: '0.500',
    unit_of_measurement: 'NOS',
    unit_price_paise: 10000,
    discount_paise: 0,
    taxable_value_paise: 5000,
    tax_rate_percentage: '18.00',
    cgst_paise: 450,
    sgst_paise: 450,
    igst_paise: 0,
    line_total_paise: 5900,
    sort_order: 0,
  });

  return {
    creditNoteId: cn.id,
  };
}

export async function cleanupTestBusiness(testDb: TestDb, businessId: string): Promise<void> {
  try {
    await testDb.transaction(async (tx) => {
      await tx.execute(sql`set session_replication_role = replica`);
      await tx.delete(schema.businesses).where(eq(schema.businesses.id, businessId));
    });
  } catch (err: unknown) {
    console.warn(
      'Best-effort cleanup note: DB-001 triggers or permissions prevented row deletion. Please delete the disposable Neon branch after testing.',
      err,
    );
  }
}
