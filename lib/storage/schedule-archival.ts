import { after } from 'next/server';
import { logError } from '@/lib/actions/_shared/logger';
import { archiveDocument } from './archival-core';
import type { ArchivalKind } from './archival-config';

async function runSafely(kind: ArchivalKind, id: string): Promise<void> {
  try {
    const result = await archiveDocument(kind, id);
    if (!result.success && result.skipped !== true) {
      logError('archival', new Error(result.error ?? 'Archival failed'), { kind, documentId: id });
    }
  } catch (error: unknown) {
    logError('archival', error, { kind, documentId: id });
  }
}

/** Call ONLY after the transaction committed. Never throws. */
export function scheduleArchival(kind: ArchivalKind, id: string): void {
  try {
    after(() => runSafely(kind, id));
  } catch (error: unknown) {
    logError('archival-schedule', error, { kind, documentId: id }); // `after` unavailable in this context: the daily sweep is the safety net
  }
}

