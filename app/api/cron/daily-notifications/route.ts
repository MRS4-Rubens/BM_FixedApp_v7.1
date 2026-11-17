import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { logError } from '@/lib/actions/_shared/logger';
import { verifyCronRequest } from '@/lib/cron/verify-cron-request';
import { runDailyNotifications } from '@/lib/notifications/daily';
import {
  NOTIFICATIONS_CRON_MONITOR_CONFIG,
  NOTIFICATIONS_CRON_MONITOR_SLUG,
} from '@/lib/notifications/monitor';
import { runWithRequestId, requestIdFromHeaders } from '@/lib/observability/request-context';

// Feature C: the once-a-day notifications job (09:00 IST). Vercel plan limits apply — verify at launch.
export const maxDuration = 300;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function handleCron(request: NextRequest): Promise<NextResponse> {
  const denied = verifyCronRequest(request, 'notifications-cron');
  if (denied) return denied;

  try {
    const summary = await Sentry.withMonitor(
      NOTIFICATIONS_CRON_MONITOR_SLUG,
      () => runDailyNotifications(),
      NOTIFICATIONS_CRON_MONITOR_CONFIG,
    );
    return NextResponse.json(summary, { status: 200 });
  } catch (error: unknown) {
    logError('notifications-cron', error);
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
