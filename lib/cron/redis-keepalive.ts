import { getRedis } from '@/lib/rate-limit/upstash';
import { logError } from '@/lib/actions/_shared/logger';

/** Key written once a day; expires on its own, so it never accumulates. */
export const REDIS_KEEPALIVE_KEY = 'bizfolio:keepalive';
const KEEPALIVE_TTL_SECONDS = 8 * 24 * 60 * 60;

/**
 * B6: Upstash Free may delete a database that receives no requests for a week. Rate limiting only touches Redis when
 * someone signs in or up, so a quiet week (holidays, pilot gaps) could lose it. The daily notifications cron calls this
 * once a day: one SET with an 8-day expiry. It never throws, so it can never break the notifications job.
 */
export async function touchRedisKeepalive(now: Date = new Date()): Promise<boolean> {
  try {
    await getRedis().set(REDIS_KEEPALIVE_KEY, now.toISOString(), { ex: KEEPALIVE_TTL_SECONDS });
    return true;
  } catch (error) {
    logError('redis-keepalive', error);
    return false;
  }
}
