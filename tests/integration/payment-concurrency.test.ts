import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { ActionError } from '@/lib/actions/_shared/errors';
import * as schema from '@/lib/db/schema';
import { withTransactionRetry } from '@/lib/db/transaction';
import { finalizeDraftCreditNoteInTransaction } from '@/lib/invoices/finalize-credit-note-tx';
import { finalizeDraftInvoiceInTransaction } from '@/lib/invoices/finalize-invoice-tx';
import {
  recordPaymentInTransaction,
  voidPaymentInTransaction,
} from '@/lib/invoices/payment-tx';
import { voidCreditNoteInTransaction } from '@/lib/invoices/void-credit-note-tx';
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

const testDbUrl = getTestDatabaseUrl();

describe.skipIf(!testDbUrl)('Payment & Void Concurrency tests (REAL Postgres)', () => {
  let testDb: TestDb;
  let testBusiness: TestBusiness;
  let defaultFyId: string;

  beforeAll(async () => {
    const validUrl = validateTestDatabaseUrl(testDbUrl);
    testDb = createTestDbClient(validUrl);
    testBusiness = await createTestBusiness(testDb);

    // Warm up the financial year
    const warmup = await createTestDraftInvoice(testDb, testBusiness.id);
    defaultFyId = warmup.financialYearId;
    await testDb.transaction((tx) =>
      finalizeDraftInvoiceInTransaction(tx, {
        invoiceId: warmup.invoiceId,
        businessId: testBusiness.id,
      }),
    );
  }, 60_000);

  afterAll(async () => {
    if (testDb && testBusiness) {
      await cleanupTestBusiness(testDb, testBusiness.id);
    }
  }, 60_000);

  async function createCustomFinalizedInvoice(
    grandTotalPaise: number,
    invoiceDate = '2026-10-28',
  ): Promise<string> {
    const [invoice] = await testDb
      .insert(schema.invoices)
      .values({
        business_id: testBusiness.id,
        financial_year_id: defaultFyId,
        invoice_number: `DRAFT-${randomBytes(6).toString('hex')}`,
        lifecycle_status: 'draft',
        invoice_date: invoiceDate,
        place_of_supply_state_code: '27',
        subtotal_paise: grandTotalPaise,
        total_cgst_paise: 0,
        total_sgst_paise: 0,
        total_igst_paise: 0,
        total_tax_paise: 0,
        grand_total_paise: grandTotalPaise,
        gst_rate_type: 'exclusive',
      })
      .returning();

    if (!invoice) throw new Error('Failed to insert test draft invoice');

    await testDb.insert(schema.invoiceLineItems).values({
      invoice_id: invoice.id,
      description: 'Test Item',
      hsn_sac_code: '998311',
      quantity: '1.000',
      unit_of_measurement: 'NOS',
      unit_price_paise: grandTotalPaise,
      discount_paise: 0,
      taxable_value_paise: grandTotalPaise,
      tax_rate_percentage: '0.00',
      cgst_paise: 0,
      sgst_paise: 0,
      igst_paise: 0,
      line_total_paise: grandTotalPaise,
      sort_order: 0,
    });

    await testDb.transaction((tx) =>
      finalizeDraftInvoiceInTransaction(tx, {
        invoiceId: invoice.id,
        businessId: testBusiness.id,
      }),
    );

    return invoice.id;
  }

  async function createCustomDraftCreditNote(
    originalInvoiceId: string,
    grandTotalPaise: number,
  ): Promise<string> {
    const [cn] = await testDb
      .insert(schema.creditNotes)
      .values({
        business_id: testBusiness.id,
        original_invoice_id: originalInvoiceId,
        financial_year_id: defaultFyId,
        credit_note_number: `DRAFT-CN-${randomBytes(6).toString('hex')}`,
        reason: '05-other',
        lifecycle_status: 'draft',
        status: 'active',
        issue_date: '2026-10-28',
        subtotal_paise: grandTotalPaise,
        total_cgst_paise: 0,
        total_sgst_paise: 0,
        total_igst_paise: 0,
        total_tax_paise: 0,
        grand_total_paise: grandTotalPaise,
      })
      .returning();

    if (!cn) throw new Error('Failed to insert test draft credit note');

    await testDb.insert(schema.creditNoteLineItems).values({
      credit_note_id: cn.id,
      description: 'Test CN Item',
      hsn_sac_code: '998311',
      quantity: '1.000',
      unit_of_measurement: 'NOS',
      unit_price_paise: grandTotalPaise,
      discount_paise: 0,
      taxable_value_paise: grandTotalPaise,
      tax_rate_percentage: '0.00',
      cgst_paise: 0,
      sgst_paise: 0,
      igst_paise: 0,
      line_total_paise: grandTotalPaise,
      sort_order: 0,
    });

    return cn.id;
  }

  async function assertStatusConsistent(invoiceId: string): Promise<void> {
    const [invoice] = await testDb
      .select()
      .from(schema.invoices)
      .where(and(eq(schema.invoices.id, invoiceId), eq(schema.invoices.business_id, testBusiness.id)));

    if (!invoice) throw new Error('Invoice not found for assertion');

    const [paidRow] = await testDb
      .select({ total: sql<string | number>`coalesce(sum(${schema.payments.amount_paise}), 0)` })
      .from(schema.payments)
      .where(
        and(
          eq(schema.payments.invoice_id, invoiceId),
          eq(schema.payments.business_id, testBusiness.id),
          eq(schema.payments.status, 'active'),
        ),
      );

    const [creditedRow] = await testDb
      .select({ total: sql<string | number>`coalesce(sum(${schema.creditNotes.grand_total_paise}), 0)` })
      .from(schema.creditNotes)
      .where(
        and(
          eq(schema.creditNotes.original_invoice_id, invoiceId),
          eq(schema.creditNotes.business_id, testBusiness.id),
          eq(schema.creditNotes.lifecycle_status, 'finalized'),
          eq(schema.creditNotes.status, 'active'),
        ),
      );

    const activePaid = Number(paidRow?.total ?? 0);
    const activeCredited = Number(creditedRow?.total ?? 0);
    const netBill = Math.max(0, invoice.grand_total_paise - activeCredited);

    const expected =
      netBill === 0
        ? 'paid'
        : activePaid === 0
          ? 'unpaid'
          : activePaid >= netBill
            ? 'paid'
            : 'partially_paid';

    expect(invoice.payment_status).toBe(expected);
  }

  it('Test 1 (the core race): 10 concurrent payments of ₹600 on a ₹1000 invoice -> exactly 1 succeeds, 9 fail with OVERPAYMENT', async () => {
    const invoiceId = await createCustomFinalizedInvoice(100000); // ₹1000

    const tasks = Array.from({ length: 10 }, () =>
      withTransactionRetry(() =>
        testDb.transaction((tx) =>
          recordPaymentInTransaction(tx, {
            businessId: testBusiness.id,
            input: {
              invoice_id: invoiceId,
              amount: 600,
              payment_date: '2026-10-28',
              payment_method: 'bank_transfer',
            },
            todayIst: '2026-10-28',
          }),
        ),
      ),
    );

    const results = await Promise.allSettled(tasks);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(9);

    for (const rej of rejected) {
      if (rej.status === 'rejected') {
        expect(rej.reason).toBeInstanceOf(ActionError);
        const actionErr = rej.reason as ActionError;
        expect(actionErr.code).toBe('OVERPAYMENT');
        expect(actionErr.message).toMatch(/exceeds.*remaining balance|no remaining balance/);
      }
    }

    const [invoice] = await testDb
      .select()
      .from(schema.invoices)
      .where(eq(schema.invoices.id, invoiceId));

    expect(invoice?.payment_status).toBe('partially_paid');
    await assertStatusConsistent(invoiceId);
  });

  it('Test 2: 10 concurrent payments of ₹100 on a ₹1000 invoice -> ALL 10 succeed, status = paid', async () => {
    const invoiceId = await createCustomFinalizedInvoice(100000); // ₹1000

    const tasks = Array.from({ length: 10 }, () =>
      withTransactionRetry(() =>
        testDb.transaction((tx) =>
          recordPaymentInTransaction(tx, {
            businessId: testBusiness.id,
            input: {
              invoice_id: invoiceId,
              amount: 100,
              payment_date: '2026-10-28',
              payment_method: 'bank_transfer',
            },
            todayIst: '2026-10-28',
          }),
        ),
      ),
    );

    const results = await Promise.allSettled(tasks);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled).toHaveLength(10);

    const [invoice] = await testDb
      .select()
      .from(schema.invoices)
      .where(eq(schema.invoices.id, invoiceId));

    expect(invoice?.payment_status).toBe('paid');
    await assertStatusConsistent(invoiceId);
  });

  it('Test 3 (void race): 5 concurrent voids of ONE ₹400 payment -> exactly 1 succeeds, 4 fail with ALREADY_VOIDED', async () => {
    const invoiceId = await createCustomFinalizedInvoice(100000); // ₹1000

    // Record one ₹400 payment
    await testDb.transaction((tx) =>
      recordPaymentInTransaction(tx, {
        businessId: testBusiness.id,
        input: {
          invoice_id: invoiceId,
          amount: 400,
          payment_date: '2026-10-28',
          payment_method: 'bank_transfer',
        },
        todayIst: '2026-10-28',
      }),
    );

    const [paymentRow] = await testDb
      .select()
      .from(schema.payments)
      .where(and(eq(schema.payments.invoice_id, invoiceId), eq(schema.payments.status, 'active')));

    expect(paymentRow).toBeDefined();
    const paymentId = paymentRow!.id;

    // Run 5 concurrent voids
    const tasks = Array.from({ length: 5 }, () =>
      withTransactionRetry(() =>
        testDb.transaction((tx) =>
          voidPaymentInTransaction(tx, {
            businessId: testBusiness.id,
            userId: 'test-user-id',
            operatorDisplayName: 'Tester',
            input: {
              id: paymentId,
              reason: 'other',
              notes: 'Duplicate entry detected in test',
            },
          }),
        ),
      ),
    );

    const results = await Promise.allSettled(tasks);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(4);

    for (const rej of rejected) {
      if (rej.status === 'rejected') {
        expect(rej.reason).toBeInstanceOf(ActionError);
        expect((rej.reason as ActionError).code).toBe('ALREADY_VOIDED');
      }
    }

    const [invoice] = await testDb
      .select()
      .from(schema.invoices)
      .where(eq(schema.invoices.id, invoiceId));

    expect(invoice?.payment_status).toBe('unpaid');
    await assertStatusConsistent(invoiceId);
  });

  it('Test 4 (credit-note void race): 5 concurrent voids of ONE ₹300 credit note -> exactly 1 succeeds, 4 fail with ALREADY_VOIDED', async () => {
    const invoiceId = await createCustomFinalizedInvoice(100000); // ₹1000

    // Create and finalize a credit note of ₹300 (30000 paise)
    const cnId = await createCustomDraftCreditNote(invoiceId, 30000);
    await testDb.transaction((tx) =>
      finalizeDraftCreditNoteInTransaction(tx, {
        creditNoteId: cnId,
        businessId: testBusiness.id,
      }),
    );

    // Run 5 concurrent voids
    const tasks = Array.from({ length: 5 }, () =>
      withTransactionRetry(() =>
        testDb.transaction((tx) =>
          voidCreditNoteInTransaction(tx, {
            businessId: testBusiness.id,
            userId: 'test-user-id',
            operatorDisplayName: 'Tester',
            input: {
              id: cnId,
              reason: 'Correction',
              notes: 'Void testing in concurrent run',
              confirm: true,
            },
          }),
        ),
      ),
    );

    const results = await Promise.allSettled(tasks);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(4);

    for (const rej of rejected) {
      if (rej.status === 'rejected') {
        expect(rej.reason).toBeInstanceOf(ActionError);
        expect((rej.reason as ActionError).code).toBe('ALREADY_VOIDED');
      }
    }

    await assertStatusConsistent(invoiceId);
  });

  it('Test 5 (interleaving): concurrent payment, credit note finalize, and credit note void -> consistency invariant holds', async () => {
    const invoiceId = await createCustomFinalizedInvoice(100000); // ₹1000

    // Setup: 1 earlier credit note of ₹100 (10000 paise) finalized
    const earlierCnId = await createCustomDraftCreditNote(invoiceId, 10000);
    await testDb.transaction((tx) =>
      finalizeDraftCreditNoteInTransaction(tx, {
        creditNoteId: earlierCnId,
        businessId: testBusiness.id,
      }),
    );

    // Setup: 1 new draft credit note of ₹400 (40000 paise)
    const newCnDraftId = await createCustomDraftCreditNote(invoiceId, 40000);

    // Interleaved operations:
    // 1. Payment of ₹400
    // 2. Finalize draft credit note of ₹400
    // 3. Void earlier credit note of ₹100
    const op1 = withTransactionRetry(() =>
      testDb.transaction((tx) =>
        recordPaymentInTransaction(tx, {
          businessId: testBusiness.id,
          input: {
            invoice_id: invoiceId,
            amount: 400,
            payment_date: '2026-10-28',
            payment_method: 'bank_transfer',
          },
          todayIst: '2026-10-28',
        }),
      ),
    );

    const op2 = withTransactionRetry(() =>
      testDb.transaction((tx) =>
        finalizeDraftCreditNoteInTransaction(tx, {
          creditNoteId: newCnDraftId,
          businessId: testBusiness.id,
        }),
      ),
    );

    const op3 = withTransactionRetry(() =>
      testDb.transaction((tx) =>
        voidCreditNoteInTransaction(tx, {
          businessId: testBusiness.id,
          userId: 'test-user-id',
          operatorDisplayName: 'Tester',
          input: {
            id: earlierCnId,
            reason: 'Correction',
            notes: 'Interleaving test void',
            confirm: true,
          },
        }),
      ),
    );

    const results = await Promise.allSettled([op1, op2, op3]);

    // All should either fulfill or reject cleanly (no unhandled DB errors)
    for (const r of results) {
      if (r.status === 'rejected') {
        expect(r.reason).toBeInstanceOf(ActionError);
      }
    }

    await assertStatusConsistent(invoiceId);
  });

  it('Test 6: date validation at boundary', async () => {
    const invoiceId = await createCustomFinalizedInvoice(100000, '2026-10-20');
    const todayIst = '2026-10-28';

    // 1. payment_date = invoice_date - 1 day ('2026-10-19') -> rejected
    await expect(
      testDb.transaction((tx) =>
        recordPaymentInTransaction(tx, {
          businessId: testBusiness.id,
          input: {
            invoice_id: invoiceId,
            amount: 10,
            payment_date: '2026-10-19',
            payment_method: 'bank_transfer',
          },
          todayIst,
        }),
      ),
    ).rejects.toThrow(/cannot be before the invoice date/);

    // 2. payment_date = invoice_date ('2026-10-20') -> accepted
    const res1 = await testDb.transaction((tx) =>
      recordPaymentInTransaction(tx, {
        businessId: testBusiness.id,
        input: {
          invoice_id: invoiceId,
          amount: 10,
          payment_date: '2026-10-20',
          payment_method: 'bank_transfer',
        },
        todayIst,
      }),
    );
    expect(res1.payment_status).toBe('partially_paid');

    // 3. payment_date = today IST ('2026-10-28') -> accepted
    const res2 = await testDb.transaction((tx) =>
      recordPaymentInTransaction(tx, {
        businessId: testBusiness.id,
        input: {
          invoice_id: invoiceId,
          amount: 10,
          payment_date: '2026-10-28',
          payment_method: 'bank_transfer',
        },
        todayIst,
      }),
    );
    expect(res2.payment_status).toBe('partially_paid');

    // 4. payment_date = today + 1 day ('2026-10-29') -> rejected
    await expect(
      testDb.transaction((tx) =>
        recordPaymentInTransaction(tx, {
          businessId: testBusiness.id,
          input: {
            invoice_id: invoiceId,
            amount: 10,
            payment_date: '2026-10-29',
            payment_method: 'bank_transfer',
          },
          todayIst,
        }),
      ),
    ).rejects.toThrow(/cannot be in the future/);
  });
});
