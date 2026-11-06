import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ActionError } from '@/lib/actions/_shared/errors';

const scheduleArchivalMock = vi.fn();
vi.mock('@/lib/storage/schedule-archival', () => ({
  scheduleArchival: (...args: unknown[]) => scheduleArchivalMock(...args),
}));

const mockAppUser = {
  id: 'u0000000-0000-4000-8000-000000000001',
  business_id: 'b0000000-0000-4000-8000-000000000001',
};

vi.mock('@/lib/actions/_shared/create-action', () => ({
  createAuthenticatedAction: (
    schema: { parse: (val: unknown) => unknown },
    handler: (input: unknown, ctx: { appUser: typeof mockAppUser }) => Promise<unknown>,
  ) => {
    return async (input: unknown) => {
      const parsed = schema.parse(input);
      return handler(parsed, { appUser: mockAppUser });
    };
  },
}));

const finalizeInvoiceTxMock = vi.fn();
vi.mock('@/lib/invoices/finalize-invoice-tx', () => ({
  finalizeDraftInvoiceInTransaction: (...args: unknown[]) => finalizeInvoiceTxMock(...args),
}));

const finalizeCreditNoteTxMock = vi.fn();
vi.mock('@/lib/invoices/finalize-credit-note-tx', () => ({
  finalizeDraftCreditNoteInTransaction: (...args: unknown[]) => finalizeCreditNoteTxMock(...args),
}));

vi.mock('@/lib/db/client', () => ({
  db: {
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({}),
  },
}));

vi.mock('@/lib/db/transaction', () => ({
  withTransactionRetry: async (cb: () => Promise<unknown>) => cb(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/rate-limit/upstash', () => ({
  sensitiveActionLimiter: {},
}));

vi.mock('@/lib/audit/request-context', () => ({
  getAuditRequestContext: async () => ({ ip: '127.0.0.1', userAgent: 'test' }),
}));

import { finalizeInvoice } from '@/lib/actions/invoices/finalize-invoice';
import { finalizeCreditNote } from '@/lib/actions/credit-notes/finalize-credit-note';

describe('finalize actions archival scheduling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('finalizeInvoice calls scheduleArchival once with invoice and id on success', async () => {
    const invoiceId = '11111111-1111-4111-8111-111111111111';
    finalizeInvoiceTxMock.mockResolvedValueOnce({
      id: invoiceId,
      invoiceNumber: 'INV-2026-001',
    });

    const res = await finalizeInvoice({ id: invoiceId });
    expect(res).toEqual({
      id: invoiceId,
      invoiceNumber: 'INV-2026-001',
    });
    expect(scheduleArchivalMock).toHaveBeenCalledTimes(1);
    expect(scheduleArchivalMock).toHaveBeenCalledWith('invoice', invoiceId);
  });

  it('finalizeInvoice does NOT call scheduleArchival if transaction fails', async () => {
    const invoiceId = '11111111-1111-4111-8111-111111111111';
    finalizeInvoiceTxMock.mockRejectedValueOnce(new ActionError('Invoice not found'));

    await expect(finalizeInvoice({ id: invoiceId })).rejects.toThrow();
    expect(scheduleArchivalMock).not.toHaveBeenCalled();
  });

  it('finalizeCreditNote calls scheduleArchival once with credit_note and id on success', async () => {
    const cnId = '22222222-2222-4222-8222-222222222222';
    const origInvoiceId = '11111111-1111-4111-8111-111111111111';
    finalizeCreditNoteTxMock.mockResolvedValueOnce({
      id: cnId,
      creditNoteNumber: 'CN-2026-001',
      originalInvoiceId: origInvoiceId,
    });

    const res = await finalizeCreditNote({ id: cnId });
    expect(res).toEqual({
      id: cnId,
      creditNoteNumber: 'CN-2026-001',
    });
    expect(scheduleArchivalMock).toHaveBeenCalledTimes(1);
    expect(scheduleArchivalMock).toHaveBeenCalledWith('credit_note', cnId);
  });

  it('finalizeCreditNote does NOT call scheduleArchival if transaction fails', async () => {
    const cnId = '22222222-2222-4222-8222-222222222222';
    finalizeCreditNoteTxMock.mockRejectedValueOnce(new ActionError('Credit note not found'));

    await expect(finalizeCreditNote({ id: cnId })).rejects.toThrow();
    expect(scheduleArchivalMock).not.toHaveBeenCalled();
  });

  it('static check: finalize actions no longer import archiveInvoicePdf or archiveCreditNotePdf', () => {
    const invoiceActionContent = readFileSync(
      path.join(process.cwd(), 'lib/actions/invoices/finalize-invoice.ts'),
      'utf8',
    );
    expect(invoiceActionContent).not.toContain('archiveInvoicePdf');

    const creditNoteActionContent = readFileSync(
      path.join(process.cwd(), 'lib/actions/credit-notes/finalize-credit-note.ts'),
      'utf8',
    );
    expect(creditNoteActionContent).not.toContain('archiveCreditNotePdf');
  });
});

