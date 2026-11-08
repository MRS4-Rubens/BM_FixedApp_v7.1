export const REDACTED = '[redacted]';

const SENSITIVE_SUBSTRING_PATTERN =
  /gstin|e-?mail|phone|mobile|account|ifsc|token|password|passwd|secret|authorization|cookie|api[-_]?key|ip_address|forwarded|real-ip|billing_name|customer_name|legal_name|trade_name|address_line|payment_reference|reference_number|display_name|full_name|first_name|last_name|contact_name|owner_name|aadhaar/i;

const SENSITIVE_TOKEN_PATTERN =
  /(?:^|[_.-])(?:utr|pan|upi|vpa|pincode|params|detail|otp)(?:$|[_.-])/i;

// a) Drizzle params tail in SQL error messages (keeps preceding SQL text). "params:" is always the last part of a
//    DrizzleQueryError message, and a value may itself contain newlines (addresses, notes), so redact up to the first
//    stack-frame line ("\n    at ...") or the end of the string, not just to the end of the line.
const DRIZZLE_PARAMS_PATTERN = /(\bparams:\s*)[\s\S]*?(?=\n\s+at\s|$)/gi;

// b) Postgres unique/check constraint violation key details. Greedy to the LAST ")" on the line so a value that
//    itself contains ")" (e.g. "ABC (India) Pvt Ltd") is fully redacted.
const POSTGRES_KEY_DETAIL_PATTERN = /(Key \([^)]*\)=\()[^\n]*(\))/g;

// c1) Bearer authentication tokens in authorization headers and error logs
const BEARER_PATTERN = /\bBearer\s+[^\s"']+/g;

// c2) Sensitive query parameters in signed or secret-bearing URLs
const URL_QUERY_SECRET_PATTERN =
  /([?&](?:token|sig|signature|key|secret|code|x-amz-signature|x-amz-credential)=)[^&#\s"']+/gi;

// d) Email addresses
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

// e) UPI Virtual Payment Address (e.g. user@okaxis, handle@upi)
const UPI_VPA_PATTERN =
  /(?<![\w.@-])[A-Za-z0-9._-]{2,256}@[A-Za-z][A-Za-z0-9]{1,63}(?![\w.@-])/g;

// f1) Indian Goods and Services Tax Identification Number (15 chars)
const GSTIN_PATTERN = /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g;

// f2) Indian Financial System Code (11 chars)
const IFSC_PATTERN = /\b[A-Z]{4}0[A-Z0-9]{6}\b/g;

// f3) Indian Permanent Account Number (10 chars)
const PAN_PATTERN = /\b[A-Z]{5}\d{4}[A-Z]\b/g;

// g) Indian mobile numbers (+91 / 91 optional prefix, starting with 6-9)
const INDIAN_MOBILE_PATTERN =
  /(?<![\w-])(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}(?![\w-])/g;

// h) Aadhaar-style 12-digit numbers formatted in 4-digit groups
const AADHAAR_PATTERN = /(?<![\w-])\d{4}\s\d{4}\s\d{4}(?![\w-])/g;

/**
 * i) Long digit runs (bank accounts etc.):
 * Numbers of 9-18 digits inside free text are redacted on purpose (bank accounts);
 * numeric (non-string) values are never touched;
 * UUID segments and dotted versions are excluded by the look-arounds.
 */
const LONG_DIGIT_RUN_PATTERN = /(?<![\w.-])\d{9,18}(?![\w.-])/g;

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_SUBSTRING_PATTERN.test(key) || SENSITIVE_TOKEN_PATTERN.test(key);
}

export function scrubString(value: string): string {
  let result = value;
  result = result.replace(DRIZZLE_PARAMS_PATTERN, '$1[redacted]');
  result = result.replace(POSTGRES_KEY_DETAIL_PATTERN, '$1[redacted]$2');
  result = result.replace(BEARER_PATTERN, `Bearer ${REDACTED}`);
  result = result.replace(URL_QUERY_SECRET_PATTERN, `$1${REDACTED}`);
  result = result.replace(EMAIL_PATTERN, REDACTED);
  result = result.replace(UPI_VPA_PATTERN, REDACTED);
  result = result.replace(GSTIN_PATTERN, REDACTED);
  result = result.replace(IFSC_PATTERN, REDACTED);
  result = result.replace(PAN_PATTERN, REDACTED);
  result = result.replace(INDIAN_MOBILE_PATTERN, REDACTED);
  result = result.replace(AADHAAR_PATTERN, REDACTED);
  result = result.replace(LONG_DIGIT_RUN_PATTERN, REDACTED);
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

export function scrubValue(
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
  depth = 0,
): unknown {
  if (depth >= 12) {
    return '[truncated]';
  }

  if (typeof value === 'string') {
    return scrubString(value);
  }

  if (typeof value !== 'object' || value === null) {
    return value;
  }

  if (value instanceof Date) {
    return value;
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: scrubString(value.message),
    };
  }

  if (isUnknownArray(value)) {
    if (seen.has(value)) {
      return '[circular]';
    }
    seen.add(value);
    try {
      return value.map((item) => scrubValue(item, seen, depth + 1));
    } finally {
      seen.delete(value);
    }
  }

  if (isRecord(value)) {
    if (seen.has(value)) {
      return '[circular]';
    }
    seen.add(value);
    try {
      const result: Record<string, unknown> = {};
      for (const key of Object.keys(value)) {
        const propValue = value[key];
        if (isSensitiveKey(key)) {
          result[key] = propValue !== null && propValue !== undefined ? REDACTED : propValue;
        } else {
          result[key] = scrubValue(propValue, seen, depth + 1);
        }
      }
      return result;
    } finally {
      seen.delete(value);
    }
  }

  return value;
}

export function scrubSentryEvent<E extends object>(event: E): E | null {
  try {
    if (typeof event !== 'object' || event === null) {
      return null;
    }
    const scrubbed = scrubValue(event);
    if (typeof scrubbed !== 'object' || scrubbed === null) {
      return null;
    }
    // Structural cast: the scrubber preserves the object graph structure and only replaces sensitive leaf values and objects.
    return scrubbed as unknown as E;
  } catch {
    return null;
  }
}
