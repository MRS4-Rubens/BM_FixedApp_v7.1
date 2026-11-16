import { z } from 'zod';
import { IMPORT_KINDS, IMPORT_MAX_BYTES } from '@/lib/import/columns';

/** Feature D: the payload of both import actions. The file travels base64-encoded (server actions take JSON). */
export const bulkImportSchema = z.object({
  kind: z.enum(IMPORT_KINDS),
  file_name: z.string().trim().min(1, 'Choose a file to upload.').max(255, 'The file name is too long.'),
  // base64 is 4/3 of the binary size; the reader re-checks the decoded size exactly.
  file_base64: z
    .string()
    .min(1, 'The file is empty.')
    .max(Math.ceil((IMPORT_MAX_BYTES * 4) / 3) + 8, 'The file is larger than 2 MB. Split it into smaller files.'),
});

export type BulkImportInput = z.infer<typeof bulkImportSchema>;
