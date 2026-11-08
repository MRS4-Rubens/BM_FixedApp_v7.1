import { isIP } from 'node:net';
import { Redis } from '@upstash/redis';
import { Ratelimit } from '@upstash/ratelimit';
import { getRateLimitEnv } from '@/lib/env';
import {
  EMAIL_BURST_LIMIT,
  EMAIL_BURST_WINDOW,
  EMAIL_DAILY_CAP_PER_BUSINESS,
  EMAIL_DAILY_WINDOW,
} from '@/lib/email/send-policy';
import { lazyLimiter, type RateLimiter } from './lazy-limiter';

export type { RateLimiter } from './lazy-limiter';

let redisInstance: Redis | undefined;

/** Lazily constructed shared Redis client. Throws EnvConfigError if Upstash variables are invalid. */
export function getRedis(): Redis {
  if (redisInstance === undefined) {
    const env = getRateLimitEnv();
    redisInstance = new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });
  }
  return redisInstance;
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
  () => new Ratelimit({ redis: getRedis(), limiter: Ratelimit.slidingWindow(20, '60 s'), prefix: '@upstash/ratelimit:sensitive', timeout: 2000 }),
);

// exportLimiter: 10 requests per 300 seconds (for Excel export — heavier operations)
export const exportLimiter: RateLimiter = lazyLimiter(
  () => new Ratelimit({ redis: getRedis(), limiter: Ratelimit.slidingWindow(10, '300 s'), prefix: '@upstash/ratelimit:export', timeout: 2000 }),
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
  const { success, reset, reason } = await limiter.limit(identifier);
  // @upstash/ratelimit silently allows a request when its internal timeout elapses. Surface that as an outage so the
  // caller's explicit fail-open / fail-closed policy applies.
  if (reason === 'timeout') throw new Error('Rate limiter timed out');
  const retryAfterSeconds = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
  return { allowed: success, retryAfterSeconds };
}

function firstValidIp(raw: string | null, pick: 'first' | 'last'): string | null {
  if (raw === null) return null;
  const entries = raw.split(',').map((entry) => entry.trim()).filter((entry) => entry !== '');
  const ordered = pick === 'first' ? entries : [...entries].reverse();
  for (const entry of ordered) if (isIP(entry) !== 0) return entry;
  return null;
}

/**
 * Real client IP. On Vercel `x-vercel-forwarded-for` is set by the platform and cannot be spoofed by clients.
 * Otherwise use the RIGHT-most valid `x-forwarded-for` entry (appended by the nearest trusted proxy; a client-supplied
 * left-most value is ignored). Returns 'unknown' when nothing valid is present. Never throws.
 */
export function getClientIp(headersList: Headers): string {
  return (
    firstValidIp(headersList.get('x-vercel-forwarded-for'), 'first') ??
    firstValidIp(headersList.get('x-forwarded-for'), 'last') ??
    'unknown'
  );
}
