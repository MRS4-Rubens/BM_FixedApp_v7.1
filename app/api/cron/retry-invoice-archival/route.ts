import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { verifyCronRequest } from '@/lib/cron/verify-cron-request';
import { runCronInBackground } from '@/lib/cron/run-in-background';
import { runArchivalSweep } from '@/lib/storage/archival-sweep';
import {
  ARCHIVAL_CRON_MONITOR_SLUG,
  ARCHIVAL_CRON_MONITOR_CONFIG,
} from '@/lib/storage/archival-monitor';
import { runWithRequestId, requestIdFromHeaders } from '@/lib/observability/request-context';

// Triggered daily by cron-job.org (lib/cron/schedules.ts). Replies 202 at once; the sweep runs in the background
// inside the Sentry cron monitor, so a failed or missed run still alerts.
export const maxDuration = 300;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function handleCron(request: NextRequest, requestId: string): NextResponse {
  // Fail-closed if CRON_SECRET is unset/weak; constant-time comparison.
  const denied = verifyCronRequest(request, 'archival-cron');
  if (denied) return denied;

  return runCronInBackground('archival-cron', requestId, () =>
    Sentry.withMonitor(ARCHIVAL_CRON_MONITOR_SLUG, () => runArchivalSweep(), ARCHIVAL_CRON_MONITOR_CONFIG),
  );
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestId = requestIdFromHeaders(request.headers);
  return runWithRequestId(requestId, async () => {
    const response = handleCron(request, requestId);
    response.headers.set('x-request-id', requestId);
    return response;
  });
}
