import { auth } from '@/lib/auth/server';
import { classifyAuthRoute } from '@/lib/auth/auth-path';
import {
  enforceLoginRateLimit,
  enforceRecoveryRateLimit,
  enforceSignupRateLimit,
  type AuthRateLimitResult,
} from '@/lib/auth/auth-rate-limit';
import { getClientIp } from '@/lib/rate-limit/upstash';

// All Neon Auth API calls (sign-in, sign-up, session refresh, …) are served by this single catch-all.
// AUTH-002: state-changing auth calls are rate-limited HERE (the identity boundary), not only in the UI Server Actions.
const handlers = auth.handler();
type PostArgs = Parameters<(typeof handlers)['POST']>;
type PostResult = ReturnType<(typeof handlers)['POST']>;

const MAX_BODY_BYTES_FOR_EMAIL = 8 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Best-effort e-mail extraction from a JSON body WITHOUT consuming the original request (uses clone()). */
async function readEmailFromBody(request: Request): Promise<string | null> {
  const contentType = request.headers.get('content-type');
  if (!contentType || !contentType.toLowerCase().includes('application/json')) {
    return null;
  }
  try {
    const raw = await request.clone().text();
    if (raw.length > MAX_BODY_BYTES_FOR_EMAIL) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (isRecord(parsed) && typeof parsed.email === 'string') {
      const email = parsed.email.trim();
      if (email.length > 0 && email.length <= 254) {
        return email;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function blockedResponse(result: Extract<AuthRateLimitResult, { allowed: false }>): Response {
  const status = result.reason === 'limited' ? 429 : 503;
  const message =
    result.reason === 'limited'
      ? 'Too many requests. Please try again later.'
      : 'Service temporarily unavailable. Please try again shortly.';
  return Response.json(
    {
      message,
      code: result.reason === 'limited' ? 'RATE_LIMITED' : 'SERVICE_UNAVAILABLE',
    },
    {
      status,
      headers: { 'Retry-After': String(result.retryAfterSeconds) },
    }
  );
}

export const GET = handlers.GET;

export async function POST(...args: PostArgs): PostResult {
  const [request] = args;
  const kind = classifyAuthRoute(request.method, new URL(request.url).pathname);
  if (kind !== null) {
    const ip = getClientIp(request.headers);
    const email = kind === 'signup' ? null : await readEmailFromBody(request);
    const result =
      kind === 'login'
        ? await enforceLoginRateLimit({ ip, email })
        : kind === 'signup'
          ? await enforceSignupRateLimit({ ip })
          : await enforceRecoveryRateLimit({ ip, email });
    if (!result.allowed) {
      return blockedResponse(result);
    }
  }
  return handlers.POST(...args);
}
