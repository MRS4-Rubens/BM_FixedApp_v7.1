import * as Sentry from '@sentry/nextjs';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { invoices, creditNotes, financialYears } from '@/lib/db/schema';
import { getAppEnv, isEnvConfigError } from '@/lib/env';
import { createArchivalToken } from '@/lib/security/archival-token';
import { renderUrlToPdfBuffer } from '@/lib/pdf/html-to-pdf-provider';
import { uploadFileToStorage } from '@/lib/storage/idrive';
import { logError } from '@/lib/actions/_shared/logger';
import {
  ARCHIVAL_MAX_ATTEMPTS,
  type ArchivalKind,
} from './archival-config';
import {
  claimDocumentById,
  markArchived,
  markFailed,
  refundAttempt,
} from './archival-claims';

export interface ArchivalResult {
  readonly success: boolean;
  readonly skipped?: boolean;
  readonly error?: string;
}

function alertArchivalExhausted(kind: ArchivalKind, id: string, attempts: number): void {
  Sentry.captureMessage('Document archival exhausted all attempts', {
    level: 'error',
    tags: { scope: 'archival-exhausted', document_type: kind },
    extra: { documentId: id, attempts },
  });
}

interface DocumentContext {
  readonly businessId: string;
  readonly financialYearId: string;
}

async function loadDocumentContext(kind: ArchivalKind, id: string): Promise<DocumentContext | null> {
  if (kind === 'invoice') {
    const rows = await db
      .select({ businessId: invoices.business_id, financialYearId: invoices.financial_year_id })
      .from(invoices)
      .where(eq(invoices.id, id));
    return rows[0] ?? null;
  } else {
    const rows = await db
      .select({ businessId: creditNotes.business_id, financialYearId: creditNotes.financial_year_id })
      .from(creditNotes)
      .where(eq(creditNotes.id, id));
    return rows[0] ?? null;
  }
}

async function loadFinancialYearLabel(financialYearId: string): Promise<string | null> {
  const rows = await db
    .select({ label: financialYears.label })
    .from(financialYears)
    .where(eq(financialYears.id, financialYearId));
  return rows[0]?.label ?? null;
}

/**
 * Executes render, upload, and database update for an already-claimed document.
 * Called by `archiveDocument` (after claim) and `runArchivalSweep` (after batch claim).
 */
export async function archiveClaimedDocument(
  kind: ArchivalKind,
  id: string,
  attempts: number,
): Promise<ArchivalResult> {
  try {
    const doc = await loadDocumentContext(kind, id);
    if (!doc) {
      throw new Error(`${kind === 'invoice' ? 'Invoice' : 'Credit note'} not found`);
    }

    const fyLabel = await loadFinancialYearLabel(doc.financialYearId);
    if (!fyLabel) {
      throw new Error('Financial year not found');
    }

    const token = createArchivalToken(id);
    const baseUrl = getAppEnv().NEXT_PUBLIC_APP_URL;
    const pathPrefix = kind === 'invoice' ? 'invoices' : 'credit-notes';
    const renderUrl = `${baseUrl}/api/${pathPrefix}/${id}/archival-render?token=${token}`;

    const pdfBuffer = await renderUrlToPdfBuffer(renderUrl);
    const storageKey = `${pathPrefix}/${doc.businessId}/${fyLabel}/${id}.pdf`;

    await uploadFileToStorage(storageKey, pdfBuffer, 'application/pdf');
    await markArchived(db, kind, id, storageKey);

    return { success: true };
  } catch (error: unknown) {
    if (isEnvConfigError(error)) {
      try {
        await refundAttempt(db, kind, id);
      } catch (refundErr: unknown) {
        logError('archival-refund-failed', refundErr, { kind, documentId: id });
      }
      return { success: false, error: error.message };
    }

    try {
      await markFailed(db, kind, id);
    } catch (markErr: unknown) {
      logError('archival-mark-failed', markErr, { kind, documentId: id });
    }

    const message = error instanceof Error ? error.message : 'Unknown archival error';
    if (attempts >= ARCHIVAL_MAX_ATTEMPTS) {
      alertArchivalExhausted(kind, id, attempts);
    }
    return { success: false, error: message };
  }
}

/**
 * Claims and archives one document by ID (used for post-finalize single-document archival).
 */
export async function archiveDocument(kind: ArchivalKind, id: string): Promise<ArchivalResult> {
  const claim = await claimDocumentById(db, kind, id);
  if (claim === null) {
    return {
      success: false,
      skipped: true,
      error: 'Not claimable (already archived, leased by another worker, exhausted, or not finalized).',
    };
  }
  return archiveClaimedDocument(kind, claim.id, claim.attempts);
}

