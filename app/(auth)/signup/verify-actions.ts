'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth/server';
import { ensureAppUser } from '@/lib/auth/ensure-app-user';
import {
  enforceLoginRateLimit,
  enforceRecoveryRateLimit,
  rateLimitUserMessage,
} from '@/lib/auth/auth-rate-limit';
import { getClientIp } from '@/lib/rate-limit/upstash';
import {
  readFormString,
  resendCodeFormSchema,
  VERIFICATION_CODE_TTL_MINUTES,
  verifyCodeFormSchema,
  type AuthActionState,
} from '@/lib/validations/auth';
import { logError } from '@/lib/actions/_shared/logger';
import { takePendingInvitePath } from '@/lib/team/pending-invite-cookie';

/**
 * LAUNCH-L4 (docs/LAUNCH_CHECKLIST.md 2.3): sign-up e-mail confirmation by 6-digit code (no links).
 *
 * These Server Actions call Neon Auth directly, so they do NOT pass through the /api/auth rate limits;
 * each one enforces its own limit here:
 *  - verify: the login limiters (10 per e-mail / 30 per IP per 15 min, fail-open), so a few typos never lock anyone out.
 *    Neon Auth also limits wrong guesses per code on its side.
 *  - resend: the recovery limiters (3 per e-mail / 10 per IP per 15 min, fail-closed), because each one sends an e-mail.
 */

const WRONG_CODE_MESSAGE = 'That code is wrong or has expired. Check the latest e-mail, or tap "Resend code".';

export async function verifySignupCodeAction(
  _prevState: AuthActionState | null,
  formData: FormData
): Promise<AuthActionState> {
  const email = readFormString(formData, 'email');
  const parsed = verifyCodeFormSchema.safeParse({ email, code: readFormString(formData, 'code') });
  if (!parsed.success) {
    return { verifyEmail: email, error: parsed.error.issues[0]?.message ?? 'Enter the 6-digit code from the e-mail.' };
  }

  const ip = getClientIp(await headers());
  const limit = await enforceLoginRateLimit({ ip, email: parsed.data.email });
  if (!limit.allowed) {
    return { verifyEmail: parsed.data.email, error: rateLimitUserMessage(limit) };
  }

  let signedIn = false;
  try {
    const response = await auth.emailOtp.verifyEmail({ email: parsed.data.email, otp: parsed.data.code });
    if (response?.error) {
      // Never echo provider text here: it could reveal whether an address has an account.
      return { verifyEmail: parsed.data.email, error: WRONG_CODE_MESSAGE };
    }
    const data = response?.data as { token?: unknown; user?: { id?: unknown; name?: unknown; email?: unknown } } | null;
    const user = data?.user;
    if (user && typeof user.id === 'string') {
      try {
        await ensureAppUser({
          authUserId: user.id,
          displayName: typeof user.name === 'string' ? user.name : null,
          email: typeof user.email === 'string' ? user.email : parsed.data.email,
        });
      } catch {
        // Logged inside ensureAppUser; the row self-heals on the next sign-in.
      }
    }
    // Auto sign-in after verification returns a session token (the session cookie is set by the auth server client).
    signedIn = typeof data?.token === 'string' && data.token.length > 0;
  } catch (error: unknown) {
    logError('verify-signup-code', error);
    return { verifyEmail: parsed.data.email, error: 'We could not check the code right now. Please try again.' };
  }

  if (!signedIn) {
    return { verified: true, notice: 'E-mail confirmed. Please sign in with your password.' };
  }
  redirect((await takePendingInvitePath()) ?? '/dashboard');
}

export async function resendSignupCodeAction(
  _prevState: AuthActionState | null,
  formData: FormData
): Promise<AuthActionState> {
  const email = readFormString(formData, 'email');
  const parsed = resendCodeFormSchema.safeParse({ email });
  if (!parsed.success) {
    return { verifyEmail: email, error: 'Please sign up again.' };
  }

  const ip = getClientIp(await headers());
  const limit = await enforceRecoveryRateLimit({ ip, email: parsed.data.email });
  if (!limit.allowed) {
    return { verifyEmail: parsed.data.email, error: rateLimitUserMessage(limit) };
  }

  // The same neutral reply whether or not the address has an account (no account discovery).
  const sentNotice = `If ${parsed.data.email} needs confirming, a new 6-digit code is on its way. It expires in ${VERIFICATION_CODE_TTL_MINUTES} minutes.`;
  try {
    // Sends whichever verification type is set in the Neon console (verification code, per our decision).
    const response = await auth.sendVerificationEmail({ email: parsed.data.email });
    if (response?.error && (response.error.status ?? 0) >= 500) {
      logError('resend-signup-code', new Error(`send-verification-email failed (${response.error.status})`));
      return { verifyEmail: parsed.data.email, error: 'We could not send a new code right now. Please try again in a few minutes.' };
    }
  } catch (error: unknown) {
    logError('resend-signup-code', error);
    return { verifyEmail: parsed.data.email, error: 'We could not send a new code right now. Please try again in a few minutes.' };
  }
  return { verifyEmail: parsed.data.email, notice: sentNotice };
}
