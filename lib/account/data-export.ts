import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import {
  businesses,
  users,
  customers,
  products,
  financialYears,
  invoices,
  invoiceLineItems,
  creditNotes,
  creditNoteLineItems,
  payments,
  subscriptionRequests,
} from '@/lib/db/schema';
import type { db } from '@/lib/db/client';

export const DATA_EXPORT_FORMAT = 'bill-matrix-data-export';
export const DATA_EXPORT_VERSION = 1;

/**
 * Explicit denylist of internal infrastructure, storage pointer, and authentication columns
 * that MUST NOT be included in data exports under DPDP right of access.
 */
export const EXPORT_FIELD_DENYLIST = [
  'auth_user_id',
  'archival_attempts',
  'archival_claimed_at',
  'archival_status',
  'archived_at',
  'screenshot_key',
] as const;

export function shouldOmitField(key: string): boolean {
  if (
    key.endsWith('_storage_key') ||
    key.endsWith('storage_key') ||
    key.endsWith('storage_key_snapshot') ||
    (key.endsWith('_key') && (key.includes('storage') || key.includes('screenshot'))) ||
    key === 'screenshot_key'
  ) {
    return true;
  }
  return (EXPORT_FIELD_DENYLIST as readonly string[]).includes(key);
}

export function sanitizeExportRecord<T extends Record<string, unknown>>(record: T): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (shouldOmitField(key)) {
      continue;
    }
    result[key] = sanitizeExportValue(value);
  }
  return result;
}

export function sanitizeExportValue(val: unknown): unknown {
  if (val instanceof Date) {
    return val.toISOString();
  }
  if (typeof val === 'bigint') {
    return Number(val);
  }
  if (Array.isArray(val)) {
    return val.map(sanitizeExportValue);
  }
  if (val !== null && typeof val === 'object') {
    return sanitizeExportRecord(val as Record<string, unknown>);
  }
  return val;
}

/** The shape of the downloaded file once parsed (the stream below writes exactly this, section by section). */
export interface DataExport {
  readonly format: typeof DATA_EXPORT_FORMAT;
  readonly version: typeof DATA_EXPORT_VERSION;
  readonly exported_at: string;
  readonly business: Record<string, unknown> | null;
  readonly users: Record<string, unknown>[];
  readonly customers: Record<string, unknown>[];
  readonly products: Record<string, unknown>[];
  readonly financial_years: Record<string, unknown>[];
  readonly invoices: (Record<string, unknown> & { line_items: Record<string, unknown>[] })[];
  readonly credit_notes: (Record<string, unknown> & { line_items: Record<string, unknown>[] })[];
  readonly payments: Record<string, unknown>[];
  readonly subscription_requests: Record<string, unknown>[];
}

type QueryableDb = {
  select: typeof db.select;
};

/** Rows per page while streaming (API-02). Each page is one database round trip and one chunk of the download. */
const DATA_EXPORT_PAGE_SIZE = 500;

interface Cursor {
  /** created_at exactly as Postgres prints it (keeps microseconds; a JS Date would round them away). */
  readonly ts: string;
  readonly id: string;
}

interface PageRow<Row> {
  readonly row: Row;
  readonly ts: string;
}

type ExportRecord = Record<string, unknown>;

/** Keyset condition "(created_at, id) > cursor" for the next page, in the same order the export always used. */
function afterCursor(createdAt: PgColumn, id: PgColumn, after: Cursor | null): SQL | undefined {
  return after === null ? undefined : sql`(${createdAt}, ${id}) > (${after.ts}::timestamptz, ${after.id}::uuid)`;
}

/** Pages of rows ordered by (created_at, id), fetched one page at a time. */
async function* keysetPages<Row extends { id: string }>(
  fetchPage: (after: Cursor | null) => Promise<PageRow<Row>[]>,
  pageSize: number,
): AsyncGenerator<Row[]> {
  let after: Cursor | null = null;
  for (;;) {
    const page = await fetchPage(after);
    if (page.length === 0) return;
    yield page.map((entry) => entry.row);
    const last = page[page.length - 1];
    if (page.length < pageSize || last === undefined) return;
    after = { ts: last.ts, id: last.row.id };
  }
}

async function* mapPages<Row>(
  pages: AsyncIterable<Row[]>,
  map: (rows: Row[]) => ExportRecord[] | Promise<ExportRecord[]>,
): AsyncGenerator<ExportRecord[]> {
  for await (const rows of pages) yield await map(rows);
}

async function* onePage(rows: ExportRecord[]): AsyncGenerator<ExportRecord[]> {
  yield rows;
}

/** A JSON array written page by page: "[", rows joined by ",", "]". */
async function* jsonArray(pages: AsyncIterable<ExportRecord[]>): AsyncGenerator<string> {
  yield '[';
  let first = true;
  for await (const page of pages) {
    if (page.length === 0) continue;
    yield (first ? '' : ',') + page.map((row) => JSON.stringify(row)).join(',');
    first = false;
  }
  yield ']';
}

function groupSanitized<Row extends ExportRecord>(rows: readonly Row[], key: (row: Row) => string): Map<string, ExportRecord[]> {
  const map = new Map<string, ExportRecord[]>();
  for (const row of rows) {
    const list = map.get(key(row)) ?? [];
    list.push(sanitizeExportRecord(row));
    map.set(key(row), list);
  }
  return map;
}

