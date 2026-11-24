'use client'

import { useActionState, useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, KeyRound } from 'lucide-react'
import { resendSignupCodeAction, verifySignupCodeAction } from '@/app/(auth)/signup/verify-actions'
import { VERIFICATION_CODE_TTL_MINUTES } from '@/lib/validations/auth'

/** Seconds the "Resend code" button waits after a resend (the server also rate-limits). */
const RESEND_COOLDOWN_SECONDS = 30

interface VerifyEmailCodeFormProps {
  email: string
  /** First message to show (from sign-up or sign-in), before any action on this screen. */
  initialNotice?: string
  /** Leave the code screen (e.g. wrong address): back to the sign-up form. */
  onChangeEmail: () => void
  /** The address was confirmed but no session was created: go to the sign-in form. */
  onGoToSignIn: () => void
}

/** LAUNCH-L4 (docs/LAUNCH_CHECKLIST.md 2.3): 6-digit code entry with "Resend code". Codes only, never links. */
export function VerifyEmailCodeForm({ email, initialNotice, onChangeEmail, onGoToSignIn }: VerifyEmailCodeFormProps) {
  const [verifyState, verifyAction, verifyPending] = useActionState(verifySignupCodeAction, null)
  const [resendState, resendAction, resendPending] = useActionState(resendSignupCodeAction, null)
  const [code, setCode] = useState('')
  const [cooldown, setCooldown] = useState(0)
  // Which form was used last, so its reply is the one shown.
  const [latest, setLatest] = useState<'verify' | 'resend' | null>(null)
  const submitVerify = (formData: FormData) => {
    setLatest('verify')
    verifyAction(formData)
  }
  const submitResend = (formData: FormData) => {
    setLatest('resend')
    resendAction(formData)
  }

  // Start the cooldown after each successful resend.
  useEffect(() => {
    if (!resendState?.notice) return
    const start = requestAnimationFrame(() => setCooldown(RESEND_COOLDOWN_SECONDS))
    return () => cancelAnimationFrame(start)
  }, [resendState])

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  if (verifyState?.verified) {
    return (
      <div className="w-full space-y-3">
        <div role="status" className="w-full rounded-xl bg-emerald-50 border border-emerald-200/80 p-3 flex items-center gap-2.5 text-sm font-medium text-emerald-800">
          <CheckCircle2 className="size-5 shrink-0 text-emerald-600" />
          <span>{verifyState.notice}</span>
        </div>
        <button
          type="button"
          onClick={onGoToSignIn}
          className="btn-shine-indigo w-full h-11 inline-flex justify-center items-center rounded-xl bg-indigo-700 hover:bg-indigo-800 text-white font-semibold text-base transition-all shadow-sm cursor-pointer"
        >
          Go to sign in
        </button>
      </div>
    )
  }

  // The reply to the form used last wins; before any action, show the sign-up / sign-in notice.
  const latestState = latest === 'verify' ? verifyState : latest === 'resend' ? resendState : null
  const error = latestState?.error
  const notice = latestState ? latestState.notice : initialNotice

  return (
    <div className="w-full space-y-3">
      {error && (
        <div role="alert" className="w-full rounded-xl bg-rose-50 border border-rose-200/80 p-2.5 sm:p-3 flex items-center gap-2.5 text-sm font-medium text-rose-700">
          <AlertCircle className="size-5 shrink-0 text-rose-500" />
          <span>{error}</span>
        </div>
      )}
      {!error && notice && (
        <div role="status" className="w-full rounded-xl bg-emerald-50 border border-emerald-200/80 p-2.5 sm:p-3 flex items-center gap-2.5 text-sm font-medium text-emerald-800">
          <CheckCircle2 className="size-5 shrink-0 text-emerald-600" />
          <span>{notice}</span>
        </div>
      )}

      <form className="w-full space-y-2.5" action={submitVerify}>
        <input type="hidden" name="email" value={email} />
        <div>
          <label className="mb-1.5 block text-base font-medium text-slate-900" htmlFor="verify-code">
            6-digit code
          </label>
          <div className="relative flex items-center">
            <KeyRound className="absolute left-3.5 size-4.5 text-slate-500 pointer-events-none" />
            <input
              id="verify-code"
              name="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              placeholder="123456"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              aria-describedby="verify-code-help"
              style={{ paddingLeft: '2.75rem' }}
              className="w-full h-11 rounded-xl border border-stone-200 bg-stone-50/70 hover:bg-white focus:bg-white pr-3.5 text-lg tracking-[0.4em] text-zinc-900 placeholder:tracking-normal placeholder:text-slate-500 focus:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-600/20 transition"
              required
            />
          </div>
          <p id="verify-code-help" className="mt-1.5 text-sm text-slate-600">
            Sent to <span className="font-medium text-slate-900 break-all">{email}</span>. The code works for {VERIFICATION_CODE_TTL_MINUTES} minutes. Check your spam folder if you can&apos;t see it.
          </p>
        </div>
        <button
          type="submit"
          disabled={verifyPending || code.length !== 6}
          className="btn-shine-indigo w-full h-11 sm:h-12 inline-flex justify-center items-center rounded-xl bg-indigo-700 hover:bg-indigo-800 text-white font-semibold text-base transition-all shadow-sm disabled:opacity-50 disabled:pointer-events-none active:scale-[0.99] cursor-pointer"
        >
          {verifyPending ? 'Checking…' : 'Confirm e-mail'}
        </button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <form action={submitResend}>
          <input type="hidden" name="email" value={email} />
          <button
            type="submit"
            disabled={resendPending || cooldown > 0}
            className="font-semibold text-indigo-700 hover:text-indigo-900 hover:underline disabled:text-slate-500 disabled:no-underline disabled:cursor-not-allowed cursor-pointer"
          >
            {resendPending ? 'Sending…' : cooldown > 0 ? `Resend code (${cooldown}s)` : 'Resend code'}
          </button>
        </form>
        <button
          type="button"
          onClick={onChangeEmail}
          className="font-medium text-slate-600 hover:text-zinc-900 hover:underline cursor-pointer"
        >
          Use a different e-mail
        </button>
      </div>
    </div>
  )
}
