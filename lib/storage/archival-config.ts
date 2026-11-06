export type ArchivalKind = 'invoice' | 'credit_note';

/** Must equal the literal in the DB-005 partial index predicate (archival_attempts < 5). A unit test pins it. */
export const ARCHIVAL_MAX_ATTEMPTS = 5;
/** A claim older than this is considered abandoned (crashed/frozen worker) and may be re-claimed. */
export const ARCHIVAL_LEASE_SECONDS = 300;
export const ARCHIVAL_SWEEP_BATCH_SIZE = 4;
export const ARCHIVAL_SWEEP_CONCURRENCY = 2;
/** Stop claiming new work after this many ms of a 300 s function (must leave room for in-flight renders). */
export const ARCHIVAL_SWEEP_DEADLINE_MS = 200_000;

