import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getRequestSession } from '@/lib/auth/request-session';
import { db } from '@/lib/db/client';
import { users, businesses } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { exportLimiter } from '@/lib/rate-limit/upstash';
import { enforceRateLimit } from '@/lib/rate-limit/enforce';
import { actionErrorResponse, jsonError, rateLimitedResponse } from '@/lib/http/route-errors';
import { getExportData } from '@/lib/actions/reports/get-export-data';
import { writeSalesRegisterWorkbook } from '@/lib/excel/build-sales-register';
import { getItrExportData } from '@/lib/actions/reports/get-itr-data';
import { writeItrReportWorkbook } from '@/lib/excel/build-itr-report';
import { getGstr1ExportData } from '@/lib/actions/reports/get-gstr1-data';
import { writeGstr1Workbook } from '@/lib/excel/build-gstr1-report';
import { writeHsnWorkbook } from '@/lib/excel/build-hsn-report';
import { canExportStatutoryReport, checkAccountNotSuspended } from '@/lib/subscriptions/entitlements';
import { PLAN_SOURCE_COLUMNS } from '@/lib/subscriptions/load';
import { exportQuerySchema } from '@/lib/validations/export';
import { xlsxStreamResponse } from '@/lib/excel/xlsx-response';
import { logError } from '@/lib/actions/_shared/logger';
import { runWithRequestId, requestIdFromHeaders } from '@/lib/observability/request-context';

export const maxDuration = 60;
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// API-01: every error is JSON { error, code } (lib/http/route-errors.ts); successful downloads are unchanged.

async function handleExport(request: NextRequest): Promise<Response> {
  // 1. Session Check (return 401 if unauthorized, no redirect)
  const sessionResponse = await getRequestSession();
  if (!sessionResponse || !sessionResponse.data || !sessionResponse.data.user) {
    return jsonError(401, 'Please sign in again.', 'UNAUTHORIZED');
  }

  // Resolve the app user manually since requireSession redirects
  const userRows = await db.select().from(users).where(eq(users.auth_user_id, sessionResponse.data.user.id));
  if (userRows.length === 0) {
    return jsonError(401, 'Please sign in again.', 'UNAUTHORIZED');
  }
  const appUser = userRows[0];

  if (!appUser.business_id) {
    return jsonError(400, 'Set up your business profile first.', 'NO_BUSINESS_LINKED');
  }

  // 2. Entitlement check for statutory Excel reports
  const bizResult = await db
    .select({
      ...PLAN_SOURCE_COLUMNS,
    })
    .from(businesses)
    .where(eq(businesses.id, appUser.business_id))
    .limit(1);

  if (bizResult.length === 0) {
    return jsonError(404, 'Business profile not found.', 'BUSINESS_NOT_FOUND');
  }

  const suspended = checkAccountNotSuspended(bizResult[0]);
  if (!suspended.allowed) {
    return jsonError(403, suspended.reason ?? 'This account is suspended. Please contact support.', suspended.code ?? 'ACCOUNT_SUSPENDED');
  }

  const exportCheck = canExportStatutoryReport(bizResult[0]);
  if (!exportCheck.allowed) {
    return jsonError(403, exportCheck.reason ?? 'Your plan does not include statutory exports.', exportCheck.code ?? 'PLAN_LIMIT');
  }

  // Fail closed: an export is heavy work on a 512 MB instance, so it waits when the limiter is unreachable (503).
  const limit = await enforceRateLimit({
    limiter: exportLimiter,
    identifier: `export:${appUser.id}`,
    policy: 'fail-closed',
    scope: 'reports-export',
  });
  if (!limit.allowed) return rateLimitedResponse(limit);

  // 2. Parse search params
  const { searchParams } = new URL(request.url);
  const parsed = exportQuerySchema.safeParse({
    startDate: searchParams.get('startDate'),
    endDate: searchParams.get('endDate'),
    label: searchParams.get('label'),
    type: searchParams.get('type') ?? undefined,
  });

  if (!parsed.success) {
    const flattened = z.flattenError(parsed.error);
    return new Response(
      JSON.stringify({ error: 'Invalid export parameters', code: 'VALIDATION_ERROR', fieldErrors: flattened.fieldErrors }),
      { status: 400, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
    );
  }

  const { startDate, endDate, label, type } = parsed.data;
  const sanitizedLabel = label.replace(/[\/\s]/g, '-');

  // 3. Dispatch based on report type
  if (type === 'gstr1') {
    const gstr1DataRes = await getGstr1ExportData({ startDate, endDate, label });
    if (!gstr1DataRes.success) {
      return actionErrorResponse(gstr1DataRes.error);
    }

    const gstr1Data = gstr1DataRes.data;
    return xlsxStreamResponse((stream) => writeGstr1Workbook(gstr1Data, stream), `GSTR1-${sanitizedLabel}.xlsx`);
  }

  if (type === 'itr_report') {
    const itrDataRes = await getItrExportData({ startDate, endDate, label });
    if (!itrDataRes.success) {
      return actionErrorResponse(itrDataRes.error);
    }

    const itrData = itrDataRes.data;
    return xlsxStreamResponse((stream) => writeItrReportWorkbook(itrData, stream), `ITR-Report-${sanitizedLabel}.xlsx`);
  }

  if (type === 'hsn_summary') {
    const gstr1DataRes = await getGstr1ExportData({ startDate, endDate, label });
    if (!gstr1DataRes.success) {
      return actionErrorResponse(gstr1DataRes.error);
    }

    const hsnData = gstr1DataRes.data;
    return xlsxStreamResponse((stream) => writeHsnWorkbook(hsnData, stream), `HSN-Summary-${sanitizedLabel}.xlsx`);
  }

  // Default / Legacy fallback: Sales Register
  const exportDataRes = await getExportData({ startDate, endDate, label });
  if (!exportDataRes.success) {
    return actionErrorResponse(exportDataRes.error);
  }

  const exportData = exportDataRes.data;
  return xlsxStreamResponse((stream) => writeSalesRegisterWorkbook(exportData, stream), `Sales-Register-${sanitizedLabel}.xlsx`);
}

export async function GET(request: NextRequest): Promise<Response> {
  const requestId = requestIdFromHeaders(request.headers);
  return runWithRequestId(requestId, async () => {
    try {
      const response = await handleExport(request);
      response.headers.set('x-request-id', requestId);
      return response;
    } catch (error) {
      logError('reports-export', error);
      const res = jsonError(500, 'Could not prepare the download. Please try again.', 'INTERNAL_ERROR');
      res.headers.set('x-request-id', requestId);
      return res;
    }
  });
}
