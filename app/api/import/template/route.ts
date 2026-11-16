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

/**
 * Feature D: GET /api/import/template?kind=customers|products downloads the Excel import template.
 * The template holds no business data (only column help, units, GST rates and state codes), but it is still
 * limited to signed-in members of a business. Returns 401 instead of redirecting (it is a file download).
 */
export async function GET(request: NextRequest): Promise<Response> {
  const kind = request.nextUrl.searchParams.get('kind');
  if (!isOneOf(IMPORT_KINDS, kind)) {
    return new Response('Unknown template. Use ?kind=customers or ?kind=products.', { status: 400 });
  }

  const session = await getRequestSession();
  const authUserId = session?.data?.user?.id;
  if (!authUserId) return new Response('Unauthorized', { status: 401 });
  const [appUser] = await db.select({ business_id: users.business_id }).from(users).where(eq(users.auth_user_id, authUserId)).limit(1);
  if (!appUser?.business_id) return new Response('Set up your business profile first.', { status: 400 });

  try {
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
    return new Response('Could not build the template. Please try again.', { status: 500 });
  }
}
