import { describe, expect, it } from 'vitest';
import { ActionError } from '@/lib/actions/_shared/errors';
import {
  mapKnownDatabaseError,
  toThrowable,
  toLoggableError,
} from '@/lib/actions/_shared/action-error-mapping';
import {
  BUSINESS_PROFILE_MAPPINGS,
  CUSTOMER_MAPPINGS,
} from '@/lib/actions/_shared/pg-constraint-mappings';
import { DB_CONSTRAINTS } from '@/lib/db/constraint-names';
import {
  PG_DEADLOCK_DETECTED,
  PG_LOCK_NOT_AVAILABLE,
  PG_SERIALIZATION_FAILURE,
} from '@/lib/db/transaction';

describe('action-error-mapping', () => {
  describe('mapKnownDatabaseError', () => {
    it('returns the same ActionError instance when already an ActionError', () => {
      const err = new ActionError('Already safe', { code: 'CUSTOM_CODE' });
      expect(mapKnownDatabaseError(err, BUSINESS_PROFILE_MAPPINGS)).toBe(err);
    });

    it('maps lock-not-available to a BUSY ActionError', () => {
      const lockError = new Error('lock timeout', { cause: { code: PG_LOCK_NOT_AVAILABLE } });
      const mapped = mapKnownDatabaseError(lockError, BUSINESS_PROFILE_MAPPINGS);
      expect(mapped).toBeInstanceOf(ActionError);
      expect(mapped?.code).toBe('BUSY');
      expect(mapped?.message).toContain('busy');
    });

    it('maps deadlock-detected to a BUSY ActionError', () => {
      const deadlockError = new Error('deadlock', { cause: { code: PG_DEADLOCK_DETECTED } });
      const mapped = mapKnownDatabaseError(deadlockError, BUSINESS_PROFILE_MAPPINGS);
      expect(mapped).toBeInstanceOf(ActionError);
      expect(mapped?.code).toBe('BUSY');
    });

    it('maps serialization-failure to a BUSY ActionError', () => {
      const serError = new Error('serialization failure', { cause: { code: PG_SERIALIZATION_FAILURE } });
      const mapped = mapKnownDatabaseError(serError, BUSINESS_PROFILE_MAPPINGS);
      expect(mapped).toBeInstanceOf(ActionError);
      expect(mapped?.code).toBe('BUSY');
    });

    it('maps a Drizzle-style wrapped duplicate GSTIN error to DUPLICATE_GSTIN with fieldErrors', () => {
      const dbError = new Error('Failed query', {
        cause: {
          code: '23505',
          constraint: DB_CONSTRAINTS.BUSINESSES_GSTIN_UNIQUE,
        },
      });
      const mapped = mapKnownDatabaseError(dbError, BUSINESS_PROFILE_MAPPINGS);
      expect(mapped).toBeInstanceOf(ActionError);
      expect(mapped?.code).toBe('DUPLICATE_GSTIN');
      expect(mapped?.fieldErrors).toEqual({
        gstin: [
          'This GSTIN is already registered with another Invoice BizFolio account. Check the number or contact support.',
        ],
      });
      expect(mapped?.message).not.toContain(DB_CONSTRAINTS.BUSINESSES_GSTIN_UNIQUE);
      expect(mapped?.message).not.toContain('businesses');
    });

    it('maps customer duplicate GSTIN constraint to DUPLICATE_CUSTOMER_GSTIN with fieldErrors', () => {
      const dbError = new Error('Failed query', {
        cause: {
          code: '23505',
          constraint: DB_CONSTRAINTS.CUSTOMERS_BUSINESS_GSTIN_UNIQUE,
        },
      });
      const mapped = mapKnownDatabaseError(dbError, CUSTOMER_MAPPINGS);
      expect(mapped).toBeInstanceOf(ActionError);
      expect(mapped?.code).toBe('DUPLICATE_CUSTOMER_GSTIN');
      expect(mapped?.fieldErrors).toEqual({
        gstin: ['A customer with this GSTIN already exists in your account.'],
      });
    });

    it('returns null for a 23505 with an unmapped constraint', () => {
      const unmappedError = new Error('duplicate key', {
        cause: { code: '23505', constraint: 'unknown_constraint_idx' },
      });
      expect(mapKnownDatabaseError(unmappedError, BUSINESS_PROFILE_MAPPINGS)).toBeNull();
    });

    it('returns null for a 23514 (check constraint violation)', () => {
      const checkError = new Error('check violation', {
        cause: { code: '23514', constraint: 'invoices_money_nonneg' },
      });
      expect(mapKnownDatabaseError(checkError, BUSINESS_PROFILE_MAPPINGS)).toBeNull();
    });

    it('returns null for a 23503 (foreign key violation)', () => {
      const fkError = new Error('fk violation', {
        cause: { code: '23503', constraint: 'invoices_customer_id_fk' },
      });
      expect(mapKnownDatabaseError(fkError, BUSINESS_PROFILE_MAPPINGS)).toBeNull();
    });
  });

  describe('toThrowable', () => {
    it('returns the mapped ActionError when an error matches', () => {
      const dbError = new Error('unique violation', {
        cause: { code: '23505', constraint: DB_CONSTRAINTS.BUSINESSES_GSTIN_UNIQUE },
      });
      const throwable = toThrowable(dbError, BUSINESS_PROFILE_MAPPINGS);
      expect(throwable).toBeInstanceOf(ActionError);
      expect((throwable as ActionError).code).toBe('DUPLICATE_GSTIN');
    });

    it('returns the identical Error instance for unmapped errors', () => {
      const original = new Error('random unhandled error');
      const throwable = toThrowable(original, BUSINESS_PROFILE_MAPPINGS);
      expect(throwable).toBe(original);
    });

    it('wraps non-Error values with cause', () => {
      const nonError = 'something bad happened';
      const throwable = toThrowable(nonError, BUSINESS_PROFILE_MAPPINGS);
      expect(throwable).toBeInstanceOf(Error);
      expect(throwable.message).toBe('Non-Error value thrown');
      expect((throwable as Error & { cause?: unknown }).cause).toBe(nonError);
    });

    it('guarantees mapped messages never contain raw constraint or table names', () => {
      const mappings = [...BUSINESS_PROFILE_MAPPINGS, ...CUSTOMER_MAPPINGS];
      for (const m of mappings) {
        expect(m.message).not.toContain(m.constraint);
        expect(m.message).not.toContain('businesses');
        expect(m.message).not.toContain('customers');
        expect(m.message).not.toContain('violates');
      }
    });
  });

  describe('toLoggableError', () => {
    it('returns standard Error instances intact', () => {
      const err = new Error('Standard error message');
      expect(toLoggableError(err)).toBe(err);
    });

    it('normalises object with {name, message} into an Error', () => {
      const payload = { name: 'ResendError', message: 'Rate limit exceeded' };
      const err = toLoggableError(payload);
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe('ResendError');
      expect(err.message).toBe('Rate limit exceeded');
    });

    it('normalises object with only {message} into an Error', () => {
      const payload = { message: 'Some provider error' };
      const err = toLoggableError(payload);
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe('Some provider error');
    });

    it('wraps primitive or junk input into an Error with cause', () => {
      const junk = 42;
      const err = toLoggableError(junk);
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe('Unknown third-party error');
      expect((err as Error & { cause?: unknown }).cause).toBe(junk);
    });
  });
});

