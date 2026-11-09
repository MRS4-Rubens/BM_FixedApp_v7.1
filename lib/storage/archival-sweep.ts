import * as Sentry from '@sentry/nextjs';
import { db } from '@/lib/db/client';
import {
  ARCHIVAL_STALE_PENDING_MINUTES,
  ARCHIVAL_SWEEP_BATCH_SIZE,
  ARCHIVAL_SWEEP_CONCURRENCY,
  ARCHIVAL_SWEEP_DEADLINE_MS,
  type ArchivalKind,
} from './archival-config';
import { claimBatch, countExhausted, countStalePending } from './archival-claims';
import { archiveClaimedDocument } from './archival-core';
import { mapWithConcurrency } from '@/lib/async/map-with-concurrency';

export interface ArchivalSweepSummary {
  readonly claimed: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly skipped: number;
  readonly exhaustedInvoices: number;
  readonly exhaustedCreditNotes: number;
  readonly staleInvoices: number;
  readonly staleCreditNotes: number;
}

export async function runArchivalSweep(
  now: () => number = Date.now,
): Promise<ArchivalSweepSummary> {
  const startTime = now();
  const deadline = startTime + ARCHIVAL_SWEEP_DEADLINE_MS;

  let claimedCount = 0;
  let succeededCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  while (now() < deadline) {
    let kind: ArchivalKind = 'invoice';
    let batch = await claimBatch(db, kind, ARCHIVAL_SWEEP_BATCH_SIZE);

    if (batch.length === 0) {
      kind = 'credit_note';
      batch = await claimBatch(db, kind, ARCHIVAL_SWEEP_BATCH_SIZE);
    }

    if (batch.length === 0) {
      // Both queues are empty
      break;
    }

    claimedCount += batch.length;

    const results = await mapWithConcurrency(
      batch,
      ARCHIVAL_SWEEP_CONCURRENCY,
      async (c) => archiveClaimedDocument(kind, c.id, c.attempts),
    );

    for (const res of results) {
      if (res.status === 'fulfilled') {
        const value = res.value;
        if (value.success) {
          succeededCount += 1;
        } else if (value.skipped) {
          skippedCount += 1;
        } else {
          failedCount += 1;
        }
      } else {
        failedCount += 1;
      }
    }
  }

  const exhaustedInvoices = await countExhausted(db, 'invoice');
  const exhaustedCreditNotes = await countExhausted(db, 'credit_note');

  if (exhaustedInvoices > 0 || exhaustedCreditNotes > 0) {
    Sentry.captureMessage('Archival backlog: documents exhausted attempts', {
      level: 'error',
      tags: { scope: 'archival-exhausted-summary' },
      extra: { invoices: exhaustedInvoices, creditNotes: exhaustedCreditNotes },
    });
  }

  const staleInvoices = await countStalePending(db, 'invoice', ARCHIVAL_STALE_PENDING_MINUTES);
  const staleCreditNotes = await countStalePending(db, 'credit_note', ARCHIVAL_STALE_PENDING_MINUTES);

  if (staleInvoices > 0 || staleCreditNotes > 0) {
    Sentry.captureMessage('Archival backlog: documents pending for over 1 hour', {
      level: 'warning',
      tags: { scope: 'archival-stale-pending' },
      extra: { invoices: staleInvoices, creditNotes: staleCreditNotes },
    });
  }

  return {
    claimed: claimedCount,
    succeeded: succeededCount,
    failed: failedCount,
    skipped: skippedCount,
    exhaustedInvoices,
    exhaustedCreditNotes,
    staleInvoices,
    staleCreditNotes,
  };
}

