import { describe, expect, it } from 'vitest';
import {
  buildPageSlice,
  decodeCursor,
  encodeCursor,
  type PageCursor,
} from '@/lib/pagination/keyset';

describe('keyset pagination (PERF-001)', () => {
  const sampleUuid = 'a1111111-2222-4333-a444-555555555555';
  const sampleTs = '2026-11-02 10:11:12.123456+00';

  it('encodes and decodes a timestamp cursor round-trip', () => {
    const cursor: PageCursor = {
      v: 1,
      k: 'ts',
      t: sampleTs,
      id: sampleUuid,
    };
    const encoded = encodeCursor(cursor);
    expect(typeof encoded).toBe('string');
    expect(encoded).not.toContain('=');

    const decoded = decodeCursor(encoded);
    expect(decoded).toEqual(cursor);
  });

  it('encodes and decodes a name cursor round-trip', () => {
    const cursor: PageCursor = {
      v: 1,
      k: 'name',
      t: 'Acme Corp Special & Co.',
      id: sampleUuid,
    };
    const encoded = encodeCursor(cursor);
    const decoded = decodeCursor(encoded);
    expect(decoded).toEqual(cursor);
  });

  it('returns null on invalid, malformed, or malicious cursors without throwing', () => {
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor('')).toBeNull();
    expect(decodeCursor('not-base64!')).toBeNull();
    expect(decodeCursor('a'.repeat(600))).toBeNull(); // oversized > 512

    // Invalid JSON
    const notJson = Buffer.from('not json', 'utf8').toString('base64url');
    expect(decodeCursor(notJson)).toBeNull();

    // Wrong version
    const wrongVersion = Buffer.from(JSON.stringify({ v: 2, k: 'ts', t: sampleTs, id: sampleUuid })).toString('base64url');
    expect(decodeCursor(wrongVersion)).toBeNull();

    // Extra keys (strict)
    const extraKey = Buffer.from(JSON.stringify({ v: 1, k: 'ts', t: sampleTs, id: sampleUuid, evil: true })).toString('base64url');
    expect(decodeCursor(extraKey)).toBeNull();

    // Bad timestamp format (no millisecond/time)
    const badTs = Buffer.from(JSON.stringify({ v: 1, k: 'ts', t: 'invalid-date', id: sampleUuid })).toString('base64url');
    expect(decodeCursor(badTs)).toBeNull();

    // Bad UUID
    const badUuid = Buffer.from(JSON.stringify({ v: 1, k: 'ts', t: sampleTs, id: 'not-a-uuid' })).toString('base64url');
    expect(decodeCursor(badUuid)).toBeNull();
  });

  describe('buildPageSlice', () => {
    interface TestRow {
      readonly id: string;
      readonly ts: string;
    }

    const toCursor = (row: TestRow): PageCursor => ({
      v: 1,
      k: 'ts',
      t: row.ts,
      id: row.id,
    });

    const createRows = (count: number): readonly TestRow[] =>
      Array.from({ length: count }, (_, i) => ({
        id: `a0000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
        ts: `2026-11-02 10:11:${String(i).padStart(2, '0')}.000000+00`,
      }));

    it('handles empty query results', () => {
      const slice = buildPageSlice([], {
        limit: 10,
        direction: 'forward',
        hasCursor: false,
        toCursor,
      });

      expect(slice.rows).toEqual([]);
      expect(slice.pageInfo.hasNext).toBe(false);
      expect(slice.pageInfo.hasPrevious).toBe(false);
      expect(slice.pageInfo.nextCursor).toBeNull();
      expect(slice.pageInfo.previousCursor).toBeNull();
    });

    it('handles single row with no lookahead', () => {
      const rows = createRows(1);
      const slice = buildPageSlice(rows, {
        limit: 10,
        direction: 'forward',
        hasCursor: false,
        toCursor,
      });

      expect(slice.rows.length).toBe(1);
      expect(slice.pageInfo.hasNext).toBe(false);
      expect(slice.pageInfo.hasPrevious).toBe(false);
      expect(slice.pageInfo.nextCursor).toBeNull();
      expect(slice.pageInfo.previousCursor).toBeNull();
    });

    it('handles exact limit boundary (limit rows, no lookahead)', () => {
      const rows = createRows(10);
      const slice = buildPageSlice(rows, {
        limit: 10,
        direction: 'forward',
        hasCursor: false,
        toCursor,
      });

      expect(slice.rows.length).toBe(10);
      expect(slice.pageInfo.hasNext).toBe(false);
      expect(slice.pageInfo.hasPrevious).toBe(false);
      expect(slice.pageInfo.nextCursor).toBeNull();
    });

    it('handles forward first page with extra lookahead row', () => {
      const rows = createRows(11); // 10 + 1 lookahead
      const slice = buildPageSlice(rows, {
        limit: 10,
        direction: 'forward',
        hasCursor: false,
        toCursor,
      });

      expect(slice.rows.length).toBe(10);
      expect(slice.pageInfo.hasNext).toBe(true);
      expect(slice.pageInfo.hasPrevious).toBe(false);
      expect(slice.pageInfo.nextCursor).not.toBeNull();
      expect(slice.pageInfo.previousCursor).toBeNull();

      // Next cursor points to row 10 (last displayed row)
      const decoded = decodeCursor(slice.pageInfo.nextCursor);
      expect(decoded?.id).toBe(rows[9].id);
    });

    it('handles forward middle page with cursor and lookahead', () => {
      const rows = createRows(11);
      const slice = buildPageSlice(rows, {
        limit: 10,
        direction: 'forward',
        hasCursor: true,
        toCursor,
      });

      expect(slice.rows.length).toBe(10);
      expect(slice.pageInfo.hasNext).toBe(true);
      expect(slice.pageInfo.hasPrevious).toBe(true);
      expect(slice.pageInfo.nextCursor).not.toBeNull();
      expect(slice.pageInfo.previousCursor).not.toBeNull();

      // Previous cursor points to row 1, next cursor points to row 10
      expect(decodeCursor(slice.pageInfo.previousCursor)?.id).toBe(rows[0].id);
      expect(decodeCursor(slice.pageInfo.nextCursor)?.id).toBe(rows[9].id);
    });

    it('handles forward last page with cursor and no lookahead', () => {
      const rows = createRows(7); // fewer than limit
      const slice = buildPageSlice(rows, {
        limit: 10,
        direction: 'forward',
        hasCursor: true,
        toCursor,
      });

      expect(slice.rows.length).toBe(7);
      expect(slice.pageInfo.hasNext).toBe(false);
      expect(slice.pageInfo.hasPrevious).toBe(true);
      expect(slice.pageInfo.nextCursor).toBeNull();
      expect(slice.pageInfo.previousCursor).not.toBeNull();
      expect(decodeCursor(slice.pageInfo.previousCursor)?.id).toBe(rows[0].id);
    });

    it('handles backward middle page with lookahead', () => {
      // In backward paging, DB returned rows in reverse order: [row 15, row 14, ... row 5] (11 rows)
      const rows = createRows(11);
      const slice = buildPageSlice(rows, {
        limit: 10,
        direction: 'backward',
        hasCursor: true,
        toCursor,
      });

      // Rows are re-reversed for forward display
      expect(slice.rows.length).toBe(10);
      expect(slice.pageInfo.hasNext).toBe(true);
      expect(slice.pageInfo.hasPrevious).toBe(true);
      expect(slice.pageInfo.previousCursor).not.toBeNull();
      expect(slice.pageInfo.nextCursor).not.toBeNull();
    });

    it('handles backward page reaching start (fewer than limit or exact without lookahead)', () => {
      const rows = createRows(5); // arrived at top of list
      const slice = buildPageSlice(rows, {
        limit: 10,
        direction: 'backward',
        hasCursor: true,
        toCursor,
      });

      expect(slice.rows.length).toBe(5);
      expect(slice.pageInfo.hasPrevious).toBe(false); // hits start
      expect(slice.pageInfo.hasNext).toBe(true);
      expect(slice.pageInfo.previousCursor).toBeNull();
      expect(slice.pageInfo.nextCursor).not.toBeNull();
    });
  });
});
