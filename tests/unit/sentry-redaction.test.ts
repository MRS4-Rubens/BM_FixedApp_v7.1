import { describe, expect, it } from 'vitest';
import {
  isSensitiveKey,
  REDACTED,
  scrubSentryEvent,
  scrubString,
  scrubValue,
} from '@/lib/observability/sentry-redaction';

describe('sentry-redaction (ARCH-005)', () => {
  it('identifies sensitive keys correctly and spares business fields', () => {
    expect(isSensitiveKey('gstin')).toBe(true);
    expect(isSensitiveKey('customer_email')).toBe(true);
    expect(isSensitiveKey('Authorization')).toBe(true);
    expect(isSensitiveKey('bank_account_number')).toBe(true);
    expect(isSensitiveKey('ifsc_code')).toBe(true);
    expect(isSensitiveKey('utr')).toBe(true);
    expect(isSensitiveKey('razorpay_token')).toBe(true);

    // Business fields and structural keys must NOT match
    expect(isSensitiveKey('amount_paise')).toBe(false);
    expect(isSensitiveKey('status')).toBe(false);
    expect(isSensitiveKey('event_id')).toBe(false);
    expect(isSensitiveKey('scope')).toBe(false);
  });

  it('redacts sensitive keys while preserving safe business fields', () => {
    const payload = {
      gstin: '27AAAAA0000A1Z5',
      customer_email: 'jane@example.com',
      Authorization: 'Bearer test-token-123',
      bank_account_number: '1234567890',
      ifsc_code: 'SBIN0001234',
      utr: 'UTR20261101999',
      razorpay_token: { id: 'tok_abc' },
      amount_paise: 999900,
      status: 'finalized',
      notes: null,
    };

    const scrubbed = scrubValue(payload) as Record<string, unknown>;

    expect(scrubbed.gstin).toBe(REDACTED);
    expect(scrubbed.customer_email).toBe(REDACTED);
    expect(scrubbed.Authorization).toBe(REDACTED);
    expect(scrubbed.bank_account_number).toBe(REDACTED);
    expect(scrubbed.ifsc_code).toBe(REDACTED);
    expect(scrubbed.utr).toBe(REDACTED);
    expect(scrubbed.razorpay_token).toBe(REDACTED);

    expect(scrubbed.amount_paise).toBe(999900);
    expect(scrubbed.status).toBe('finalized');
    expect(scrubbed.notes).toBeNull();
  });

  it('replaces email, GSTIN, IFSC and PAN inside free text', () => {
    const text = 'User john.doe@example.co.in with GSTIN 29ABCDE1234F2Z5 and PAN ABCDE1234F bank IFSC HDFC0001234';
    const scrubbed = scrubString(text);

    expect(scrubbed).not.toContain('john.doe@example.co.in');
    expect(scrubbed).not.toContain('29ABCDE1234F2Z5');
    expect(scrubbed).not.toContain('ABCDE1234F');
    expect(scrubbed).not.toContain('HDFC0001234');
    expect(scrubbed).toBe('User [redacted] with GSTIN [redacted] and PAN [redacted] bank IFSC [redacted]');
  });

  it('scrubs URL query secrets (?token=abc&page=2 -> ?token=[redacted]&page=2)', () => {
    const query = '?token=abc&page=2';
    expect(scrubString(query)).toBe('?token=[redacted]&page=2');

    const fullUrl = 'https://s3.example.com/invoice.pdf?token=secret123&signature=sig456&key=val&safe=1';
    expect(scrubString(fullUrl)).toBe(
      'https://s3.example.com/invoice.pdf?token=[redacted]&signature=[redacted]&key=[redacted]&safe=1',
    );
  });

  it('keeps the word Bearer while scrubbing the token value', () => {
    const header = 'Bearer secret-jwt-or-api-token-value';
    expect(scrubString(header)).toBe('Bearer [redacted]');
  });

  it('terminates on circular references and depth overflow without infinite loop', () => {
    const cyclicObj: Record<string, unknown> = { label: 'root' };
    cyclicObj.self = cyclicObj;

    const scrubbedObj = scrubValue(cyclicObj) as Record<string, unknown>;
    expect(scrubbedObj.label).toBe('root');
    expect(scrubbedObj.self).toBe('[circular]');

    const cyclicArr: unknown[] = [];
    cyclicArr.push(cyclicArr);
    const scrubbedArr = scrubValue(cyclicArr) as unknown[];
    expect(scrubbedArr[0]).toBe('[circular]');

    // Build a deeply nested structure (15 levels)
    let deep: Record<string, unknown> = { level: 15 };
    for (let i = 14; i >= 0; i--) {
      deep = { level: i, next: deep };
    }
    const scrubbedDeep = scrubValue(deep) as Record<string, unknown>;
    expect(scrubbedDeep).toBeDefined();

    // Verify depth truncation occurs
    let curr: unknown = scrubbedDeep;
    let foundTruncated = false;
    for (let i = 0; i < 20; i++) {
      if (curr === '[truncated]') {
        foundTruncated = true;
        break;
      }
      if (typeof curr === 'object' && curr !== null && 'next' in curr) {
        curr = (curr as Record<string, unknown>).next;
      } else {
        break;
      }
    }
    expect(foundTruncated).toBe(true);
  });

  it('does not mutate the input object', () => {
    const original = {
      gstin: '27AAAAA0000A1Z5',
      customer_email: 'jane@example.com',
      nested: {
        amount_paise: 12000,
        phone: '9876543210',
      },
    };

    const scrubbed = scrubValue(original);
    expect(scrubbed).not.toBe(original);
    expect(original.gstin).toBe('27AAAAA0000A1Z5');
    expect(original.customer_email).toBe('jane@example.com');
    expect(original.nested.amount_paise).toBe(12000);
    expect(original.nested.phone).toBe('9876543210');
  });

  it('converts Error extras to { name, message } with scrubbed message', () => {
    const err = new Error('Failed to charge user@example.com with GSTIN 27AAAAA0000A1Z5');
    const scrubbed = scrubValue(err) as { name: string; message: string };

    expect(scrubbed.name).toBe('Error');
    expect(scrubbed.message).toBe('Failed to charge [redacted] with GSTIN [redacted]');
    expect(scrubbed.message).not.toContain('user@example.com');
    expect(scrubbed.message).not.toContain('27AAAAA0000A1Z5');
  });

  it('preserves structural Sentry fields while scrubbing sensitive contents', () => {
    const event = {
      event_id: 'fc6d907087f2470f93000a907f90f23f',
      release: 'git-commit-sha-12345',
      environment: 'production',
      tags: { scope: 'invoices:finalize', runtime: 'nodejs' },
      user: { id: 'usr_12345' },
      contexts: {
        trace: {
          trace_id: '4bf92f3577b34da6a3ce929d0e0e4736',
          span_id: '00f067aa0ba902b7',
        },
      },
      exception: {
        values: [
          {
            type: 'Error',
            value: 'Customer 27AAAAA0000A1Z5 payment failed',
            stacktrace: {
              frames: [
                {
                  filename: '/app/lib/actions/invoices/finalize.ts',
                  function: 'finalizeDraftInvoice',
                  lineno: 42,
                },
              ],
            },
          },
        ],
      },
    };

    const scrubbed = scrubSentryEvent(event);
    expect(scrubbed).not.toBeNull();
    if (!scrubbed) throw new Error('Expected non-null scrubbed event');

    expect(scrubbed.event_id).toBe('fc6d907087f2470f93000a907f90f23f');
    expect(scrubbed.release).toBe('git-commit-sha-12345');
    expect(scrubbed.environment).toBe('production');
    expect(scrubbed.tags.scope).toBe('invoices:finalize');
    expect(scrubbed.user.id).toBe('usr_12345');
    expect(scrubbed.contexts.trace.trace_id).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(scrubbed.exception.values[0]?.stacktrace?.frames[0]?.filename).toBe(
      '/app/lib/actions/invoices/finalize.ts',
    );
    expect(scrubbed.exception.values[0]?.stacktrace?.frames[0]?.function).toBe('finalizeDraftInvoice');
    expect(scrubbed.exception.values[0]?.stacktrace?.frames[0]?.lineno).toBe(42);
    expect(scrubbed.exception.values[0]?.value).toBe('Customer [redacted] payment failed');
  });

  it('fails closed (returns null) on poisoned input with a throwing getter', () => {
    const poisoned = {
      safe: 'ok',
      get malicious(): string {
        throw new Error('Explosive getter');
      },
    };

    expect(scrubSentryEvent(poisoned)).toBeNull();
  });
});

