'use server';

import { headers } from 'next/headers';
import { enforceRecoveryRateLimit, rateLimitUserMessage } from '@/lib/auth/auth-rate-limit';
import { validatePasswordPolicy } from '@/lib/auth/password-policy';
import { auth } from '@/lib/auth/server';
import { getClientIp } from '@/lib/rate-limit/upstash';
import { siteOrigin } from '@/lib/seo/routes';
import { readFormString, resendCodeFormSchema } from '@/lib/validations/auth';

type ResetState = { error?: string; done?: true; invalidLink?: true };

export async function requestResetLinkAction(
  _previousState: ResetState | null,
  formData: FormData,
): Promise<ResetState> {
  const parsed = resendCodeFormSchema.safeParse({ email: readFormString(formData, 'email') });
  if (!parsed.success) return { error: 'Enter a valid email address.' };

  const { email } = parsed.data;
  const limit = await enforceRecoveryRateLimit({ ip: getClientIp(await headers()), email });
  if (!limit.allowed) return { error: rateLimitUserMessage(limit) };

  const error = 'We could not send a reset link right now. Please try again later.';
  try {
    const result = await auth.requestPasswordReset({
      email,
      redirectTo: new URL('/reset-password', siteOrigin()).href,
    });
    // Preserve Neon's neutral response for unknown accounts and avoid showing raw provider errors.
    return result.data?.status === true ? { done: true } : { error };
  } catch {
    return { error };
  }
}

export async function resetPasswordAction(
  _previousState: ResetState | null,
  formData: FormData,
): Promise<ResetState> {
  const token = readFormString(formData, 'token');
  if (!token || token.length > 512) return { invalidLink: true };

  const password = readFormString(formData, 'password');
  const policy = validatePasswordPolicy(password);
  if (!policy.ok) return { error: policy.message };
  if (password !== readFormString(formData, 'confirmPassword')) {
    return { error: 'Passwords do not match.' };
  }

  const limit = await enforceRecoveryRateLimit({ ip: getClientIp(await headers()), email: null });
  if (!limit.allowed) return { error: rateLimitUserMessage(limit) };

  const error = 'We could not reset your password right now. Please try again later.';
  try {
    const result = await auth.resetPassword({ token, newPassword: password });
    if (result.error) {
      const { code } = result.error;
      if (code === 'INVALID_TOKEN' || code === 'TOKEN_EXPIRED' || code === 'bad_jwt') {
        return { invalidLink: true };
      }
      return { error };
    }
    return result.data?.status === true ? { done: true } : { error };
  } catch {
    return { error };
  }
}
