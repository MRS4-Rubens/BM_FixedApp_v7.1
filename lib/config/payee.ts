/**
 * Payee (platform collection account) configuration for manual subscription payments.
 *
 * FAILS CLOSED: if any value is missing, malformed, or a known placeholder, the result is
 * `unavailable` and callers must not present payment instructions to customers.
 * Raw values are never included in problems, so results are safe to log.
 *
 * `env` is injectable so the validated env module (ARCH-002) can supply it later.
 */

const PAYEE_ENV_KEYS = {
  upiId: 'ADMIN_UPI_ID',
  upiName: 'ADMIN_UPI_NAME',
  bankName: 'ADMIN_BANK_NAME',
  accName: 'ADMIN_BANK_ACC_NAME',
  accNo: 'ADMIN_BANK_ACC_NO',
  ifsc: 'ADMIN_BANK_IFSC',
} as const;

export type PayeeField = keyof typeof PAYEE_ENV_KEYS;
export type PayeeEnvName = (typeof PAYEE_ENV_KEYS)[PayeeField];
export type PayeeConfig = Readonly<Record<PayeeField, string>>;

export type PayeeProblemReason = 'missing' | 'invalid_format' | 'placeholder' | 'unreadable';

export interface PayeeProblem {
  readonly name: PayeeEnvName | 'PLATFORM_SETTINGS';
  readonly reason: PayeeProblemReason;
}

export type PayeeConfigResult =
  | { readonly status: 'configured'; readonly config: PayeeConfig }
  | { readonly status: 'unavailable'; readonly problems: readonly PayeeProblem[] };

type EnvSource = Readonly<Record<string, string | undefined>>;

type FieldReadResult =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly problem: PayeeProblem };

interface FieldRule {
  readonly normalize: (value: string) => string;
  readonly isValid: (value: string) => boolean;
  /** Known dev/template values; compared case-insensitively against the normalised value. */
  readonly placeholders: readonly string[];
}

export const UPI_ID_PATTERN = /^[A-Za-z0-9._-]{2,256}@[A-Za-z][A-Za-z0-9]{1,63}$/;
export const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const ACCOUNT_NUMBER_PATTERN = /^\d{9,18}$/;
export const DISPLAY_TEXT_PATTERN = /^[^\p{Cc}\p{Cf}]{2,100}$/u;

const keepAsIs = (value: string): string => value;
const isDisplayText = (value: string): boolean => DISPLAY_TEXT_PATTERN.test(value);

// Only money-routing identifiers are deny-listed. Display names/bank names can legitimately
// be any text, so they are format-checked only.
const FIELD_RULES: Readonly<Record<PayeeField, FieldRule>> = {
  upiId: {
    normalize: keepAsIs,
    isValid: (value) => UPI_ID_PATTERN.test(value),
    placeholders: ['admin@okaxis', 'merchant@upi'],
  },
  upiName: { normalize: keepAsIs, isValid: isDisplayText, placeholders: [] },
  bankName: { normalize: keepAsIs, isValid: isDisplayText, placeholders: [] },
  accName: { normalize: keepAsIs, isValid: isDisplayText, placeholders: [] },
  accNo: {
    normalize: (value) => value.replace(/\s+/g, ''),
    isValid: (value) => ACCOUNT_NUMBER_PATTERN.test(value),
    placeholders: ['12345678901', '00000000000'],
  },
  ifsc: {
    normalize: (value) => value.toUpperCase(),
    isValid: (value) => IFSC_PATTERN.test(value),
    placeholders: ['SBIN0001234', 'SBIN0000000'],
  },
};

function readField(env: EnvSource, field: PayeeField): FieldReadResult {
  const name = PAYEE_ENV_KEYS[field];
  const rule = FIELD_RULES[field];
  const raw = env[name]?.trim() ?? '';

  if (raw === '') {
    return { ok: false, problem: { name, reason: 'missing' } };
  }
  const value = rule.normalize(raw);
  if (!rule.isValid(value)) {
    return { ok: false, problem: { name, reason: 'invalid_format' } };
  }
  const lowered = value.toLowerCase();
  if (rule.placeholders.some((placeholder) => placeholder.toLowerCase() === lowered)) {
    return { ok: false, problem: { name, reason: 'placeholder' } };
  }
  return { ok: true, value };
}

