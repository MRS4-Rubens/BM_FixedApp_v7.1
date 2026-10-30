import { createHash } from 'node:crypto';
import { enforceRateLimit } from '@/lib/rate-limit/enforce';
import {
  loginEmailLimiter,
  loginIpLimiter,
  recoveryEmailLimiter,
  recoveryIpLimiter,
  signupIpLimiter,
  type RateLimiter,
} from '@/lib/rate-limit/upstash';

export type AuthRateLimitResult =
  | { allowed: true }
  | { allowed: false; reason: 'limited' | 'unavailable'; retryAfterSeconds: number };

export interface AuthLimiters {
  loginIp: RateLimiter;
  loginEmail: RateLimiter;
  signupIp: RateLimiter;
  recoveryIp: RateLimiter;
  recoveryEmail: RateLimiter;
}

const DEFAULT_LIMITERS: AuthLimiters = {
  loginIp: loginIpLimiter,
  loginEmail: loginEmailLimiter,
  signupIp: signupIpLimiter,
  recoveryIp: recoveryIpLimiter,
  recoveryEmail: recoveryEmailLimiter,
};

/** SHA-256 (first 32 hex chars) of the trimmed, lower-cased e-mail: stable key, no PII in Redis. */
export function hashEmailForRateLimit(email: string): string {
  const normalized = email.trim().toLowerCase();
  return createHash('sha256').update(normalized).digest('hex').slice(0, 32);
}

export async function enforceLoginRateLimit(
  args: { ip: string; email: string | null },
  limiters?: AuthLimiters
): Promise<AuthRateLimitResult> {
  const activeLimiters = limiters ?? DEFAULT_LIMITERS;

  // 1. Enforce IP limiter first (policy: fail-open)
  const ipOutcome = await enforceRateLimit({
    limiter: activeLimiters.loginIp,
    identifier: `login:ip:${args.ip}`,
    policy: 'fail-open',
    scope: 'auth-login-ip',
  });
  if (!ipOutcome.allowed) {
    return { allowed: false, reason: ipOutcome.reason, retryAfterSeconds: ipOutcome.retryAfterSeconds };
  }

  // 2. If IP passes and email is provided, enforce email limiter
  if (args.email) {
    const hash = hashEmailForRateLimit(args.email);
    const emailOutcome = await enforceRateLimit({
      limiter: activeLimiters.loginEmail,
      identifier: `login:email:${hash}`,
      policy: 'fail-open',
      scope: 'auth-login-email',
    });
    if (!emailOutcome.allowed) {
      return { allowed: false, reason: emailOutcome.reason, retryAfterSeconds: emailOutcome.retryAfterSeconds };
    }
  }

  return { allowed: true };
}

export async function enforceSignupRateLimit(
  args: { ip: string },
  limiters?: AuthLimiters
): Promise<AuthRateLimitResult> {
  const activeLimiters = limiters ?? DEFAULT_LIMITERS;

  // Policy: fail-closed
  const ipOutcome = await enforceRateLimit({
    limiter: activeLimiters.signupIp,
    identifier: `signup:ip:${args.ip}`,
    policy: 'fail-closed',
    scope: 'auth-signup',
  });
  if (!ipOutcome.allowed) {
    return { allowed: false, reason: ipOutcome.reason, retryAfterSeconds: ipOutcome.retryAfterSeconds };
  }

  return { allowed: true };
}

export async function enforceRecoveryRateLimit(
  args: { ip: string; email: string | null },
  limiters?: AuthLimiters
): Promise<AuthRateLimitResult> {
  const activeLimiters = limiters ?? DEFAULT_LIMITERS;

  // 1. Enforce IP limiter first (policy: fail-closed)
  const ipOutcome = await enforceRateLimit({
    limiter: activeLimiters.recoveryIp,
    identifier: `recovery:ip:${args.ip}`,
    policy: 'fail-closed',
    scope: 'auth-recovery-ip',
  });
  if (!ipOutcome.allowed) {
    return { allowed: false, reason: ipOutcome.reason, retryAfterSeconds: ipOutcome.retryAfterSeconds };
  }

  // 2. If IP passes and email is provided, enforce email limiter
  if (args.email) {
    const hash = hashEmailForRateLimit(args.email);
    const emailOutcome = await enforceRateLimit({
      limiter: activeLimiters.recoveryEmail,
      identifier: `recovery:email:${hash}`,
      policy: 'fail-closed',
      scope: 'auth-recovery-email',
    });
    if (!emailOutcome.allowed) {
      return { allowed: false, reason: emailOutcome.reason, retryAfterSeconds: emailOutcome.retryAfterSeconds };
    }
  }

  return { allowed: true };
}

export function rateLimitUserMessage(result: Extract<AuthRateLimitResult, { allowed: false }>): string {
  if (result.reason === 'limited') {
    return 'Too many attempts. Please wait a moment and try again.';
  }
  return 'This service is temporarily unavailable. Please try again in a few minutes.';
}

