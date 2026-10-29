import { describe, expect, it } from 'vitest';
import { getPgError } from '@/lib/db/pg-error';
import { classifyClaimInsertError } from '@/lib/subscriptions/claim-errors';

describe('pg-error and claim-errors (API-009)', () => {
  it('getPgError finds code and constraint on direct error object', () => {
    const error = { code: '23505', constraint: 'uniq_constraint' };
    expect(getPgError(error)).toEqual({ code: '23505', constraint: 'uniq_constraint' });
  });

  it('getPgError unwraps cause 1 to 3 levels deep', () => {
    const level1 = { cause: { code: '23505', constraint: 'c_lvl1' } };
    expect(getPgError(level1)).toEqual({ code: '23505', constraint: 'c_lvl1' });

    const level2 = { cause: { cause: { code: '42P01', constraint: null } } };
    expect(getPgError(level2)).toEqual({ code: '42P01', constraint: null });

    const level3 = { cause: { cause: { cause: { code: '23503', constraint: 'c_lvl3' } } } };
    expect(getPgError(level3)).toEqual({ code: '23503', constraint: 'c_lvl3' });
  });

  it('getPgError stops at max depth 5 and returns nulls if not found', () => {
    const level6 = {
      cause: {
        cause: {
          cause: {
            cause: {
              cause: {
                cause: { code: '23505', constraint: 'deep' },
              },
            },
          },
        },
      },
    };
    expect(getPgError(level6)).toEqual({ code: null, constraint: null });
  });

  it('getPgError returns nulls for non-error or empty values', () => {
    expect(getPgError(null)).toEqual({ code: null, constraint: null });
    expect(getPgError(undefined)).toEqual({ code: null, constraint: null });
    expect(getPgError('string error')).toEqual({ code: null, constraint: null });
    expect(getPgError(12345)).toEqual({ code: null, constraint: null });
    expect(getPgError({})).toEqual({ code: null, constraint: null });
  });

  it('classifyClaimInsertError handles unique reference and pending claim constraints correctly', () => {
    const dupRefError = {
      code: '23505',
      constraint: 'subscription_requests_payment_reference_unique',
    };
    expect(classifyClaimInsertError(dupRefError)).toBe('DUPLICATE_REFERENCE');

    const pendingError = {
      code: '23505',
      constraint: 'subscription_requests_one_pending_per_business',
    };
    expect(classifyClaimInsertError(pendingError)).toBe('PENDING_CLAIM_EXISTS');

    const uppercasePending = {
      cause: { code: '23505', constraint: 'PENDING_BUSINESS_CLAIM_IDX' },
    };
    expect(classifyClaimInsertError(uppercasePending)).toBe('PENDING_CLAIM_EXISTS');

    const other23505 = { code: '23505', constraint: null };
    expect(classifyClaimInsertError(other23505)).toBe('DUPLICATE_REFERENCE');

    const not23505 = { code: '23503', constraint: 'foreign_key' };
    expect(classifyClaimInsertError(not23505)).toBe('UNKNOWN');

    expect(classifyClaimInsertError(new Error('general error'))).toBe('UNKNOWN');
  });
});

