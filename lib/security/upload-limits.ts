// Browser-safe (no imports): shared by client-side Zod schemas and lib/security/upload.ts (PERF-005).
const BASE64_EXPANSION = 1.37;
const DATA_URL_SLACK = 256;

/** Maximum base64 characters worth parsing for a given decoded limit (cheap pre-decode guard for Zod schemas). */
export function maxBase64Chars(maxBytes: number): number {
  return Math.ceil(maxBytes * BASE64_EXPANSION) + DATA_URL_SLACK;
}

/**
 * B9b: strict stored-image limits (owner decision 2026-11-21), to keep IDrive e2 storage and invoice PDFs small.
 * The browser shrinks pictures to fit before uploading (lib/images/shrink-image.ts); the server enforces the same limits.
 * The signature limit lives in signature-limits.ts (shared with its own PNG rules).
 */
export const LOGO_MAX_BYTES = 30 * 1024;
export const PAYMENT_SCREENSHOT_MAX_BYTES = 50 * 1024;
/** Largest ORIGINAL picture we try to shrink in the browser (it is never uploaded at this size). */
export const IMAGE_PICK_MAX_BYTES = 25 * 1024 * 1024;
