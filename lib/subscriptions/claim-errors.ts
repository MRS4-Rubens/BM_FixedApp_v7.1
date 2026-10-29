import { getPgError } from '@/lib/db/pg-error';

export type ClaimInsertFailure = 'PENDING_CLAIM_EXISTS' | 'DUPLICATE_REFERENCE' | 'UNKNOWN';

/** DB-005 must name its partial unique index so that it contains the word "pending". */
export function classifyClaimInsertError(error: unknown): ClaimInsertFailure {
  const { code, constraint } = getPgError(error);
  if (code !== '23505') {
    return 'UNKNOWN';
  }
  if (constraint && constraint.toLowerCase().includes('pending')) {
    return 'PENDING_CLAIM_EXISTS';
  }
  return 'DUPLICATE_REFERENCE';
}

