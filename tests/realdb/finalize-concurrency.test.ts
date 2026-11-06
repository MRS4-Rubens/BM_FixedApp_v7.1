import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { ActionError } from '@/lib/actions/_shared/errors';
import { NO_AUDIT_REQUEST_CONTEXT } from '@/lib/audit/log';
import { withTransactionRetry } from '@/lib/db/transaction';
import * as schema from '@/lib/db/schema';
import { lockDraftInvoice } from '@/lib/invoices/document-locks';
import { finalizeDraftInvoiceInTransaction } from '@/lib/invoices/finalize-invoice-tx';
import { finalizeDraftCreditNoteInTransaction } from '@/lib/invoices/finalize-credit-note-tx';
import {
  TestDb,
  TestBusiness,
  getTestDatabaseUrl,
  validateTestDatabaseUrl,
  createTestDbClient,
  createTestBusiness,
  createTestDraftInvoice,
  createTestDraftCreditNote,
  cleanupTestBusiness,
} from './helpers/db';

describe('Finalize concurrency tests (REAL Postgres)', () => {
  let testDb: TestDb;
  let testBusiness: TestBusiness;
  let defaultFyId: string;

  beforeAll(async () => {
    const validUrl = validateTestDatabaseUrl(getTestDatabaseUrl());
    testDb = createTestDbClient(validUrl);
    testBusiness = await createTestBusiness(testDb);

    // Warm up the financial year
    const warmup = await createTestDraftInvoice(testDb, testBusiness.id);
    defaultFyId = warmup.financialYearId;
    await testDb.transaction((tx) =>
      finalizeDraftInvoiceInTransaction(tx, {
        invoiceId: warmup.invoiceId,
        businessId: testBusiness.id,
        actorUserId: null,
        requestContext: NO_AUDIT_REQUEST_CONTEXT,
      }),
    );
  }, 60_000);

  afterAll(async () => {
    if (testDb && testBusiness) {
      await cleanupTestBusiness(testDb, testBusiness.id);
    }
  }, 60_000);

  it('Case 1: 10 parallel finalizations of ONE draft invoice -> exactly 1 fulfilled, 9 ALREADY_FINALIZED', async () => {
    const { invoiceId } = await createTestDraftInvoice(testDb, testBusiness.id);

    // Read baseline counters
    const [fyBefore] = await testDb
      .select({ count: schema.financialYears.invoice_sequence_counter })
      .from(schema.financialYears)
      .where(eq(schema.financialYears.id, defaultFyId));
    const baselineSeq = fyBefore?.count ?? 0;

    // Launch 10 parallel finalizations of the SAME invoice
    const tasks = Array.from({ length: 10 }, () =>
      withTransactionRetry(() =>
        testDb.transaction((tx) =>
          finalizeDraftInvoiceInTransaction(tx, {
            invoiceId,
            businessId: testBusiness.id,
            actorUserId: null,
            requestContext: NO_AUDIT_REQUEST_CONTEXT,
          }),
        ),
      ),
    );

    const results = await Promise.allSettled(tasks);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // Exactly 1 must succeed
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(9);

    // All rejected must be ALREADY_FINALIZED
    for (const rej of rejected) {
      if (rej.status === 'rejected') {
        expect(rej.reason).toBeInstanceOf(ActionError);
        expect((rej.reason as ActionError).code).toBe('ALREADY_FINALIZED');
      }
    }

    // Sequence counter incremented by EXACTLY 1 (no gaps)
    const [fyAfter] = await testDb
      .select({ count: schema.financialYears.invoice_sequence_counter })
      .from(schema.financialYears)
      .where(eq(schema.financialYears.id, defaultFyId));
    expect(fyAfter?.count).toBe(baselineSeq + 1);

    // Single invoice state is finalized
    const [invRow] = await testDb
      .select()
      .from(schema.invoices)
      .where(eq(schema.invoices.id, invoiceId));
    expect(invRow?.lifecycle_status).toBe('finalized');
  }, 60_000);

  it('Case 2: 10 distinct drafts finalized in parallel -> 10 fulfilled, contiguous sequences, unique numbers', async () => {
    const drafts = await Promise.all(
      Array.from({ length: 10 }, () => createTestDraftInvoice(testDb, testBusiness.id)),
    );

    const [fyBefore] = await testDb
      .select({ count: schema.financialYears.invoice_sequence_counter })
      .from(schema.financialYears)
      .where(eq(schema.financialYears.id, defaultFyId));
    const baselineSeq = fyBefore?.count ?? 0;

    const tasks = drafts.map((d) =>
      withTransactionRetry(() =>
        testDb.transaction((tx) =>
          finalizeDraftInvoiceInTransaction(tx, {
            invoiceId: d.invoiceId,
            businessId: testBusiness.id,
            actorUserId: null,
            requestContext: NO_AUDIT_REQUEST_CONTEXT,
          }),
        ),
      ),
    );

    const results = await Promise.allSettled(tasks);

    const fulfilled = results.filter(
      (r): r is PromiseFulfilledResult<{ invoiceId: string; invoiceNumber: string }> =>
        r.status === 'fulfilled',
    );
    expect(fulfilled).toHaveLength(10);

    const invoiceNumbers = new Set(fulfilled.map((r) => r.value.invoiceNumber));
    expect(invoiceNumbers.size).toBe(10);

    // Verify sequences are contiguous baseline + 1 .. baseline + 10
    const rows = await testDb
      .select({ seq: schema.invoices.invoice_sequence })
      .from(schema.invoices)
      .where(
        sql`${schema.invoices.id} IN ${drafts.map((d) => d.invoiceId)}`,
      );

    const sequences = rows.map((r) => r.seq).sort((a, b) => (a ?? 0) - (b ?? 0));
    const expected = Array.from({ length: 10 }, (_, i) => baselineSeq + 1 + i);
    expect(sequences).toEqual(expected);
  }, 60_000);

  it('Case 3: 10 drafts x 3 duplicate attempts each (30 concurrent calls) -> 10 fulfilled, 20 ALREADY_FINALIZED, contiguous sequences', async () => {
    const drafts = await Promise.all(
      Array.from({ length: 10 }, () => createTestDraftInvoice(testDb, testBusiness.id)),
    );

    const [fyBefore] = await testDb
      .select({ count: schema.financialYears.invoice_sequence_counter })
      .from(schema.financialYears)
      .where(eq(schema.financialYears.id, defaultFyId));
    const baselineSeq = fyBefore?.count ?? 0;

    // Create 30 concurrent tasks: 3 attempts for each of the 10 drafts
    const tasks = drafts.flatMap((d) =>
      Array.from({ length: 3 }, () =>
        withTransactionRetry(() =>
          testDb.transaction((tx) =>
            finalizeDraftInvoiceInTransaction(tx, {
              invoiceId: d.invoiceId,
              businessId: testBusiness.id,
              actorUserId: null,
              requestContext: NO_AUDIT_REQUEST_CONTEXT,
            }),
          ),
        ),
      ),
    );

    // Shuffle tasks slightly to interleave
    tasks.sort(() => Math.random() - 0.5);

    const results = await Promise.allSettled(tasks);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(10);
    expect(rejected).toHaveLength(20);

    for (const rej of rejected) {
      if (rej.status === 'rejected') {
        expect(rej.reason).toBeInstanceOf(ActionError);
        expect((rej.reason as ActionError).code).toBe('ALREADY_FINALIZED');
      }
    }

    const rows = await testDb
      .select({ seq: schema.invoices.invoice_sequence })
      .from(schema.invoices)
      .where(
        sql`${schema.invoices.id} IN ${drafts.map((d) => d.invoiceId)}`,
      );

    const sequences = rows.map((r) => r.seq).sort((a, b) => (a ?? 0) - (b ?? 0));
    const expected = Array.from({ length: 10 }, (_, i) => baselineSeq + 1 + i);
    expect(sequences).toEqual(expected);

    // Sequence counter incremented by EXACTLY 10
    const [fyAfter] = await testDb
      .select({ count: schema.financialYears.invoice_sequence_counter })
      .from(schema.financialYears)
      .where(eq(schema.financialYears.id, defaultFyId));
    expect(fyAfter?.count).toBe(baselineSeq + 10);
  }, 60_000);

  it('Case 4: Gap prevention on rollback — failed finalization does not advance sequence counter', async () => {
    const [fyBefore] = await testDb
      .select({ count: schema.financialYears.invoice_sequence_counter })
      .from(schema.financialYears)
      .where(eq(schema.financialYears.id, defaultFyId));
    const baselineSeq = fyBefore?.count ?? 0;

    // A syntactically VALID format whose resolved number exceeds the 16-character CGST Rule 46(b) limit:
    // the counter is incremented first, then numbering throws FORMAT_CAPACITY_EXCEEDED, so this proves rollback.
    // ({SEQ:8} would be rejected by the format parser before any counter write, testing nothing.)
    await testDb
      .update(schema.businesses)
      .set({ invoice_number_format: 'LONGFORMATEXCEEDING/{SEQ:4}' })
      .where(eq(schema.businesses.id, testBusiness.id));

    let errorThrown: unknown;
    try {
      const badDraft = await createTestDraftInvoice(testDb, testBusiness.id);
      await testDb.transaction((tx) =>
        finalizeDraftInvoiceInTransaction(tx, {
          invoiceId: badDraft.invoiceId,
          businessId: testBusiness.id,
          actorUserId: null,
          requestContext: NO_AUDIT_REQUEST_CONTEXT,
        }),
      );
    } catch (err: unknown) {
      errorThrown = err;
    } finally {
      // Always restore, so a failure here can never cascade into later cases.
      await testDb
        .update(schema.businesses)
        .set({ invoice_number_format: 'INV-{YY}/{SEQ:4}' })
        .where(eq(schema.businesses.id, testBusiness.id));
    }

    expect(errorThrown).toBeInstanceOf(ActionError);
    expect((errorThrown as ActionError).code).toBe('FORMAT_CAPACITY_EXCEEDED');

    // Counters must be completely unchanged because the transaction rolled back
    const [fyAfterRollback] = await testDb
      .select({ count: schema.financialYears.invoice_sequence_counter })
      .from(schema.financialYears)
      .where(eq(schema.financialYears.id, defaultFyId));
    expect(fyAfterRollback?.count).toBe(baselineSeq);

    // Next finalization receives baseline + 1 (no gap!)
    const goodDraft = await createTestDraftInvoice(testDb, testBusiness.id);
    const result = await testDb.transaction((tx) =>
      finalizeDraftInvoiceInTransaction(tx, {
        invoiceId: goodDraft.invoiceId,
        businessId: testBusiness.id,
        actorUserId: null,
        requestContext: NO_AUDIT_REQUEST_CONTEXT,
      }),
    );

    const [goodInv] = await testDb
      .select()
      .from(schema.invoices)
      .where(eq(schema.invoices.id, result.invoiceId));
    expect(goodInv?.invoice_sequence).toBe(baselineSeq + 1);
  }, 60_000);

  it('Case 5: Credit notes: 10 parallel finalizations of ONE draft credit note -> exactly 1 fulfilled, 9 ALREADY_FINALIZED', async () => {
    // Create and finalize original invoice
    const { invoiceId: origInvId } = await createTestDraftInvoice(testDb, testBusiness.id);
    await testDb.transaction((tx) =>
      finalizeDraftInvoiceInTransaction(tx, {
        invoiceId: origInvId,
        businessId: testBusiness.id,
        actorUserId: null,
        requestContext: NO_AUDIT_REQUEST_CONTEXT,
      }),
    );

    // Create draft credit note
    const { creditNoteId } = await createTestDraftCreditNote(
      testDb,
      testBusiness.id,
      origInvId,
      defaultFyId,
    );

    const [fyBefore] = await testDb
      .select({ count: schema.financialYears.credit_note_sequence_counter })
      .from(schema.financialYears)
      .where(eq(schema.financialYears.id, defaultFyId));
    const baselineCnSeq = fyBefore?.count ?? 0;

    const tasks = Array.from({ length: 10 }, () =>
      withTransactionRetry(() =>
        testDb.transaction((tx) =>
          finalizeDraftCreditNoteInTransaction(tx, {
            creditNoteId,
            businessId: testBusiness.id,
            actorUserId: null,
            requestContext: NO_AUDIT_REQUEST_CONTEXT,
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
        expect((rej.reason as ActionError).code).toBe('ALREADY_FINALIZED');
      }
    }

    // Sequence counter +1 exactly
    const [fyAfter] = await testDb
      .select({ count: schema.financialYears.credit_note_sequence_counter })
      .from(schema.financialYears)
      .where(eq(schema.financialYears.id, defaultFyId));
    expect(fyAfter?.count).toBe(baselineCnSeq + 1);

    // Original invoice payment status recomputed
    const [origInv] = await testDb
      .select()
      .from(schema.invoices)
      .where(eq(schema.invoices.id, origInvId));
    expect(origInv?.payment_status).toBe('unpaid');
  }, 60_000);

  it('Case 6: Draft-vs-finalize ordering: transaction B waits for A and then rejects with ALREADY_FINALIZED', async () => {
    const { invoiceId } = await createTestDraftInvoice(testDb, testBusiness.id);

    let aCommittedTime = 0;
    let bCompletedTime = 0;

    const taskA = testDb.transaction(async (tx) => {
      await lockDraftInvoice(tx, { id: invoiceId, businessId: testBusiness.id });
      // Hold lock for 1 second
      await tx.execute(sql`SELECT pg_sleep(1)`);
      const res = await finalizeDraftInvoiceInTransaction(tx, {
        invoiceId,
        businessId: testBusiness.id,
        actorUserId: null,
        requestContext: NO_AUDIT_REQUEST_CONTEXT,
      });
      aCommittedTime = Date.now();
      return res;
    });

    const taskB = (async () => {
      // Delay slightly to ensure A acquires the lock first
      await new Promise((resolve) => setTimeout(resolve, 100));
      try {
        return await testDb.transaction(async (tx) => {
          return lockDraftInvoice(tx, { id: invoiceId, businessId: testBusiness.id });
        });
      } finally {
        bCompletedTime = Date.now();
      }
    })();

    const [resultA, resultB] = await Promise.allSettled([taskA, taskB]);

    expect(resultA.status).toBe('fulfilled');
    expect(resultB.status).toBe('rejected');

    if (resultB.status === 'rejected') {
      expect(resultB.reason).toBeInstanceOf(ActionError);
      expect((resultB.reason as ActionError).code).toBe('ALREADY_FINALIZED');
    }

    // B completed only AFTER A committed
    expect(bCompletedTime).toBeGreaterThanOrEqual(aCommittedTime);
  }, 60_000);

  it('Case 7: Gap query returns zero rows for invoices and credit notes', async () => {
    // Gap query for invoices
    const invoiceGapQuery = await testDb.execute<{ s: number }>(sql`
      SELECT s FROM generate_series(
        1,
        (SELECT coalesce(max(invoice_sequence), 0) FROM invoices WHERE financial_year_id = ${defaultFyId})
      ) s
      LEFT JOIN invoices i ON i.invoice_sequence = s AND i.financial_year_id = ${defaultFyId}
      WHERE i.id IS NULL;
    `);

    expect(invoiceGapQuery.rows).toHaveLength(0);

    // Gap query for credit notes
    const cnGapQuery = await testDb.execute<{ s: number }>(sql`
      SELECT s FROM generate_series(
        1,
        (SELECT coalesce(max(credit_note_sequence), 0) FROM credit_notes WHERE financial_year_id = ${defaultFyId})
      ) s
      LEFT JOIN credit_notes c ON c.credit_note_sequence = s AND c.financial_year_id = ${defaultFyId}
      WHERE c.id IS NULL;
    `);

    expect(cnGapQuery.rows).toHaveLength(0);
  }, 60_000);
});
