import { NextResponse } from 'next/server';

// LAUNCH-L2: liveness check for the uptime monitor (every 5 min). It keeps the Render Free service awake and
// tells us the web server answers. It touches NO database and NO Redis, so frequent pings cost nothing there.
export const dynamic = 'force-dynamic';

export function GET(): NextResponse {
  return NextResponse.json({ status: 'ok' }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
}
