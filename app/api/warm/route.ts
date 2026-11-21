import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { decideWarm, initialWarmState, type WarmState } from '@/lib/db/warmup-policy';

// B2: called from the login screen so Neon is awake by the time the user signs in. Capped (see warmup-policy.ts).
// Always answers 204 with no body, whether or not it pinged, so it reveals nothing.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

let state: WarmState = initialWarmState;

export async function POST(): Promise<NextResponse> {
  const decision = decideWarm(state, Date.now());
  state = decision.next;
  if (decision.warm) {
    // Fire and forget: the user never waits for this, and a failure just means the next real query wakes Neon.
    void db.execute(sql`select 1`).catch(() => undefined);
  }
  return new NextResponse(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}
