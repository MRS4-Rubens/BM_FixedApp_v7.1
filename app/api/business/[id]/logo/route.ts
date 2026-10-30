import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { businesses } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getFileBuffer } from '@/lib/storage/idrive';
import { isLogoKeyReferenced } from '@/lib/storage/logo';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function resolveLogoContentType(key: string): string | null {
  const lowerKey = key.toLowerCase();
  if (lowerKey.endsWith('.png')) {
    return 'image/png';
  }
  if (lowerKey.endsWith('.jpg') || lowerKey.endsWith('.jpeg')) {
    return 'image/jpeg';
  }
  if (lowerKey.endsWith('.webp')) {
    return 'image/webp';
  }
  return null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    if (!id || !UUID_REGEX.test(id)) {
      return new NextResponse('Invalid Business ID', { status: 400 });
    }

    const businessRows = await db
      .select({ logo_storage_key: businesses.logo_storage_key })
      .from(businesses)
      .where(eq(businesses.id, id))
      .limit(1);

    if (businessRows.length === 0) {
      return new NextResponse('Business not found', { status: 404 });
    }

    const currentKey = businessRows[0].logo_storage_key;
    const k = request.nextUrl.searchParams.get('k');

    let storageKey: string | null = null;
    let isImmutable = false;

    if (!k) {
      storageKey = currentKey;
    } else if (k === currentKey) {
      storageKey = k;
      isImmutable = true;
    } else {
      const referenced = await isLogoKeyReferenced(db, id, k);
      if (!referenced) {
        return new NextResponse('Logo not found', { status: 404 });
      }
      storageKey = k;
      isImmutable = true;
    }

    if (!storageKey) {
      return new NextResponse('Logo not found', { status: 404 });
    }

    const contentType = resolveLogoContentType(storageKey);
    if (!contentType) {
      return new NextResponse('Logo not found', { status: 404 });
    }

    const buffer = await getFileBuffer(storageKey);
    const cacheControl = isImmutable
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=3600, stale-while-revalidate=86400';

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': cacheControl,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    });
  } catch (error: unknown) {
    console.error('Error fetching logo:', error);
    return new NextResponse('Failed to load logo', { status: 500 });
  }
}
