import { describe, expect, it } from 'vitest';
import {
  diffBusinessIdentity,
  isGstinUniqueViolation,
  buildGstinTakenMessage,
  buildIdentityLockedMessage,
  GSTIN_UNIQUE_CONSTRAINT,
} from '@/lib/business/identity-policy';

describe('AUTH-004: Business Identity Policy Unit Tests', () => {
  describe('GSTIN unique constraint name', () => {
    it('matches the canonical PostgreSQL constraint name', () => {
      expect(GSTIN_UNIQUE_CONSTRAINT).toBe('businesses_gstin_unique');
    });
  });

  describe('diffBusinessIdentity', () => {
    it('returns unchanged for identical identities', () => {
      const current = { gstin: '29AABCT1332L1ZV', state_code: '29' };
      const next = { gstin: '29AABCT1332L1ZV', state_code: '29' };
      expect(diffBusinessIdentity(current, next)).toEqual({ kind: 'unchanged' });
    });

    it('returns unchanged for case and whitespace differences', () => {
      const current = { gstin: '29AABCT1332L1ZV', state_code: '29' };
      const next = { gstin: ' 29aabct1332l1zv  ', state_code: ' 29 ' };
      expect(diffBusinessIdentity(current, next)).toEqual({ kind: 'unchanged' });
    });

    it('returns changed with gstin when only GSTIN differs', () => {
      const current = { gstin: '29AABCT1332L1ZV', state_code: '29' };
      const next = { gstin: '29XYZAB1234C1Z1', state_code: '29' };
      expect(diffBusinessIdentity(current, next)).toEqual({
        kind: 'changed',
        fields: ['gstin'],
      });
    });

    it('returns changed with state_code when only state differs', () => {
      const current = { gstin: '29AABCT1332L1ZV', state_code: '29' };
      const next = { gstin: '29AABCT1332L1ZV', state_code: '27' };
      expect(diffBusinessIdentity(current, next)).toEqual({
        kind: 'changed',
        fields: ['state_code'],
      });
    });

    it('returns changed with both fields when both differ', () => {
      const current = { gstin: '29AABCT1332L1ZV', state_code: '29' };
      const next = { gstin: '27XYZAB1234C1Z1', state_code: '27' };
      expect(diffBusinessIdentity(current, next)).toEqual({
        kind: 'changed',
        fields: ['gstin', 'state_code'],
      });
    });
  });

  describe('isGstinUniqueViolation', () => {
    it('identifies direct Postgres error object', () => {
      const err = { code: '23505', constraint: 'businesses_gstin_unique' };
      expect(isGstinUniqueViolation(err)).toBe(true);
    });

    it('identifies Drizzle error wrapped with cause', () => {
      const err = {
        name: 'DrizzleError',
        cause: { code: '23505', constraint: 'businesses_gstin_unique' },
      };
      expect(isGstinUniqueViolation(err)).toBe(true);
    });

    it('identifies deeply nested error causes', () => {
      const err = {
        cause: {
          cause: {
            cause: { code: '23505', constraint: 'businesses_gstin_unique' },
          },
        },
      };
      expect(isGstinUniqueViolation(err)).toBe(true);
    });

    it('rejects errors with wrong constraint name', () => {
      const err = { code: '23505', constraint: 'customers_business_id_gstin_unique' };
      expect(isGstinUniqueViolation(err)).toBe(false);
    });

    it('rejects errors with wrong SQLSTATE code', () => {
      const err = { code: '23503', constraint: 'businesses_gstin_unique' };
      expect(isGstinUniqueViolation(err)).toBe(false);
    });

    it('rejects non-object errors gracefully', () => {
      expect(isGstinUniqueViolation(null)).toBe(false);
      expect(isGstinUniqueViolation(undefined)).toBe(false);
      expect(isGstinUniqueViolation('string error')).toBe(false);
      expect(isGstinUniqueViolation(12345)).toBe(false);
      expect(isGstinUniqueViolation({})).toBe(false);
    });
  });

  describe('message builders', () => {
    it('builds canonical duplicate GSTIN message', () => {
      expect(buildGstinTakenMessage()).toBe(
        'This GSTIN is already registered on Invoice BizFolio. If you own it, contact support with proof of ownership.',
      );
    });

    it('builds canonical identity locked message with support email', () => {
      expect(buildIdentityLockedMessage('support@billmatrix.in')).toBe(
        'GSTIN and registered state cannot be changed after invoices have been finalized. Please contact support@billmatrix.in to request a change.',
      );
    });
  });
});

