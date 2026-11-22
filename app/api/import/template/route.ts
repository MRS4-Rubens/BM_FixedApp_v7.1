import { eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { getRequestSession } from '@/lib/auth/request-session';
import { db } from '@/lib/db/client';
import { users } from '@/lib/db/schema';
import { IMPORT_KINDS } from '@/lib/import/columns';
import { loadTaxRateIdsByPercent } from '@/lib/import/prepare';
import { buildImportTemplate } from '@/lib/import/template';
import { isOneOf } from '@/lib/db/domain-values';
import { logError } from '@/lib/actions/_shared/logger';
import { jsonError } from '@/lib/http/route-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Feature D: GET /api/import/template?kind=customers|products downloads the Excel import template.
 * The template holds no business data (only column help, units, GST rates and state codes), but it is still
 * limited to signed-in members of a business. Returns 401 instead of redirecting (it is a file download).
 */
export async function GET(request: NextRequest): Promise<Response> {
  const kind = request.nextUrl.searchParams.get('kind');
  if (!isOneOf(IMPORT_KINDS, kind)) {
    return jsonError(400, 'Unknown template. Use ?kind=customers or ?kind=products.', 'VALIDATION_ERROR');
  }

  // API-01: the session and user lookups are inside the try, so a database blip is a clean JSON 500, not a crash.
  try {
    const session = await getRequestSession();
    const authUserId = session?.data?.user?.id;
    if (!authUserId) return jsonError(401, 'Please sign in again.', 'UNAUTHORIZED');
    const [appUser] = await db.select({ business_id: users.business_id }).from(users).where(eq(users.auth_user_id, authUserId)).limit(1);
    if (!appUser?.business_id) return jsonError(400, 'Set up your business profile first.', 'NO_BUSINESS_LINKED');

    const rates = kind === 'products' ? [...(await loadTaxRateIdsByPercent(db)).keys()] : [];
    rates.sort((a, b) => Number(a) - Number(b));
    const file = await buildImportTemplate(kind, rates);
    return new Response(new Uint8Array(file), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="invoice-bizfolio-${kind}-import-template.xlsx"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error: unknown) {
    logError('import-template', error, { kind });
    return jsonError(500, 'Could not build the template. Please try again.', 'INTERNAL_ERROR');
  }
}
