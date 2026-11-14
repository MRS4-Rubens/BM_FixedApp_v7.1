import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Sentry from '@sentry/nextjs';
import { logError, logWarn } from '@/lib/actions/_shared/logger';
import { ActionError } from '@/lib/actions/_shared/errors';
import { DrizzleQueryError } from 'drizzle-orm';

vi.mock('@sentry/nextjs', () => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

describe('logger-sentry (ARCH-005)', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('expected ActionError calls addBreadcrumb and NOT captureException', () => {
    const error = new ActionError('Invoice already finalized', { code: 'ALREADY_FINALIZED' });
    logError('invoices:finalize', error, { expected: true, code: 'ALREADY_FINALIZED' });

    expect(Sentry.addBreadcrumb).toHaveBeenCalledTimes(1);
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith({
      category: 'expected-error',
      level: 'info',
      message: 'invoices:finalize',
      data: { code: 'ALREADY_FINALIZED' },
    });

    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('unexpected Error calls captureException with tags.scope and meta', () => {
    const error = new Error('Database connection failed');
    logError('invoices:save', error, { invoiceId: 'inv-123' });

    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalledWith(error, {
      tags: { scope: 'invoices:save' },
      extra: { invoiceId: 'inv-123' },
    });

    expect(Sentry.addBreadcrumb).not.toHaveBeenCalled();
  });

  it('non-Error value calls captureMessage with level error and originalError extra', () => {
    logError('auth:token', 'raw string failure reason', { ip: '127.0.0.1' });

    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(Sentry.captureMessage).toHaveBeenCalledWith('raw string failure reason', {
      level: 'error',
      tags: { scope: 'auth:token' },
      extra: { ip: '127.0.0.1', originalError: 'raw string failure reason' },
    });

    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(Sentry.addBreadcrumb).not.toHaveBeenCalled();
  });

  it('prints valid JSON to console.error', () => {
    const error = new Error('Sample unexpected failure');

    logError('reports:generate', error, { reportType: 'gstr1' });

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const printedArg = consoleSpy.mock.calls[0]?.[0];
    expect(typeof printedArg).toBe('string');

    const parsed = JSON.parse(printedArg as string) as Record<string, unknown>;
    expect(parsed.scope).toBe('reports:generate');
    expect(parsed.message).toBe('Sample unexpected failure');
    expect(parsed.meta).toEqual({ reportType: 'gstr1' });
    expect(typeof parsed.timestamp).toBe('string');

    consoleSpy.mockRestore();
  });

  it('SEC-006: logError scrubs PII in meta and outputs single-line JSON without unescaped newlines', () => {
    const error = new Error('Payment processing failed');
    logError('invoices:payment', error, {
      customer_email: 'jane@example.com',
      note: 'call 9876543210',
      invoiceId: 'inv-1',
    });

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const printedArg = consoleSpy.mock.calls[0]?.[0];
    expect(typeof printedArg).toBe('string');
    const printed = printedArg as string;

    expect(printed.includes('\n')).toBe(false);

    const parsed = JSON.parse(printed) as {
      meta: { customer_email: string; note: string; invoiceId: string };
    };
    expect(parsed.meta.customer_email).toBe('[redacted]');
    expect(parsed.meta.note).not.toContain('9876543210');
    expect(parsed.meta.invoiceId).toBe('inv-1');
  });

  it('SEC-006: logError scrubs DrizzleQueryError params from message and stack while preserving Sentry captureException error instance', () => {
    const rawSql = 'insert into customers values ($1,$2)';
    const params = ['Ravi Kumar', '9876543210'];
    const originalError = new Error('duplicate key');
    const err = new DrizzleQueryError(rawSql, params, originalError);

    logError('create-customer', err);

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const printedArg = consoleSpy.mock.calls[0]?.[0];
    const printed = printedArg as string;

    expect(printed).not.toContain('Ravi Kumar');
    expect(printed).not.toContain('9876543210');

    const parsed = JSON.parse(printed) as { message: string; stack: string };
    expect(parsed.message).not.toContain('Ravi Kumar');
    expect(parsed.message).not.toContain('9876543210');
    expect(parsed.message).toContain('params: [redacted]');
    if (parsed.stack) {
      expect(parsed.stack).not.toContain('Ravi Kumar');
      expect(parsed.stack).not.toContain('9876543210');
    }

    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalledWith(err, {
      tags: { scope: 'create-customer' },
      extra: undefined,
    });
  });

  it('logError prints the real reason behind a DrizzleQueryError (error.cause), scrubbed', () => {
    const connectTimeout = Object.assign(new Error('timeout exceeded when trying to connect'), { code: 'ETIMEDOUT' });
    const err = new DrizzleQueryError('select 1 from invoices where business_id = $1', ['biz-1'], connectTimeout);
    logError('get-dashboard-stats', err);

    const parsed = JSON.parse(consoleSpy.mock.calls[0]?.[0] as string) as {
      message: string;
      cause?: Array<{ name: string; message: string; code?: string }>;
    };
    expect(parsed.message).toContain('Failed query');
    expect(parsed.cause).toEqual([{ name: 'Error', message: 'timeout exceeded when trying to connect', code: 'ETIMEDOUT' }]);

    // A cause carrying private data is scrubbed like everything else in the log line.
    consoleSpy.mockClear();
    const leaky = new DrizzleQueryError('insert into customers values ($1)', ['x'], new Error('bad mobile 9876543210'));
    logError('create-customer', leaky);
    const printed = consoleSpy.mock.calls[0]?.[0] as string;
    expect(printed).not.toContain('9876543210');
    expect(JSON.parse(printed).cause[0].message).toContain('bad mobile');
  });

  it('logError omits the cause field when there is no cause', () => {
    logError('plain', new Error('no cause here'));
    const parsed = JSON.parse(consoleSpy.mock.calls[0]?.[0] as string) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty('cause');
  });

  it('SEC-006: logError extra passed to Sentry is scrubbed for sensitive keys', () => {
    const error = new Error('GSTIN verification failure');
    logError('business:verify', error, { gstin: '27AAAAA0000A1Z5' });

    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    const callArgs = vi.mocked(Sentry.captureException).mock.calls[0];
    const context = callArgs?.[1] as { extra?: Record<string, unknown> } | undefined;
    expect(context?.extra).toBeDefined();
    expect(context?.extra?.gstin).toBe('[redacted]');
  });

  it('SEC-006: non-Error value scrubs PII before Sentry captureMessage', () => {
    logError('auth:login', 'user ravi@okaxis failed');

    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    const messageArg = vi.mocked(Sentry.captureMessage).mock.calls[0]?.[0];
    expect(messageArg).not.toContain('ravi@okaxis');
    expect(messageArg).toBe('user [redacted] failed');
  });

  it('SEC-006: logWarn prints via console.warn with warn level, adds breadcrumb, and avoids Sentry issue creation', () => {
    logWarn('admin:payee-config', 'Payee configuration problems: missing UPI for user 9876543210');

    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    const printedArg = consoleWarnSpy.mock.calls[0]?.[0];
    const printed = printedArg as string;
    const parsed = JSON.parse(printed) as {
      level: string;
      scope: string;
      message: string;
    };

    expect(parsed.level).toBe('warn');
    expect(parsed.scope).toBe('admin:payee-config');
    expect(parsed.message).not.toContain('9876543210');
    expect(parsed.message).toContain('[redacted]');

    expect(Sentry.addBreadcrumb).toHaveBeenCalledTimes(1);
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith({
      category: 'warning',
      level: 'warning',
      message: 'admin:payee-config: Payee configuration problems: missing UPI for user [redacted]',
    });

    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });
});
