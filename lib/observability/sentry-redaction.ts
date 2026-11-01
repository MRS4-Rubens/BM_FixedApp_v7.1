export const REDACTED = '[redacted]';

const SENSITIVE_SUBSTRING_PATTERN =
  /gstin|e-?mail|phone|mobile|account|ifsc|token|password|passwd|secret|authorization|cookie|api[-_]?key|ip_address|forwarded|real-ip|billing_name|customer_name|legal_name|trade_name|address_line|payment_reference|reference_number/i;

const SENSITIVE_TOKEN_PATTERN = /(?:^|[_.-])(?:utr|pan|upi|vpa|pincode)(?:$|[_.-])/i;

const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const GSTIN_PATTERN = /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g;
const IFSC_PATTERN = /\b[A-Z]{4}0[A-Z0-9]{6}\b/g;
const PAN_PATTERN = /\b[A-Z]{5}\d{4}[A-Z]\b/g;
const BEARER_PATTERN = /\bBearer\s+[^\s"']+/g;
const URL_QUERY_SECRET_PATTERN =
  /([?&](?:token|sig|signature|key|secret|code|x-amz-signature|x-amz-credential)=)[^&#\s"']+/gi;

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_SUBSTRING_PATTERN.test(key) || SENSITIVE_TOKEN_PATTERN.test(key);
}

export function scrubString(value: string): string {
  let result = value;
  result = result.replace(EMAIL_PATTERN, REDACTED);
  result = result.replace(GSTIN_PATTERN, REDACTED);
  result = result.replace(IFSC_PATTERN, REDACTED);
  result = result.replace(PAN_PATTERN, REDACTED);
  result = result.replace(BEARER_PATTERN, `Bearer ${REDACTED}`);
  result = result.replace(URL_QUERY_SECRET_PATTERN, `$1${REDACTED}`);
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

