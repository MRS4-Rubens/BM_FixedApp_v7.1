import { Redis } from '@upstash/redis';
import { Ratelimit } from '@upstash/ratelimit';
import { getRateLimitEnv } from '@/lib/env';

let redisInstance: Redis | undefined;

/** Lazily constructed shared Redis client. Throws EnvConfigError if Upstash variables are invalid. */
export function getRedis(): Redis {
  if (redisInstance === undefined) {
    const env = getRateLimitEnv();
    redisInstance = new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });
  }
  return redisInstance;
}

/** Structural subset of Ratelimit used across the app; lets limiters be lazy facades. */
export type RateLimiter = Pick<Ratelimit, 'limit'>;

function lazyLimiter(create: () => Ratelimit): RateLimiter {
  let instance: Ratelimit | undefined;
  return {
    limit: (...args: Parameters<Ratelimit['limit']>) => {
      instance ??= create();
      return instance.limit(...args);
    },
  };
}

/**
 * All three limiters share one Redis instance but use independent prefixes/windows — 
 * tune the numeric limits here centrally if they prove too strict or too loose in real use; 
 * nothing else needs to change.
 */

// authLimiter: 5 requests per 60 seconds (for login/signup attempts)
export const authLimiter: RateLimiter = lazyLimiter(
  () => new Ratelimit({ redis: getRedis(), limiter: Ratelimit.slidingWindow(5, '60 s'), prefix: '@upstash/ratelimit:auth' }),
);

// sensitiveActionLimiter: 20 requests per 60 seconds (for finalizing invoices, sending emails, recording payments)
export const sensitiveActionLimiter: RateLimiter = lazyLimiter(
  () => new Ratelimit({ redis: getRedis(), limiter: Ratelimit.slidingWindow(20, '60 s'), prefix: '@upstash/ratelimit:sensitive' }),
);

// exportLimiter: 10 requests per 300 seconds (for Excel export and the archival-render route — heavier operations)
export const exportLimiter: RateLimiter = lazyLimiter(
  () => new Ratelimit({ redis: getRedis(), limiter: Ratelimit.slidingWindow(10, '300 s'), prefix: '@upstash/ratelimit:export' }),
);

/**
 * Helper to check rate limit and return retry-after in seconds
 */
export async function checkRateLimit(limiter: RateLimiter, identifier: string): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const { success, reset } = await limiter.limit(identifier);
  
  // Calculate how many seconds until the window resets
  const now = Date.now();
  const retryAfterSeconds = Math.max(1, Math.ceil((reset - now) / 1000));
  
  return {
    allowed: success,
    retryAfterSeconds,
  };
}

/**
 * Extracts the real client IP from the 'x-forwarded-for' header.
 * Falls back to 'unknown' if absent, never throws.
 */
export function getClientIp(headersList: Headers): string {
  const forwardedFor = headersList.get('x-forwarded-for');
  if (forwardedFor) {
    // Vercel appends proxy IPs after the real one, so we take the first address
    const ips = forwardedFor.split(',');
    return ips[0].trim();
  }
  return 'unknown';
}
