import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getCronEnv, isEnvConfigError } from '@/lib/env';
import { logError } from '@/lib/actions/_shared/logger';
import { runArchivalSweep } from '@/lib/storage/archival-sweep';

// Vercel plan limits apply — verify
export const maxDuration = 300;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  // 1. Verify Vercel Cron Secret (fail-closed if unset/weak + constant-time check)
  let cronSecret: string;
  try {
    cronSecret = getCronEnv().CRON_SECRET;
  } catch (error: unknown) {
    if (isEnvConfigError(error)) {
      logError('archival-cron', error, { reason: 'CRON_SECRET is not configured properly' });
      return new NextResponse('Server Configuration Error', { status: 500 });
    }
    throw error;
  }

  const authHeader = request.headers.get('authorization') ?? '';
  const expectedHeader = `Bearer ${cronSecret}`;

  const authBuf = Buffer.from(authHeader, 'utf8');
  const expectedBuf = Buffer.from(expectedHeader, 'utf8');

  if (
    authBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(authBuf, expectedBuf)
  ) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    const summary = await runArchivalSweep();
    return NextResponse.json(summary, { status: 200 });
  } catch (error: unknown) {
    logError('archival-cron', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
