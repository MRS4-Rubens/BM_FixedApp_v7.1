import { z } from 'zod';

export const DEFAULT_PAGE_SIZE = 50;
export const MIN_PAGE_SIZE = 10; // URL `size` lower bound (manual testing)
export const MAX_PAGE_SIZE = 100;

export const pageSizeSchema = z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE);

// PostgreSQL timestamptz::text, e.g. 2026-11-02 10:11:12.123456+00 (microseconds preserved)
const PG_TIMESTAMP_TEXT = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)$/;

const cursorSchema = z.discriminatedUnion('k', [
  z
    .object({
      v: z.literal(1),
      k: z.literal('ts'),
      t: z.string().regex(PG_TIMESTAMP_TEXT),
      id: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      v: z.literal(1),
      k: z.literal('name'),
      t: z.string().max(400),
      id: z.string().uuid(),
    })
    .strict(),
]);

export type PageCursor = z.infer<typeof cursorSchema>;

export function encodeCursor(cursor: PageCursor): string {
  const json = JSON.stringify(cursor);
  return Buffer.from(json, 'utf8')
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/** Never throws. Returns null for anything malformed/oversized (>512 chars) or failing the schema. */
export function decodeCursor(raw: string | undefined | null): PageCursor | null {
  if (!raw || typeof raw !== 'string' || raw.length > 512) {
    return null;
  }

  try {
    const unpadded = raw.replace(/-/g, '+').replace(/_/g, '/');
    const padding = (4 - (unpadded.length % 4)) % 4;
    const base64 = unpadded + '='.repeat(padding);
    const json = Buffer.from(base64, 'base64').toString('utf8');
    const parsed: unknown = JSON.parse(json);
    const result = cursorSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export type PageDirection = 'forward' | 'backward';

export interface PageInfo {
  readonly hasNext: boolean;
  readonly hasPrevious: boolean;
  readonly nextCursor: string | null;
  readonly previousCursor: string | null;
  readonly hasNextPage: boolean;
  readonly hasPreviousPage: boolean;
  readonly startCursor: string | null;
  readonly endCursor: string | null;
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly pageInfo: PageInfo;
  readonly total: number;
  readonly totalCount: number;
}

/**
 * `rows` are in QUERY order and contain up to limit+1 rows (the lookahead).
 * forward : query order == display order. backward: query order is reversed; this function re-reverses for display.
 * forward : hasNext = lookahead present; hasPrevious = a cursor was supplied.
 * backward: hasPrevious = lookahead present; hasNext = true (we arrived from a later page).
 * Cursors are built from the FIRST/LAST DISPLAYED row via toCursor.
 */
export function buildPageSlice<TRow>(
  rows: readonly TRow[],
  options: {
    readonly limit: number;
    readonly direction: PageDirection;
    readonly hasCursor: boolean;
    readonly toCursor: (row: TRow) => PageCursor;
  },
): { readonly rows: readonly TRow[]; readonly pageInfo: PageInfo } {
  const { limit, direction, hasCursor, toCursor } = options;

  if (rows.length === 0) {
    return {
      rows: [],
      pageInfo: {
        hasNext: false,
        hasPrevious: false,
        nextCursor: null,
        previousCursor: null,
        hasNextPage: false,
        hasPreviousPage: false,
        startCursor: null,
        endCursor: null,
      },
    };
  }

  const hasExtra = rows.length > limit;
  const sliced = hasExtra ? rows.slice(0, limit) : rows.slice();

  let displayedRows: readonly TRow[];
  let hasNext: boolean;
  let hasPrevious: boolean;

  if (direction === 'forward') {
    displayedRows = sliced;
    hasNext = hasExtra;
    hasPrevious = hasCursor;
  } else {
    // backward: query order was reversed, re-reverse for display
    displayedRows = sliced.slice().reverse();
    hasPrevious = hasExtra;
    hasNext = true; // Arrived from a later page
  }

  const firstRow = displayedRows[0];
  const lastRow = displayedRows[displayedRows.length - 1];

  const nextCursor = hasNext && lastRow ? encodeCursor(toCursor(lastRow)) : null;
  const previousCursor = hasPrevious && firstRow ? encodeCursor(toCursor(firstRow)) : null;

  return {
    rows: displayedRows,
    pageInfo: {
      hasNext,
      hasPrevious,
      nextCursor,
      previousCursor,
      hasNextPage: hasNext,
      hasPreviousPage: hasPrevious,
      startCursor: previousCursor,
      endCursor: nextCursor,
    },
  };
}
