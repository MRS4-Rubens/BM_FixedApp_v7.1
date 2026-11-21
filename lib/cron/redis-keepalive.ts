import { getRedis } from '@/lib/rate-limit/upstash';
import { logError } from '@/lib/actions/_shared/logger';

/** Key written once a day; expires on its own, so it never accumulates. */
export const REDIS_KEEPALIVE_KEY = 'bizfolio:keepalive';
const KEEPALIVE_TTL_SECONDS = 8 * 24 * 60 * 60;
/** Upper bound for the keepalive write only (the shared Redis client keeps its own behaviour for rate limiting). */
const KEEPALIVE_TIMEOUT_MS = 5_000;

/**
 * B6: Upstash Free may delete a database that receives no requests for a week. Rate limiting only touches Redis when
 * someone signs in or up, so a quiet week (holidays, pilot gaps) could lose it. The daily notifications cron calls this
 * once a day: one SET with an 8-day expiry. It never throws and gives up after KEEPALIVE_TIMEOUT_MS, so a failing or
 * stalled Redis can never block or break the notifications job.
 */
export async function touchRedisKeepalive(
  now: Date = new Date(),
  timeoutMs: number = KEEPALIVE_TIMEOUT_MS,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Redis keepalive timed out after ${timeoutMs} ms`)), timeoutMs);
  });
  try {
    await Promise.race([getRedis().set(REDIS_KEEPALIVE_KEY, now.toISOString(), { ex: KEEPALIVE_TTL_SECONDS }), timeout]);
    return true;
  } catch (error) {
    logError('redis-keepalive', error);
    return false;
  } finally {
    clearTimeout(timer);
  }
}
