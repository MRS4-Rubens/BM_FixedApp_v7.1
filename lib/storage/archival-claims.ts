import { sql, type SQL } from 'drizzle-orm';
import { ARCHIVAL_LEASE_SECONDS, ARCHIVAL_MAX_ATTEMPTS, type ArchivalKind } from './archival-config';

const TABLE_BY_KIND = { invoice: 'invoices', credit_note: 'credit_notes' } as const satisfies Record<ArchivalKind, string>;
const table = (kind: ArchivalKind): SQL => sql.raw(TABLE_BY_KIND[kind]);

/** Minimal structural type satisfied by the Drizzle db handle; adapt with a tiny adapter if Drizzle's type is not assignable. NO `any`. */
export interface SqlExecutor {
  execute(query: SQL): PromiseLike<{ readonly rows: readonly unknown[] }>;
}

export interface ClaimedDocument {
  readonly id: string;
  readonly attempts: number;
}

function isClaimRow(value: unknown): value is { id: string; archival_attempts: number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    'archival_attempts' in value &&
    typeof value.archival_attempts === 'number'
  );
}

function toClaims(rows: readonly unknown[]): ClaimedDocument[] {
  return rows.filter(isClaimRow).map((row) => ({ id: row.id, attempts: row.archival_attempts }));
}

const CLAIMABLE = sql`lifecycle_status = 'finalized'
  AND archival_status IN ('pending', 'failed')
  AND archival_attempts < ${ARCHIVAL_MAX_ATTEMPTS}
  AND (archival_claimed_at IS NULL OR archival_claimed_at < now() - make_interval(secs => ${ARCHIVAL_LEASE_SECONDS}::double precision))`;

/** Claim ONE specific document (post-finalize path). Plain UPDATE: waits briefly for a concurrent row lock instead of skipping. */
export async function claimDocumentById(db: SqlExecutor, kind: ArchivalKind, id: string): Promise<ClaimedDocument | null> {
  const result = await db.execute(sql`UPDATE ${table(kind)}
    SET archival_attempts = archival_attempts + 1, archival_claimed_at = now()
    WHERE id = ${id} AND ${CLAIMABLE}
    RETURNING id, archival_attempts`);
  return toClaims(result.rows)[0] ?? null;
}

/** Claim up to `limit` documents for the sweep. SKIP LOCKED: busy rows are simply left for the next run. */
export async function claimBatch(db: SqlExecutor, kind: ArchivalKind, limit: number): Promise<ClaimedDocument[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new RangeError('limit must be an integer 1..50');
  const result = await db.execute(sql`UPDATE ${table(kind)}
    SET archival_attempts = archival_attempts + 1, archival_claimed_at = now()
    WHERE id IN (
      SELECT id FROM ${table(kind)} WHERE ${CLAIMABLE}
      ORDER BY finalized_at ASC NULLS LAST, id ASC
      LIMIT ${limit} FOR UPDATE SKIP LOCKED)
    RETURNING id, archival_attempts`);
  return toClaims(result.rows);
}

export async function markArchived(db: SqlExecutor, kind: ArchivalKind, id: string, storageKey: string): Promise<void> {
  await db.execute(sql`UPDATE ${table(kind)}
    SET pdf_storage_key = ${storageKey}, archival_status = 'archived', archived_at = now(), archival_claimed_at = NULL
    WHERE id = ${id} AND lifecycle_status = 'finalized'`);
}

/** Never downgrades an already-archived row (a late failure from an expired lease must not undo a success). */
export async function markFailed(db: SqlExecutor, kind: ArchivalKind, id: string): Promise<void> {
  await db.execute(sql`UPDATE ${table(kind)}
    SET archival_status = 'failed', archival_claimed_at = NULL
    WHERE id = ${id} AND archival_status <> 'archived'`);
}

/** Configuration problem (not a document problem): give the attempt back and release the lease. */
export async function refundAttempt(db: SqlExecutor, kind: ArchivalKind, id: string): Promise<void> {
  await db.execute(sql`UPDATE ${table(kind)}
    SET archival_attempts = GREATEST(archival_attempts - 1, 0), archival_claimed_at = NULL
    WHERE id = ${id} AND archival_status <> 'archived'`);
}

export async function countExhausted(db: SqlExecutor, kind: ArchivalKind): Promise<number> {
  const result = await db.execute(sql`SELECT count(*)::int AS n FROM ${table(kind)}
    WHERE lifecycle_status = 'finalized' AND archival_status <> 'archived' AND archival_attempts >= ${ARCHIVAL_MAX_ATTEMPTS}`);
  const row = result.rows[0];
  return typeof row === 'object' && row !== null && 'n' in row && typeof row.n === 'number' ? row.n : 0;
}

