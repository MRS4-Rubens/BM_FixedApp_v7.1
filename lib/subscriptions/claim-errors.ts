import { getPgError } from '@/lib/db/pg-error';

export type ClaimInsertFailure = 'PENDING_CLAIM_EXISTS' | 'DUPLICATE_REFERENCE' | 'UNKNOWN';

/** Partial unique index created by migration DB-005: one pending claim per business. */
export const PENDING_CLAIM_INDEX_NAME = 'subscription_requests_one_pending_per_biz';

export function classifyClaimInsertError(error: unknown): ClaimInsertFailure {
  const { code, constraint } = getPgError(error);
  if (code !== '23505') return 'UNKNOWN';
  if (constraint === PENDING_CLAIM_INDEX_NAME) return 'PENDING_CLAIM_EXISTS';
  return 'DUPLICATE_REFERENCE';
}

