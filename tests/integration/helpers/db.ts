import { randomBytes } from 'node:crypto';
import { Pool, neonConfig } from '@neondatabase/serverless';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from 'ws';
import * as schema from '@/lib/db/schema';
import { getOrCreateCurrentFinancialYear } from '@/lib/invoices/financial-year-rollover';

neonConfig.webSocketConstructor = ws;

export type TestDb = ReturnType<typeof createTestDbClient>;

export function getTestDatabaseUrl(): string | undefined {
  return process.env.TEST_DATABASE_URL;
}

export function validateTestDatabaseUrl(url: string | undefined): string {
  if (!url) {
    throw new Error('TEST_DATABASE_URL is not set.');
  }

  const mainDb = process.env.DATABASE_URL;
  const unpooledDb = process.env.DATABASE_URL_UNPOOLED;

  if (url === mainDb || url === unpooledDb) {
    throw new Error(
      'REFUSING TO RUN INTEGRATION TESTS: TEST_DATABASE_URL matches DATABASE_URL or DATABASE_URL_UNPOOLED. Integration tests MUST run against a disposable Neon branch.',
    );
  }

  return url;
}

export function createTestDbClient(connectionString: string) {
  const pool = new Pool({
    connectionString,
    max: 12,
  });
  return drizzle(pool, { schema });
}

export interface TestBusiness {
  readonly id: string;
  readonly gstin: string;
  readonly legalName: string;
}

export async function createTestBusiness(testDb: TestDb): Promise<TestBusiness> {
  const hex = randomBytes(4).toString('hex').toUpperCase();
  // Format GSTIN: 2 digits state + 10 alphanumeric PAN-like + 1 entity + 'Z' + 1 checksum (15 chars)
  const gstin = `27TESTB${hex}1Z5`;
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
      invoice_date: '2026-10-28',
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
      issue_date: '2026-10-28',
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

