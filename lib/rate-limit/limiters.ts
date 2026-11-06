import { Ratelimit } from '@upstash/ratelimit';
import { getRedis } from '@/lib/rate-limit/upstash';
import { lazyLimiter, type RateLimiter } from '@/lib/rate-limit/lazy-limiter';

export const DEFAULT_ACTION_LIMIT = 120;
export const DEFAULT_ACTION_WINDOW = '60 s';
export const PUBLIC_ASSET_LIMIT = 300;
export const PUBLIC_ASSET_WINDOW = '60 s';
const LIMITER_TIMEOUT_MS = 2000;

/** Generous per-user, per-action ceiling applied by createAuthenticatedAction when an action has no explicit limiter. */
export const defaultActionLimiter: RateLimiter = lazyLimiter(
  () =>
    new Ratelimit({
      redis: getRedis(),
      limiter: Ratelimit.slidingWindow(DEFAULT_ACTION_LIMIT, DEFAULT_ACTION_WINDOW),
      prefix: '@upstash/ratelimit:action-default',
      timeout: LIMITER_TIMEOUT_MS,
      ephemeralCache: new Map<string, number>(),
    }),
);

/** Per-IP ceiling for unauthenticated, cheap public GET endpoints (logo image). */
export const publicAssetLimiter: RateLimiter = lazyLimiter(
  () =>
    new Ratelimit({
      redis: getRedis(),
      limiter: Ratelimit.slidingWindow(PUBLIC_ASSET_LIMIT, PUBLIC_ASSET_WINDOW),
      prefix: '@upstash/ratelimit:public-asset',
      timeout: LIMITER_TIMEOUT_MS,
      ephemeralCache: new Map<string, number>(),
    }),
);

