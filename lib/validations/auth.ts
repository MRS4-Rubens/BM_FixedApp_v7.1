import { z } from 'zod';
import { PASSWORD_MAX_LENGTH, validatePasswordPolicy } from '@/lib/auth/password-policy';

export interface AuthActionState {
  error?: string;
  notice?: string;
  /** LAUNCH-L4: set when the account exists but its e-mail must be confirmed with a code before sign-in. */
  verifyEmail?: string;
  /** LAUNCH-L4: the e-mail was confirmed but no session was created; the person must sign in. */
  verified?: boolean;
}

/** LAUNCH-L4: Neon Auth's verification codes expire after 15 minutes (neon.com/docs/auth/guides/email-verification). */
export const VERIFICATION_CODE_TTL_MINUTES = 15;

/**
 * Sign-in with an unconfirmed address ("Verify at Sign-up" on). Neon Auth's API answers `EMAIL_NOT_VERIFIED`; the
 * @neondatabase/auth server client renames it to `email_not_confirmed` (BETTER_AUTH_ERROR_MAP). Accept both.
 */
const EMAIL_NOT_VERIFIED_CODES: ReadonlySet<string> = new Set(['EMAIL_NOT_VERIFIED', 'email_not_confirmed']);

export function isEmailNotVerifiedCode(code: unknown): boolean {
  return typeof code === 'string' && EMAIL_NOT_VERIFIED_CODES.has(code);
}

export const verifyCodeFormSchema = z.object({
  email: z.string().trim().min(1, 'Please sign up again.').max(254, 'Email address is too long.').email('Please sign up again.'),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code from the e-mail.'),
});

export const resendCodeFormSchema = verifyCodeFormSchema.pick({ email: true });

export const loginFormSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'Please enter both email and password.')
    .max(254, 'Email address is too long.'),
  password: z
    .string()
    .min(1, 'Please enter both email and password.')
    .max(PASSWORD_MAX_LENGTH, 'Password is too long.'),
});

export const signupFormSchema = z
  .object({
    ownerName: z
      .string()
      .trim()
      .min(1, 'Please fill in all required fields.')
      .max(100, 'Name is too long.'),
    email: z
      .string()
      .trim()
      .min(1, 'Please fill in all required fields.')
      .max(254, 'Email address is too long.')
      .email('Please enter a valid email address.'),
    password: z
      .string()
      .min(1, 'Please fill in all required fields.')
      .max(PASSWORD_MAX_LENGTH, `Password must be at most ${PASSWORD_MAX_LENGTH} characters long.`),
    confirmPassword: z.string().min(1, 'Please fill in all required fields.'),
  })
  .superRefine((value, ctx) => {
    if (value.password !== value.confirmPassword) {
      ctx.addIssue({ code: 'custom', path: ['confirmPassword'], message: 'Passwords do not match.' });
      return;
    }
    const policy = validatePasswordPolicy(value.password, { email: value.email, name: value.ownerName });
    if (!policy.ok) {
      ctx.addIssue({ code: 'custom', path: ['password'], message: policy.message });
    }
  });

/** Reads a FormData entry as a string ('' when missing or a File) — avoids `as string` casts. */
export function readFormString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

/** Extracts an API error message from an auth response body (if present as a string), returning null otherwise. */
export function extractAuthErrorMessage(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }
  if ('body' in error) {
    const candidate = error as { body?: unknown };
    if (typeof candidate.body === 'object' && candidate.body !== null && 'message' in candidate.body) {
      const message = (candidate.body as { message?: unknown }).message;
      if (typeof message === 'string' && message.trim().length > 0) {
        return message;
      }
    }
  }
  return null;
}

