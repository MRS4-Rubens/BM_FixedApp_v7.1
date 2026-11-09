/**
 * Business logo retrieval endpoint (PERF-003, SEC-005, COMP-001).
 * Versioned ?k= URLs are immutable because every upload gets a new random key.
 * The legacy unversioned URL redirects without caching to the current versioned key.
 * Vercel edge caches immutable assets for 1 day via Vercel-CDN-Cache-Control.
 */

import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { businesses } from '@/lib/db/schema';
import { getFileBuffer } from '@/lib/storage/idrive';
import { isLogoKeyReferenced } from '@/lib/storage/logo';
import { buildLogoUrl, logoMimeFromKey, MAX_LOGO_KEY_LENGTH } from '@/lib/storage/logo-url';
import { getClientIp } from '@/lib/rate-limit/upstash';
import { enforceRateLimit } from '@/lib/rate-limit/enforce';
import { publicAssetLimiter } from '@/lib/rate-limit/limiters';
import { logError } from '@/lib/actions/_shared/logger';
import { runWithRequestId, requestIdFromHeaders } from '@/lib/observability/request-context';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';
const CDN_CACHE = 'public, max-age=86400';
const NO_STORE = { 'Cache-Control': 'no-store' } as const;

function logoEtag(key: string): string {
  return '"' + createHash('sha256').update(key).digest('hex').slice(0, 32) + '"';
}

function stripWeak(tag: string): string {
  const trimmed = tag.trim();
  return trimmed.startsWith('W/') ? trimmed.slice(2).trim() : trimmed;
}

function ifNoneMatchHits(header: string | null, etag: string): boolean {
  if (!header || !header.trim()) {
    return false;
  }
  const trimmedHeader = header.trim();
  if (trimmedHeader === '*') {
    return true;
  }
  const cleanEtag = stripWeak(etag);
  return trimmedHeader
    .split(',')
    .map(stripWeak)
    .some((t) => t === cleanEtag);
}

async function handleLogoGet(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    if (!id || !UUID_REGEX.test(id)) {
      return new NextResponse('Invalid Business ID', { status: 400, headers: NO_STORE });
    }

    const k = request.nextUrl.searchParams.get('k');
    if (k !== null && (k.length === 0 || k.length > MAX_LOGO_KEY_LENGTH)) {
      return new NextResponse('Invalid logo key', {
        status: 400,
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    const ip = getClientIp(request.headers);
    if (ip !== 'unknown') {
      const outcome = await enforceRateLimit({
        limiter: publicAssetLimiter,
        identifier: `logo:${ip}`,
        policy: 'fail-open',
        scope: 'logo-route',
      });
      if (!outcome.allowed) {
        return new NextResponse(
          outcome.reason === 'limited' ? 'Too Many Requests' : 'Service Unavailable',
          {
            status: outcome.reason === 'limited' ? 429 : 503,
            headers: {
              'Retry-After': String(outcome.retryAfterSeconds),
              'Cache-Control': 'no-store',
            },
          },
        );
      }
    }

    const businessRows = await db
      .select({ logo_storage_key: businesses.logo_storage_key })
      .from(businesses)
      .where(eq(businesses.id, id))
      .limit(1);

    if (businessRows.length === 0) {
      return new NextResponse('Business not found', { status: 404, headers: NO_STORE });
    }

    const currentKey = businessRows[0].logo_storage_key;

    if (k === null) {
      if (!currentKey) {
        return new NextResponse('Logo not found', {
          status: 404,
          headers: { 'Cache-Control': 'no-store' },
        });
      }
      const redirectUrl = new URL(buildLogoUrl(id, currentKey), request.nextUrl.origin);
      const redirectResponse = NextResponse.redirect(redirectUrl, 307);
      redirectResponse.headers.set('Cache-Control', 'no-store');
      return redirectResponse;
    }

    const isAuthorized = k === currentKey || (await isLogoKeyReferenced(db, id, k));
    if (!isAuthorized) {
      return new NextResponse('Logo not found', {
        status: 404,
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    const contentType = logoMimeFromKey(k);
    if (!contentType) {
      return new NextResponse('Logo not found', {
        status: 404,
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    const etag = logoEtag(k);
    const sharedHeaders: Record<string, string> = {
      'Cache-Control': IMMUTABLE_CACHE,
      'Vercel-CDN-Cache-Control': CDN_CACHE,
      ETag: etag,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    };

    if (ifNoneMatchHits(request.headers.get('if-none-match'), etag)) {
      return new NextResponse(null, { status: 304, headers: sharedHeaders });
    }

    const buffer = await getFileBuffer(k);
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        ...sharedHeaders,
        'Content-Type': contentType,
        'Content-Length': String(buffer.byteLength),
      },
    });
  } catch (error: unknown) {
    logError('logo-route', error);
    return new NextResponse('Failed to load logo', { status: 500, headers: NO_STORE });
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const requestId = requestIdFromHeaders(request.headers);
  // Logs inside carry the request id, but the response does not: logo responses are cached publicly for a year
  // (IMMUTABLE_CACHE), and a per-request header would be frozen into every cached copy.
  return runWithRequestId(requestId, () => handleLogoGet(request, context));
}
