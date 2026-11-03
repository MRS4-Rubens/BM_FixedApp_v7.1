import { Redis } from '@upstash/redis';
import { Ratelimit } from '@upstash/ratelimit';
import { getRateLimitEnv } from '@/lib/env';
import {
  EMAIL_BURST_LIMIT,
  EMAIL_BURST_WINDOW,
  EMAIL_DAILY_CAP_PER_BUSINESS,
  EMAIL_DAILY_WINDOW,
} from '@/lib/email/send-policy';

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
 * Centrally tunable auth rate-limiting parameters.
 */
export const LOGIN_IP_LIMIT = 30;
export const LOGIN_IP_WINDOW = '15 m';
export const LOGIN_EMAIL_LIMIT = 10;
export const LOGIN_EMAIL_WINDOW = '15 m';
export const SIGNUP_IP_LIMIT = 3;
export const SIGNUP_IP_WINDOW = '1 h';
export const RECOVERY_IP_LIMIT = 10;
export const RECOVERY_IP_WINDOW = '15 m';
export const RECOVERY_EMAIL_LIMIT = 3;
export const RECOVERY_EMAIL_WINDOW = '15 m';

// AUTH-002: Dedicated limiters for auth boundaries and server actions
export const loginIpLimiter: RateLimiter = lazyLimiter(
  () => new Ratelimit({ redis: getRedis(), limiter: Ratelimit.slidingWindow(LOGIN_IP_LIMIT, LOGIN_IP_WINDOW), prefix: '@upstash/ratelimit:auth-login-ip' }),
);

export const loginEmailLimiter: RateLimiter = lazyLimiter(
  () => new Ratelimit({ redis: getRedis(), limiter: Ratelimit.slidingWindow(LOGIN_EMAIL_LIMIT, LOGIN_EMAIL_WINDOW), prefix: '@upstash/ratelimit:auth-login-email' }),
);

export const signupIpLimiter: RateLimiter = lazyLimiter(
  () => new Ratelimit({ redis: getRedis(), limiter: Ratelimit.slidingWindow(SIGNUP_IP_LIMIT, SIGNUP_IP_WINDOW), prefix: '@upstash/ratelimit:auth-signup-ip' }),
);

export const recoveryIpLimiter: RateLimiter = lazyLimiter(
  () => new Ratelimit({ redis: getRedis(), limiter: Ratelimit.slidingWindow(RECOVERY_IP_LIMIT, RECOVERY_IP_WINDOW), prefix: '@upstash/ratelimit:auth-recovery-ip' }),
);

export const recoveryEmailLimiter: RateLimiter = lazyLimiter(
  () => new Ratelimit({ redis: getRedis(), limiter: Ratelimit.slidingWindow(RECOVERY_EMAIL_LIMIT, RECOVERY_EMAIL_WINDOW), prefix: '@upstash/ratelimit:auth-recovery-email' }),
);

// sensitiveActionLimiter: 20 requests per 60 seconds (for finalizing invoices, sending emails, recording payments)
export const sensitiveActionLimiter: RateLimiter = lazyLimiter(
  () => new Ratelimit({ redis: getRedis(), limiter: Ratelimit.slidingWindow(20, '60 s'), prefix: '@upstash/ratelimit:sensitive' }),
);

// exportLimiter: 10 requests per 300 seconds (for Excel export and the archival-render route — heavier operations)
export const exportLimiter: RateLimiter = lazyLimiter(
  () => new Ratelimit({ redis: getRedis(), limiter: Ratelimit.slidingWindow(10, '300 s'), prefix: '@upstash/ratelimit:export' }),
);

// API-011: Outbound customer email burst and daily cap limiters
export const emailBurstLimiter: RateLimiter = lazyLimiter(
  () => new Ratelimit({ redis: getRedis(), limiter: Ratelimit.slidingWindow(EMAIL_BURST_LIMIT, EMAIL_BURST_WINDOW), prefix: '@upstash/ratelimit:email-burst' }),
);

export const emailDailyCapLimiter: RateLimiter = lazyLimiter(
  () => new Ratelimit({ redis: getRedis(), limiter: Ratelimit.slidingWindow(EMAIL_DAILY_CAP_PER_BUSINESS, EMAIL_DAILY_WINDOW), prefix: '@upstash/ratelimit:email-daily' }),
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
