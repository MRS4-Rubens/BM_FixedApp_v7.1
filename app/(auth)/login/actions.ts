'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth/server';
import { ensureAppUser } from '@/lib/auth/ensure-app-user';
import { enforceLoginRateLimit, rateLimitUserMessage } from '@/lib/auth/auth-rate-limit';
import { getClientIp } from '@/lib/rate-limit/upstash';
import {
  EMAIL_NOT_VERIFIED_CODE,
  extractAuthErrorMessage,
  loginFormSchema,
  readFormString,
  type AuthActionState,
} from '@/lib/validations/auth';
import { logError } from '@/lib/actions/_shared/logger';
import { takePendingInvitePath } from '@/lib/team/pending-invite-cookie';

export async function loginAction(
  _prevState: AuthActionState | null,
  formData: FormData
): Promise<AuthActionState> {
  // 1. Validate form fields
  const email = readFormString(formData, 'email');
  const password = readFormString(formData, 'password');

  const parsed = loginFormSchema.safeParse({ email, password });
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]?.message ?? 'Please enter both email and password.';
    return { error: firstIssue };
  }

  // 2. Enforce shared rate limiting (fail-open)
  const ip = getClientIp(await headers());
  const limit = await enforceLoginRateLimit({ ip, email: parsed.data.email });
  if (!limit.allowed) {
    return { error: rateLimitUserMessage(limit) };
  }

  // 3. Authenticate against Neon Auth
  try {
    const signInResponse = await auth.signIn.email({
      email: parsed.data.email,
      password: parsed.data.password,
    });

    const apiError = signInResponse?.error;
    if (apiError) {
      // LAUNCH-L4: the password was right but the e-mail is unconfirmed; show the code screen instead of a dead end.
      if (apiError.code === EMAIL_NOT_VERIFIED_CODE) {
        return {
          verifyEmail: parsed.data.email,
          notice: `Please confirm your e-mail first. Enter the 6-digit code we sent to ${parsed.data.email}, or tap "Resend code".`,
        };
      }
      return { error: apiError.message || 'Invalid credentials' };
    }

    if (signInResponse?.data?.user) {
      try {
        await ensureAppUser({
          authUserId: signInResponse.data.user.id,
          displayName: signInResponse.data.user.name || null,
          email: signInResponse.data.user.email || parsed.data.email,
        });
      } catch {
        // Logged inside ensureAppUser; do not block login as session self-heals
      }
    }
  } catch (error: unknown) {
    logError('login-action', error);
    return {
      error: extractAuthErrorMessage(error) ?? 'We could not sign you in right now. Please try again.',
    };
  }

  // 4. Redirect on success outside the try/catch. Feature A: someone who started from a team invite link
  //    goes back to that invite instead of the dashboard.
  redirect((await takePendingInvitePath()) ?? '/dashboard');
}
