'use server';

import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { listBusinessesWithCounts } from '@/lib/subscriptions/business-directory';
import { z } from 'zod';

export const getAllBusinesses = createAuthenticatedAction(
  z.object({}),
  // Businesses with invoice/user counts (grouped joins; see lib/subscriptions/business-directory.ts, PERF-002).
  async () => listBusinessesWithCounts(),
  'get-all-businesses',
  { requirePlatformAdmin: true }
);
