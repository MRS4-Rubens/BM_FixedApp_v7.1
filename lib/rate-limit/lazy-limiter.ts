import type { Ratelimit } from '@upstash/ratelimit';

/** Structural subset of Ratelimit used across the app; lets limiters be lazy facades. */
export type RateLimiter = Pick<Ratelimit, 'limit'>;

export function lazyLimiter(create: () => Ratelimit): RateLimiter {
  let instance: Ratelimit | undefined;
  return {
    limit: (...args: Parameters<Ratelimit['limit']>) => {
      instance ??= create();
      return instance.limit(...args);
    },
  };
}

