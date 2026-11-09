import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it } from 'vitest';
import * as schema from '@/lib/db/schema';
import {
  ARCHIVAL_MAX_ATTEMPTS,
} from '@/lib/storage/archival-config';
import {
  claimDocumentById,
  claimBatch,
  markArchived,
  markFailed,
  refundAttempt,
  countExhausted,
  countStalePending,
} from '@/lib/storage/archival-claims';

const DRIZZLE_DIR = join(process.cwd(), 'drizzle');
const CURRENT_MIGRATION_TAG = '0023_api008_archival_state';
const PREVIOUS_MIGRATION_TAG = '0022_db007_audit_log_append_only';

interface JournalEntry {
  tag: string;
}

interface IdRow {
  id: string;
}

function readJournal(): JournalEntry[] {
  const raw: unknown = JSON.parse(readFileSync(join(DRIZZLE_DIR, 'meta', '_journal.json'), 'utf8'));
  const entries = (raw as { entries: Array<{ tag: string }> }).entries;
  return entries.map((e) => ({ tag: e.tag }));
}

function statementsOf(tag: string): string[] {
  return readFileSync(join(DRIZZLE_DIR, `${tag}.sql`), 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function applyMigrations(pg: PGlite, upToTag: string): Promise<void> {
  const journal = readJournal();
  for (const entry of journal) {
    for (const statement of statementsOf(entry.tag)) {
      await pg.exec(statement);
    }
    if (entry.tag === upToTag) {
      return;
    }
  }
}

async function insertOne(pg: PGlite, sqlText: string, params: unknown[] = []): Promise<string> {
  const result = await pg.query<IdRow>(sqlText, params);
  const row = result.rows[0];
  if (!row) throw new Error(`no row returned for query: ${sqlText}`);
  return row.id;
}

interface Fixture {
  businessId: string;
  financialYearId: string;
}

async function createBaseFixture(pg: PGlite): Promise<Fixture> {
  const businessId = await insertOne(
    pg,
    `INSERT INTO businesses (legal_name, trade_name, gstin, address_line1, city, state_code, pincode)
     VALUES ('Test Business', 'Test Trade', '27AAPFU0939F1ZV', '100 Road', 'Mumbai', '27', '400001')
     RETURNING id`,
  );

  const financialYearId = await insertOne(
    pg,
    `INSERT INTO financial_years (business_id, label, start_date, end_date)
     VALUES ($1, '2026-27', '2026-04-01', '2027-03-31')
     RETURNING id`,
    [businessId],
  );

  return { businessId, financialYearId };
}

let seq = 100;
async function createFinalizedInvoice(pg: PGlite, fx: Fixture, attempts = 0): Promise<string> {
  seq += 1;
  const num = `INV-2026-${seq}`;
  const invId = await insertOne(
    pg,
    `INSERT INTO invoices (
       business_id, financial_year_id, invoice_number, invoice_sequence, lifecycle_status,
       invoice_date, due_date, finalized_at, subtotal_paise, total_tax_paise, grand_total_paise,
       archival_status, archival_attempts,
       seller_name_snapshot, seller_address_snapshot, seller_state_code_snapshot,
       seller_snapshot_source, seller_gstin_snapshot
     ) VALUES (
       $1, $2, $3, $4, 'finalized',
       '2026-05-10', '2026-06-10', now(), 10000, 1800, 11800,
       'pending', $5,
       'Test Business', '{"city":"Mumbai"}'::jsonb, '27',
       'captured_at_finalization', '27AAPFU0939F1ZV'
     ) RETURNING id`,
    [fx.businessId, fx.financialYearId, num, seq, attempts],
  );
  return invId;
}

async function createDraftInvoice(pg: PGlite, fx: Fixture): Promise<string> {
  seq += 1;
  const num = `DRAFT-${seq}`;
  return insertOne(
    pg,
    `INSERT INTO invoices (
       business_id, financial_year_id, invoice_number, lifecycle_status,
       subtotal_paise, total_tax_paise, grand_total_paise, archival_status, archival_attempts
     ) VALUES ($1, $2, $3, 'draft', 10000, 1800, 11800, 'pending', 0)
     RETURNING id`,
    [fx.businessId, fx.financialYearId, num],
  );
}

async function createFinalizedCreditNote(
  pg: PGlite,
  fx: Fixture,
  invoiceId: string,
  attempts = 0,
): Promise<string> {
  seq += 1;
  const num = `CN-2026-${seq}`;
  return insertOne(
    pg,
    `INSERT INTO credit_notes (
       business_id, original_invoice_id, financial_year_id, credit_note_number,
       credit_note_sequence, lifecycle_status, issue_date, finalized_at,
       reason, subtotal_paise, total_tax_paise, grand_total_paise,
       archival_status, archival_attempts,
       seller_name_snapshot, seller_address_snapshot, seller_state_code_snapshot,
       seller_snapshot_source, seller_gstin_snapshot
     ) VALUES (
       $1, $2, $3, $4,
       $5, 'finalized', '2026-05-11', now(),
       'Discount', 5000, 900, 5900,
       'pending', $6,
       'Test Business', '{"city":"Mumbai"}'::jsonb, '27',
       'captured_at_finalization', '27AAPFU0939F1ZV'
     ) RETURNING id`,
    [fx.businessId, invoiceId, fx.financialYearId, num, seq, attempts],
  );
}

describe('API-008: serverless PDF archival claims and integrity (PGlite)', () => {
  it('1. claimDocumentById on a pending finalized invoice returns attempts=1 and sets archival_claimed_at', async () => {
    const pg = new PGlite();
    await applyMigrations(pg, CURRENT_MIGRATION_TAG);
    const db = drizzle(pg, { schema });
    const fx = await createBaseFixture(pg);

    const invId = await createFinalizedInvoice(pg, fx);
    const claim = await claimDocumentById(db, 'invoice', invId);

    expect(claim).not.toBeNull();
    expect(claim?.id).toBe(invId);
    expect(claim?.attempts).toBe(1);

    const row = (await pg.query<{ archival_claimed_at: string | null }>(
      'SELECT archival_claimed_at FROM invoices WHERE id = $1',
      [invId],
    )).rows[0];
    expect(row?.archival_claimed_at).not.toBeNull();
  });

  it('2. immediate second claimDocumentById returns null (lease protection)', async () => {
    const pg = new PGlite();
    await applyMigrations(pg, CURRENT_MIGRATION_TAG);
    const db = drizzle(pg, { schema });
    const fx = await createBaseFixture(pg);

    const invId = await createFinalizedInvoice(pg, fx);
    const claim1 = await claimDocumentById(db, 'invoice', invId);
    expect(claim1).not.toBeNull();

    const claim2 = await claimDocumentById(db, 'invoice', invId);
    expect(claim2).toBeNull();
  });

  it('3. after setting archival_claimed_at to past lease expiry it can be re-claimed with incremented attempts', async () => {
    const pg = new PGlite();
    await applyMigrations(pg, CURRENT_MIGRATION_TAG);
    const db = drizzle(pg, { schema });
    const fx = await createBaseFixture(pg);

    const invId = await createFinalizedInvoice(pg, fx);
    await claimDocumentById(db, 'invoice', invId);

    // Simulate abandoned worker past lease
    await pg.query(
      `UPDATE invoices SET archival_claimed_at = now() - interval '10 minutes' WHERE id = $1`,
      [invId],
    );

    const claim2 = await claimDocumentById(db, 'invoice', invId);
    expect(claim2).not.toBeNull();
    expect(claim2?.attempts).toBe(2);
  });

  it('4. a DRAFT invoice is never claimed by id or batch and its attempts stay 0', async () => {
    const pg = new PGlite();
    await applyMigrations(pg, CURRENT_MIGRATION_TAG);
    const db = drizzle(pg, { schema });
    const fx = await createBaseFixture(pg);

    const draftId = await createDraftInvoice(pg, fx);

    const claimId = await claimDocumentById(db, 'invoice', draftId);
    expect(claimId).toBeNull();

    const batch = await claimBatch(db, 'invoice', 10);
    expect(batch.map((b) => b.id)).not.toContain(draftId);

    const row = (await pg.query<{ archival_attempts: number }>(
      'SELECT archival_attempts FROM invoices WHERE id = $1',
      [draftId],
    )).rows[0];
    expect(row?.archival_attempts).toBe(0);
  });

  it('5. document with archival_attempts = 5 is exhausted and never claimed', async () => {
    const pg = new PGlite();
    await applyMigrations(pg, CURRENT_MIGRATION_TAG);
    const db = drizzle(pg, { schema });
    const fx = await createBaseFixture(pg);

    const invId = await createFinalizedInvoice(pg, fx, 5);
    const claim = await claimDocumentById(db, 'invoice', invId);
    expect(claim).toBeNull();

    const exhausted = await countExhausted(db, 'invoice');
    expect(exhausted).toBeGreaterThanOrEqual(1);
  });

  it('6. markArchived sets status/key/archived_at and clears lease; markFailed after does not downgrade', async () => {
    const pg = new PGlite();
    await applyMigrations(pg, CURRENT_MIGRATION_TAG);
    const db = drizzle(pg, { schema });
    const fx = await createBaseFixture(pg);

    const invId = await createFinalizedInvoice(pg, fx);
    await claimDocumentById(db, 'invoice', invId);

    const storageKey = 'invoices/test-biz/2026-27/inv-1.pdf';
    await markArchived(db, 'invoice', invId, storageKey);

    const afterArchive = (await pg.query<{
      archival_status: string;
      pdf_storage_key: string | null;
      archival_claimed_at: string | null;
      archived_at: string | null;
    }>('SELECT archival_status, pdf_storage_key, archival_claimed_at, archived_at FROM invoices WHERE id = $1', [
      invId,
    ])).rows[0];

    expect(afterArchive?.archival_status).toBe('archived');
    expect(afterArchive?.pdf_storage_key).toBe(storageKey);
    expect(afterArchive?.archival_claimed_at).toBeNull();
    expect(afterArchive?.archived_at).not.toBeNull();

    // Late failure must not downgrade archived status
    await markFailed(db, 'invoice', invId);

    const afterFailed = (await pg.query<{ archival_status: string }>(
      'SELECT archival_status FROM invoices WHERE id = $1',
      [invId],
    )).rows[0];
    expect(afterFailed?.archival_status).toBe('archived');
  });

  it('7. refundAttempt decrements attempts (never below 0) and clears the lease', async () => {
    const pg = new PGlite();
    await applyMigrations(pg, CURRENT_MIGRATION_TAG);
    const db = drizzle(pg, { schema });
    const fx = await createBaseFixture(pg);

    const invId = await createFinalizedInvoice(pg, fx);
    const claim = await claimDocumentById(db, 'invoice', invId);
    expect(claim?.attempts).toBe(1);

    await refundAttempt(db, 'invoice', invId);

    const row = (await pg.query<{ archival_attempts: number; archival_claimed_at: string | null }>(
      'SELECT archival_attempts, archival_claimed_at FROM invoices WHERE id = $1',
      [invId],
    )).rows[0];

    expect(row?.archival_attempts).toBe(0);
    expect(row?.archival_claimed_at).toBeNull();

    // Refunding again stays at 0
    await refundAttempt(db, 'invoice', invId);
    const row2 = (await pg.query<{ archival_attempts: number }>(
      'SELECT archival_attempts FROM invoices WHERE id = $1',
      [invId],
    )).rows[0];
    expect(row2?.archival_attempts).toBe(0);
  });

  it('8. claimBatch honours limit, ordering by finalized_at, and handles credit notes independently', async () => {
    const pg = new PGlite();
    await applyMigrations(pg, CURRENT_MIGRATION_TAG);
    const db = drizzle(pg, { schema });
    const fx = await createBaseFixture(pg);

    const inv1 = await createFinalizedInvoice(pg, fx);
    const inv2 = await createFinalizedInvoice(pg, fx);
    const cn1 = await createFinalizedCreditNote(pg, fx, inv1);

    const batchInvoices = await claimBatch(db, 'invoice', 1);
    expect(batchInvoices).toHaveLength(1);
    expect(batchInvoices[0].id).toBe(inv1);

    const batchInvoices2 = await claimBatch(db, 'invoice', 1);
    expect(batchInvoices2).toHaveLength(1);
    expect(batchInvoices2[0].id).toBe(inv2);

    const batchCreditNotes = await claimBatch(db, 'credit_note', 5);
    expect(batchCreditNotes).toHaveLength(1);
    expect(batchCreditNotes[0].id).toBe(cn1);
  });

  it('9. immutability triggers: updating archival columns on finalized documents succeeds, while financial columns raise BM_IMMUTABLE_RECORD', async () => {
    const pg = new PGlite();
    await applyMigrations(pg, CURRENT_MIGRATION_TAG);
    const fx = await createBaseFixture(pg);

    const invId = await createFinalizedInvoice(pg, fx);
    const cnId = await createFinalizedCreditNote(pg, fx, invId);

    // Archival updates succeed on finalized invoice
    await expect(
      pg.query(`UPDATE invoices SET archival_claimed_at = now(), archival_attempts = 2 WHERE id = $1`, [invId]),
    ).resolves.toBeDefined();

    // Archival updates succeed on finalized credit note
    await expect(
      pg.query(`UPDATE credit_notes SET archival_status = 'failed', archival_claimed_at = now(), archival_attempts = 1 WHERE id = $1`, [cnId]),
    ).resolves.toBeDefined();

    // Financial mutation on finalized invoice fails with BM_IMMUTABLE_RECORD
    await expect(
      pg.query(`UPDATE invoices SET grand_total_paise = grand_total_paise + 1 WHERE id = $1`, [invId]),
    ).rejects.toThrow(/BM_IMMUTABLE_RECORD/);

    // Financial mutation on finalized credit note fails with BM_IMMUTABLE_RECORD
    await expect(
      pg.query(`UPDATE credit_notes SET grand_total_paise = grand_total_paise + 1 WHERE id = $1`, [cnId]),
    ).rejects.toThrow(/BM_IMMUTABLE_RECORD/);
  });

  it('10. migration backfill: applies cleanly, sets credit note archival_status, and resets dirty draft invoices', async () => {
    const pg = new PGlite();
    // 1. Apply up to the PREVIOUS migration
    await applyMigrations(pg, PREVIOUS_MIGRATION_TAG);
    const fx = await createBaseFixture(pg);

    // Plant legacy data
    seq += 1;
    const invId = await insertOne(
      pg,
      `INSERT INTO invoices (
         business_id, financial_year_id, invoice_number, invoice_sequence, lifecycle_status,
         invoice_date, due_date, finalized_at, subtotal_paise, total_tax_paise, grand_total_paise,
         archival_status, archival_attempts,
         seller_name_snapshot, seller_address_snapshot, seller_state_code_snapshot,
         seller_snapshot_source, seller_gstin_snapshot
       ) VALUES (
         $1, $2, 'INV-LEGACY-1', $3, 'finalized',
         '2026-05-01', '2026-06-01', now(), 10000, 1800, 11800,
         'pending', 0,
         'Test Business', '{"city":"Mumbai"}'::jsonb, '27',
         'captured_at_finalization', '27AAPFU0939F1ZV'
       ) RETURNING id`,
      [fx.businessId, fx.financialYearId, seq],
    );

    // Finalized credit note WITH pdf_storage_key
    seq += 1;
    const cnWithPdfId = await insertOne(
      pg,
      `INSERT INTO credit_notes (
         business_id, original_invoice_id, financial_year_id, credit_note_number,
         credit_note_sequence, lifecycle_status, issue_date, finalized_at,
         reason, subtotal_paise, total_tax_paise, grand_total_paise, pdf_storage_key,
         seller_name_snapshot, seller_address_snapshot, seller_state_code_snapshot,
         seller_snapshot_source, seller_gstin_snapshot
       ) VALUES (
         $1, $2, $3, 'CN-LEGACY-1',
         $4, 'finalized', '2026-05-02', now(),
         'Return', 5000, 900, 5900, 'credit-notes/storage-key-1.pdf',
         'Test Business', '{"city":"Mumbai"}'::jsonb, '27',
         'captured_at_finalization', '27AAPFU0939F1ZV'
       ) RETURNING id`,
      [fx.businessId, invId, fx.financialYearId, seq],
    );

    // Finalized credit note WITHOUT pdf_storage_key
    seq += 1;
    const cnWithoutPdfId = await insertOne(
      pg,
      `INSERT INTO credit_notes (
         business_id, original_invoice_id, financial_year_id, credit_note_number,
         credit_note_sequence, lifecycle_status, issue_date, finalized_at,
         reason, subtotal_paise, total_tax_paise, grand_total_paise,
         seller_name_snapshot, seller_address_snapshot, seller_state_code_snapshot,
         seller_snapshot_source, seller_gstin_snapshot
       ) VALUES (
         $1, $2, $3, 'CN-LEGACY-2',
         $4, 'finalized', '2026-05-03', now(),
         'Return', 2000, 360, 2360,
         'Test Business', '{"city":"Mumbai"}'::jsonb, '27',
         'captured_at_finalization', '27AAPFU0939F1ZV'
       ) RETURNING id`,
      [fx.businessId, invId, fx.financialYearId, seq],
    );

    // Draft invoice polluted by old cron (attempts=3, status='failed')
    seq += 1;
    const pollutedDraftId = await insertOne(
      pg,
      `INSERT INTO invoices (
         business_id, financial_year_id, invoice_number, lifecycle_status,
         subtotal_paise, total_tax_paise, grand_total_paise, archival_status, archival_attempts
       ) VALUES ($1, $2, 'DRAFT-POLLUTED', 'draft', 10000, 1800, 11800, 'failed', 3)
       RETURNING id`,
      [fx.businessId, fx.financialYearId],
    );

    // 2. Now apply the new migration
    for (const statement of statementsOf(CURRENT_MIGRATION_TAG)) {
      await pg.exec(statement);
    }

    // 3. Verify assertions
    const cnWithPdf = (await pg.query<{ archival_status: string; archived_at: string | null }>(
      'SELECT archival_status, archived_at FROM credit_notes WHERE id = $1',
      [cnWithPdfId],
    )).rows[0];
    expect(cnWithPdf?.archival_status).toBe('archived');
    expect(cnWithPdf?.archived_at).not.toBeNull();

    const cnWithoutPdf = (await pg.query<{ archival_status: string }>(
      'SELECT archival_status FROM credit_notes WHERE id = $1',
      [cnWithoutPdfId],
    )).rows[0];
    expect(cnWithoutPdf?.archival_status).toBe('pending');

    const draft = (await pg.query<{ archival_status: string; archival_attempts: number }>(
      'SELECT archival_status, archival_attempts FROM invoices WHERE id = $1',
      [pollutedDraftId],
    )).rows[0];
    expect(draft?.archival_status).toBe('pending');
    expect(draft?.archival_attempts).toBe(0);
  });

  it('11. migration idempotency: running 0023_api008_archival_state statements twice succeeds without error', async () => {
    const pg = new PGlite();
    await applyMigrations(pg, CURRENT_MIGRATION_TAG);

    // Re-run all statements of the new migration
    for (const statement of statementsOf(CURRENT_MIGRATION_TAG)) {
      await expect(pg.exec(statement)).resolves.toBeDefined();
    }
  });

  it('12. ARCHIVAL_MAX_ATTEMPTS literal matches index predicates in schema and migrations', () => {
    expect(ARCHIVAL_MAX_ATTEMPTS).toBe(5);

    const migrationSql = readFileSync(join(DRIZZLE_DIR, `${CURRENT_MIGRATION_TAG}.sql`), 'utf8');
    expect(migrationSql).toContain(`"archival_attempts" < 5`);

    const schemaCreditNotes = readFileSync(join(process.cwd(), 'lib/db/schema/credit_notes.ts'), 'utf8');
    expect(schemaCreditNotes).toContain(`archival_attempts} < 5`);
  });

  it('13. countStalePending counts only finalized + pending/failed + under-max-attempts + finalized_at older than threshold', async () => {
    const pg = new PGlite();
    await applyMigrations(pg, CURRENT_MIGRATION_TAG);
    const db = drizzle(pg, { schema });
    const fx = await createBaseFixture(pg);

    const insertInvoice = async (opts: {
      lifecycle: string;
      archivalStatus: string;
      attempts: number;
      finalizedMinutesAgo: number | null;
    }) => {
      seq += 1;
      const finalizedSql =
        opts.finalizedMinutesAgo !== null
          ? `now() - make_interval(mins => ${opts.finalizedMinutesAgo}::int)`
          : 'NULL';
      return await insertOne(
        pg,
        `INSERT INTO invoices (
           business_id, financial_year_id, invoice_number, invoice_sequence, lifecycle_status,
           invoice_date, due_date, finalized_at, subtotal_paise, total_tax_paise, grand_total_paise,
           archival_status, archival_attempts,
           seller_name_snapshot, seller_address_snapshot, seller_state_code_snapshot,
           seller_snapshot_source, seller_gstin_snapshot
         ) VALUES (
           $1, $2, $3, $4, $5,
           '2026-05-01', '2026-05-15', ${finalizedSql}, 10000, 1800, 11800,
           $6, $7,
           'Test Business', '{"city":"Mumbai"}'::jsonb, '27',
           'captured_at_finalization', '27AAPFU0939F1ZV'
         ) RETURNING id`,
        [fx.businessId, fx.financialYearId, `INV-STALE-${seq}`, seq, opts.lifecycle, opts.archivalStatus, opts.attempts],
      );
    };

    // 1. Finalized 70 mins ago, pending, attempts=1 -> STALE
    await insertInvoice({ lifecycle: 'finalized', archivalStatus: 'pending', attempts: 1, finalizedMinutesAgo: 70 });

    // 2. Finalized 70 mins ago, failed, attempts=3 -> STALE
    await insertInvoice({ lifecycle: 'finalized', archivalStatus: 'failed', attempts: 3, finalizedMinutesAgo: 70 });

    // 3. Finalized 10 mins ago, pending, attempts=0 -> NOT STALE (too fresh)
    await insertInvoice({ lifecycle: 'finalized', archivalStatus: 'pending', attempts: 0, finalizedMinutesAgo: 10 });

    // 4. Finalized 70 mins ago, archived, attempts=1 -> NOT STALE (already archived)
    await insertInvoice({ lifecycle: 'finalized', archivalStatus: 'archived', attempts: 1, finalizedMinutesAgo: 70 });

    // 5. Finalized 70 mins ago, pending, attempts=5 -> NOT STALE (exhausted)
    await insertInvoice({ lifecycle: 'finalized', archivalStatus: 'pending', attempts: ARCHIVAL_MAX_ATTEMPTS, finalizedMinutesAgo: 70 });

    // 6. Draft, pending, attempts=0 -> NOT STALE (not finalized)
    await insertInvoice({ lifecycle: 'draft', archivalStatus: 'pending', attempts: 0, finalizedMinutesAgo: null });

    const staleInvoices = await countStalePending(db, 'invoice', 60);
    expect(staleInvoices).toBe(2);

    // Verify credit notes queue is independent
    const staleCreditNotesInitial = await countStalePending(db, 'credit_note', 60);
    expect(staleCreditNotesInitial).toBe(0);

    // Insert a stale credit note
    seq += 1;
    const invId = await insertInvoice({ lifecycle: 'finalized', archivalStatus: 'archived', attempts: 1, finalizedMinutesAgo: 80 });
    await insertOne(
      pg,
      `INSERT INTO credit_notes (
         business_id, original_invoice_id, financial_year_id, credit_note_number,
         credit_note_sequence, lifecycle_status, issue_date, finalized_at,
         reason, subtotal_paise, total_tax_paise, grand_total_paise,
         archival_status, archival_attempts,
         seller_name_snapshot, seller_address_snapshot, seller_state_code_snapshot,
         seller_snapshot_source, seller_gstin_snapshot
       ) VALUES (
         $1, $2, $3, 'CN-STALE-1',
         $4, 'finalized', '2026-05-03', now() - make_interval(mins => 75::int),
         'Return', 2000, 360, 2360,
         'pending', 0,
         'Test Business', '{"city":"Mumbai"}'::jsonb, '27',
         'captured_at_finalization', '27AAPFU0939F1ZV'
       ) RETURNING id`,
      [fx.businessId, invId, fx.financialYearId, seq],
    );

    const staleCreditNotesAfter = await countStalePending(db, 'credit_note', 60);
    expect(staleCreditNotesAfter).toBe(1);
  });
}, 60_000);
