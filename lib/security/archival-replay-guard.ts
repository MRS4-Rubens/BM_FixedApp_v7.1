import { getRedis } from '@/lib/rate-limit/upstash';

export type ReplayOutcome = 'CONSUMED' | 'REPLAYED';

export interface ReplayStore {
  set(key: string, value: number, options: { nx: true; ex: number }): Promise<unknown>;
}

const KEY_PREFIX = 'archival:jti:';

/** Atomically marks a jti as used. `ttlSeconds` must cover the token's remaining lifetime. Throws on store errors (caller fails closed). */
export async function consumeArchivalJti(
  jti: string,
  ttlSeconds: number,
  store: ReplayStore = getRedis(),
): Promise<ReplayOutcome> {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1) throw new RangeError('ttlSeconds must be a positive integer');
  const result = await store.set(`${KEY_PREFIX}${jti}`, 1, { nx: true, ex: ttlSeconds });
  return result === 'OK' ? 'CONSUMED' : 'REPLAYED';
}
