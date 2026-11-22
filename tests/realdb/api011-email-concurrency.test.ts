import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { ActionError } from '@/lib/actions/_shared/errors';
import * as schema from '@/lib/db/schema';
import { withTransactionRetry } from '@/lib/db/transaction';
import { getOrCreateCurrentFinancialYear } from '@/lib/invoices/financial-year-rollover';
import {
  claimReminderInTransaction,
  claimInvoiceEmailInTransaction,
} from '@/lib/invoices/email-claim-tx';
import {
  type TestDb,
  type TestBusiness,
  getTestDatabaseUrl,
  validateTestDatabaseUrl,
  createTestDbClient,
  createTestBusiness,
  cleanupTestBusiness,
} from './helpers/db';

// TEST-02: moved from tests/integration, where a "skip when no test database" guard silently skipped it in every CI run.
describe('API-011: Outbound email claim concurrency (REAL Postgres)', () => {
  let testDb: TestDb;
  let testBusiness: TestBusiness;
  let defaultFyId: string;
  let customerId: string;
  let seqCounter = 5000;

  beforeAll(async () => {
    const validUrl = validateTestDatabaseUrl(getTestDatabaseUrl());
    testDb = createTestDbClient(validUrl);
    testBusiness = await createTestBusiness(testDb);

    const fy = await testDb.transaction(async (tx) => {
      return getOrCreateCurrentFinancialYear(tx, testBusiness.id, new Date());
    });
    defaultFyId = fy.id;

    const [cust] = await testDb
      .insert(schema.customers)
      .values({
        business_id: testBusiness.id,
        name: 'Concurrency Customer',
        email: 'concurrency.customer@example.com',
        state_code: '27',
        city: 'Mumbai',
        pincode: '400001',
      })
      .returning();

    if (!cust) {
      throw new Error('Failed to create customer for concurrency tests');
    }
    customerId = cust.id;
  }, 60_000);

  afterAll(async () => {
    if (testDb && testBusiness) {
      await cleanupTestBusiness(testDb, testBusiness.id);
    }
  }, 60_000);

  async function createTestFinalizedInvoice(options: {
    readonly isArchived?: boolean;
    readonly isOverdue?: boolean;
  } = {}): Promise<string> {
    const currentSeq = seqCounter++;
    const [inv] = await testDb
      .insert(schema.invoices)
      .values({
        business_id: testBusiness.id,
        financial_year_id: defaultFyId,
        customer_id: customerId,
        invoice_number: `INV-CONC-${randomBytes(4).toString('hex').toUpperCase()}`,
        lifecycle_status: 'finalized',
        invoice_sequence: currentSeq,
        invoice_date: '2026-04-01',
        due_date: options.isOverdue ? '2026-04-10' : '2099-01-01',
        place_of_supply_state_code: '27',
        subtotal_paise: 10000,
        total_cgst_paise: 900,
        total_sgst_paise: 900,
        total_igst_paise: 0,
        total_tax_paise: 1800,
        grand_total_paise: 11800,
        payment_status: 'unpaid',
        archival_status: options.isArchived ? 'archived' : 'pending',
        pdf_storage_key: options.isArchived ? 'invoices/concurrency.pdf' : null,
        finalized_at: new Date('2026-04-01T00:00:00Z'),
        seller_name_snapshot: testBusiness.legalName,
        seller_address_snapshot: { line1: '123 Concurrency Way', line2: null, city: 'Mumbai', pincode: '400001' },
        seller_state_code_snapshot: '27',
        seller_snapshot_source: 'captured_at_finalization',
      })
      .returning();

    if (!inv) throw new Error('Failed to create test finalized invoice');
    return inv.id;
  }

  it('10 parallel claimReminderInTransaction for one overdue invoice -> exactly 1 fulfilled, 9 COOLDOWN, reminder_count = 1', async () => {
    const invoiceId = await createTestFinalizedInvoice({ isOverdue: true });
    const now = new Date('2026-05-01T10:00:00Z');

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, async () => {
        return withTransactionRetry(() =>
          testDb.transaction(async (tx) => {
            return claimReminderInTransaction(tx, {
              businessId: testBusiness.id,
              invoiceId,
              now,
            });
          }),
        );
      }),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(9);

    for (const r of rejected) {
      if (r.status === 'rejected') {
        expect(r.reason).toBeInstanceOf(ActionError);
        expect((r.reason as ActionError).code).toBe('COOLDOWN');
      }
    }

    const [inv] = await testDb
      .select({ reminder_count: schema.invoices.reminder_count })
      .from(schema.invoices)
      .where(eq(schema.invoices.id, invoiceId));

    expect(inv?.reminder_count).toBe(1);
  });

  it('10 parallel claimInvoiceEmailInTransaction -> exactly 1 fulfilled, email_send_count +1', async () => {
    const invoiceId = await createTestFinalizedInvoice({ isArchived: true });
    const now = new Date('2026-05-01T12:00:00Z');

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, async () => {
        return withTransactionRetry(() =>
          testDb.transaction(async (tx) => {
            return claimInvoiceEmailInTransaction(tx, {
              businessId: testBusiness.id,
              invoiceId,
              now,
            });
          }),
        );
      }),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(9);

    for (const r of rejected) {
      if (r.status === 'rejected') {
        expect(r.reason).toBeInstanceOf(ActionError);
        expect((r.reason as ActionError).code).toBe('COOLDOWN');
      }
    }

    const [inv] = await testDb
      .select({ email_send_count: schema.invoices.email_send_count })
      .from(schema.invoices)
      .where(eq(schema.invoices.id, invoiceId));

    expect(inv?.email_send_count).toBe(1);
  });

  it('20 parallel claims on 20 different invoices of one business all succeed without deadlocks or timeouts', async () => {
    const invoiceIds = await Promise.all(
      Array.from({ length: 20 }, async () => {
        return createTestFinalizedInvoice({ isArchived: true });
      }),
    );

    const now = new Date('2026-05-01T14:00:00Z');

    const results = await Promise.allSettled(
      invoiceIds.map(async (invoiceId) => {
        return withTransactionRetry(() =>
          testDb.transaction(async (tx) => {
            return claimInvoiceEmailInTransaction(tx, {
              businessId: testBusiness.id,
              invoiceId,
              now,
            });
          }),
        );
      }),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled.length).toBe(20);
  });
});
