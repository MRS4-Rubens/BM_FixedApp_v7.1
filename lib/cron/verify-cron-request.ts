import crypto from 'crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { getCronEnv, isEnvConfigError } from '@/lib/env';
import { logError } from '@/lib/actions/_shared/logger';

/**
 * Verifies the cron secret (sent by cron-job.org as `Authorization: Bearer <CRON_SECRET>`): fail-closed when CRON_SECRET is unset/weak (500), constant-time comparison,
 * 401 on mismatch. Returns null when the request may proceed, otherwise the response to send.
 */
export function verifyCronRequest(request: NextRequest, scope: string): NextResponse | null {
  let cronSecret: string;
  try {
    cronSecret = getCronEnv().CRON_SECRET;
  } catch (error: unknown) {
    if (isEnvConfigError(error)) {
      logError(scope, error, { reason: 'CRON_SECRET is not configured properly' });
      return new NextResponse('Server Configuration Error', { status: 500 });
    }
    throw error;
  }

  const authBuf = Buffer.from(request.headers.get('authorization') ?? '', 'utf8');
  const expectedBuf = Buffer.from(`Bearer ${cronSecret}`, 'utf8');
  if (authBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(authBuf, expectedBuf)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  return null;
}
