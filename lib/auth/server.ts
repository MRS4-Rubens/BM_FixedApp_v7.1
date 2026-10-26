import { createNeonAuth } from '@neondatabase/auth/next/server';
import { getAuthEnv } from '@/lib/env';

const env = getAuthEnv();

// This instance provides .handler() for the API route, .middleware() for proxy.ts, .getSession() for reading the current session, and all sign-in/sign-up/sign-out methods used in Server Actions below.
export const auth = createNeonAuth({
  baseUrl: env.NEON_AUTH_BASE_URL,
  cookies: { secret: env.NEON_AUTH_COOKIE_SECRET },
});
