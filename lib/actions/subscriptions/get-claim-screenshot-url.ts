'use server';

import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { ActionError } from '@/lib/actions/_shared/errors';
import { logError } from '@/lib/actions/_shared/logger';
import { db } from '@/lib/db/client';
import { subscriptionRequests } from '@/lib/db/schema';
import { sensitiveActionLimiter } from '@/lib/rate-limit/upstash';
import { getSignedDownloadUrl } from '@/lib/storage/idrive';

const CLAIM_SCREENSHOT_URL_TTL_SECONDS = 300;
const SCREENSHOT_PREFIX = 'payment-screenshots/';

const inputSchema = z.object({ requestId: z.string().uuid('Invalid request id') });

export interface ClaimScreenshotUrl {
  readonly url: string;
  readonly expiresInSeconds: number;
}

export const getClaimScreenshotUrl = createAuthenticatedAction(
  inputSchema,
  async (input): Promise<ClaimScreenshotUrl> => {
    const [row] = await db
      .select({ businessId: subscriptionRequests.business_id, key: subscriptionRequests.screenshot_storage_key })
      .from(subscriptionRequests)
      .where(eq(subscriptionRequests.id, input.requestId))
      .limit(1);

    if (!row) throw new ActionError('Payment proof not found.', { code: 'NOT_FOUND' });
    if (row.key === null || row.key === '') throw new ActionError('No payment proof was uploaded for this request.', { code: 'NO_SCREENSHOT' });

    // Defence in depth: only ever sign objects under this request's own business folder.
    if (!row.key.startsWith(`${SCREENSHOT_PREFIX}${row.businessId}/`)) {
      logError('get-claim-screenshot-url', new Error('Screenshot key outside expected prefix'), { requestId: input.requestId });
      throw new ActionError('Payment proof not found.', { code: 'NOT_FOUND' });
    }

    const url = await getSignedDownloadUrl(row.key, CLAIM_SCREENSHOT_URL_TTL_SECONDS, { forceDownload: true });
    return { url, expiresInSeconds: CLAIM_SCREENSHOT_URL_TTL_SECONDS };
  },
  'get-claim-screenshot-url',
  { requirePlatformAdmin: true, rateLimit: { limiter: sensitiveActionLimiter, keyPrefix: 'claim-screenshot', outage: 'fail-closed' } },
);

