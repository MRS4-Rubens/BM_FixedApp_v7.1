import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requestResetLinkAction, resetPasswordAction } from '@/app/(auth)/reset-password/actions';
import { enforceRecoveryRateLimit } from '@/lib/auth/auth-rate-limit';
import { auth } from '@/lib/auth/server';

vi.mock('next/headers', () => ({
  headers: async () => new Headers({ origin: 'https://pilot.onrender.com' }),
}));
vi.mock('@/lib/env', () => ({
  getAppEnv: () => ({ NEXT_PUBLIC_APP_URL: 'https://pilot.onrender.com' }),
}));
vi.mock('@/lib/auth/server', () => ({
  auth: { requestPasswordReset: vi.fn(), resetPassword: vi.fn() },
}));
vi.mock('@/lib/auth/auth-rate-limit', () => ({
  enforceRecoveryRateLimit: vi.fn(),
  rateLimitUserMessage: () => 'Too many attempts.',
}));
vi.mock('@/lib/rate-limit/upstash', () => ({ getClientIp: () => '192.0.2.1' }));

const email = 'tester@example.test';
const password = 'A-fresh-test-passphrase!';

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

describe('Password reset through Neon Auth', () => {
  beforeEach(() => {
    vi.mocked(enforceRecoveryRateLimit).mockResolvedValue({ allowed: true });
  });

  it('uses the configured app URL and returns a neutral result', async () => {
    vi.mocked(auth.requestPasswordReset).mockResolvedValueOnce({
      data: { status: true, message: 'If this user exists, check your email.' },
      error: null,
    });
    const result = await requestResetLinkAction(null, form({ email, redirectTo: 'https://untrusted.example' }));

    expect(result).toEqual({ done: true });
    expect(enforceRecoveryRateLimit).toHaveBeenCalledWith({ ip: '192.0.2.1', email });
    expect(auth.requestPasswordReset).toHaveBeenCalledWith({
      email,
      redirectTo: 'https://pilot.onrender.com/reset-password',
    });
  });

  it('does not contact Neon for invalid email or a blocked recovery request', async () => {
    expect(await requestResetLinkAction(null, form({ email: 'invalid' }))).toHaveProperty('error');
    vi.mocked(enforceRecoveryRateLimit).mockResolvedValue({ allowed: false, reason: 'limited', retryAfterSeconds: 10 });
    expect(await requestResetLinkAction(null, form({ email }))).toEqual({ error: 'Too many attempts.' });
    expect(auth.requestPasswordReset).not.toHaveBeenCalled();
  });

  it('only submits a valid replacement password with the reset token', async () => {
    expect(await resetPasswordAction(null, form({ password }))).toEqual({ invalidLink: true });
    expect(await resetPasswordAction(null, form({ token: 'test-token', password, confirmPassword: 'different' })))
      .toEqual({ error: 'Passwords do not match.' });
    expect(await resetPasswordAction(null, form({ token: 'test-token', password: 'short', confirmPassword: 'short' })))
      .toEqual({ error: 'Password must be at least 10 characters long.' });
    expect(auth.resetPassword).not.toHaveBeenCalled();

    vi.mocked(auth.resetPassword).mockResolvedValueOnce({ data: { status: true }, error: null });
    expect(await resetPasswordAction(null, form({ token: 'test-token', password, confirmPassword: password })))
      .toEqual({ done: true });
    expect(auth.resetPassword).toHaveBeenCalledWith({ token: 'test-token', newPassword: password });
  });

  it('handles a rejected token and avoids exposing upstream service errors', async () => {
    vi.mocked(auth.resetPassword).mockResolvedValueOnce({
      data: null,
      error: { code: 'bad_jwt', message: 'Invalid token', status: 400, statusText: 'Bad Request' },
    });
    expect(await resetPasswordAction(null, form({ token: 'used-token', password, confirmPassword: password })))
      .toEqual({ invalidLink: true });

    vi.mocked(auth.requestPasswordReset).mockResolvedValueOnce({
      data: null,
      error: { message: 'Internal provider detail', status: 503, statusText: 'Service Unavailable' },
    });
    expect(await requestResetLinkAction(null, form({ email })))
      .toEqual({ error: 'We could not send a reset link right now. Please try again later.' });
  });

  it('keeps a valid-looking reset submission behind the recovery rate limiter', async () => {
    vi.mocked(enforceRecoveryRateLimit).mockResolvedValue({ allowed: false, reason: 'unavailable', retryAfterSeconds: 30 });
    const result = await resetPasswordAction(null, form({ token: 'test-token', password, confirmPassword: password }));

    expect(result).toHaveProperty('error');
    expect(enforceRecoveryRateLimit).toHaveBeenCalledWith({ ip: '192.0.2.1', email: null });
    expect(auth.resetPassword).not.toHaveBeenCalled();
  });
});
