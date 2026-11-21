import { NextRequest, NextResponse } from 'next/server';
import { verifyCronRequest } from '@/lib/cron/verify-cron-request';
import { runCronInBackground } from '@/lib/cron/run-in-background';
import { runDailyNotifications } from '@/lib/notifications/daily';
import { touchRedisKeepalive } from '@/lib/cron/redis-keepalive';
import { runWithRequestId, requestIdFromHeaders } from '@/lib/observability/request-context';

// Feature C: the once-a-day notifications job (09:00 IST), triggered by cron-job.org (lib/cron/schedules.ts).
// Replies 202 at once and runs in the background. LAUNCH-L2: no Sentry cron monitor here (the free plan has one,
// used by the archival job); failures are still logged to Sentry and cron-job.org e-mails when a call fails.
export const maxDuration = 300;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function handleCron(request: NextRequest, requestId: string): NextResponse {
  const denied = verifyCronRequest(request, 'notifications-cron');
  if (denied) return denied;

  return runCronInBackground('notifications-cron', requestId, async () => {
    // B6: one tiny Redis write a day so Upstash never sees a week without requests (never throws).
    await touchRedisKeepalive();
    return runDailyNotifications();
  });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestId = requestIdFromHeaders(request.headers);
  return runWithRequestId(requestId, async () => {
    const response = handleCron(request, requestId);
    response.headers.set('x-request-id', requestId);
    return response;
  });
}
