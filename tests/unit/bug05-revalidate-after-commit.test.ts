import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * BUG-05: once a payment is committed, nothing afterwards may report a failure — the form would unlock and a retry
 * would record the same payment twice. Page revalidation after the commit therefore never throws.
 */
const mocks = vi.hoisted(() => ({ revalidatePath: vi.fn(), logError: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: (...args: unknown[]) => mocks.revalidatePath(...args) }));
vi.mock('@/lib/actions/_shared/logger', () => ({ logError: (...args: unknown[]) => mocks.logError(...args) }));

import { revalidateAfterCommit } from '@/lib/actions/_shared/revalidate-after-commit';

describe('BUG-05: revalidateAfterCommit', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refreshes every path', () => {
    revalidateAfterCommit('record-payment', ['/invoices', '/invoices/inv-1']);
    expect(mocks.revalidatePath.mock.calls).toEqual([['/invoices'], ['/invoices/inv-1']]);
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it('a failing refresh is logged, never thrown, and the remaining paths are still refreshed', () => {
    mocks.revalidatePath.mockImplementationOnce(() => {
      throw new Error('revalidate failed');
    });
    expect(() => revalidateAfterCommit('record-payment', ['/invoices', '/invoices/inv-1'])).not.toThrow();
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(2);
    expect(mocks.logError).toHaveBeenCalledWith('record-payment', expect.any(Error), {
      step: 'revalidate-after-commit',
      path: '/invoices',
    });
  });

  it('recordPayment revalidates only after the transaction, through the helper (not inside its try)', () => {
    const source = readFileSync(join(process.cwd(), 'lib/actions/payments/record-payment.ts'), 'utf8');
    expect(source).not.toContain('revalidatePath(');
    const txEnd = source.indexOf('throw toThrowable(error);');
    const revalidateAt = source.indexOf("revalidateAfterCommit('record-payment'");
    expect(txEnd).toBeGreaterThan(0);
    expect(revalidateAt).toBeGreaterThan(txEnd); // after the try/catch that wraps the transaction
  });

  it('the payment form locks on an INTERNAL_ERROR result too (the outcome is uncertain)', () => {
    const source = readFileSync(join(process.cwd(), 'components/app/invoices/payment-section.tsx'), 'utf8');
    expect(source).toMatch(/result\.error\.code === 'INTERNAL_ERROR'\) \{\s*\/\/[^\n]*\n\s*setMustReload\(true\);/);
  });
});
