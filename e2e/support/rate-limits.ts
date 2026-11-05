import { assertSafeTarget, type E2eEnv } from './env';

/**
 * Resets Upstash Redis sliding-window keys specifically for auth endpoints
 * (signup and login limiters).
 *
 * Strict Guardrails:
 * 1. Checks E2E_UPSTASH_ALLOW_FLUSH === true.
 * 2. Asserts target safety and host allowlist.
 * 3. Never issues FLUSHDB or FLUSHALL.
 * 4. Only deletes keys matching the strict auth prefixes.
 */
export async function resetAuthRateLimits(env: E2eEnv): Promise<number> {
  if (!env.E2E_UPSTASH_ALLOW_FLUSH) {
    console.warn(
      '[E2E Rate Limits] E2E_UPSTASH_ALLOW_FLUSH is false. Skipping reset (Note: signup is limited to 3/hr/IP).',
    );
    return 0;
  }

  if (!env.E2E_UPSTASH_REST_URL || !env.E2E_UPSTASH_REST_TOKEN) {
    console.warn(
      '[E2E Rate Limits] E2E_UPSTASH_REST_URL or E2E_UPSTASH_REST_TOKEN missing. Skipping reset.',
    );
    return 0;
  }

  assertSafeTarget(env);

  const patterns = [
    '@upstash/ratelimit:auth-signup-ip*',
    '@upstash/ratelimit:auth-login-ip*',
    '@upstash/ratelimit:auth-login-email*',
    '@upstash/ratelimit:auth:signup*',
    '@upstash/ratelimit:auth:login*',
  ];

  const baseUrl = env.E2E_UPSTASH_REST_URL.replace(/\/$/, '');
  const headers = {
    Authorization: `Bearer ${env.E2E_UPSTASH_REST_TOKEN}`,
    'Content-Type': 'application/json',
  };

  let totalDeleted = 0;

  for (const pattern of patterns) {
    let cursor = '0';
    do {
      const scanRes = await fetch(`${baseUrl}/scan/${cursor}/match/${encodeURIComponent(pattern)}/count/100`, {
        method: 'GET',
        headers,
      });

      if (!scanRes.ok) {
        console.warn(`[E2E Rate Limits] SCAN failed for pattern ${pattern}: ${scanRes.status}`);
        break;
      }

      const scanData = (await scanRes.json()) as { result?: [string, string[]] };
      if (!scanData.result || !Array.isArray(scanData.result[1])) {
        break;
      }

      cursor = scanData.result[0];
      const keys = scanData.result[1];

      // Double guard: only delete keys that strictly start with @upstash/ratelimit:auth
      const safeKeys = keys.filter(
        (k) => k.startsWith('@upstash/ratelimit:auth-') || k.startsWith('@upstash/ratelimit:auth:'),
      );

      if (safeKeys.length > 0) {
        const delRes = await fetch(`${baseUrl}/pipeline`, {
          method: 'POST',
          headers,
          body: JSON.stringify(safeKeys.map((k) => ['DEL', k])),
        });
        if (delRes.ok) {
          totalDeleted += safeKeys.length;
        }
      }
    } while (cursor !== '0');
  }

  return totalDeleted;
}

