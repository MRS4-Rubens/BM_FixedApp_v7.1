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
const LOGIN_IP_LIMIT = 30;
const LOGIN_IP_WINDOW = '15 m';
const LOGIN_EMAIL_LIMIT = 10;
const LOGIN_EMAIL_WINDOW = '15 m';
const SIGNUP_IP_LIMIT = 3;
const SIGNUP_IP_WINDOW = '1 h';
const RECOVERY_IP_LIMIT = 10;
const RECOVERY_IP_WINDOW = '15 m';
const RECOVERY_EMAIL_LIMIT = 3;
const RECOVERY_EMAIL_WINDOW = '15 m';

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

function validIps(raw: string | null): string[] {
  if (raw === null) return [];
  return raw.split(',').map((entry) => entry.trim()).filter((entry) => entry !== '' && isIP(entry) !== 0);
}

/** Private, loopback, link-local and carrier-grade-NAT addresses: hops inside a hosting network, never a visitor. */
export function isInternalIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) {
    const [a = 0, b = 0] = ip.split('.').map(Number);
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a === 0
    );
  }
  if (version === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped?.[1]) return isInternalIp(mapped[1]);
    return /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower);
  }
  return false;
}

/**
 * Real client IP for rate limits (SEC-01). Render runs behind Cloudflare and an internal load balancer:
 *  1. `cf-connecting-ip`: set by Cloudflare's edge to the visitor's address (a value sent by the visitor is
 *     overwritten), so it cannot be faked.
 *  2. Otherwise the RIGHT-most PUBLIC `x-forwarded-for` entry: internal hops (Render's own 10.x load balancer) are
 *     skipped, and client-supplied left-most entries are never preferred over an address added by a proxy.
 *  3. Only internal addresses (local development): the right-most of them.
 * `x-vercel-forwarded-for` and `true-client-ip` are NOT trusted: on Render they can pass through from the visitor
 * unchanged. Measured 2026-11-22 on the Render TEST service: the right-most `x-forwarded-for` entry was Render's
 * private proxy (10.25.x.x), so every visitor shared one rate-limit bucket. Returns 'unknown' when nothing valid is
 * present. Never throws.
 */
export function getClientIp(headersList: Headers): string {
  const edge = validIps(headersList.get('cf-connecting-ip'))[0];
  if (edge !== undefined) return edge;
  const forwarded = validIps(headersList.get('x-forwarded-for')).reverse();
  return forwarded.find((ip) => !isInternalIp(ip)) ?? forwarded[0] ?? 'unknown';
}
