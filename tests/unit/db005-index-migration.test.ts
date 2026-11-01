import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PENDING_CLAIM_INDEX_NAME } from '@/lib/subscriptions/claim-errors';

const DRIZZLE_DIR = join(process.cwd(), 'drizzle');
const META_DIR = join(DRIZZLE_DIR, 'meta');
const SCHEMA_DIR = join(process.cwd(), 'lib', 'db', 'schema');

const CREATED_INDEXES = [
  'subscription_requests_one_pending_per_biz',
  'invoices_archival_retry_idx',
  'customers_biz_name_idx',
  'products_biz_active_idx',
  'invoice_line_items_product_idx',
  'audit_log_biz_created_idx',
  'subscription_requests_user_id_idx',
  'invoices_biz_customer_idx',
] as const;

const DROPPED_INDEXES = [
  'invoices_lifecycle_status_idx',
  'invoices_payment_status_idx',
  'invoices_business_id_idx',
  'credit_notes_lifecycle_status_idx',
  'credit_notes_status_idx',
  'payments_status_idx',
] as const;

interface JournalEntry {
  readonly idx: number;
  readonly when: number;
  readonly tag: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

function parseJournal(raw: unknown): readonly JournalEntry[] {
  if (!isRecord(raw) || !Array.isArray(raw.entries)) {
    throw new Error('drizzle/meta/_journal.json: "entries" array is missing');
  }
  return raw.entries.map((entry: unknown, position: number): JournalEntry => {
    if (
      !isRecord(entry) ||
      typeof entry.idx !== 'number' ||
      typeof entry.when !== 'number' ||
      typeof entry.tag !== 'string'
    ) {
      throw new Error(`drizzle/meta/_journal.json: malformed entry at position ${position}`);
    }
    return { idx: entry.idx, when: entry.when, tag: entry.tag };
  });
}

function readAllSchemaText(): string {
  const schemaFiles = readdirSync(SCHEMA_DIR).filter((f) => f.endsWith('.ts'));
  return schemaFiles
    .map((f) => readFileSync(join(SCHEMA_DIR, f), 'utf8'))
    .join('\n');
}

describe('DB-005 migration and schema static guards', () => {
  const journal = parseJournal(readJson(join(META_DIR, '_journal.json')));
  const entry21 = journal.find((e) => e.idx === 21);
  const migrationTag = '0021_db005_index_hardening';
  const migrationSqlPath = join(DRIZZLE_DIR, `${migrationTag}.sql`);
  const snapshotPath = join(META_DIR, '0021_snapshot.json');

  it('1. migration 0021 exists in journal and its snapshot exists', () => {
    expect(entry21).toBeDefined();
    expect(entry21?.idx).toBe(21);
    expect(entry21?.tag).toBe(migrationTag);
    expect(existsSync(migrationSqlPath)).toBe(true);
    expect(existsSync(snapshotPath)).toBe(true);
  });

  it('2. migration SQL has pre-flight guard, IF NOT EXISTS / IF EXISTS, and NO CONCURRENTLY', () => {
    const sql = readFileSync(migrationSqlPath, 'utf8');

    // Pre-flight guard
    expect(sql).toContain('DO $$');
    expect(sql).toContain('DB-005 pre-flight failed');

    // No CREATE INDEX CONCURRENTLY in SQL statements
    const executableStatements = sql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    expect(executableStatements.toUpperCase()).not.toContain('CONCURRENTLY');

    // All 8 CREATE statements use IF NOT EXISTS
    for (const idxName of CREATED_INDEXES) {
      const createPattern = new RegExp(`CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+IF\\s+NOT\\s+EXISTS\\s+"${idxName}"`, 'i');
      expect(sql).toMatch(createPattern);
    }

    // All 6 DROP statements use IF EXISTS
    for (const idxName of DROPPED_INDEXES) {
      const dropPattern = new RegExp(`DROP\\s+INDEX\\s+IF\\s+EXISTS\\s+"${idxName}"`, 'i');
      expect(sql).toMatch(dropPattern);
    }
  });

  it('3. schema files define all 8 created indexes and none of the 6 dropped indexes', () => {
    const allSchema = readAllSchemaText();

    for (const idxName of CREATED_INDEXES) {
      expect(allSchema).toContain(idxName);
    }

    for (const idxName of DROPPED_INDEXES) {
      expect(allSchema).not.toContain(idxName);
    }
  });

  it('4. PENDING_CLAIM_INDEX_NAME is coupled to schema, migration, and contains "pending"', () => {
    expect(PENDING_CLAIM_INDEX_NAME).toBe('subscription_requests_one_pending_per_biz');
    expect(PENDING_CLAIM_INDEX_NAME.toLowerCase()).toContain('pending');

    const subReqSchema = readFileSync(join(SCHEMA_DIR, 'subscription_requests.ts'), 'utf8');
    expect(subReqSchema).toContain(PENDING_CLAIM_INDEX_NAME);

    const sql = readFileSync(migrationSqlPath, 'utf8');
    expect(sql).toContain(PENDING_CLAIM_INDEX_NAME);
  });
});
