// Quantity Format (Invoice Settings) is enforced on the SERVER when a document is finalized:
// - invoices: every line must fit the business setting (drafts saved earlier may hold more decimals; finalize refuses);
// - credit notes: each line may also use the decimals its ORIGINAL invoice line needed, so older decimal lines can
//   still be credited after switching to whole numbers.
// Stored quantities are never rewritten.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ActionResult } from '@/lib/actions/_shared/types';
import * as schema from '@/lib/db/schema';

const state = vi.hoisted(() => ({ db: undefined as unknown, businessId: '' }));
const USER_ID = '00000000-0000-4000-8000-0000000000a1';

vi.mock('@/lib/db/client', () => ({
  get db() {
    return state.db;
  },
}));
vi.mock('@/lib/auth/session', () => ({
  getCurrentAppUser: async () => ({
    id: '00000000-0000-4000-8000-0000000000a1',
    business_id: state.businessId,
    role: 'owner' as const,
  }),
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('@/lib/rate-limit/upstash', () => ({
  sensitiveActionLimiter: {},
  checkRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }),
  getClientIp: () => '127.0.0.1',
}));
vi.mock('@/lib/actions/_shared/logger', () => ({ logError: () => undefined }));
// Archival (PDF) work scheduled after finalize is irrelevant here.
vi.mock('next/server', () => ({ after: () => undefined }));

import { finalizeDraftInvoiceInTransaction } from '@/lib/invoices/finalize-invoice-tx';
import { finalizeCreditNote } from '@/lib/actions/credit-notes/finalize-credit-note';
import { saveCreditNoteDraft } from '@/lib/actions/credit-notes/save-credit-note-draft';

const DRIZZLE_DIR = join(process.cwd(), 'drizzle');

function readJournalTags(): string[] {
  const raw = JSON.parse(readFileSync(join(DRIZZLE_DIR, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string }[] };
  return raw.entries.map((e) => e.tag);
}

async function applyMigrations(pg: PGlite): Promise<void> {
  for (const tag of readJournalTags()) {
    const statements = readFileSync(join(DRIZZLE_DIR, `${tag}.sql`), 'utf8')
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const statement of statements) await pg.exec(statement);
  }
}

async function insertOne(pg: PGlite, sqlText: string, params: unknown[] = []): Promise<string> {
  const result = await pg.query<{ id: string }>(sqlText, params);
  const row = result.rows[0];
  if (!row) throw new Error(`no row returned for: ${sqlText}`);
  return row.id;
}

function expectSuccess<T>(result: ActionResult<T>): T {
  if (!result.success) throw new Error(`expected success but got ${result.error.code}: ${result.error.message}`);
  return result.data;
}

describe('Quantity Format: enforced at finalize', () => {
  let pg: PGlite;
  let fyId: string;
  let draftCounter = 0;

  async function setQuantityDecimals(value: number | null): Promise<void> {
    await pg.query(`UPDATE businesses SET invoice_display_prefs = $1::jsonb WHERE id = $2`, [
      value === null ? '{}' : JSON.stringify({ quantityDecimals: value }),
      state.businessId,
    ]);
  }

  /** Draft invoice with the given lines (0% GST, so totals are simply qty x price). Returns invoice + line ids. */
  async function createDraft(lines: Array<{ qty: string; pricePaise: number; unit: string }>): Promise<{ id: string; lineIds: string[] }> {
    const totals = lines.map((l) => Math.round(Number(l.qty) * l.pricePaise));
    const subtotal = totals.reduce((a, b) => a + b, 0);
    const id = await insertOne(
      pg,
      `INSERT INTO invoices (business_id, financial_year_id, invoice_number, lifecycle_status, invoice_date, due_date,
         place_of_supply_state_code, subtotal_paise, total_cgst_paise, total_sgst_paise, total_igst_paise, total_tax_paise, grand_total_paise)
       VALUES ($1, $2, $4, 'draft', CURRENT_DATE, CURRENT_DATE + interval '30 days', '27', $3, 0, 0, 0, 0, $3) RETURNING id`,
      [state.businessId, fyId, subtotal, `DRAFT-QTY-${++draftCounter}`],
    );
    const lineIds: string[] = [];
    for (const [i, l] of lines.entries()) {
      lineIds.push(
        await insertOne(
          pg,
          `INSERT INTO invoice_line_items (invoice_id, description, hsn_sac_code, quantity, unit_of_measurement, unit_price_paise,
             taxable_value_paise, tax_rate_percentage, cgst_paise, sgst_paise, igst_paise, line_total_paise, sort_order)
           VALUES ($1, $2, '4802', $3, $4, $5, $6, 0, 0, 0, 0, $6, $7) RETURNING id`,
          [id, `Item ${i + 1}`, l.qty, l.unit, l.pricePaise, totals[i], i],
        ),
      );
    }
    return { id, lineIds };
  }

  async function finalizeInvoice(invoiceId: string): Promise<void> {
    const ormDb = drizzle(pg, { schema });
    await ormDb.transaction(async (tx) => {
      await finalizeDraftInvoiceInTransaction(tx as unknown as Parameters<typeof finalizeDraftInvoiceInTransaction>[0], {
        invoiceId,
        businessId: state.businessId,
        actorUserId: USER_ID,
        requestContext: { ip: '127.0.0.1', userAgent: 'vitest' },
      });
    });
  }

  async function lifecycleOf(invoiceId: string): Promise<string> {
    const res = await pg.query<{ lifecycle_status: string }>(`SELECT lifecycle_status FROM invoices WHERE id = $1`, [invoiceId]);
    return res.rows[0]!.lifecycle_status;
  }

  beforeAll(async () => {
    pg = new PGlite();
    await applyMigrations(pg);
    state.db = drizzle(pg, { schema });
    state.businessId = await insertOne(
      pg,
      `INSERT INTO businesses (legal_name, gstin, address_line1, city, state_code, pincode, subscription_plan, subscription_status)
       VALUES ('Qty Format Traders', '27AABCU9603R1ZQ', '1 Market Rd', 'Pune', '27', '411001', 'essentials', 'active') RETURNING id`,
    );
    await pg.query(
      `INSERT INTO users (id, auth_user_id, email, business_id, role, display_name)
       VALUES ($1, 'auth_qty', 'owner@qty.test', $2, 'owner', 'Owner')`,
      [USER_ID, state.businessId],
    );
    fyId = await insertOne(
      pg,
      `INSERT INTO financial_years (business_id, label, start_date, end_date, is_current)
       VALUES ($1, '2026-27', '2026-04-01', '2027-03-31', true) RETURNING id`,
      [state.businessId],
    );
  }, 60_000);

  afterAll(async () => {
    await pg.close();
  });

  it('no saved setting (existing accounts) keeps today\'s behaviour: 3 decimals finalize', async () => {
    await setQuantityDecimals(null);
    const draft = await createDraft([{ qty: '2.125', pricePaise: 800, unit: 'KGS' }]);
    await finalizeInvoice(draft.id);
    expect(await lifecycleOf(draft.id)).toBe('finalized');
  });

  it('whole numbers: a draft holding 2.5 is refused at finalize and stays a draft; 2 finalizes', async () => {
    await setQuantityDecimals(0);
    const bad = await createDraft([
      { qty: '3', pricePaise: 5000, unit: 'NOS' },
      { qty: '2.5', pricePaise: 10000, unit: 'NOS' },
    ]);
    await expect(finalizeInvoice(bad.id)).rejects.toMatchObject({ code: 'QUANTITY_FORMAT' });
    await expect(finalizeInvoice(bad.id)).rejects.toThrow(/Line 2: quantity 2\.5/);
    expect(await lifecycleOf(bad.id)).toBe('draft');

    const good = await createDraft([{ qty: '2', pricePaise: 10000, unit: 'NOS' }]);
    await finalizeInvoice(good.id);
    expect(await lifecycleOf(good.id)).toBe('finalized');
  });

  it('2 decimals: 1.25 finalizes, 1.125 is refused', async () => {
    await setQuantityDecimals(2);
    const ok = await createDraft([{ qty: '1.25', pricePaise: 2000, unit: 'KGS' }]);
    await finalizeInvoice(ok.id);
    expect(await lifecycleOf(ok.id)).toBe('finalized');

    const tooFine = await createDraft([{ qty: '1.125', pricePaise: 800, unit: 'KGS' }]);
    await expect(finalizeInvoice(tooFine.id)).rejects.toMatchObject({ code: 'QUANTITY_FORMAT' });
    expect(await lifecycleOf(tooFine.id)).toBe('draft');
  });

  it('credit notes: an older 2.5 kg line can still be credited in decimals after switching to whole numbers', async () => {
    // Invoice issued while decimals were allowed.
    await setQuantityDecimals(3);
    const inv = await createDraft([
      { qty: '2.5', pricePaise: 10000, unit: 'KGS' },
      { qty: '3', pricePaise: 5000, unit: 'NOS' },
    ]);
    await finalizeInvoice(inv.id);
    const [kgLineId, nosLineId] = inv.lineIds as [string, string];

    // The business now switches to whole numbers.
    await setQuantityDecimals(0);

    // 0.5 kg on the decimal line: allowed (the original line needed decimals).
    const kgDraft = expectSuccess(
      await saveCreditNoteDraft({
        original_invoice_id: inv.id,
        reason: '01-sales-return',
        line_items: [{ original_line_item_id: kgLineId, quantity: 0.5 }],
      }),
    );
    expectSuccess(await finalizeCreditNote({ id: kgDraft.id }));

    // 1.5 on the whole-number line: refused.
    const nosBad = expectSuccess(
      await saveCreditNoteDraft({
        original_invoice_id: inv.id,
        reason: '01-sales-return',
        line_items: [{ original_line_item_id: nosLineId, quantity: 1.5 }],
      }),
    );
    const refused = await finalizeCreditNote({ id: nosBad.id });
    expect(refused.success).toBe(false);
    if (!refused.success) {
      expect(refused.error.code).toBe('QUANTITY_FORMAT');
      expect(refused.error.message).toMatch(/Whole numbers only/);
    }

    // 1 on the whole-number line: allowed.
    const nosGood = expectSuccess(
      await saveCreditNoteDraft({
        id: nosBad.id,
        original_invoice_id: inv.id,
        reason: '01-sales-return',
        line_items: [{ original_line_item_id: nosLineId, quantity: 1 }],
      }),
    );
    expectSuccess(await finalizeCreditNote({ id: nosGood.id }));
  });

  it('re-saving a credit note draft records the time in updated_at (CodeRabbit, PR #73)', async () => {
    await setQuantityDecimals(null);
    const inv = await createDraft([{ qty: '4', pricePaise: 1000, unit: 'NOS' }]);
    await finalizeInvoice(inv.id);
    const lineId = inv.lineIds[0] as string;
    const draft = expectSuccess(
      await saveCreditNoteDraft({ original_invoice_id: inv.id, reason: '01-sales-return', line_items: [{ original_line_item_id: lineId, quantity: 1 }] }),
    );
    await pg.query(`UPDATE credit_notes SET updated_at = '2020-01-01T00:00:00Z' WHERE id = $1`, [draft.id]);
    expectSuccess(
      await saveCreditNoteDraft({ id: draft.id, original_invoice_id: inv.id, reason: '01-sales-return', line_items: [{ original_line_item_id: lineId, quantity: 2 }] }),
    );
    const row = await pg.query<{ updated_at: Date }>(`SELECT updated_at FROM credit_notes WHERE id = $1`, [draft.id]);
    expect(new Date(row.rows[0]?.updated_at ?? 0).getUTCFullYear()).toBeGreaterThan(2020);
  });

  it('stored quantities are never rewritten by the setting', async () => {
    const res = await pg.query<{ quantity: string }>(
      `SELECT ili.quantity FROM invoice_line_items ili JOIN invoices i ON i.id = ili.invoice_id
       WHERE i.lifecycle_status = 'finalized' AND ili.quantity::text IN ('2.125', '2.500')`,
    );
    expect(res.rows.map((r) => r.quantity).sort()).toEqual(['2.125', '2.500']);
  });
});
