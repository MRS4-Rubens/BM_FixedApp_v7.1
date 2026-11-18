'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth/server';
import { ensureAppUser } from '@/lib/auth/ensure-app-user';
import { enforceSignupRateLimit, rateLimitUserMessage } from '@/lib/auth/auth-rate-limit';
import { getClientIp } from '@/lib/rate-limit/upstash';
import {
  extractAuthErrorMessage,
  readFormString,
  signupFormSchema,
  VERIFICATION_CODE_TTL_MINUTES,
  type AuthActionState,
} from '@/lib/validations/auth';
import { logError } from '@/lib/actions/_shared/logger';
import { takePendingInvitePath } from '@/lib/team/pending-invite-cookie';

export async function signupAction(
  _prevState: AuthActionState | null,
  formData: FormData
): Promise<AuthActionState> {
  // 1. Validate form fields and password policy
  const ownerName = readFormString(formData, 'ownerName');
  const email = readFormString(formData, 'email');
  const password = readFormString(formData, 'password');
  const confirmPassword = readFormString(formData, 'confirmPassword');

  const parsed = signupFormSchema.safeParse({
    ownerName,
    email,
    password,
    confirmPassword,
  });
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]?.message ?? 'Please fill in all required fields.';
    return { error: firstIssue };
  }

  // 2. Enforce shared rate limiting (fail-closed)
  const ip = getClientIp(await headers());
  const limit = await enforceSignupRateLimit({ ip });
  if (!limit.allowed) {
    return { error: rateLimitUserMessage(limit) };
  }

  // 3. Create identity in Neon Auth
  let requiresVerification = false;
  try {
    const signUpResponse = await auth.signUp.email({
      email: parsed.data.email,
      password: parsed.data.password,
      name: parsed.data.ownerName,
    });

    const apiError = signUpResponse?.error;
    if (apiError) {
      return { error: apiError.message || 'Signup failed' };
    }

    // 4. Provision local app user row (self-healing, does not fail signup)
    if (signUpResponse?.data?.user) {
      try {
        await ensureAppUser({
          authUserId: signUpResponse.data.user.id,
          displayName: parsed.data.ownerName,
          email: parsed.data.email,
        });
      } catch {
        // Logged inside ensureAppUser; do not block signup
      }

      if ('token' in signUpResponse.data && signUpResponse.data.token === null) {
        // Neon Auth "Verify at Sign-up" is enabled: no session exists yet (AUTH-001 seam).
        requiresVerification = true;
      }
    }
  } catch (error: unknown) {
    logError('signup-action', error);
    return {
      error: extractAuthErrorMessage(error) ?? 'We could not create your account right now. Please try again.',
    };
  }

  // 5. Complete signup: notice if verification required, else redirect to dashboard
  // LAUNCH-L4: Neon Auth has already e-mailed a 6-digit code; the modal now shows the code-entry screen.
  if (requiresVerification) {
    return {
      verifyEmail: parsed.data.email,
      notice: `Account created. We sent a 6-digit code to ${parsed.data.email}. It expires in ${VERIFICATION_CODE_TTL_MINUTES} minutes.`,
    };
  }

  // Feature A: someone who started from a team invite link goes back to that invite instead of the dashboard.
  redirect((await takePendingInvitePath()) ?? '/dashboard');
}
