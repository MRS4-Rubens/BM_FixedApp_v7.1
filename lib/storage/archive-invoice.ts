import { archiveDocument, type ArchivalResult } from './archival-core';

export async function archiveInvoicePdf(id: string): Promise<ArchivalResult> {
  return archiveDocument('invoice', id);
}
