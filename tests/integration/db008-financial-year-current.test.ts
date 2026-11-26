import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '@/lib/db/schema';
import type { ActionResult } from '@/lib/actions/_shared/types';
import type { DbTransaction } from '@/lib/db/client';

interface TestState {
  db: PgliteDatabase<typeof schema> | undefined;
  userId: string;
  businessId: string | null;
}

const state: TestState = vi.hoisted(() => ({
  db: undefined,
  userId: '00000000-0000-0000-0000-000000000001',
  businessId: null,
}));

vi.mock('@/lib/db/client', () => ({
  get db() {
    return state.db;
  },
}));

vi.mock('@/lib/auth/session', () => ({
  getCurrentAppUser: async () => ({
    id: state.userId,
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

import { getOrCreateCurrentFinancialYear } from '@/lib/invoices/financial-year-rollover';
import { getSalesByFinancialYear } from '@/lib/actions/reports/get-sales-by-financial-year';
import { saveBusinessProfile } from '@/lib/actions/business/save-business-profile';

function expectSuccess<T>(result: ActionResult<T>): T {
  if (!result.success) {
    throw new Error(`Expected success but got error: ${result.error.message} (${result.error.code})`);
  }
  return result.data;
}

const DRIZZLE_DIR = join(process.cwd(), 'drizzle');

interface JournalEntry {
  tag: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJournal(): JournalEntry[] {
  const raw: unknown = JSON.parse(readFileSync(join(DRIZZLE_DIR, 'meta', '_journal.json'), 'utf8'));
  if (!isRecord(raw) || !Array.isArray(raw.entries)) {
    throw new Error('journal has no entries array');
  }
  return raw.entries.map((entry: unknown): JournalEntry => {
    if (!isRecord(entry) || typeof entry.tag !== 'string') {
      throw new Error('malformed journal entry');
    }
    return { tag: entry.tag };
  });
}

async function applyMigrations(pg: PGlite, entries: JournalEntry[]): Promise<void> {
  for (const entry of entries) {
    const statements = readFileSync(join(DRIZZLE_DIR, `${entry.tag}.sql`), 'utf8')
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const stmt of statements) {
      await pg.exec(stmt);
    }
  }
}

interface IdRow {
  id: string;
}

async function insertOne(pg: PGlite, sqlText: string, params: unknown[] = []): Promise<string> {
  const result = await pg.query<IdRow>(sqlText, params);
  const row = result.rows[0];
  if (!row) {
    throw new Error(`no row returned for: ${sqlText}`);
  }
  return row.id;
}

describe('DB-008: financial-year "current" flag invariants and dynamic resolution', () => {
  let pg: PGlite;

  beforeAll(async () => {
    pg = new PGlite();
    const journal = readJournal();
    await applyMigrations(pg, journal);
    state.db = drizzle(pg, { schema });
  }, 60_000);

  afterAll(async () => {
    if (pg) {
      await pg.close();
    }
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('DB-008: rollover is insert-or-select only and never touches other FY rows', async () => {
    if (!state.db) throw new Error('Database not initialized');

    const bizId = await insertOne(
      pg,
      `INSERT INTO businesses (legal_name, gstin, address_line1, city, state_code, pincode)
       VALUES ('Rollover Invariant Biz', '29ABCDE1234F1Z5', '123 Test St', 'Bengaluru', '29', '560001') RETURNING id`,
    );

    const fy25Id = await insertOne(
      pg,
      `INSERT INTO financial_years (business_id, label, start_date, end_date, is_current, invoice_sequence_counter, credit_note_sequence_counter)
       VALUES ($1, '2025-26', '2025-04-01', '2026-03-31', true, 0, 0) RETURNING id`,
      [bizId],
    );

    const fy26Id = await insertOne(
      pg,
      `INSERT INTO financial_years (business_id, label, start_date, end_date, is_current, invoice_sequence_counter, credit_note_sequence_counter)
       VALUES ($1, '2026-27', '2026-04-01', '2027-03-31', false, 0, 0) RETURNING id`,
      [bizId],
    );

    interface FySnapshotRow {
      id: string;
      label: string;
      is_current: boolean;
      updated_at: string;
    }

    const beforeRes = await pg.query<FySnapshotRow>(
      `SELECT id, label, is_current, updated_at::text FROM financial_years WHERE business_id = $1 ORDER BY label`,
      [bizId],
    );
    expect(beforeRes.rows.length).toBe(2);
    const before25 = beforeRes.rows.find((r) => r.id === fy25Id);
    const before26 = beforeRes.rows.find((r) => r.id === fy26Id);
    if (!before25 || !before26) throw new Error('Existing FY rows missing');

    const returned25 = await state.db.transaction(async (tx) => {
      return getOrCreateCurrentFinancialYear(tx as unknown as DbTransaction, bizId, new Date('2025-12-15T06:00:00Z'));
    });
    expect(returned25.id).toBe(fy25Id);
    expect(returned25.label).toBe('2025-26');

    const midRes = await pg.query<FySnapshotRow>(
      `SELECT id, label, is_current, updated_at::text FROM financial_years WHERE business_id = $1 ORDER BY label`,
      [bizId],
    );
    const mid25 = midRes.rows.find((r) => r.id === fy25Id);
    const mid26 = midRes.rows.find((r) => r.id === fy26Id);
    if (!mid25 || !mid26) throw new Error('Existing FY rows missing after lookup');

    expect(mid25.is_current).toBe(before25.is_current);
    expect(mid25.updated_at).toBe(before25.updated_at);
    expect(mid26.is_current).toBe(before26.is_current);
    expect(mid26.updated_at).toBe(before26.updated_at);

    const created27 = await state.db.transaction(async (tx) => {
      return getOrCreateCurrentFinancialYear(tx as unknown as DbTransaction, bizId, new Date('2027-05-01T06:00:00Z'));
    });
    expect(created27.label).toBe('2027-28');

    interface FyDetailRow {
      label: string;
      start_date: string;
      end_date: string;
      is_current: boolean;
    }

    const created27Res = await pg.query<FyDetailRow>(
      `SELECT label, to_char(start_date, 'YYYY-MM-DD') AS start_date, to_char(end_date, 'YYYY-MM-DD') AS end_date, is_current
       FROM financial_years WHERE id = $1`,
      [created27.id],
    );
    expect(created27Res.rows[0]?.label).toBe('2027-28');
    expect(created27Res.rows[0]?.start_date).toBe('2027-04-01');
    expect(created27Res.rows[0]?.end_date).toBe('2028-03-31');
    expect(created27Res.rows[0]?.is_current).toBe(false);

    const afterRes = await pg.query<FySnapshotRow>(
      `SELECT id, label, is_current, updated_at::text FROM financial_years WHERE business_id = $1 AND id IN ($2, $3)`,
      [bizId, fy25Id, fy26Id],
    );
    const after25 = afterRes.rows.find((r) => r.id === fy25Id);
    const after26 = afterRes.rows.find((r) => r.id === fy26Id);
    if (!after25 || !after26) throw new Error('Prior FY rows missing after rollover creation');

    expect(after25.is_current).toBe(before25.is_current);
    expect(after25.updated_at).toBe(before25.updated_at);
    expect(after26.is_current).toBe(before26.is_current);
    expect(after26.updated_at).toBe(before26.updated_at);
  });

  it('DB-008: getSalesByFinancialYear marks current FY by frozen system date regardless of stored flag', async () => {
    const bizId = await insertOne(
      pg,
      `INSERT INTO businesses (legal_name, gstin, address_line1, city, state_code, pincode)
       VALUES ('Report Test Biz', '29REP1234F1Z5AB', '123 Report St', 'Bengaluru', '29', '560001') RETURNING id`,
    );

    await insertOne(
      pg,
      `INSERT INTO financial_years (business_id, label, start_date, end_date, is_current, invoice_sequence_counter, credit_note_sequence_counter)
       VALUES ($1, '2025-26', '2025-04-01', '2026-03-31', true, 0, 0) RETURNING id`,
      [bizId],
    );

    await insertOne(
      pg,
      `INSERT INTO financial_years (business_id, label, start_date, end_date, is_current, invoice_sequence_counter, credit_note_sequence_counter)
       VALUES ($1, '2026-27', '2026-04-01', '2027-03-31', false, 0, 0) RETURNING id`,
      [bizId],
    );

    state.businessId = bizId;

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-06T06:00:00Z'));

    const res1 = await getSalesByFinancialYear({});
    const sales1 = expectSuccess(res1);

    const fy26Entry1 = sales1.find((r) => r.key === '2026-27');
    const fy25Entry1 = sales1.find((r) => r.key === '2025-26');
    expect(fy26Entry1).toBeDefined();
    expect(fy25Entry1).toBeDefined();
    expect(fy26Entry1?.is_current).toBe(true);
    expect(fy25Entry1?.is_current).toBe(false);

    vi.setSystemTime(new Date('2027-04-02T06:00:00Z'));

    const res2 = await getSalesByFinancialYear({});
    const sales2 = expectSuccess(res2);

    expect(sales2.length).toBeGreaterThanOrEqual(2);
    for (const entry of sales2) {
      expect(entry.is_current).toBe(false);
    }
  });

  it('DB-008: first-time setup writes IST calendar dates at FY boundary', async () => {
    const userId = await insertOne(
      pg,
      `INSERT INTO users (auth_user_id, email, business_id) VALUES ('auth_ist_test', 'ist@test.com', NULL) RETURNING id`,
    );

    state.userId = userId;
    state.businessId = null;

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2027-03-31T19:00:00Z')); // 1 Apr 2027 00:30 IST

    const res = await saveBusinessProfile({
      legal_name: 'IST Boundary Enterprise',
      phone: '9876543210',
      gstin: '29BOUND1234F1Z5',
      registration_type: 'regular',
      address_line1: 'Boundary Road',
      city: 'Bengaluru',
      state_code: '29',
      pincode: '560001',
    });

    const data = expectSuccess(res);
    const newBizId = data.businessId;
    expect(newBizId).toBeDefined();

    interface SetupFyRow {
      label: string;
      start_date: string;
      end_date: string;
      is_current: boolean;
    }

    const fyRes = await pg.query<SetupFyRow>(
      `SELECT label, to_char(start_date, 'YYYY-MM-DD') AS start_date, to_char(end_date, 'YYYY-MM-DD') AS end_date, is_current
       FROM financial_years WHERE business_id = $1`,
      [newBizId],
    );

    expect(fyRes.rows.length).toBe(1);
    const row = fyRes.rows[0];
    if (!row) throw new Error('Created FY row missing');

    expect(row.label).toBe('2027-28');
    expect(row.start_date).toBe('2027-04-01');
    expect(row.end_date).toBe('2028-03-31');
    expect(row.is_current).toBe(false);
  });
});
