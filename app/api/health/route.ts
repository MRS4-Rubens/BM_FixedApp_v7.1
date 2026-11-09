import { NextRequest, NextResponse } from 'next/server';
import { getHealthStatus } from '@/lib/observability/health';
import { runWithRequestId, requestIdFromHeaders } from '@/lib/observability/request-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestId = requestIdFromHeaders(request.headers);
  return runWithRequestId(requestId, async () => {
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

