import { archiveDocument, type ArchivalResult } from './archival-core';

export async function archiveCreditNotePdf(id: string): Promise<ArchivalResult> {
  return archiveDocument('credit_note', id);
}
