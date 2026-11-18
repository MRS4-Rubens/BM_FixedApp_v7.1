import { beforeEach, describe, expect, it, vi } from 'vitest';

// LAUNCH-L4 (docs/LAUNCH_CHECKLIST.md 2.3): sign-up e-mail confirmation by 6-digit code.

const state = vi.hoisted(() => ({
  counts: new Map<string, number>(),
  redisOutage: false,
  signUpResponse: null as unknown,
  signInResponse: null as unknown,
  verifyResponse: null as unknown,
  verifyThrows: null as unknown,
  resendResponse: null as unknown,
  ensureAppUser: vi.fn(),
}));

function limiter(limit: number) {
  return {
    limit: vi.fn(async (identifier: string) => {
      if (state.redisOutage) throw new Error('Upstash Redis connection timeout');
      const count = (state.counts.get(identifier) ?? 0) + 1;
      state.counts.set(identifier, count);
      return { success: count <= limit, limit, remaining: Math.max(0, limit - count), reset: Date.now() + 60_000, pending: Promise.resolve() };
    }),
  };
}

vi.mock('@/lib/rate-limit/upstash', () => ({
  loginIpLimiter: limiter(30),
  loginEmailLimiter: limiter(10),
  signupIpLimiter: limiter(3),
  recoveryIpLimiter: limiter(10),
  recoveryEmailLimiter: limiter(3),
  getClientIp: () => '127.0.0.1',
  checkRateLimit: async (l: { limit: (id: string) => Promise<{ success: boolean; reset: number }> }, id: string) => {
    const res = await l.limit(id);
    return { allowed: res.success, retryAfterSeconds: Math.max(1, Math.ceil((res.reset - Date.now()) / 1000)) };
  },
}));

vi.mock('@/lib/auth/server', () => ({
  auth: {
    signUp: { email: vi.fn(async () => state.signUpResponse) },
    signIn: { email: vi.fn(async () => state.signInResponse) },
    emailOtp: {
      verifyEmail: vi.fn(async () => {
        if (state.verifyThrows) throw state.verifyThrows;
        return state.verifyResponse;
      }),
    },
    sendVerificationEmail: vi.fn(async () => state.resendResponse),
  },
}));
vi.mock('@/lib/auth/ensure-app-user', () => ({ ensureAppUser: vi.fn(async (args) => state.ensureAppUser(args)) }));
vi.mock('@/lib/team/pending-invite-cookie', () => ({ takePendingInvitePath: vi.fn(async () => null) }));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));
vi.mock('@/lib/actions/_shared/logger', () => ({ logError: vi.fn(), logWarn: vi.fn() }));

import { signupAction } from '@/app/(auth)/signup/actions';
import { loginAction } from '@/app/(auth)/login/actions';
import { resendSignupCodeAction, verifySignupCodeAction } from '@/app/(auth)/signup/verify-actions';
import { hashEmailForRateLimit } from '@/lib/auth/auth-rate-limit';
import { auth } from '@/lib/auth/server';

const EMAIL = 'asha@shop.in';

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.append(key, value);
  return fd;
}

const verifiedUser = { id: 'usr_9', name: 'Asha', email: EMAIL, emailVerified: true };

beforeEach(() => {
  vi.clearAllMocks();
  state.counts.clear();
  state.redisOutage = false;
  state.signUpResponse = { data: { user: { id: 'usr_9', name: 'Asha', email: EMAIL }, token: null }, error: null };
  state.signInResponse = { data: { user: verifiedUser }, error: null };
  state.verifyResponse = { data: { status: true, token: 'tok_1', user: verifiedUser }, error: null };
  state.verifyThrows = null;
  state.resendResponse = { data: { status: true }, error: null };
  state.ensureAppUser.mockResolvedValue({ id: 'local_1' });
});

describe('LAUNCH-L4 sign-up opens the code screen', () => {
  it('when Neon Auth requires verification (no session), sign-up returns the code-screen state with the 15-minute notice', async () => {
    const result = await signupAction(
      null,
      form({ ownerName: 'Asha', email: EMAIL, password: 'correct horse battery', confirmPassword: 'correct horse battery' }),
    );
    expect(result.verifyEmail).toBe(EMAIL);
    expect(result.notice).toContain('6-digit code');
    expect(result.notice).toContain('15 minutes');
    expect(result.notice).not.toMatch(/link/i);
    expect(result.error).toBeUndefined();
  });

  it('sign-in with the right password but an unconfirmed e-mail also opens the code screen (not a dead end)', async () => {
    // The raw API code and the name the @neondatabase/auth server client turns it into (seen live on Neon).
    for (const code of ['EMAIL_NOT_VERIFIED', 'email_not_confirmed']) {
      state.signInResponse = { data: null, error: { message: 'Email not verified', status: 403, code } };
      const result = await loginAction(null, form({ email: EMAIL, password: 'correct horse battery' }));
      expect(result.verifyEmail).toBe(EMAIL);
      expect(result.error).toBeUndefined();
    }
  });

  it('other sign-in errors stay plain errors', async () => {
    state.signInResponse = { data: null, error: { message: 'Invalid email or password', status: 401, code: 'INVALID_EMAIL_OR_PASSWORD' } };
    expect(await loginAction(null, form({ email: EMAIL, password: 'x' }))).toEqual({ error: 'Invalid email or password' });
  });
});

