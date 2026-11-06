/**
 * Note: PGlite and in-memory mocks cannot reproduce real Redis network latency
 * or multi-worker Redis contention. Concurrency and network outage scenarios
 * are simulated deterministically via mock rate-limiter state.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  redisOutage: false,
  counts: new Map<string, number>(),
  signInResponse: { data: { user: { id: 'usr_123', name: 'User', email: 'user@example.com' } }, error: null } as unknown,
  signUpResponse: { data: { user: { id: 'usr_456', name: 'User 2', email: 'user2@example.com' }, token: 'tok_abc' }, error: null } as unknown,
  signInThrows: null as unknown,
  ensureAppUserMock: vi.fn(),
  clientIp: '127.0.0.1',
}));

function makeControllableLimiter(limit: number) {
  return {
    limit: vi.fn(async (identifier: string) => {
      if (state.redisOutage) {
        throw new Error('Upstash Redis connection timeout');
      }
      const count = (state.counts.get(identifier) ?? 0) + 1;
      state.counts.set(identifier, count);
      const success = count <= limit;
      return {
        success,
        limit,
        remaining: Math.max(0, limit - count),
        reset: Date.now() + 60_000,
        pending: Promise.resolve(),
      };
    }),
  };
}

vi.mock('@/lib/rate-limit/upstash', () => ({
  loginIpLimiter: makeControllableLimiter(30),
  loginEmailLimiter: makeControllableLimiter(10),
  signupIpLimiter: makeControllableLimiter(3),
  recoveryIpLimiter: makeControllableLimiter(10),
  recoveryEmailLimiter: makeControllableLimiter(3),
  getClientIp: () => state.clientIp,
  checkRateLimit: async (limiter: { limit: (id: string) => Promise<{ success: boolean; reset: number }> }, id: string) => {
    const res = await limiter.limit(id);
    return {
      allowed: res.success,
      retryAfterSeconds: Math.max(1, Math.ceil((res.reset - Date.now()) / 1000)),
    };
  },
}));

vi.mock('@/lib/auth/server', () => ({
  auth: {
    handler: () => ({
      GET: vi.fn(async (req: Request) => new Response(JSON.stringify({ status: 'ok', url: req.url }), { status: 200 })),
      POST: vi.fn(async (req: Request) => {
        // Echoes request.json() to prove request body stream was NOT consumed by rate limit guard
        const body = (await req.json()) as unknown;
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
      }),
    }),
    signIn: {
      email: vi.fn(async () => {
        if (state.signInThrows) throw state.signInThrows;
        return state.signInResponse;
      }),
    },
    signUp: {
      email: vi.fn(async () => state.signUpResponse),
    },
  },
}));

vi.mock('@/lib/auth/ensure-app-user', () => ({
  ensureAppUser: vi.fn(async (args) => state.ensureAppUserMock(args)),
}));

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers({ 'x-forwarded-for': state.clientIp })),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock('@/lib/actions/_shared/logger', () => ({
  logError: vi.fn(),
}));

import { POST, GET } from '@/lib/../app/api/auth/[...path]/route';
import { loginAction } from '@/lib/../app/(auth)/login/actions';
import { signupAction } from '@/lib/../app/(auth)/signup/actions';
import { hashEmailForRateLimit } from '@/lib/auth/auth-rate-limit';
import { auth } from '@/lib/auth/server';

describe('AUTH-002: Boundary & Server Action Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.redisOutage = false;
    state.counts.clear();
    state.clientIp = '127.0.0.1';
    state.signInResponse = { data: { user: { id: 'usr_123', name: 'User', email: 'user@example.com' } }, error: null };
    state.signUpResponse = { data: { user: { id: 'usr_456', name: 'User 2', email: 'user2@example.com' }, token: 'tok_abc' }, error: null };
    state.signInThrows = null;
    state.ensureAppUserMock.mockResolvedValue({ id: 'local_usr_1' });
  });

  describe('Route Boundary Guard (/api/auth/[...path])', () => {
    it('rate-limits 20 POSTs to /api/auth/sign-in/email: first 10 pass, later return 429 with Retry-After and code', async () => {
      const email = 'target@example.com';
      const results: Response[] = [];

      for (let i = 0; i < 20; i++) {
        const req = new Request('http://localhost:3000/api/auth/sign-in/email', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-forwarded-for': '198.51.100.1',
          },
          body: JSON.stringify({ email, password: 'StrongPassword123!' }),
        });
        const res = await POST(req, { params: Promise.resolve({ path: ['sign-in', 'email'] }) });
        results.push(res);
      }

      // First 10 requests pass through to the handler (echoing body)
      for (let i = 0; i < 10; i++) {
        expect(results[i].status).toBe(200);
        const data = (await results[i].json()) as { email: string };
        expect(data.email).toBe(email);
      }

      // Requests 11 to 20 are blocked at the boundary with 429
      for (let i = 10; i < 20; i++) {
        expect(results[i].status).toBe(429);
        expect(results[i].headers.get('Retry-After')).toBeTruthy();
        const body = (await results[i].json()) as { code: string; message: string };
        expect(body.code).toBe('RATE_LIMITED');
        expect(body.message).toBe('Too many requests. Please try again later.');
      }
    });

    it('limits by email even if request comes from a different IP', async () => {
      const email = 'cross-ip@example.com';

      // Exhaust 10 email attempts from IP A
      state.clientIp = '10.0.0.1';
      for (let i = 0; i < 10; i++) {
        const req = new Request('http://localhost:3000/api/auth/sign-in/email', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.1' },
          body: JSON.stringify({ email, password: 'Pass' }),
        });
        await POST(req, { params: Promise.resolve({ path: ['sign-in', 'email'] }) });
      }

      // 11th attempt from a DIFFERENT IP B must still be blocked by email limiter
      state.clientIp = '10.0.0.2';
      const reqFromIpB = new Request('http://localhost:3000/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.2' },
        body: JSON.stringify({ email, password: 'Pass' }),
      });
      const blockedRes = await POST(reqFromIpB, { params: Promise.resolve({ path: ['sign-in', 'email'] }) });
      expect(blockedRes.status).toBe(429);
    });

    it('never rate-limits GET /api/auth/get-session or POST /api/auth/sign-out', async () => {
      const getReq = new Request('http://localhost:3000/api/auth/get-session', { method: 'GET' });
      const getRes = await GET(getReq, { params: Promise.resolve({ path: ['get-session'] }) });
      expect(getRes.status).toBe(200);

      for (let i = 0; i < 40; i++) {
        const signOutReq = new Request('http://localhost:3000/api/auth/sign-out', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        });
        const signOutRes = await POST(signOutReq, { params: Promise.resolve({ path: ['sign-out'] }) });
        expect(signOutRes.status).toBe(200);
      }
    });

    it('blocks 4th sign-up attempt from the same IP with 429', async () => {
      state.clientIp = '192.0.2.55';
      const results: Response[] = [];

      for (let i = 0; i < 4; i++) {
        const req = new Request('http://localhost:3000/api/auth/sign-up/email', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': '192.0.2.55' },
          body: JSON.stringify({ email: `user${i}@example.com`, password: 'Password123!', name: 'User' }),
        });
        const res = await POST(req, { params: Promise.resolve({ path: ['sign-up', 'email'] }) });
        results.push(res);
      }

      expect(results[0].status).toBe(200);
      expect(results[1].status).toBe(200);
      expect(results[2].status).toBe(200);
      expect(results[3].status).toBe(429);
      const body = (await results[3].json()) as { code: string };
      expect(body.code).toBe('RATE_LIMITED');
    });

    it('handles outage: login POST fails open (200), signup and recovery return 503', async () => {
      state.redisOutage = true;

      // Login: fail-open -> reaches handler
      const loginReq = new Request('http://localhost:3000/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'open@example.com', password: 'Pass' }),
      });
      const loginRes = await POST(loginReq, { params: Promise.resolve({ path: ['sign-in', 'email'] }) });
      expect(loginRes.status).toBe(200);

      // Signup: fail-closed -> 503
      const signupReq = new Request('http://localhost:3000/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'closed@example.com', password: 'Pass', name: 'Name' }),
      });
      const signupRes = await POST(signupReq, { params: Promise.resolve({ path: ['sign-up', 'email'] }) });
      expect(signupRes.status).toBe(503);
      const signupBody = (await signupRes.json()) as { code: string };
      expect(signupBody.code).toBe('SERVICE_UNAVAILABLE');

      // Recovery: fail-closed -> 503
      const recoveryReq = new Request('http://localhost:3000/api/auth/forget-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'recovery@example.com' }),
      });
      const recoveryRes = await POST(recoveryReq, { params: Promise.resolve({ path: ['forget-password'] }) });
      expect(recoveryRes.status).toBe(503);
    });
  });

  describe('Server Actions (loginAction & signupAction)', () => {
    it('loginAction with limiter outage does not crash and returns normal auth failure', async () => {
      state.redisOutage = true;
      state.signInResponse = { data: null, error: { message: 'Invalid credentials' } };

      const fd = new FormData();
      fd.append('email', 'test@example.com');
      fd.append('password', 'wrong-pass-1');

      const result = await loginAction(null, fd);
      expect(result).toEqual({ error: 'Invalid credentials' });
    });

    it('loginAction when rate-limited returns user message and skips signIn', async () => {
      const email = 'target@example.com';
      const hash = hashEmailForRateLimit(email);
      // Set count to 11 to trigger block (> 10)
      state.counts.set(`login:email:${hash}`, 11);

      const fd = new FormData();
      fd.append('email', email);
      fd.append('password', 'anypassword');

      const result = await loginAction(null, fd);
      expect(result).toEqual({ error: 'Too many attempts. Please wait a moment and try again.' });
      expect(auth.signIn.email).not.toHaveBeenCalled();
    });

    it('signupAction blocks weak passwords and skips signUp', async () => {
      const fd = new FormData();
      fd.append('ownerName', 'Jane');
      fd.append('email', 'jane@example.com');
      fd.append('password', 'password123');
      fd.append('confirmPassword', 'password123');

      const result = await signupAction(null, fd);
      expect(result).toEqual({ error: 'This password is too common. Please choose a different one.' });
      expect(auth.signUp.email).not.toHaveBeenCalled();
    });

    it('signupAction blocks mismatched passwords with legacy error', async () => {
      const fd = new FormData();
      fd.append('ownerName', 'Jane');
      fd.append('email', 'jane@example.com');
      fd.append('password', 'correct horse battery');
      fd.append('confirmPassword', 'different horse battery');

      const result = await signupAction(null, fd);
      expect(result).toEqual({ error: 'Passwords do not match.' });
      expect(auth.signUp.email).not.toHaveBeenCalled();
    });

    it('signupAction with limiter outage returns temporarily unavailable', async () => {
      state.redisOutage = true;

      const fd = new FormData();
      fd.append('ownerName', 'Jane');
      fd.append('email', 'jane@example.com');
      fd.append('password', 'correct horse battery');
      fd.append('confirmPassword', 'correct horse battery');

      const result = await signupAction(null, fd);
      expect(result).toEqual({
        error: 'This service is temporarily unavailable. Please try again in a few minutes.',
      });
      expect(auth.signUp.email).not.toHaveBeenCalled();
    });

    it('successful loginAction calls ensureAppUser and redirects to /dashboard', async () => {
      const fd = new FormData();
      fd.append('email', 'valid@example.com');
      fd.append('password', 'ValidPassphrase123');

      await expect(loginAction(null, fd)).rejects.toThrow('NEXT_REDIRECT:/dashboard');
      expect(state.ensureAppUserMock).toHaveBeenCalledWith({
        authUserId: 'usr_123',
        displayName: 'User',
        email: 'user@example.com',
      });
    });

    it('ensureAppUser rejection does NOT prevent login redirect', async () => {
      state.ensureAppUserMock.mockRejectedValueOnce(new Error('DB failure'));

      const fd = new FormData();
      fd.append('email', 'valid@example.com');
      fd.append('password', 'ValidPassphrase123');

      // Still redirects successfully to dashboard
      await expect(loginAction(null, fd)).rejects.toThrow('NEXT_REDIRECT:/dashboard');
    });

    it('thrown error with body.message returns that message, while unknown error returns generic text', async () => {
      state.signInThrows = { body: { message: 'Your account has been deactivated.' } };

      const fd1 = new FormData();
      fd1.append('email', 'valid@example.com');
      fd1.append('password', 'ValidPassphrase123');
      const res1 = await loginAction(null, fd1);
      expect(res1).toEqual({ error: 'Your account has been deactivated.' });

      // Unknown/raw internal error
      state.signInThrows = new Error('Database connection reset at 10.0.0.1:5432');
      const res2 = await loginAction(null, fd1);
      expect(res2).toEqual({ error: 'We could not sign you in right now. Please try again.' });
      expect(res2.error).not.toContain('Database');
    });
  });
});