export function loadPayeeConfig(env: EnvSource = process.env): PayeeConfigResult {
  const upiId = readField(env, 'upiId');
  const upiName = readField(env, 'upiName');
  const bankName = readField(env, 'bankName');
  const accName = readField(env, 'accName');
  const accNo = readField(env, 'accNo');
  const ifsc = readField(env, 'ifsc');

  if (
    !upiId.ok ||
    !upiName.ok ||
    !bankName.ok ||
    !accName.ok ||
    !accNo.ok ||
    !ifsc.ok
  ) {
    const problems: PayeeProblem[] = [];
    for (const result of [upiId, upiName, bankName, accName, accNo, ifsc]) {
      if (!result.ok) {
        problems.push(result.problem);
      }
    }
    return { status: 'unavailable', problems };
  }

  return {
    status: 'configured',
    config: {
      upiId: upiId.value,
      upiName: upiName.value,
      bankName: bankName.value,
      accName: accName.value,
      accNo: accNo.value,
      ifsc: ifsc.value,
    },
  };
}

/** Variable names and reasons only (never values). Safe for logs and the admin UI. */
export function describePayeeProblems(problems: readonly PayeeProblem[]): string {
  return problems.map((problem) => `${problem.name} (${problem.reason})`).join(', ');
}

export function validatePayeeObject(raw: Record<string, unknown>): PayeeConfigResult {
  const fakeEnv: Record<string, string> = {
    ADMIN_UPI_ID: typeof raw.upiId === 'string' ? raw.upiId : '',
    ADMIN_UPI_NAME: typeof raw.upiName === 'string' ? raw.upiName : '',
    ADMIN_BANK_NAME: typeof raw.bankName === 'string' ? raw.bankName : '',
    ADMIN_BANK_ACC_NAME: typeof raw.accName === 'string' ? raw.accName : '',
    ADMIN_BANK_ACC_NO: typeof raw.accNo === 'string' ? raw.accNo : '',
    ADMIN_BANK_IFSC: typeof raw.ifsc === 'string' ? raw.ifsc : '',
  };
  return loadPayeeConfig(fakeEnv);
}

function isUndefinedTableError(err: unknown): boolean {
  if (typeof err === 'object' && err !== null) {
    if ('code' in err && err.code === '42P01') {
      return true;
    }
    if (
      'cause' in err &&
      typeof err.cause === 'object' &&
      err.cause !== null &&
      'code' in err.cause &&
      err.cause.code === '42P01'
    ) {
      return true;
    }
  }
  return false;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export async function getAuthoritativePayeeConfig(): Promise<PayeeConfigResult & { source: 'database' | 'env' }> {
  try {
    const { db } = await import('@/lib/db/client');
    const { platformSettings } = await import('@/lib/db/schema');
    const { eq } = await import('drizzle-orm');

    const [row] = await db
      .select({ value: platformSettings.value })
      .from(platformSettings)
      .where(eq(platformSettings.key, 'payee_config'))
      .limit(1);

    if (!row) {
      // 1. DB returns NO row -> env result, source 'env'
      const envResult = loadPayeeConfig();
      return { ...envResult, source: 'env' };
    }

    if (isRecord(row.value)) {
      const parsed = validatePayeeObject(row.value);
      if (parsed.status === 'configured') {
        // 2. Row exists and validates -> database result, source 'database'
        return { ...parsed, source: 'database' };
      }
      // 3. Row exists but does NOT validate -> { status: 'unavailable', problems: <validator problems>, source: 'database' } and logWarn('payee:db-config', <describePayeeProblems>) — do NOT fall back to env
      const { logWarn } = await import('@/lib/actions/_shared/logger');
      logWarn('payee:db-config', describePayeeProblems(parsed.problems));
      return { status: 'unavailable', problems: parsed.problems, source: 'database' };
    }

    // Row exists but is not a record -> does NOT validate
    const fallbackProblems: readonly PayeeProblem[] = [
      { name: 'PLATFORM_SETTINGS', reason: 'invalid_format' },
    ];
    const { logWarn } = await import('@/lib/actions/_shared/logger');
    logWarn('payee:db-config', describePayeeProblems(fallbackProblems));
    return { status: 'unavailable', problems: fallbackProblems, source: 'database' };
  } catch (err: unknown) {
    if (isUndefinedTableError(err)) {
      // 4. Query throws isUndefinedTableError -> logWarn('payee:db-config', 'platform_settings table missing; using env') and return env result, source 'env'
      try {
        const { logWarn } = await import('@/lib/actions/_shared/logger');
        logWarn('payee:db-config', 'platform_settings table missing; using env');
      } catch {
        // dynamic import fallback
      }
      const envResult = loadPayeeConfig();
      return { ...envResult, source: 'env' };
    }

    // 5. Query throws anything else -> logError('payee:db-config', err) and return { status: 'unavailable', problems: [{ name: 'PLATFORM_SETTINGS', reason: 'unreadable' }], source: 'database' }
    try {
      const { logError } = await import('@/lib/actions/_shared/logger');
      logError('payee:db-config', err);
    } catch {
      // dynamic import fallback
    }
    return {
      status: 'unavailable',
      problems: [{ name: 'PLATFORM_SETTINGS', reason: 'unreadable' }],
      source: 'database',
    };
  }
}
