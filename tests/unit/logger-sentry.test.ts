import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Sentry from '@sentry/nextjs';
import { logError } from '@/lib/actions/_shared/logger';
import { ActionError } from '@/lib/actions/_shared/errors';

vi.mock('@sentry/nextjs', () => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

describe('logger-sentry (ARCH-005)', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
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
});