describe('LAUNCH-L4 verifySignupCodeAction', () => {
  it('a correct code with auto sign-in creates the app user and goes to the dashboard', async () => {
    await expect(verifySignupCodeAction(null, form({ email: EMAIL, code: '123456' }))).rejects.toThrow('NEXT_REDIRECT:/dashboard');
    expect(auth.emailOtp.verifyEmail).toHaveBeenCalledWith({ email: EMAIL, otp: '123456' });
    expect(state.ensureAppUser).toHaveBeenCalledWith({ authUserId: 'usr_9', displayName: 'Asha', email: EMAIL });
  });

  it('a correct code without a session asks the person to sign in', async () => {
    state.verifyResponse = { data: { status: true, token: null, user: verifiedUser }, error: null };
    expect(await verifySignupCodeAction(null, form({ email: EMAIL, code: '123456' }))).toEqual({
      verified: true,
      notice: 'E-mail confirmed. Please sign in with your password.',
    });
  });

  it('a wrong or expired code keeps the screen open with a neutral message (provider text never shown)', async () => {
    state.verifyResponse = { data: null, error: { message: 'Invalid OTP for user asha@shop.in', status: 400, code: 'INVALID_OTP' } };
    const result = await verifySignupCodeAction(null, form({ email: EMAIL, code: '000000' }));
    expect(result.verifyEmail).toBe(EMAIL);
    expect(result.error).toContain('wrong or has expired');
    expect(result.error).not.toContain('Invalid OTP');
  });

  it('rejects anything that is not exactly 6 digits without calling Neon Auth', async () => {
    for (const code of ['', '12345', '1234567', '12a456', '12 345']) {
      const result = await verifySignupCodeAction(null, form({ email: EMAIL, code }));
      expect(result.error).toBe('Enter the 6-digit code from the e-mail.');
    }
    expect(auth.emailOtp.verifyEmail).not.toHaveBeenCalled();
  });

  it('is rate-limited per e-mail (11th try in 15 minutes blocked) before calling Neon Auth', async () => {
    state.counts.set(`login:email:${hashEmailForRateLimit(EMAIL)}`, 10);
    const result = await verifySignupCodeAction(null, form({ email: EMAIL, code: '123456' }));
    expect(result.error).toBe('Too many attempts. Please wait a moment and try again.');
    expect(auth.emailOtp.verifyEmail).not.toHaveBeenCalled();
  });

  it('a network failure returns a retry message instead of crashing', async () => {
    state.verifyThrows = new Error('fetch failed');
    const result = await verifySignupCodeAction(null, form({ email: EMAIL, code: '123456' }));
    expect(result).toEqual({ verifyEmail: EMAIL, error: 'We could not check the code right now. Please try again.' });
  });
});

describe('LAUNCH-L4 resendSignupCodeAction', () => {
  it('asks Neon Auth to send a new code and answers neutrally', async () => {
    const result = await resendSignupCodeAction(null, form({ email: EMAIL }));
    expect(auth.sendVerificationEmail).toHaveBeenCalledWith({ email: EMAIL });
    expect(result.verifyEmail).toBe(EMAIL);
    expect(result.notice).toContain('new 6-digit code');
    expect(result.notice).toContain('15 minutes');
  });

  it('gives the same answer when Neon Auth says the address is unknown or already confirmed (no account discovery)', async () => {
    state.resendResponse = { data: null, error: { message: 'User not found', status: 400, code: 'USER_NOT_FOUND' } };
    const result = await resendSignupCodeAction(null, form({ email: EMAIL }));
    expect(result.error).toBeUndefined();
    expect(result.notice).toContain('If asha@shop.in needs confirming');
  });

  it('allows 3 resends per e-mail per 15 minutes, then blocks without sending', async () => {
    for (let i = 0; i < 3; i += 1) {
      expect((await resendSignupCodeAction(null, form({ email: EMAIL }))).error).toBeUndefined();
    }
    const blocked = await resendSignupCodeAction(null, form({ email: EMAIL }));
    expect(blocked.error).toBe('Too many attempts. Please wait a moment and try again.');
    expect(auth.sendVerificationEmail).toHaveBeenCalledTimes(3);
  });

  it('fails closed when the rate limiter is down (each resend sends an e-mail)', async () => {
    state.redisOutage = true;
    const result = await resendSignupCodeAction(null, form({ email: EMAIL }));
    expect(result.error).toBe('This service is temporarily unavailable. Please try again in a few minutes.');
    expect(auth.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('a provider outage (5xx) is reported as "could not send"', async () => {
    state.resendResponse = { data: null, error: { message: 'down', status: 503 } };
    expect((await resendSignupCodeAction(null, form({ email: EMAIL }))).error).toContain('could not send a new code');
  });
});
