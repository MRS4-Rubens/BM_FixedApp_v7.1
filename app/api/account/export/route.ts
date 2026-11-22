import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { getRequestSession } from '@/lib/auth/request-session';
import { db } from '@/lib/db/client';
import { users, businesses } from '@/lib/db/schema';
import { exportLimiter } from '@/lib/rate-limit/upstash';
import { enforceRateLimit } from '@/lib/rate-limit/enforce';
import { jsonError, rateLimitedResponse } from '@/lib/http/route-errors';
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
    return jsonError(401, 'Unauthorized', 'UNAUTHORIZED');
  }

  // 2. Resolve app user
  const userRows = await db
    .select()
    .from(users)
    .where(eq(users.auth_user_id, sessionResponse.data.user.id))
    .limit(1);

  if (userRows.length === 0) {
    return jsonError(401, 'Unauthorized', 'UNAUTHORIZED');
  }
  const appUser = userRows[0];

  // 3. Resolve business
  if (!appUser.business_id) {
    return jsonError(400, 'No business profile linked to user.', 'NO_BUSINESS_LINKED');
  }

  const bizRows = await db
    .select({ id: businesses.id })
    .from(businesses)
    .where(eq(businesses.id, appUser.business_id))
    .limit(1);

  if (bizRows.length === 0) {
    return jsonError(404, 'Business profile not found.', 'BUSINESS_NOT_FOUND');
  }

  // 4. Role gate: only the owner can download full account data
  if (appUser.role !== 'owner') {
    return jsonError(403, 'Only the business owner can download the account data.', 'FORBIDDEN');
  }

  // 5. Rate limit (API-01: fail closed with 503 when the limiter is unreachable, instead of a generic 500)
  const limit = await enforceRateLimit({
    limiter: exportLimiter,
    identifier: `account-export:${appUser.id}`,
    policy: 'fail-closed',
    scope: 'account-export',
  });
  if (!limit.allowed) return rateLimitedResponse(limit);

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
      const res = jsonError(500, 'Internal Server Error', 'INTERNAL_ERROR');
      res.headers.set('x-request-id', requestId);
      return res;
    }
  });
}

