'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { requestResetLinkAction, resetPasswordAction } from '@/app/(auth)/reset-password/actions';
import { InvoiceBizFolioLogo } from '@/components/brand/invoice-bizfolio-logo';
import { Button } from '@/components/ui/button';
import { PASSWORD_MAX_LENGTH } from '@/lib/auth/password-policy';

type RecoveryFormProps = { mode: 'request' } | { mode: 'reset'; token: string };

const inputClass =
  'w-full rounded-xl border border-input bg-background px-3 py-2.5 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';
const linkClass = 'font-semibold text-indigo-700 underline underline-offset-4';

export function PasswordRecoveryForm(props: RecoveryFormProps) {
  const isRequest = props.mode === 'request';
  const token = props.mode === 'reset' ? props.token : '';
  const [state, action, pending] = useActionState(isRequest ? requestResetLinkAction : resetPasswordAction, null);
  const invalidLink = !isRequest && (!token || state?.invalidLink);
  const title = state?.done
    ? (isRequest ? 'Check your email' : 'Password updated')
    : isRequest ? 'Forgot your password?' : 'Set a new password';

  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center px-4 py-10">
      <section className="w-full space-y-5 rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-sm sm:p-8">
        <InvoiceBizFolioLogo />
        <h1 className="text-2xl font-bold text-foreground">{title}</h1>
        {invalidLink ? (
          <p role="alert" className="text-sm text-destructive">
            This reset link is invalid, expired, or already used.{' '}
            <Link href="/forgot-password" className={linkClass}>Request a new reset link</Link>.
          </p>
        ) : state?.done ? (
          <p role="status" className="text-sm text-muted-foreground">
            {isRequest
              ? 'If an account exists for that email, we’ll send a reset link. Check your spam folder if it doesn’t arrive.'
              : 'Sign in with your new password.'}
          </p>
        ) : (
          <form action={action} className="space-y-4">
            {state?.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
            {isRequest ? (
              <label className="block space-y-1.5 text-sm font-semibold">
                <span>Email address</span>
                <input className={inputClass} type="email" name="email" autoComplete="email" maxLength={254} required />
              </label>
            ) : (
              <>
                <input type="hidden" name="token" value={token} />
                <label className="block space-y-1.5 text-sm font-semibold">
                  <span>New password</span>
                  <input className={inputClass} type="password" name="password" autoComplete="new-password" maxLength={PASSWORD_MAX_LENGTH} required />
                </label>
                <label className="block space-y-1.5 text-sm font-semibold">
                  <span>Confirm new password</span>
                  <input className={inputClass} type="password" name="confirmPassword" autoComplete="new-password" maxLength={PASSWORD_MAX_LENGTH} required />
                </label>
              </>
            )}
            <Button type="submit" size="lg" disabled={pending} className="btn-shine-indigo w-full font-bold">
              {isRequest ? (pending ? 'Sending…' : 'Send reset link') : (pending ? 'Updating…' : 'Update password')}
            </Button>
          </form>
        )}
        <Link href="/login" className={linkClass}>Back to sign in</Link>
      </section>
    </main>
  );
}
