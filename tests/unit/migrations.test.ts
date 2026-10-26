import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const DRIZZLE_DIR = join(process.cwd(), 'drizzle');
const META_DIR = join(DRIZZLE_DIR, 'meta');
const ROOT_PREV_ID = '00000000-0000-0000-0000-000000000000';

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

interface SnapshotIds {
  id: string;
  prevId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

function parseJournal(raw: unknown): JournalEntry[] {
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

function parseSnapshotIds(raw: unknown, label: string): SnapshotIds {
  if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.prevId !== 'string') {
    throw new Error(`${label}: "id"/"prevId" missing`);
  }
  return { id: raw.id, prevId: raw.prevId };
}

const snapshotPath = (idx: number): string =>
  join(META_DIR, `${String(idx).padStart(4, '0')}_snapshot.json`);

describe('drizzle migration history integrity (guards ARCH-004)', () => {
  const journal = parseJournal(readJson(join(META_DIR, '_journal.json')));

  it('has a contiguous, zero-based idx sequence', () => {
    expect(journal.length).toBeGreaterThan(0);
    journal.forEach((entry, position) => expect(entry.idx).toBe(position));
  });

  it('has strictly increasing "when" timestamps (drizzle skips anything not newer than the last applied row)', () => {
    for (let i = 1; i < journal.length; i += 1) {
      expect(journal[i].when, `entry ${journal[i].tag}`).toBeGreaterThan(journal[i - 1].when);
    }
  });

  it('has a SQL file and a snapshot for every journal entry', () => {
    for (const entry of journal) {
      expect(existsSync(join(DRIZZLE_DIR, `${entry.tag}.sql`)), `${entry.tag}.sql`).toBe(true);
      expect(existsSync(snapshotPath(entry.idx)), `snapshot ${entry.idx}`).toBe(true);
    }
  });

  it('has an unbroken snapshot chain (prevId -> id)', () => {
    const snapshots = journal.map((entry) =>
      parseSnapshotIds(readJson(snapshotPath(entry.idx)), `snapshot ${entry.idx}`),
    );
    expect(snapshots[0].prevId).toBe(ROOT_PREV_ID);
    for (let i = 1; i < snapshots.length; i += 1) {
      expect(snapshots[i].prevId, `snapshot ${i}`).toBe(snapshots[i - 1].id);
    }
  });

  it('keeps migration 0013 idempotent (environments that ran the old hand-written 0013 re-run it)', () => {
    const entry = journal.find((candidate) => candidate.idx === 13);
    expect(entry, 'journal entry 13').toBeDefined();
    const sql = readFileSync(join(DRIZZLE_DIR, `${entry?.tag ?? ''}.sql`), 'utf8');
    const addColumns = sql.match(/ADD COLUMN /g)?.length ?? 0;
    const addColumnsGuarded = sql.match(/ADD COLUMN IF NOT EXISTS /g)?.length ?? 0;
    const createIndexes = sql.match(/CREATE INDEX /g)?.length ?? 0;
    const createIndexesGuarded = sql.match(/CREATE INDEX IF NOT EXISTS /g)?.length ?? 0;
    const dropConstraints = sql.match(/DROP CONSTRAINT /g)?.length ?? 0;
    const dropConstraintsGuarded = sql.match(/DROP CONSTRAINT IF EXISTS /g)?.length ?? 0;
    expect(addColumnsGuarded).toBe(addColumns);
    expect(createIndexesGuarded).toBe(createIndexes);
    expect(dropConstraintsGuarded).toBe(dropConstraints);
  });
});
