import { NextResponse } from 'next/server';
import { getDatabaseHealth } from '@/lib/observability/health';

// LAUNCH-L2: database check for the uptime monitor (every 6 h, so Neon Free can sleep in between).
// Returns 200 { status: 'ok' } or 503 { status: 'error' }; never exposes hostnames, errors or credentials.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const health = await getDatabaseHealth();
  return NextResponse.json(
    { status: health.status },
    { status: health.statusCode, headers: { 'Cache-Control': 'no-store' } },
  );
}
