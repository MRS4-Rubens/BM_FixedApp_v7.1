import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '@/lib/db/schema';

/**
 * SVC-02: a short outage during the nightly sweep must cost each document ONE attempt, not all five. The REAL sweep
 * and the REAL claim SQL run against PGlite with every migration applied; only the render/upload step is replaced by a
 * fake that fails (or succeeds) through the real markFailed / markArchived.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, mode: 'fail' as 'fail' | 'succeed', clock: 0 }));

vi.mock('@/lib/db/client', () => ({
  get db() {
    return state.db;
  },
}));
vi.mock('@sentry/nextjs', () => ({ captureMessage: vi.fn() }));
vi.mock('@/lib/storage/archival-core', async () => {
  const claims = await vi.importActual<typeof import('@/lib/storage/archival-claims')>('@/lib/storage/archival-claims');
  return {
    archiveClaimedDocument: async (kind: 'invoice' | 'credit_note', id: string) => {
      state.clock += 10_500; // each render waits ~10.5 s in the real Cloudflare queue
      if (state.mode === 'succeed') {
        await claims.markArchived(state.db as never, kind, id, `pdfs/${id}.pdf`);
        return { success: true };
      }
      await claims.markFailed(state.db as never, kind, id);
      return { success: false, error: 'Cloudflare 503 (simulated outage)' };
    },
  };
});

import { runArchivalSweep } from '@/lib/storage/archival-sweep';

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

describe('SVC-02: the nightly archival sweep claims each document at most once per run', () => {
  let pg: PGlite;
  let businessId: string;
  let financialYearId: string;
  let seq = 0;
  const sweep = () => runArchivalSweep(() => state.clock);

  async function pendingInvoice(): Promise<string> {
    seq += 1;
    return insertOne(
      pg,
      `INSERT INTO invoices (business_id, financial_year_id, invoice_number, invoice_sequence, lifecycle_status,
         invoice_date, due_date, finalized_at, subtotal_paise, total_tax_paise, grand_total_paise, archival_status, archival_attempts,
         seller_name_snapshot, seller_address_snapshot, seller_state_code_snapshot, seller_snapshot_source, seller_gstin_snapshot)
       VALUES ($1, $2, $3, $4, 'finalized', '2026-05-10', '2026-06-10', now() - make_interval(mins => $4), 10000, 1800, 11800,
         'pending', 0, 'Test Business', '{"city":"Mumbai"}'::jsonb, '27', 'captured_at_finalization', '27AAPFU0939F1ZV')
       RETURNING id`,
      [businessId, financialYearId, `INV-${seq}`, seq],
    );
  }

  async function archival(id: string): Promise<{ attempts: number; status: string }> {
    const row = (
      await pg.query<{ archival_attempts: number; archival_status: string }>(
        'SELECT archival_attempts, archival_status::text AS archival_status FROM invoices WHERE id = $1 AND business_id = $2',
        [id, businessId],
      )
    ).rows[0];
    if (!row) throw new Error('invoice not found');
    return { attempts: row.archival_attempts, status: row.archival_status };
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

  beforeEach(() => {
    state.clock = 0;
  });

  it('an outage costs one attempt per document per night (before: all 5 in one run)', async () => {
    const a = await pendingInvoice();
    const b = await pendingInvoice();
    state.mode = 'fail';

    const night1 = await sweep();
    expect(night1.claimed).toBe(2);
    expect(night1.failed).toBe(2);
    expect(await archival(a)).toEqual({ attempts: 1, status: 'failed' });
    expect(await archival(b)).toEqual({ attempts: 1, status: 'failed' });

    const night2 = await sweep();
    expect(night2.claimed).toBe(2);
    expect(await archival(a)).toEqual({ attempts: 2, status: 'failed' });

    // The outage is over: the next run archives both with attempts to spare.
    state.mode = 'succeed';
    const night3 = await sweep();
    expect(night3.succeeded).toBe(2);
    expect(await archival(a)).toEqual({ attempts: 3, status: 'archived' });
    expect(await archival(b)).toEqual({ attempts: 3, status: 'archived' });
  });

  it('a run ends early once every claimable document has been tried (no busy loop until the deadline)', async () => {
    await pendingInvoice();
    state.mode = 'fail';
    const run = await sweep();
    expect(run.claimed).toBe(1);
    expect(state.clock).toBe(10_500); // one render, then the run stopped
  });
});
