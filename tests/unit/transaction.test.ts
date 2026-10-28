import { describe, expect, it } from 'vitest';
import { ActionError } from '@/lib/actions/_shared/errors';
import {
  getPgErrorCode,
  isRetryableTransactionError,
  toBusyActionError,
  withTransactionRetry,
  PG_DEADLOCK_DETECTED,
  PG_SERIALIZATION_FAILURE,
  PG_LOCK_NOT_AVAILABLE,
} from '@/lib/db/transaction';

describe('lib/db/transaction', () => {
  describe('getPgErrorCode', () => {
    it('finds 40P01 on a plain object', () => {
      const err = { code: '40P01' };
      expect(getPgErrorCode(err)).toBe('40P01');
    });

    it('finds 40P01 on an Error with cause one level deep', () => {
      const err = Object.assign(new Error('Failed query'), { cause: { code: '40P01' } });
      expect(getPgErrorCode(err)).toBe('40P01');
    });

    it('finds code two levels deep in the cause chain', () => {
      const err = { cause: { cause: { code: '40001' } } };
      expect(getPgErrorCode(err)).toBe('40001');
    });

    it('returns undefined for null, strings, or numbers', () => {
      expect(getPgErrorCode(null)).toBeUndefined();
      expect(getPgErrorCode('40P01')).toBeUndefined();
      expect(getPgErrorCode(12345)).toBeUndefined();
      expect(getPgErrorCode(undefined)).toBeUndefined();
    });

    it('returns undefined for objects without code or with non-SQLSTATE codes', () => {
      expect(getPgErrorCode({})).toBeUndefined();
      expect(getPgErrorCode({ code: 'ALREADY_FINALIZED' })).toBeUndefined();
      expect(getPgErrorCode({ code: 'not5' })).toBeUndefined();
      expect(getPgErrorCode(new ActionError('Invalid', { code: 'NOT_FOUND' }))).toBeUndefined();
    });
  });

  describe('isRetryableTransactionError', () => {
    it('is true only for 40P01 and 40001', () => {
      expect(isRetryableTransactionError({ code: PG_DEADLOCK_DETECTED })).toBe(true);
      expect(isRetryableTransactionError({ code: PG_SERIALIZATION_FAILURE })).toBe(true);
      expect(isRetryableTransactionError({ code: PG_LOCK_NOT_AVAILABLE })).toBe(false);
      expect(isRetryableTransactionError({ code: '23505' })).toBe(false);
      expect(isRetryableTransactionError(new Error('Random network failure'))).toBe(false);
    });

    it('is false for ActionError even if it carries a code', () => {
      const actionErr = new ActionError('Busy', { code: PG_DEADLOCK_DETECTED });
      expect(isRetryableTransactionError(actionErr)).toBe(false);
    });
  });

  describe('toBusyActionError', () => {
    it('maps 55P03, 40P01 and 40001 to an ActionError with code BUSY', () => {
      const codes = [PG_LOCK_NOT_AVAILABLE, PG_DEADLOCK_DETECTED, PG_SERIALIZATION_FAILURE];
      for (const code of codes) {
        const busy = toBusyActionError({ code });
        expect(busy).toBeInstanceOf(ActionError);
        expect(busy?.code).toBe('BUSY');
        expect(busy?.message).toBe(
          'The system is busy processing another change to this record. Please wait a moment and try again.',
        );
      }
    });

    it('returns null for ActionError and other errors', () => {
      const actionErr = new ActionError('Not found', { code: 'NOT_FOUND' });
      expect(toBusyActionError(actionErr)).toBeNull();
      expect(toBusyActionError(new Error('Syntax error'))).toBeNull();
      expect(toBusyActionError({ code: '23505' })).toBeNull();
    });
  });

  describe('withTransactionRetry', () => {
    it('returns on first success without calling sleep', async () => {
      const delays: number[] = [];
      const sleep = async (ms: number): Promise<void> => {
        delays.push(ms);
      };
      let callCount = 0;
      const result = await withTransactionRetry(
        async () => {
          callCount += 1;
          return 'ok';
        },
        { sleep },
      );

      expect(result).toBe('ok');
      expect(callCount).toBe(1);
      expect(delays).toHaveLength(0);
    });

    it('retries a 40P01 failure then succeeds on attempt 2', async () => {
      const delays: number[] = [];
      const sleep = async (ms: number): Promise<void> => {
        delays.push(ms);
      };
      let callCount = 0;
      const result = await withTransactionRetry(
        async () => {
          callCount += 1;
          if (callCount === 1) {
            throw { code: PG_DEADLOCK_DETECTED };
          }
          return 'success-after-retry';
        },
        { sleep, baseDelayMs: 40, random: () => 0.5 },
      );

      expect(result).toBe('success-after-retry');
      expect(callCount).toBe(2);
      expect(delays).toHaveLength(1);
      // baseDelayMs * 2^(attempt-1) * (0.5 + random) = 40 * 1 * (0.5 + 0.5) = 40
      expect(delays[0]).toBe(40);
    });

    it('stops after maxAttempts and rethrows the last retryable error', async () => {
      const delays: number[] = [];
      const sleep = async (ms: number): Promise<void> => {
        delays.push(ms);
      };
      let callCount = 0;
      const deadlockError = { code: PG_DEADLOCK_DETECTED };

      await expect(
        withTransactionRetry(
          async () => {
            callCount += 1;
            throw deadlockError;
          },
          { maxAttempts: 3, sleep },
        ),
      ).rejects.toBe(deadlockError);

      expect(callCount).toBe(3);
      expect(delays).toHaveLength(2);
    });

    it('never retries ActionError or non-retryable plain errors', async () => {
      let callCount = 0;
      const actionErr = new ActionError('Validation failed', { code: 'INVALID' });

      await expect(
        withTransactionRetry(async () => {
          callCount += 1;
          throw actionErr;
        }),
      ).rejects.toThrow(actionErr);

      expect(callCount).toBe(1);

      let plainCallCount = 0;
      const plainErr = new Error('Syntax error');
      await expect(
        withTransactionRetry(async () => {
          plainCallCount += 1;
          throw plainErr;
        }),
      ).rejects.toThrow(plainErr);

      expect(plainCallCount).toBe(1);
    });

    it('sleeps with increasing delays (exponential backoff)', async () => {
      const delays: number[] = [];
      const sleep = async (ms: number): Promise<void> => {
        delays.push(ms);
      };
      let callCount = 0;

      await expect(
        withTransactionRetry(
          async () => {
            callCount += 1;
            throw { code: PG_SERIALIZATION_FAILURE };
          },
          { maxAttempts: 4, baseDelayMs: 50, random: () => 0.5, sleep },
        ),
      ).rejects.toBeDefined();

      expect(callCount).toBe(4);
      // attempt 1: 50 * 2^0 * (0.5 + 0.5) = 50
      // attempt 2: 50 * 2^1 * (0.5 + 0.5) = 100
      // attempt 3: 50 * 2^2 * (0.5 + 0.5) = 200
      expect(delays).toEqual([50, 100, 200]);
    });
  });
});

