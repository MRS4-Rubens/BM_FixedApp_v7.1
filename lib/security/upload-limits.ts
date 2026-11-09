// Browser-safe (no imports): shared by client-side Zod schemas and lib/security/upload.ts (PERF-005).
const BASE64_EXPANSION = 1.37;
const DATA_URL_SLACK = 256;

/** Maximum base64 characters worth parsing for a given decoded limit (cheap pre-decode guard for Zod schemas). */
export function maxBase64Chars(maxBytes: number): number {
  return Math.ceil(maxBytes * BASE64_EXPANSION) + DATA_URL_SLACK;
}
