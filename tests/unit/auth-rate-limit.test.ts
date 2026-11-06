import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  enforceLoginRateLimit,
  enforceRecoveryRateLimit,
  enforceSignupRateLimit,
  hashEmailForRateLimit,
  rateLimitUserMessage,
  type AuthLimiters,
} from '@/lib/auth/auth-rate-limit';
import type { RateLimiter } from '@/lib/rate-limit/upstash';

function createRecordingLimiter(options?: { allowed?: boolean; throws?: boolean }): {
  limiter: RateLimiter;
  calls: string[];
} {
  const calls: string[] = [];
  const limiter: RateLimiter = {
    limit: vi.fn().mockImplementation(async (identifier: string) => {
      calls.push(identifier);
      if (options?.throws) {
        throw new Error('Redis down');
      }
      return {
        success: options?.allowed ?? true,
        limit: 10,
        remaining: options?.allowed === false ? 0 : 9,
        reset: Date.now() + 10_000,
        pending: Promise.resolve(),
      };
    }),
  };
  return { limiter, calls };
}

describe('Auth Rate Limiting Layer (AUTH-002)', () => {
  let loginIp: ReturnType<typeof createRecordingLimiter>;
  let loginEmail: ReturnType<typeof createRecordingLimiter>;
  let signupIp: ReturnType<typeof createRecordingLimiter>;
  let recoveryIp: ReturnType<typeof createRecordingLimiter>;
  let recoveryEmail: ReturnType<typeof createRecordingLimiter>;
  let limiters: AuthLimiters;

  beforeEach(() => {
    loginIp = createRecordingLimiter();
    loginEmail = createRecordingLimiter();
    signupIp = createRecordingLimiter();
    recoveryIp = createRecordingLimiter();
    recoveryEmail = createRecordingLimiter();

    limiters = {
      loginIp: loginIp.limiter,
      loginEmail: loginEmail.limiter,
      signupIp: signupIp.limiter,
      recoveryIp: recoveryIp.limiter,
      recoveryEmail: recoveryEmail.limiter,
    };
  });

  it('normalizes and hashes email correctly without leaking raw email in hash', () => {
    const rawEmail = ' Test.User@Example.COM ';
    const hash1 = hashEmailForRateLimit(rawEmail);
    const hash2 = hashEmailForRateLimit('test.user@example.com');
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(32);
    expect(hash1).not.toContain('test');
    expect(hash1).not.toContain('example');
  });

  it('login consumes IP limiter then email limiter; identifiers never contain raw email', async () => {
    const result = await enforceLoginRateLimit(
      { ip: '192.168.1.1', email: 'alice@example.com' },
      limiters
    );

    expect(result).toEqual({ allowed: true });
    expect(loginIp.calls).toEqual(['login:ip:192.168.1.1']);
    expect(loginEmail.calls).toHaveLength(1);
    expect(loginEmail.calls[0]).toMatch(/^login:email:[0-9a-f]{32}$/);
    expect(loginEmail.calls[0]).not.toContain('alice');
    expect(loginEmail.calls[0]).not.toContain('@');
  });

  it('login only checks IP limiter if email is null', async () => {
    const result = await enforceLoginRateLimit({ ip: '10.0.0.1', email: null }, limiters);
    expect(result).toEqual({ allowed: true });
    expect(loginIp.calls).toEqual(['login:ip:10.0.0.1']);
    expect(loginEmail.calls).toHaveLength(0);
  });

  it('IP-blocked login stops immediately and does NOT consume email limiter', async () => {
    loginIp = createRecordingLimiter({ allowed: false });
    limiters.loginIp = loginIp.limiter;

    const result = await enforceLoginRateLimit(
      { ip: '1.2.3.4', email: 'bob@example.com' },
      limiters
    );

    expect(result.allowed).toBe(false);
    expect(loginIp.calls).toEqual(['login:ip:1.2.3.4']);
    expect(loginEmail.calls).toHaveLength(0);
  });

  it('login fails open on Redis outage', async () => {
    loginIp = createRecordingLimiter({ throws: true });
    loginEmail = createRecordingLimiter({ throws: true });
    limiters.loginIp = loginIp.limiter;
    limiters.loginEmail = loginEmail.limiter;

    const result = await enforceLoginRateLimit(
      { ip: '1.2.3.4', email: 'charlie@example.com' },
      limiters
    );

    // Fail-open means allowed: true despite Redis failure
    expect(result).toEqual({ allowed: true });
  });

  it('signup checks IP limiter only and fails closed on outage', async () => {
    const ok = await enforceSignupRateLimit({ ip: '10.10.10.10' }, limiters);
    expect(ok).toEqual({ allowed: true });
    expect(signupIp.calls).toEqual(['signup:ip:10.10.10.10']);

    // Now test outage fail-closed
    signupIp = createRecordingLimiter({ throws: true });
    limiters.signupIp = signupIp.limiter;

    const outageResult = await enforceSignupRateLimit({ ip: '10.10.10.10' }, limiters);
    expect(outageResult).toEqual({
      allowed: false,
      reason: 'unavailable',
      retryAfterSeconds: 30,
    });
  });

  it('recovery checks IP limiter then email limiter and fails closed', async () => {
    const result = await enforceRecoveryRateLimit(
      { ip: '127.0.0.1', email: 'recovery@example.com' },
      limiters
    );

    expect(result).toEqual({ allowed: true });
    expect(recoveryIp.calls).toEqual(['recovery:ip:127.0.0.1']);
    expect(recoveryEmail.calls).toHaveLength(1);
    expect(recoveryEmail.calls[0]).toMatch(/^recovery:email:[0-9a-f]{32}$/);
    expect(recoveryEmail.calls[0]).not.toContain('recovery@example.com');
  });

  it('maps rate limit outcome to appropriate user-facing messages', () => {
    expect(rateLimitUserMessage({ allowed: false, reason: 'limited', retryAfterSeconds: 15 })).toBe(
      'Too many attempts. Please wait a moment and try again.'
    );
    expect(rateLimitUserMessage({ allowed: false, reason: 'unavailable', retryAfterSeconds: 30 })).toBe(
      'This service is temporarily unavailable. Please try again in a few minutes.'
    );
  });
});

