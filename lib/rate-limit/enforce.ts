import { checkRateLimit, type RateLimiter } from '@/lib/rate-limit/upstash';
import { logError } from '@/lib/actions/_shared/logger';

export type OutagePolicy = 'fail-open' | 'fail-closed';

export type RateLimitOutcome =
  | { allowed: true; degraded: boolean }
  | { allowed: false; reason: 'limited' | 'unavailable'; retryAfterSeconds: number };

export const OUTAGE_RETRY_AFTER_SECONDS = 30;
const OUTAGE_LOG_INTERVAL_MS = 60_000;
const lastOutageLogAt = new Map<string, number>();

export async function enforceRateLimit(args: {
  limiter: RateLimiter;
  identifier: string;
  policy: OutagePolicy;
  scope: string;
  now?: () => number;
}): Promise<RateLimitOutcome> {
  try {
    const result = await checkRateLimit(args.limiter, args.identifier);
    return result.allowed
      ? { allowed: true, degraded: false }
      : { allowed: false, reason: 'limited', retryAfterSeconds: result.retryAfterSeconds };
  } catch (error: unknown) {
    const nowMs = (args.now ?? Date.now)();
    const last = lastOutageLogAt.get(args.scope);
    if (last === undefined || nowMs - last >= OUTAGE_LOG_INTERVAL_MS) {
      lastOutageLogAt.set(args.scope, nowMs);
      logError(`rate-limit-unavailable:${args.scope}`, error, { policy: args.policy });
    }
    return args.policy === 'fail-open'
      ? { allowed: true, degraded: true }
      : { allowed: false, reason: 'unavailable', retryAfterSeconds: OUTAGE_RETRY_AFTER_SECONDS };
  }
}

export function resetOutageLogThrottleForTests(): void {
  lastOutageLogAt.clear();
}

