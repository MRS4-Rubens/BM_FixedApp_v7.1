import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { logError } from '@/lib/actions/_shared/logger';
import { verifyCronRequest } from '@/lib/cron/verify-cron-request';
import { runArchivalSweep } from '@/lib/storage/archival-sweep';
import {
  ARCHIVAL_CRON_MONITOR_SLUG,
  ARCHIVAL_CRON_MONITOR_CONFIG,
} from '@/lib/storage/archival-monitor';
import { runWithRequestId, requestIdFromHeaders } from '@/lib/observability/request-context';

// Vercel plan limits apply — verify
export const maxDuration = 300;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function handleCron(request: NextRequest): Promise<NextResponse> {
  // 1. Verify Vercel Cron Secret (fail-closed if unset/weak + constant-time check)
  const denied = verifyCronRequest(request, 'archival-cron');
  if (denied) return denied;

  try {
    const summary = await Sentry.withMonitor(
      ARCHIVAL_CRON_MONITOR_SLUG,
      () => runArchivalSweep(),
      ARCHIVAL_CRON_MONITOR_CONFIG,
    );
    return NextResponse.json(summary, { status: 200 });
  } catch (error: unknown) {
    logError('archival-cron', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestId = requestIdFromHeaders(request.headers);
  return runWithRequestId(requestId, async () => {
    const response = await handleCron(request);
    response.headers.set('x-request-id', requestId);
    return response;
  });
}
