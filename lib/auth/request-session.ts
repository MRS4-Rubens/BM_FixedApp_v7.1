import { cache } from 'react';
import { auth } from '@/lib/auth/server';

export type GetSessionResult = Awaited<ReturnType<typeof auth.getSession>>;

/**
 * PERF-004: the ONE place that calls auth.getSession().
 * React cache() makes this request-scoped inside a Server Component render pass (layout + page share one lookup).
 * In Server Actions and Route Handlers cache() is a pass-through (Next.js docs), so they always read fresh.
 * Rule: never mutate the user or business during a render; mutations belong in actions/route handlers.
 */
export const getRequestSession = cache(async (): Promise<GetSessionResult> => auth.getSession());

