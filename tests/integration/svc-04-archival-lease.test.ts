import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '@/lib/db/schema';

/**
 * SVC-04 on a real PostgreSQL (PGlite, all migrations): the real archiveClaimedDocument and claim SQL; only the HTML
 * builder, the Cloudflare render and the IDrive upload are faked.
 */
const state = vi.hoisted(() => ({
  db: undefined as unknown,
  render: undefined as undefined | ((options: { onTurn?: () => Promise<void> }) => Promise<Buffer>),
}));

vi.mock('@/lib/db/client', () => ({
  get db() {
    return state.db;
  },
}));
vi.mock('@sentry/nextjs', () => ({ captureMessage: vi.fn() }));
vi.mock('@/lib/actions/_shared/logger', () => ({ logError: vi.fn() }));
vi.mock('@/lib/pdf/archival-document', () => ({ buildArchivalHtml: async () => ({ html: '<p>invoice</p>' }) }));
vi.mock('@/lib/storage/idrive', () => ({ uploadFileToStorage: async () => undefined }));
vi.mock('@/lib/pdf/html-to-pdf-provider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pdf/html-to-pdf-provider')>();
  return {
    ...actual,
    renderHtmlToPdfBuffer: (_html: string, options: { onTurn?: () => Promise<void> } = {}) => state.render!(options),
  };
});

import { PdfRenderError } from '@/lib/pdf/html-to-pdf-provider';
import { claimBatch, refreshClaim } from '@/lib/storage/archival-claims';
import { archiveClaimedDocument } from '@/lib/storage/archival-core';

const DRIZZLE_DIR = join(process.cwd(), 'drizzle');

async function applyAllMigrations(pg: PGlite): Promise<void> {
  const journal = JSON.parse(readFileSync(join(DRIZZLE_DIR, 'meta', '_journal.json'), 'utf8')) as { entries: Array<{ tag: string }> };
  for (const entry of journal.entries) {
    const statements = readFileSync(join(DRIZZLE_DIR, `${entry.tag}.sql`), 'utf8')
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);
    for (const statement of statements) await pg.exec(statement);
  }
}

async function insertOne(pg: PGlite, sqlText: string, params: unknown[] = []): Promise<string> {
  const row = (await pg.query<{ id: string }>(sqlText, params)).rows[0];
  if (!row) throw new Error(`no row returned for: ${sqlText}`);
  return row.id;
}

