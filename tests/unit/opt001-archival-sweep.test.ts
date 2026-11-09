import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Sentry from '@sentry/nextjs';

const mockClaimBatch = vi.fn();
const mockCountExhausted = vi.fn();
const mockCountStalePending = vi.fn();

vi.mock('@/lib/db/client', () => ({
  db: {
    execute: vi.fn(),
  },
}));

vi.mock('@/lib/storage/archival-claims', () => ({
  claimBatch: (...args: unknown[]) => mockClaimBatch(...args),
  countExhausted: (...args: unknown[]) => mockCountExhausted(...args),
  countStalePending: (...args: unknown[]) => mockCountStalePending(...args),
}));

vi.mock('@/lib/storage/archival-core', () => ({
  archiveClaimedDocument: vi.fn(),
}));

vi.mock('@sentry/nextjs', () => ({
  captureMessage: vi.fn(),
}));

import { runArchivalSweep } from '@/lib/storage/archival-sweep';
import { ARCHIVAL_STALE_PENDING_MINUTES } from '@/lib/storage/archival-config';

describe('OPT-001: archival sweep stale & exhausted backlog alerts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClaimBatch.mockResolvedValue([]); // empty queue
    mockCountExhausted.mockResolvedValue(0);
    mockCountStalePending.mockResolvedValue(0);
  });

  it('passes ARCHIVAL_STALE_PENDING_MINUTES (60) to countStalePending and does not alert when 0 stale', async () => {
    expect(ARCHIVAL_STALE_PENDING_MINUTES).toBe(60);

    const summary = await runArchivalSweep();

    expect(mockCountStalePending).toHaveBeenCalledWith(expect.anything(), 'invoice', 60);
    expect(mockCountStalePending).toHaveBeenCalledWith(expect.anything(), 'credit_note', 60);

    expect(summary.staleInvoices).toBe(0);
    expect(summary.staleCreditNotes).toBe(0);
    expect(summary.exhaustedInvoices).toBe(0);
    expect(summary.exhaustedCreditNotes).toBe(0);

    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('captures Sentry warning when staleInvoices > 0', async () => {
    mockCountStalePending.mockImplementation((_db, kind) => {
      if (kind === 'invoice') return Promise.resolve(3);
      return Promise.resolve(0);
    });

    const summary = await runArchivalSweep();

    expect(summary.staleInvoices).toBe(3);
    expect(summary.staleCreditNotes).toBe(0);

    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'Archival backlog: documents pending for over 1 hour',
      {
        level: 'warning',
        tags: { scope: 'archival-stale-pending' },
        extra: { invoices: 3, creditNotes: 0 },
      },
    );
  });

  it('captures Sentry warning when staleCreditNotes > 0', async () => {
    mockCountStalePending.mockImplementation((_db, kind) => {
      if (kind === 'invoice') return Promise.resolve(0);
      return Promise.resolve(2);
    });

    const summary = await runArchivalSweep();

    expect(summary.staleInvoices).toBe(0);
    expect(summary.staleCreditNotes).toBe(2);

    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'Archival backlog: documents pending for over 1 hour',
      {
        level: 'warning',
        tags: { scope: 'archival-stale-pending' },
        extra: { invoices: 0, creditNotes: 2 },
      },
    );
  });

  it('captures both exhausted and stale alerts when both conditions are met', async () => {
    mockCountExhausted.mockImplementation((_db, kind) => {
      if (kind === 'invoice') return Promise.resolve(1);
      return Promise.resolve(0);
    });
    mockCountStalePending.mockImplementation((_db, kind) => {
      if (kind === 'invoice') return Promise.resolve(4);
      return Promise.resolve(1);
    });

    const summary = await runArchivalSweep();

    expect(summary.exhaustedInvoices).toBe(1);
    expect(summary.staleInvoices).toBe(4);
    expect(summary.staleCreditNotes).toBe(1);

    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'Archival backlog: documents exhausted attempts',
      {
        level: 'error',
        tags: { scope: 'archival-exhausted-summary' },
        extra: { invoices: 1, creditNotes: 0 },
      },
    );

    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'Archival backlog: documents pending for over 1 hour',
      {
        level: 'warning',
        tags: { scope: 'archival-stale-pending' },
        extra: { invoices: 4, creditNotes: 1 },
      },
    );
  });
});

