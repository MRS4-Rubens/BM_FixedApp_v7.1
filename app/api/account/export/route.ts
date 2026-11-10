import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { getRequestSession } from '@/lib/auth/request-session';
import { db } from '@/lib/db/client';
import { users, businesses } from '@/lib/db/schema';
import { exportLimiter, checkRateLimit } from '@/lib/rate-limit/upstash';
import { loadDataExport, DATA_EXPORT_VERSION } from '@/lib/account/data-export';
import { writeAudit, sanitizeIp, sanitizeUserAgent } from '@/lib/audit/log';
import { formatIstDateAsIso } from '@/lib/invoices/ist-date';
import { logError } from '@/lib/actions/_shared/logger';
import { runWithRequestId, requestIdFromHeaders } from '@/lib/observability/request-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handleExport(request: NextRequest): Promise<Response> {
  // 1. Session check
  const sessionResponse = await getRequestSession();
  if (!sessionResponse?.data?.user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 2. Resolve app user
  const userRows = await db
    .select()
    .from(users)
    .where(eq(users.auth_user_id, sessionResponse.data.user.id))
    .limit(1);

  if (userRows.length === 0) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const appUser = userRows[0];

  // 3. Resolve business
  if (!appUser.business_id) {
    return new Response(JSON.stringify({ error: 'No business profile linked to user.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const bizRows = await db
    .select({ id: businesses.id })
    .from(businesses)
    .where(eq(businesses.id, appUser.business_id))
    .limit(1);

  if (bizRows.length === 0) {
    return new Response(JSON.stringify({ error: 'Business profile not found.' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 4. Role gate: only the owner can download full account data
  if (appUser.role !== 'owner') {
    return new Response(
      JSON.stringify({ error: 'Only the business owner can download the account data.' }),
      {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }

  // 5. Rate limit
  const { allowed, retryAfterSeconds } = await checkRateLimit(
    exportLimiter,
    `account-export:${appUser.id}`,
  );
  if (!allowed) {
    return new Response(
      JSON.stringify({ error: `Too Many Requests. Retry after ${retryAfterSeconds} seconds.` }),
      {
        status: 429,
        headers: {
          'Retry-After': retryAfterSeconds.toString(),
          'Content-Type': 'application/json',
        },
      },
    );
  }

  // 6. Load data export
  const exportData = await loadDataExport(db, appUser.business_id);

  // 7. Write audit record in ONE transaction
  await db.transaction(async (tx) => {
    await writeAudit(tx, {
      businessId: appUser.business_id!,
      actorUserId: appUser.id,
      entityType: 'business',
      entityId: appUser.business_id!,
      action: 'data_export',
      metadata: { version: DATA_EXPORT_VERSION },
      requestContext: {
        ip: sanitizeIp(request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip')),
        userAgent: sanitizeUserAgent(request.headers.get('user-agent')),
      },
    });
  });

  // 8. Respond with JSON attachment (pretty-printed 2 spaces)
  const istDateStr = formatIstDateAsIso(new Date());
  const filename = `bill-matrix-data-${istDateStr}.json`;
  const jsonBody = JSON.stringify(exportData, null, 2);

  return new Response(jsonBody, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}

export async function GET(request: NextRequest): Promise<Response> {
  const requestId = requestIdFromHeaders(request.headers);
  return runWithRequestId(requestId, async () => {
    try {
      const response = await handleExport(request);
      response.headers.set('x-request-id', requestId);
      return response;
    } catch (error) {
      logError('account-data-export', error);
      const res = new Response(JSON.stringify({ error: 'Internal Server Error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
      res.headers.set('x-request-id', requestId);
      return res;
    }
  });
}

