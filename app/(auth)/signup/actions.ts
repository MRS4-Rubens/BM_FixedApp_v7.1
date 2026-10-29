'use server'

import { auth } from '@/lib/auth/server'
import { redirect } from 'next/navigation'
import { ensureAppUser } from '@/lib/auth/ensure-app-user'
import { headers } from 'next/headers'
import { authLimiter, checkRateLimit, getClientIp } from '@/lib/rate-limit/upstash'

export async function signupAction(prevState: any, formData: FormData): Promise<{ error?: string; notice?: string }> {
  const name = formData.get('ownerName') as string;
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;
  const confirmPassword = formData.get('confirmPassword') as string;
  
  if (!name || !email || !password || !confirmPassword) {
    return { error: 'Please fill in all required fields.' };
  }
  
  if (password !== confirmPassword) {
    return { error: 'Passwords do not match.' };
  }

  const ip = getClientIp(await headers());
  const { allowed } = await checkRateLimit(authLimiter, `auth:${ip}`);
  if (!allowed) {
    return { error: 'Too many attempts. Please wait a moment and try again.' };
  }
  
  try {
    const signUpResponse = await auth.signUp.email({ email, password, name });
    
    // Better Auth (which Neon Auth wraps) usually returns data/error or throws.
    // We check for error property just in case.
    if (signUpResponse && signUpResponse.error) {
       return { error: signUpResponse.error.message || 'Signup failed' };
    }

    if (signUpResponse && signUpResponse.data && signUpResponse.data.user) {
      await ensureAppUser({
        authUserId: signUpResponse.data.user.id,
        displayName: name,
        email: email
      });

      if ('token' in signUpResponse.data && signUpResponse.data.token === null) {
        // Neon Auth "Verify at Sign-up" is enabled: no session exists yet.
        return { notice: 'Account created. Please check your e-mail to verify your address, then log in.' };
      }
    }
  } catch (err: any) {
    return { error: err.body?.message || err.message || 'An unexpected error occurred during signup' };
  }
  
  redirect('/dashboard');
}
