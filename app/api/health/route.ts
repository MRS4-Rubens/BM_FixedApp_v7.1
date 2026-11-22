import { NextRequest, NextResponse } from 'next/server';
import { getHealthStatus } from '@/lib/observability/health';
import { verifyCronRequest } from '@/lib/cron/verify-cron-request';
import { runWithRequestId, requestIdFromHeaders } from '@/lib/observability/request-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// SVC-05: database + Redis check for manual use only (no monitor polls it). It is PRIVATE: it needs the cron secret
// (`Authorization: Bearer <CRON_SECRET>`), because each call wakes the Neon compute and uses an Upstash command, and a
// public URL polled every minute would keep Neon awake all month. Uptime monitors use /ping and /health-db.

export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestId = requestIdFromHeaders(request.headers);
  return runWithRequestId(requestId, async () => {
    const denied = verifyCronRequest(request, 'health-check');
    if (denied) {
      denied.headers.set('Cache-Control', 'no-store');
      denied.headers.set('x-request-id', requestId);
      return denied;
    }
    const health = await getHealthStatus();
    return NextResponse.json(
      {
        status: health.status,
        checks: {
          database: health.checks.database,
          redis: health.checks.redis,
        },
      },
      {
        status: health.statusCode,
        headers: {
          'Cache-Control': 'no-store',
          'x-request-id': requestId,
        },
      },
    );
  });
}

