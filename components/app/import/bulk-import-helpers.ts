import { IMPORT_MAX_BYTES, type ImportKind } from '@/lib/import/columns';

export type RowFilter = 'all' | 'ready' | 'duplicate' | 'error';

export interface ImportIssue {
  readonly column: string;
  readonly message: string;
}

export interface ImportPreviewRow {
  readonly rowNumber: number;
  readonly label: string;
  readonly status: 'ready' | 'duplicate' | 'error';
  readonly issues: readonly ImportIssue[];
}

export interface ImportSummary {
  readonly total: number;
  readonly ready: number;
  readonly duplicates: number;
  readonly errors: number;
}

export interface BulkImportPreviewData {
  readonly kind: ImportKind;
  readonly summary: ImportSummary;
  readonly rows: readonly ImportPreviewRow[];
}

export interface ImportRunResult {
  readonly kind: ImportKind;
  readonly summary: ImportSummary;
  readonly imported: number;
}

export interface RowWithStatus {
  readonly status: 'ready' | 'duplicate' | 'error';
}

export type FileMetaValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

/**
 * Validates basic file metadata before uploading.
 * Checks extension (.xlsx or .csv) and size (1 B .. 2 MB).
 */
export function validateImportFileMeta(name: string, size: number): FileMetaValidationResult {
  const lowerName = name.toLowerCase();
  const hasValidExt = lowerName.endsWith('.xlsx') || lowerName.endsWith('.csv');
  if (!hasValidExt) {
    return { ok: false, message: 'Choose an Excel (.xlsx) or CSV (.csv) file.' };
  }
  if (size <= 0) {
    return { ok: false, message: 'The file is empty.' };
  }
  if (size > IMPORT_MAX_BYTES) {
    return { ok: false, message: 'The file is larger than 2 MB. Split it into smaller files.' };
  }
  return { ok: true };
}

/**
 * Converts a File to base64 using arrayBuffer and chunked btoa.
 * Avoids call stack overflow by slicing in 32 KB (0x8000) chunks.
 */
export async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const CHUNK_SIZE = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, i + CHUNK_SIZE);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

/**
 * Filters import preview rows based on status tab.
 */
export function filterRows<T extends RowWithStatus>(
  rows: readonly T[],
  filter: RowFilter,
): readonly T[] {
  if (filter === 'all') {
    return rows;
  }
  return rows.filter((row) => row.status === filter);
}

/**
 * Human-readable label for the primary import button.
 */
export function importButtonLabel(kind: ImportKind, ready: number): string {
  if (ready === 0) {
    return 'Nothing to import';
  }
  if (kind === 'customers') {
    return ready === 1 ? 'Import 1 customer' : `Import ${ready} customers`;
  }
  return ready === 1 ? 'Import 1 product' : `Import ${ready} products`;
}