/**
 * API-02: the "Download my data" file (DPDP right of access), written as a STREAM of JSON text so a business with tens
 * of thousands of invoice lines never holds everything in the 512 MB process at once. Same sections, order and fields
 * as before, compact (not pretty-printed). The large sections (customers, products, invoices + their lines, credit
 * notes + their lines, payments) are read in keyset pages of `pageSize` rows; every query is scoped to `businessId`.
 */
export async function* streamDataExport(
  database: QueryableDb,
  businessId: string,
  options: { readonly pageSize?: number; readonly now?: Date } = {},
): AsyncGenerator<string> {
  const pageSize = options.pageSize ?? DATA_EXPORT_PAGE_SIZE;
  const exportedAt = (options.now ?? new Date()).toISOString();

  const [biz] = await database.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  yield `{"format":${JSON.stringify(DATA_EXPORT_FORMAT)},"version":${DATA_EXPORT_VERSION},"exported_at":${JSON.stringify(exportedAt)},"business":${JSON.stringify(biz ? sanitizeExportRecord(biz) : null)}`;

  // Small sections (a handful of rows each): one query.
  const userRows = await database
    .select()
    .from(users)
    .where(eq(users.business_id, businessId))
    .orderBy(asc(users.created_at), asc(users.id));
  yield ',"users":';
  yield* jsonArray(onePage(userRows.map(sanitizeExportRecord)));

  yield ',"customers":';
  yield* jsonArray(
    mapPages(
      keysetPages(
        (after) =>
          database
            .select({ row: customers, ts: sql<string>`${customers.created_at}::text` })
            .from(customers)
            .where(and(eq(customers.business_id, businessId), afterCursor(customers.created_at, customers.id, after)))
            .orderBy(asc(customers.created_at), asc(customers.id))
            .limit(pageSize),
        pageSize,
      ),
      (rows) => rows.map(sanitizeExportRecord),
    ),
  );

  yield ',"products":';
  yield* jsonArray(
    mapPages(
      keysetPages(
        (after) =>
          database
            .select({ row: products, ts: sql<string>`${products.created_at}::text` })
            .from(products)
            .where(and(eq(products.business_id, businessId), afterCursor(products.created_at, products.id, after)))
            .orderBy(asc(products.created_at), asc(products.id))
            .limit(pageSize),
        pageSize,
      ),
      (rows) => rows.map(sanitizeExportRecord),
    ),
  );

  const fyRows = await database
    .select()
    .from(financialYears)
    .where(eq(financialYears.business_id, businessId))
    .orderBy(asc(financialYears.start_date), asc(financialYears.id));
  yield ',"financial_years":';
  yield* jsonArray(onePage(fyRows.map(sanitizeExportRecord)));

  // Invoices: one page of invoices, then the line items of exactly those invoices.
  yield ',"invoices":';
  yield* jsonArray(
    mapPages(
      keysetPages(
        (after) =>
          database
            .select({ row: invoices, ts: sql<string>`${invoices.created_at}::text` })
            .from(invoices)
            .where(and(eq(invoices.business_id, businessId), afterCursor(invoices.created_at, invoices.id, after)))
            .orderBy(asc(invoices.created_at), asc(invoices.id))
            .limit(pageSize),
        pageSize,
      ),
      async (rows) => {
        const lines = await database
          .select()
          .from(invoiceLineItems)
          .where(inArray(invoiceLineItems.invoice_id, rows.map((row) => row.id)))
          .orderBy(asc(invoiceLineItems.sort_order), asc(invoiceLineItems.created_at));
        const byInvoice = groupSanitized(lines, (line) => line.invoice_id);
        return rows.map((row) => ({ ...sanitizeExportRecord(row), line_items: byInvoice.get(row.id) ?? [] }));
      },
    ),
  );

  yield ',"credit_notes":';
  yield* jsonArray(
    mapPages(
      keysetPages(
        (after) =>
          database
            .select({ row: creditNotes, ts: sql<string>`${creditNotes.created_at}::text` })
            .from(creditNotes)
            .where(and(eq(creditNotes.business_id, businessId), afterCursor(creditNotes.created_at, creditNotes.id, after)))
            .orderBy(asc(creditNotes.created_at), asc(creditNotes.id))
            .limit(pageSize),
        pageSize,
      ),
      async (rows) => {
        const lines = await database
          .select()
          .from(creditNoteLineItems)
          .where(inArray(creditNoteLineItems.credit_note_id, rows.map((row) => row.id)))
          .orderBy(asc(creditNoteLineItems.sort_order), asc(creditNoteLineItems.created_at));
        const byNote = groupSanitized(lines, (line) => line.credit_note_id);
        return rows.map((row) => ({ ...sanitizeExportRecord(row), line_items: byNote.get(row.id) ?? [] }));
      },
    ),
  );

  yield ',"payments":';
  yield* jsonArray(
    mapPages(
      keysetPages(
        (after) =>
          database
            .select({ row: payments, ts: sql<string>`${payments.created_at}::text` })
            .from(payments)
            .where(and(eq(payments.business_id, businessId), afterCursor(payments.created_at, payments.id, after)))
            .orderBy(asc(payments.created_at), asc(payments.id))
            .limit(pageSize),
        pageSize,
      ),
      (rows) => rows.map(sanitizeExportRecord),
    ),
  );

  const subRows = await database
    .select()
    .from(subscriptionRequests)
    .where(eq(subscriptionRequests.business_id, businessId))
    .orderBy(asc(subscriptionRequests.created_at), asc(subscriptionRequests.id));
  yield ',"subscription_requests":';
  yield* jsonArray(onePage(subRows.map(sanitizeExportRecord)));

  yield '}';
}