describe('SVC-04: archival lease renewal and the busy render queue', () => {
  let pg: PGlite;
  let businessId: string;
  let financialYearId: string;
  let seq = 0;

  async function pendingInvoice(): Promise<string> {
    seq += 1;
    return insertOne(
      pg,
      `INSERT INTO invoices (business_id, financial_year_id, invoice_number, invoice_sequence, lifecycle_status,
         invoice_date, due_date, finalized_at, subtotal_paise, total_tax_paise, grand_total_paise, archival_status, archival_attempts,
         seller_name_snapshot, seller_address_snapshot, seller_state_code_snapshot, seller_snapshot_source, seller_gstin_snapshot)
       VALUES ($1, $2, $3, $4, 'finalized', '2026-05-10', '2026-06-10', now(), 10000, 1800, 11800, 'pending', 0,
         'Test Business', '{"city":"Mumbai"}'::jsonb, '27', 'captured_at_finalization', '27AAPFU0939F1ZV')
       RETURNING id`,
      [businessId, financialYearId, `INV-${seq}`, seq],
    );
  }

  async function row(id: string) {
    const result = await pg.query<{ archival_attempts: number; archival_status: string; claim_age_s: number | null }>(
      `SELECT archival_attempts, archival_status::text AS archival_status,
         extract(epoch FROM (now() - archival_claimed_at))::float8 AS claim_age_s
       FROM invoices WHERE id = $1 AND business_id = $2`,
      [id, businessId],
    );
    const found = result.rows[0];
    if (!found) throw new Error('invoice not found');
    return found;
  }

  beforeAll(async () => {
    pg = new PGlite();
    state.db = drizzle(pg, { schema });
    await applyAllMigrations(pg);
    businessId = await insertOne(
      pg,
      `INSERT INTO businesses (legal_name, trade_name, gstin, address_line1, city, state_code, pincode)
       VALUES ('Test Business', 'Test Trade', '27AAPFU0939F1ZV', '100 Road', 'Mumbai', '27', '400001') RETURNING id`,
    );
    financialYearId = await insertOne(
      pg,
      `INSERT INTO financial_years (business_id, label, start_date, end_date) VALUES ($1, '2026-27', '2026-04-01', '2027-03-31') RETURNING id`,
      [businessId],
    );
  }, 180_000);

  afterAll(async () => {
    await pg.close();
  });

  it("renews the lease when the document's turn in the render queue comes", async () => {
    const id = await pendingInvoice();
    const [claim] = await claimBatch(state.db as never, 'invoice', 1);
    expect(claim?.id).toBe(id);
    // Pretend the document waited 4.5 minutes in the queue (lease is 5 minutes).
    await pg.query(`UPDATE invoices SET archival_claimed_at = now() - interval '270 seconds' WHERE id = $1`, [id]);
    expect((await row(id)).claim_age_s).toBeGreaterThan(260);

    let ageAtRequest = Number.NaN;
    state.render = async (options) => {
      await options.onTurn?.();
      ageAtRequest = (await row(id)).claim_age_s ?? Number.NaN;
      return Buffer.from('%PDF-1.7');
    };
    const result = await archiveClaimedDocument('invoice', id, claim!.attempts);

    expect(result.success).toBe(true);
    expect(ageAtRequest).toBeLessThan(5); // freshly renewed right before the request
    expect((await row(id)).archival_status).toBe('archived');
  });

  it('a full render queue gives the attempt back (not counted against the 5)', async () => {
    const id = await pendingInvoice();
    const [claim] = await claimBatch(state.db as never, 'invoice', 1);
    expect((await row(id)).archival_attempts).toBe(1);

    state.render = async () => {
      throw new PdfRenderError('busy', 'Too many PDFs are waiting to be rendered; this one will be retried later.');
    };
    const result = await archiveClaimedDocument('invoice', id, claim!.attempts);

    expect(result.success).toBe(false);
    const after = await row(id);
    expect(after.archival_attempts).toBe(0);
    expect(after.archival_status).toBe('pending');
    expect(after.claim_age_s).toBeNull(); // lease released: the next run picks it up
  });

  it('refreshClaim never touches an archived or unclaimed document', async () => {
    const archived = await pendingInvoice();
    // An archived row that still carries an old lease (e.g. a late worker): it must stay exactly as it is.
    await pg.query(
      `UPDATE invoices SET archival_status = 'archived', pdf_storage_key = 'k', archived_at = now(), archival_claimed_at = now() - interval '600 seconds' WHERE id = $1`,
      [archived],
    );
    const unclaimed = await pendingInvoice();

    await refreshClaim(state.db as never, 'invoice', archived, businessId);
    await refreshClaim(state.db as never, 'invoice', unclaimed, businessId);

    expect((await row(archived)).claim_age_s).toBeGreaterThan(590);
    expect((await row(unclaimed)).claim_age_s).toBeNull();
  });

  it("refreshClaim only renews the lease within the document's own business", async () => {
    const id = await pendingInvoice();
    await claimBatch(state.db as never, 'invoice', 1);
    await pg.query(`UPDATE invoices SET archival_claimed_at = now() - interval '200 seconds' WHERE id = $1`, [id]);
    await refreshClaim(state.db as never, 'invoice', id, '00000000-0000-4000-8000-000000000000');
    expect((await row(id)).claim_age_s).toBeGreaterThan(190); // other business: untouched
    await refreshClaim(state.db as never, 'invoice', id, businessId);
    expect((await row(id)).claim_age_s).toBeLessThan(5);
    await pg.query(`UPDATE invoices SET archival_status = 'archived', archived_at = now(), pdf_storage_key = 'k', archival_claimed_at = NULL WHERE id = $1`, [id]);
  });

  it('a lease renewal that hangs does not block the render (bounded, then rendering continues)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const id = await pendingInvoice();
      const [claim] = await claimBatch(state.db as never, 'invoice', 1);
      const claims = await import('@/lib/storage/archival-claims');
      const hang = vi.spyOn(claims, 'refreshClaim').mockReturnValue(new Promise<void>(() => undefined));
      let rendered = false;
      state.render = async (options) => {
        const turn = options.onTurn?.();
        await vi.advanceTimersByTimeAsync(3_000);
        await turn;
        rendered = true;
        return Buffer.from('%PDF-1.7');
      };
      const result = await archiveClaimedDocument('invoice', id, claim!.attempts);
      expect(hang).toHaveBeenCalled();
      expect(rendered).toBe(true);
      expect(result.success).toBe(true);
      hang.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });
});
