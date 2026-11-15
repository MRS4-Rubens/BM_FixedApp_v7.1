import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  validatePayeeObject,
  getAuthoritativePayeeConfig,
  DISPLAY_TEXT_PATTERN,
} from '@/lib/config/payee';
import { updatePlatformPayeeSchema } from '@/lib/validations/admin-payee';

const dbState = {
  row: undefined as { value: unknown } | undefined,
  error: null as unknown,
};

vi.mock('@/lib/db/client', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => {
            if (dbState.error) throw dbState.error;
            return dbState.row ? [dbState.row] : [];
          },
        }),
      }),
    }),
  },
}));

const loggerMock = {
  logWarn: vi.fn(),
  logError: vi.fn(),
};

vi.mock('@/lib/actions/_shared/logger', () => ({
  logWarn: (...args: unknown[]) => loggerMock.logWarn(...args),
  logError: (...args: unknown[]) => loggerMock.logError(...args),
}));

describe('Platform Payee Configuration & Validation', () => {
  const validPayee = {
    upiId: 'merchant@okhdfc',
    upiName: 'Bill Matrix Solutions',
    bankName: 'HDFC Bank',
    accName: 'Bill Matrix Current A/C',
    accNo: '50200012345678',
    ifsc: 'HDFC0001234',
  };

  const stubValidEnv = () => {
    vi.stubEnv('ADMIN_UPI_ID', validPayee.upiId);
    vi.stubEnv('ADMIN_UPI_NAME', validPayee.upiName);
    vi.stubEnv('ADMIN_BANK_NAME', validPayee.bankName);
    vi.stubEnv('ADMIN_BANK_ACC_NAME', validPayee.accName);
    vi.stubEnv('ADMIN_BANK_ACC_NO', validPayee.accNo);
    vi.stubEnv('ADMIN_BANK_IFSC', validPayee.ifsc);
  };

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    dbState.row = undefined;
    dbState.error = null;
  });

  it('validates a correct payee candidate object', () => {
    const result = validatePayeeObject(validPayee);
    expect(result.status).toBe('configured');
    if (result.status === 'configured') {
      expect(result.config.upiId).toBe('merchant@okhdfc');
      expect(result.config.ifsc).toBe('HDFC0001234');
      expect(result.config.accNo).toBe('50200012345678');
    }
  });

  it('flags placeholder upiId or placeholder accNo as unavailable', () => {
    const invalidUpi = {
      ...validPayee,
      upiId: 'admin@okaxis', // Known placeholder
    };
    const resultUpi = validatePayeeObject(invalidUpi);
    expect(resultUpi.status).toBe('unavailable');
    if (resultUpi.status === 'unavailable') {
      expect(
        resultUpi.problems.some((p) => p.name === 'ADMIN_UPI_ID' && p.reason === 'placeholder')
      ).toBe(true);
    }

    const invalidAcc = {
      ...validPayee,
      accNo: '12345678901', // Known placeholder
    };
    const resultAcc = validatePayeeObject(invalidAcc);
    expect(resultAcc.status).toBe('unavailable');
    if (resultAcc.status === 'unavailable') {
      expect(
        resultAcc.problems.some((p) => p.name === 'ADMIN_BANK_ACC_NO' && p.reason === 'placeholder')
      ).toBe(true);
    }
  });

  it('DISPLAY_TEXT_PATTERN rejects invisible/bidi characters and accepts clean names', () => {
    expect(DISPLAY_TEXT_PATTERN.test('HDFC Bank Ltd.')).toBe(true);
    // U+202E (RIGHT-TO-LEFT OVERRIDE)
    expect(DISPLAY_TEXT_PATTERN.test('HDFC\u202E Bank')).toBe(false);
    // U+200B (ZERO WIDTH SPACE)
    expect(DISPLAY_TEXT_PATTERN.test('Bill\u200BMatrix')).toBe(false);
  });

  it('rejects malformed IFSC codes in the update schema', () => {
    const parsed = updatePlatformPayeeSchema.safeParse({
      ...validPayee,
      ifsc: 'INVALID_IFSC',
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts valid payee update payload and normalises IFSC to uppercase', () => {
    const parsed = updatePlatformPayeeSchema.safeParse({
      ...validPayee,
      ifsc: 'hdfc0001234',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.ifsc).toBe('HDFC0001234');
    }
  });

  describe('getAuthoritativePayeeConfig outcomes', () => {
    it('Outcome 1: DB returns NO row -> env result, source env', async () => {
      stubValidEnv();
      dbState.row = undefined;
      dbState.error = null;

      const res = await getAuthoritativePayeeConfig();
      expect(res.source).toBe('env');
      expect(res.status).toBe('configured');
    });

    it('Outcome 2: Row exists and validates -> database result, source database', async () => {
      dbState.row = { value: validPayee };
      dbState.error = null;

      const res = await getAuthoritativePayeeConfig();
      expect(res.source).toBe('database');
      expect(res.status).toBe('configured');
      if (res.status === 'configured') {
        expect(res.config.upiId).toBe(validPayee.upiId);
      }
    });

    it('Outcome 3: Row exists but does NOT validate -> unavailable, source database, warns, no env fallback', async () => {
      stubValidEnv();
      dbState.row = { value: { ...validPayee, upiId: 'admin@okaxis' } };
      dbState.error = null;

      const res = await getAuthoritativePayeeConfig();
      expect(res.source).toBe('database');
      expect(res.status).toBe('unavailable');
      expect(loggerMock.logWarn).toHaveBeenCalledWith(
        'payee:db-config',
        expect.stringContaining('ADMIN_UPI_ID (placeholder)')
      );
    });

    it('Outcome 4: Query throws isUndefinedTableError -> warns and returns env result, source env', async () => {
      stubValidEnv();
      dbState.error = { code: '42P01', message: 'relation "platform_settings" does not exist' };

      const res = await getAuthoritativePayeeConfig();
      expect(res.source).toBe('env');
      expect(res.status).toBe('configured');
      expect(loggerMock.logWarn).toHaveBeenCalledWith(
        'payee:db-config',
        'platform_settings table missing; using env'
      );
    });

    it('Outcome 5: Query throws anything else -> logs error and returns unavailable with PLATFORM_SETTINGS unreadable', async () => {
      const dbErr = new Error('Connection timeout');
      dbState.error = dbErr;

      const res = await getAuthoritativePayeeConfig();
      expect(res.source).toBe('database');
      expect(res.status).toBe('unavailable');
      expect(loggerMock.logError).toHaveBeenCalledWith('payee:db-config', dbErr);
      if (res.status === 'unavailable') {
        expect(res.problems).toEqual([{ name: 'PLATFORM_SETTINGS', reason: 'unreadable' }]);
      }
    });
  });
});
