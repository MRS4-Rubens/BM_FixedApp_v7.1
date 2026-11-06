import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, asc, eq, sql } from 'drizzle-orm';
import * as schema from '@/lib/db/schema';
import { NO_AUDIT_REQUEST_CONTEXT } from '@/lib/audit/log';
import { finalizeDraftInvoiceInTransaction } from '@/lib/invoices/finalize-invoice-tx';
import { finalizeDraftCreditNoteInTransaction } from '@/lib/invoices/finalize-credit-note-tx';
import {
  type TestDb,
  type TestBusiness,
  getTestDatabaseUrl,
  validateTestDatabaseUrl,
  createTestDbClient,
  closeTestDb,
  createTestBusiness,
  createTestDraftInvoice,
  createTestDraftCreditNote,
  uuidLiteral,
  errorChainText,
} from './helpers/db';
import {
  createTestUser,
  readGaplessSequences,
} from './helpers/fixtures';
import { runConcurrently } from './helpers/concurrency';

describe('API-002: Real-DB Failure Injection & Gapless Sequences (REAL Postgres)', () => {
  let testDb: TestDb;
  let testBusiness: TestBusiness;
  let validUserId: string;
  const createdBusinessIds: string[] = [];

  beforeAll(async () => {
    const url = validateTestDatabaseUrl(getTestDatabaseUrl());
    testDb = createTestDbClient(url);
    testBusiness = await createTestBusiness(testDb);
    createdBusinessIds.push(testBusiness.id);

    const user = await createTestUser(testDb, {
      email: `valid-actor-${randomUUID()}@example.com`,
      businessId: testBusiness.id,
    });
    validUserId = user.id;

    // Warm up financial year
    const warmup = await createTestDraftInvoice(testDb, testBusiness.id);
    await testDb.transaction((tx) =>
      finalizeDraftInvoiceInTransaction(tx, {
        invoiceId: warmup.invoiceId,
        businessId: testBusiness.id,
        actorUserId: validUserId,
        requestContext: NO_AUDIT_REQUEST_CONTEXT,
      }),
    );
  });

  afterAll(async () => {
    if (!testDb) return;
    // Ensure test triggers/functions are clean
    await testDb.execute(sql`DROP TRIGGER IF EXISTS bm_test_trg_fail_finalize ON invoices;`);
    await testDb.execute(sql`DROP FUNCTION IF EXISTS bm_test_fail_finalize();`);
    await testDb.execute(sql`DROP TRIGGER IF EXISTS bm_test_trg_fail_cn ON credit_notes;`);
    await testDb.execute(sql`DROP FUNCTION IF EXISTS bm_test_fail_cn();`);

    for (const bizId of createdBusinessIds) {
      await testDb.delete(schema.creditNotes).where(eq(schema.creditNotes.business_id, bizId)).catch(() => undefined);
      await testDb.delete(schema.invoiceLineItems).where(
        sql`${schema.invoiceLineItems.invoice_id} IN (SELECT id FROM invoices WHERE business_id = ${bizId})`,
      ).catch(() => undefined);
      await testDb.delete(schema.invoices).where(eq(schema.invoices.business_id, bizId)).catch(() => undefined);
      await testDb.delete(schema.auditLog).where(eq(schema.auditLog.business_id, bizId)).catch(() => undefined);
      await testDb.delete(schema.financialYears).where(eq(schema.financialYears.business_id, bizId)).catch(() => undefined);
      await testDb.delete(schema.users).where(eq(schema.users.business_id, bizId)).catch(() => undefined);
      await testDb.delete(schema.businesses).where(eq(schema.businesses.id, bizId)).catch(() => undefined);
    }
    await closeTestDb(testDb);
  });

  it('1. Injection A: Failure AFTER number allocation rolls back sequence; next finalize gets contiguous sequence (1..2)', async () => {
    const biz = await createTestBusiness(testDb);
    createdBusinessIds.push(biz.id);

    const user = await createTestUser(testDb, {
      email: `inj-a-${randomUUID()}@example.com`,
      businessId: biz.id,
    });

    const d1 = await createTestDraftInvoice(testDb, biz.id);
    const d2 = await createTestDraftInvoice(testDb, biz.id);
    const d3 = await createTestDraftInvoice(testDb, biz.id);

    // Finalize D1 -> sequence 1
    const r1 = await testDb.transaction((tx) =>
      finalizeDraftInvoiceInTransaction(tx, {
        invoiceId: d1.invoiceId,
        businessId: biz.id,
        actorUserId: user.id,
        requestContext: NO_AUDIT_REQUEST_CONTEXT,
      }),
    );
    expect(r1.invoiceNumber).toMatch(/(?:[\/\-])0*1$/);

    // Install trigger on invoices table to fail ONLY for D2 when transitioning to finalized
    await testDb.execute(sql`
      CREATE OR REPLACE FUNCTION bm_test_fail_finalize()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'BM_TEST_INJECTED_FAILURE';
      END;
      $$ LANGUAGE plpgsql;
    `);

    await testDb.execute(sql`
      CREATE TRIGGER bm_test_trg_fail_finalize
      BEFORE UPDATE ON invoices
      FOR EACH ROW
      WHEN (NEW.id = ${uuidLiteral(d2.invoiceId)} AND NEW.lifecycle_status = 'finalized')
      EXECUTE FUNCTION bm_test_fail_finalize();
    `);

    try {
      // Finalizing D2 must throw BM_TEST_INJECTED_FAILURE
      const injectedError = await testDb
        .transaction((tx) =>
          finalizeDraftInvoiceInTransaction(tx, {
            invoiceId: d2.invoiceId,
            businessId: biz.id,
            actorUserId: user.id,
            requestContext: NO_AUDIT_REQUEST_CONTEXT,
          }),
        )
        .then(() => null, (error: unknown) => error);
      // Drizzle wraps the Postgres error ("Failed query: ..."); the RAISE text lives in error.cause.
      expect(errorChainText(injectedError)).toContain('BM_TEST_INJECTED_FAILURE');

      // Verify D2 remains a draft in the database
      const [d2Post] = await testDb.select().from(schema.invoices).where(eq(schema.invoices.id, d2.invoiceId));
      expect(d2Post.lifecycle_status).toBe('draft');
    } finally {
      // Drop trigger before finalizing D3
      await testDb.execute(sql`DROP TRIGGER IF EXISTS bm_test_trg_fail_finalize ON invoices;`);
      await testDb.execute(sql`DROP FUNCTION IF EXISTS bm_test_fail_finalize();`);
    }

    // Finalize D3 -> must receive sequence 2 (NOT 3)
    const r3 = await testDb.transaction((tx) =>
      finalizeDraftInvoiceInTransaction(tx, {
        invoiceId: d3.invoiceId,
        businessId: biz.id,
        actorUserId: user.id,
        requestContext: NO_AUDIT_REQUEST_CONTEXT,
      }),
    );
    expect(r3.invoiceNumber).toMatch(/(?:[\/\-])0*2$/);

    // Verify sequences are strictly contiguous: [1, 2]
    const seqs = await readGaplessSequences(testDb, biz.id);
    expect(seqs).toEqual([1, 2]);
  });

  it('2. Injection B: Audit foreign key failure rolls back atomically; next finalize gets contiguous sequence', async () => {
    const biz = await createTestBusiness(testDb);
    createdBusinessIds.push(biz.id);

    const validUser = await createTestUser(testDb, {
      email: `valid-audit-${randomUUID()}@example.com`,
      businessId: biz.id,
    });

    const d1 = await createTestDraftInvoice(testDb, biz.id);
    const d2 = await createTestDraftInvoice(testDb, biz.id);
    const d3 = await createTestDraftInvoice(testDb, biz.id);

    // Finalize D1 with valid user
    const r1 = await testDb.transaction((tx) =>
      finalizeDraftInvoiceInTransaction(tx, {
        invoiceId: d1.invoiceId,
        businessId: biz.id,
        actorUserId: validUser.id,
        requestContext: NO_AUDIT_REQUEST_CONTEXT,
      }),
    );
    expect(r1.invoiceNumber).toMatch(/(?:[\/\-])0*1$/);

    // Finalize D2 with non-existent user ID -> audit_log foreign key constraint fails
    const ghostUserId = '00000000-0000-4000-8000-000000000999';
    await expect(
      testDb.transaction((tx) =>
        finalizeDraftInvoiceInTransaction(tx, {
          invoiceId: d2.invoiceId,
          businessId: biz.id,
          actorUserId: ghostUserId,
          requestContext: NO_AUDIT_REQUEST_CONTEXT,
        }),
      ),
    ).rejects.toThrow();

    // D2 stays in draft
    const [d2Post] = await testDb.select().from(schema.invoices).where(eq(schema.invoices.id, d2.invoiceId));
    expect(d2Post.lifecycle_status).toBe('draft');

    // Finalize D3 with valid user -> must receive sequence 2
    const r3 = await testDb.transaction((tx) =>
      finalizeDraftInvoiceInTransaction(tx, {
        invoiceId: d3.invoiceId,
        businessId: biz.id,
        actorUserId: validUser.id,
        requestContext: NO_AUDIT_REQUEST_CONTEXT,
      }),
    );
    expect(r3.invoiceNumber).toMatch(/(?:[\/\-])0*2$/);

    const seqs = await readGaplessSequences(testDb, biz.id);
    expect(seqs).toEqual([1, 2]);
  });

  it('3. Injection C: Credit note guarded update failure rolls back sequence counter', async () => {
    const biz = await createTestBusiness(testDb);
    createdBusinessIds.push(biz.id);

    const user = await createTestUser(testDb, {
      email: `cn-actor-${randomUUID()}@example.com`,
      businessId: biz.id,
    });

    // Need a finalized invoice to attach credit notes to
    const inv = await createTestDraftInvoice(testDb, biz.id);
    await testDb.transaction((tx) =>
      finalizeDraftInvoiceInTransaction(tx, {
        invoiceId: inv.invoiceId,
        businessId: biz.id,
        actorUserId: user.id,
        requestContext: NO_AUDIT_REQUEST_CONTEXT,
      }),
    );

    const fyId = inv.financialYearId;

    // API-004: draft credit notes reserve creditable quantity. Each helper draft credits 0.5 of a 1.0 line, so at
    // most two may exist at once: cn1 (finalized) + cn2 (fails, then deleted like a user would) + cn3.
    const { creditNoteId: cn1 } = await createTestDraftCreditNote(testDb, biz.id, inv.invoiceId, fyId);

    // Finalize CN 1 -> sequence 1
    const r1 = await testDb.transaction((tx) =>
      finalizeDraftCreditNoteInTransaction(tx, {
        creditNoteId: cn1,
        businessId: biz.id,
        actorUserId: user.id,
        requestContext: NO_AUDIT_REQUEST_CONTEXT,
      }),
    );
    expect(r1.creditNoteNumber).toMatch(/(?:[\/\-])0*1$/);

    const { creditNoteId: cn2 } = await createTestDraftCreditNote(testDb, biz.id, inv.invoiceId, fyId);

    // Install trigger on credit_notes table to fail for cn2
    await testDb.execute(sql`
      CREATE OR REPLACE FUNCTION bm_test_fail_cn()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'BM_TEST_INJECTED_CN_FAILURE';
      END;
      $$ LANGUAGE plpgsql;
    `);

    await testDb.execute(sql`
      CREATE TRIGGER bm_test_trg_fail_cn
      BEFORE UPDATE ON credit_notes
      FOR EACH ROW
      WHEN (NEW.id = ${uuidLiteral(cn2)} AND NEW.lifecycle_status = 'finalized')
      EXECUTE FUNCTION bm_test_fail_cn();
    `);

    try {
      const injectedCnError = await testDb
        .transaction((tx) =>
          finalizeDraftCreditNoteInTransaction(tx, {
            creditNoteId: cn2,
            businessId: biz.id,
            actorUserId: user.id,
            requestContext: NO_AUDIT_REQUEST_CONTEXT,
          }),
        )
        .then(() => null, (error: unknown) => error);
      expect(errorChainText(injectedCnError)).toContain('BM_TEST_INJECTED_CN_FAILURE');

      const [cn2Post] = await testDb.select().from(schema.creditNotes).where(eq(schema.creditNotes.id, cn2));
      expect(cn2Post.lifecycle_status).toBe('draft');
    } finally {
      await testDb.execute(sql`DROP TRIGGER IF EXISTS bm_test_trg_fail_cn ON credit_notes;`);
      await testDb.execute(sql`DROP FUNCTION IF EXISTS bm_test_fail_cn();`);
    }

    // The failed draft is discarded (as the user would), releasing its reserved quantity.
    await testDb.delete(schema.creditNoteLineItems).where(eq(schema.creditNoteLineItems.credit_note_id, cn2));
    await testDb.delete(schema.creditNotes).where(eq(schema.creditNotes.id, cn2));
    const { creditNoteId: cn3 } = await createTestDraftCreditNote(testDb, biz.id, inv.invoiceId, fyId);

    // Finalize CN 3 -> must receive sequence 2
    const r3 = await testDb.transaction((tx) =>
      finalizeDraftCreditNoteInTransaction(tx, {
        creditNoteId: cn3,
        businessId: biz.id,
        actorUserId: user.id,
        requestContext: NO_AUDIT_REQUEST_CONTEXT,
      }),
    );
    expect(r3.creditNoteNumber).toMatch(/(?:[\/\-])0*2$/);

    const finalizedCns = await testDb
      .select({ seq: schema.creditNotes.credit_note_sequence })
      .from(schema.creditNotes)
      .where(
        and(
          eq(schema.creditNotes.business_id, biz.id),
          eq(schema.creditNotes.lifecycle_status, 'finalized'),
        ),
      )
      .orderBy(asc(schema.creditNotes.credit_note_sequence));

    expect(finalizedCns.map((c) => c.seq)).toEqual([1, 2]);
  });

  it('4. Mixed: 10 concurrent finalizes where 1 is poisoned by trigger -> 9 succeed with contiguous sequences, 1 failure, zero gaps', async () => {
    const biz = await createTestBusiness(testDb);
    createdBusinessIds.push(biz.id);

    const user = await createTestUser(testDb, {
      email: `mixed-${randomUUID()}@example.com`,
      businessId: biz.id,
    });

    const drafts: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      const d = await createTestDraftInvoice(testDb, biz.id);
      drafts.push(d.invoiceId);
    }

    // Poison the 5th draft (index 4)
    const poisonedDraftId = drafts[4];

    await testDb.execute(sql`
      CREATE OR REPLACE FUNCTION bm_test_fail_finalize()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'BM_TEST_POISONED_DRAFT';
      END;
      $$ LANGUAGE plpgsql;
    `);

    await testDb.execute(sql`
      CREATE TRIGGER bm_test_trg_fail_finalize
      BEFORE UPDATE ON invoices
      FOR EACH ROW
      WHEN (NEW.id = ${uuidLiteral(poisonedDraftId)} AND NEW.lifecycle_status = 'finalized')
      EXECUTE FUNCTION bm_test_fail_finalize();
    `);

    try {
      const results = await runConcurrently(10, (index) =>
        testDb.transaction((tx) =>
          finalizeDraftInvoiceInTransaction(tx, {
            invoiceId: drafts[index],
            businessId: biz.id,
            actorUserId: user.id,
            requestContext: NO_AUDIT_REQUEST_CONTEXT,
          }),
        ),
      );

      expect(results).toHaveLength(10);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(9);
      expect(rejected).toHaveLength(1);

      if (rejected[0].status === 'rejected') {
        expect(errorChainText(rejected[0].reason)).toContain('BM_TEST_POISONED_DRAFT');
      }

      // Read gapless sequences from DB: must be strictly [1, 2, 3, 4, 5, 6, 7, 8, 9] with NO gaps
      const seqs = await readGaplessSequences(testDb, biz.id);
      expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);

      // Poisoned draft must still be 'draft'
      const [poisonedRow] = await testDb
        .select()
        .from(schema.invoices)
        .where(eq(schema.invoices.id, poisonedDraftId));
      expect(poisonedRow.lifecycle_status).toBe('draft');
    } finally {
      await testDb.execute(sql`DROP TRIGGER IF EXISTS bm_test_trg_fail_finalize ON invoices;`);
      await testDb.execute(sql`DROP FUNCTION IF EXISTS bm_test_fail_finalize();`);
    }
  });
});
