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

export type PayeeProblemReason = 'missing' | 'invalid_format' | 'placeholder';

export interface PayeeProblem {
  readonly name: PayeeEnvName;
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

const UPI_ID_PATTERN = /^[A-Za-z0-9._-]{2,256}@[A-Za-z][A-Za-z0-9]{1,63}$/;
const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT_NUMBER_PATTERN = /^\d{9,18}$/;
const DISPLAY_TEXT_PATTERN = /^[^\r\n\t]{2,100}$/;

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
