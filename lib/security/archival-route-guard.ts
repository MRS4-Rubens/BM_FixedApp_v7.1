import type { NextRequest } from 'next/server';
import { logError } from '@/lib/actions/_shared/logger';
import { checkRateLimit, exportLimiter, getClientIp } from '@/lib/rate-limit/upstash';
import { consumeArchivalJti } from '@/lib/security/archival-replay-guard';
import { ARCHIVAL_JTI_GRACE_SECONDS, verifyArchivalToken, type ArchivalDocumentType } from '@/lib/security/archival-token';

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Cache-Control': 'no-store, max-age=0',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

/** Every response from an archival-render route MUST be built with this helper. */
export function archivalResponse(body: string, init: { readonly status: number; readonly headers?: Readonly<Record<string, string>> }): Response {
  return new Response(body, { status: init.status, headers: { ...SECURITY_HEADERS, ...init.headers } });
}

export type ArchivalAuthResult = { readonly ok: true } | { readonly ok: false; readonly response: Response };

const deny = (status: number, body: string, headers?: Readonly<Record<string, string>>): ArchivalAuthResult => ({
  ok: false,
  response: archivalResponse(body, { status, ...(headers ? { headers } : {}) }),
});

export async function authorizeArchivalRequest(
  request: NextRequest,
  type: ArchivalDocumentType,
  documentId: string,
): Promise<ArchivalAuthResult> {
  const tokens = request.nextUrl.searchParams.getAll('token');
  const token = tokens.length === 1 ? tokens[0] : undefined;
  if (token === undefined || token === '') return deny(401, 'Unauthorized');

  try {
    const verification = verifyArchivalToken(token, { type, documentId });
    if (!verification.valid) return deny(401, 'Unauthorized');

    const { allowed, retryAfterSeconds } = await checkRateLimit(exportLimiter, `archival-render:${getClientIp(request.headers)}`);
    if (!allowed) return deny(429, `Too Many Requests. Retry after ${retryAfterSeconds} seconds.`, { 'Retry-After': String(retryAfterSeconds) });

    const remaining = Math.max(1, verification.expiresAt - Math.floor(Date.now() / 1000));
    const outcome = await consumeArchivalJti(verification.jti, remaining + ARCHIVAL_JTI_GRACE_SECONDS);
    if (outcome === 'REPLAYED') {
      logError('archival-render', new Error('Archival token replay rejected'), { documentType: type, documentId, expected: true });
      return deny(401, 'Unauthorized');
    }
    return { ok: true };
  } catch (error: unknown) {
    // Fail closed: signing-secret, rate-limit or replay-store failures never grant access.
    logError('archival-render', error, { documentType: type, documentId, stage: 'authorize' });
    return deny(503, 'Service Unavailable', { 'Retry-After': '5' });
  }
}
