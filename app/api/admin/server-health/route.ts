import { NextResponse } from 'next/server';
import { isPlatformAdmin } from '@/lib/auth/admin';
import { readServerHealth } from '@/lib/admin/server-health';

// B1: admin-only live memory reading of this server process. No database access.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  if (!(await isPlatformAdmin())) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json(readServerHealth(), { headers: { 'cache-control': 'no-store' } });
}
