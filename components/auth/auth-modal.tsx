'use client'

import { usePageScrollLock } from '@/lib/hooks/use-page-scroll-lock'

import { useState, useEffect, useRef, useActionState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { InvoiceBizFolioLogo } from '@/components/brand/invoice-bizfolio-logo'
import {
  Eye,
  EyeOff,
  X,
  Mail,
  Lock,
  User,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react'
import { useAuthModal } from './auth-modal-context'
import { loginAction } from '@/app/(auth)/login/actions'
import { signupAction } from '@/app/(auth)/signup/actions'
import { VerifyEmailCodeForm } from './verify-email-code-form'
import type { AuthActionState } from '@/lib/validations/auth'
import { SUPPORT_EMAIL } from '@/lib/config/contact'
import { useIsClient } from '@/lib/hooks/use-is-client'

const socialButtonClass = 'flex min-h-11 min-w-0 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-stone-200 bg-white px-1 py-1.5 text-xs font-medium whitespace-nowrap text-slate-700 transition-colors hover:border-indigo-200 hover:bg-indigo-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 min-[400px]:flex-row min-[400px]:gap-1.5 sm:text-sm'

export function AuthenticationModal() {
  const { isOpen, mode, openLogin, openSignup, closeModal } = useAuthModal()

  const mounted = useIsClient()
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [passwordInput, setPasswordInput] = useState('')
  const [shake, setShake] = useState(false)

  // Login Action State
  const [loginState, loginFormAction, loginPending] = useActionState(loginAction, null)
  // Signup Action State
  const [signupState, signupFormAction, signupPending] = useActionState(signupAction, null)
  // LAUNCH-L4: replies that asked for a code but whose code screen the person has left (it stays closed for them).
  const [dismissedVerifyStates, setDismissedVerifyStates] = useState<readonly AuthActionState[]>([])
  const modeState = mode === 'login' ? loginState : signupState
  const verifyEmail =
    modeState?.verifyEmail && !dismissedVerifyStates.includes(modeState) ? modeState.verifyEmail : null
  const dismissVerifyScreen = () =>
    setDismissedVerifyStates((list) => [...list, ...[loginState, signupState].filter((state) => state !== null)])

  const modalRef = useRef<HTMLDivElement>(null)
  const lastActiveElementRef = useRef<HTMLElement | null>(null)

  // Restore focus to trigger button when closed
  useEffect(() => {
    if (isOpen) {
      lastActiveElementRef.current = document.activeElement as HTMLElement
    } else {
      if (lastActiveElementRef.current) {
        lastActiveElementRef.current.focus()
      }
    }
  }, [isOpen])

  usePageScrollLock(isOpen)

  // ESC key to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        closeModal()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, closeModal])

  // Focus trap inside the modal
  useEffect(() => {
    if (!isOpen) return

    const modal = modalRef.current
    if (!modal) return

    const focusableSelector =
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    const focusableElements = Array.from(modal.querySelectorAll<HTMLElement>(focusableSelector))

    if (focusableElements.length === 0) return

    const firstElement = focusableElements[0]
    const lastElement = focusableElements[focusableElements.length - 1]

    // Set initial focus to the code box (LAUNCH-L4), else the email input, else first element
    const firstInput =
      modal.querySelector<HTMLInputElement>('input[name="code"]') ??
      modal.querySelector<HTMLInputElement>('input[name="email"]:not([type="hidden"])')
    if (firstInput) {
      firstInput.focus()
    } else {
      firstElement.focus()
    }

    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return

      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          lastElement.focus()
          e.preventDefault()
        }
      } else {
        if (document.activeElement === lastElement) {
          firstElement.focus()
          e.preventDefault()
        }
      }
    }

    window.addEventListener('keydown', handleTab)
    return () => window.removeEventListener('keydown', handleTab)
  }, [isOpen, mode, verifyEmail])

  // Trigger shake animation when form state error changes
  // While the code screen is open it shows its own messages.
  const activeError = verifyEmail ? undefined : modeState?.error
  const activeNotice = mode === 'signup' && !verifyEmail ? signupState?.notice : undefined
  useEffect(() => {
    if (activeError) {
      const frame = requestAnimationFrame(() => setShake(true))
      const timer = setTimeout(() => setShake(false), 500)
      return () => {
        cancelAnimationFrame(frame)
        clearTimeout(timer)
      }
    }
  }, [activeError])

  if (!mounted || !isOpen) return null

  // Password strength logic
  const getPasswordStrength = (pass: string) => {
    if (!pass) return { score: 0, label: '', color: 'bg-zinc-200' }
    let score = 0
    if (pass.length >= 6) score++
    if (pass.length >= 8 && /[A-Z]/.test(pass) && /[a-z]/.test(pass)) score++
    if (/\d/.test(pass)) score++
    if (/[^A-Za-z0-9]/.test(pass)) score++

    const labels = ['', 'Weak', 'Fair', 'Good', 'Strong']
    const colors = [
      'bg-zinc-200',
      'bg-rose-500', // Weak
      'bg-amber-400', // Fair
      'bg-indigo-500', // Good
      'bg-emerald-500', // Strong
    ]
    return { score, label: labels[score], color: colors[score] }
  }

  const { score: strengthScore, label: strengthLabel, color: strengthColor } =
    getPasswordStrength(passwordInput)

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      closeModal()
    }
  }

  return createPortal(
    <div
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/55 backdrop-blur-sm"
      aria-modal="true"
      role="dialog"
      aria-labelledby="auth-modal-title"
    >
      <div
        ref={modalRef}
        style={{
          width: '100%',
          maxWidth: mode === 'login' ? '460px' : '520px',
          scrollbarWidth: 'none',
        }}
        data-viewport-dialog className={`relative w-full mx-auto bg-[#fffefc] border border-stone-200 shadow-2xl rounded-2xl p-4 sm:p-5 flex flex-col items-center max-h-[92dvh] overflow-y-auto ${
          shake ? 'animate-shake' : ''
        }`}
      >
        {/* Close Button */}
        <button
          onClick={closeModal}
          type="button"
          aria-label="Close dialog"
          className="absolute right-4 top-4 rounded-full p-2 text-slate-500 hover:bg-zinc-100 hover:text-zinc-700 transition cursor-pointer"
        >
          <X className="size-5" />
        </button>

        {/* Brand Header */}
        <div className="flex flex-col items-center text-center w-full mb-3">
          <InvoiceBizFolioLogo className="mb-2 w-44" />

          <h2
            id="auth-modal-title"
            className="text-2xl sm:text-3xl font-bold text-zinc-950 tracking-tight"
          >
            {verifyEmail ? 'Confirm your e-mail' : mode === 'login' ? 'Welcome back!' : 'Create your account'}
          </h2>
          <p className="mt-1 text-sm sm:text-base text-slate-600">
            {verifyEmail
              ? 'Enter the 6-digit code we e-mailed you.'
              : mode === 'login'
                ? 'Sign in to your Invoice BizFolio account.'
                : 'Start your 14-day free trial. No credit card required.'}
          </p>
        </div>

        {/* Error Alert Banner */}
        {activeError && (
          <div role="alert" className="w-full mb-3 rounded-xl bg-rose-50 border border-rose-200/80 p-2.5 sm:p-3 flex items-center gap-2.5 text-sm font-medium text-rose-700">
            <AlertCircle className="size-5 shrink-0 text-rose-500" />
            <span>{activeError}</span>
          </div>
        )}

        {activeNotice && (
          <div
            role="status"
            className="w-full mb-3 rounded-xl bg-emerald-50 border border-emerald-200/80 p-2.5 sm:p-3 flex items-center gap-2.5 text-sm font-medium text-emerald-800"
          >
            <CheckCircle2 className="size-5 shrink-0 text-emerald-600" />
            <span>{activeNotice}</span>
          </div>
        )}

        {/* LAUNCH-L4: CODE SCREEN (after sign-up, or sign-in with an unconfirmed e-mail) */}
        {verifyEmail && (
          <VerifyEmailCodeForm
            key={verifyEmail}
            email={verifyEmail}
            initialNotice={modeState?.notice}
            onChangeEmail={dismissVerifyScreen}
            onGoToSignIn={() => {
              dismissVerifyScreen()
              openLogin()
            }}
          />
        )}

        {/* LOGIN FORM */}
        {mode === 'login' && !verifyEmail && (
          <form className="w-full space-y-2.5" action={loginFormAction}>
            {/* Email Field */}
            <div>
              <label
                className="mb-1.5 block text-base font-medium text-slate-900"
                htmlFor="login-email"
              >
                Email
              </label>
              <div className="relative flex items-center">
                <Mail className="absolute left-3.5 size-4.5 text-slate-500 pointer-events-none" />
                <input
                  id="login-email"
                  type="email"
                  name="email"
                  placeholder="you@company.com"
                  style={{ paddingLeft: '2.75rem' }}
                  className="w-full h-11 rounded-xl border border-stone-200 bg-stone-50/70 hover:bg-white focus:bg-white pr-3.5 text-base text-zinc-900 placeholder:text-slate-500 focus:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-600/20 transition"
                  required
                />
              </div>
            </div>

            {/* Password Field */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  className="text-base font-medium text-slate-900"
                  htmlFor="login-password"
                >
                  Password
                </label>

              </div>
              <div className="relative flex items-center">
                <Lock className="absolute left-3.5 size-4.5 text-slate-500 pointer-events-none" />
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  placeholder="••••••••"
                  style={{ paddingLeft: '2.75rem', paddingRight: '2.75rem' }}
                  className="w-full h-11 rounded-xl border border-stone-200 bg-stone-50/70 hover:bg-white focus:bg-white text-base text-zinc-900 placeholder:text-slate-500 focus:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-600/20 transition"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-3 text-slate-500 hover:text-zinc-700 transition cursor-pointer p-1"
                >
                  {showPassword ? <EyeOff className="size-4.5" /> : <Eye className="size-4.5" />}
                </button>
              </div>
              <div className="mt-1.5 flex justify-end">
                <a
                  href={`mailto:${SUPPORT_EMAIL}?subject=Password%20Reset%20Request%20-%20Invoice%20BizFolio`}
                  className="text-sm font-medium text-indigo-700 hover:text-indigo-900 hover:underline transition"
                >
                  Forgot password?
                </a>
              </div>
            </div>

            {/* Remember Me */}
            <div className="flex items-center justify-between pt-0.5">
              <label htmlFor="login-remember-me" className="flex items-center gap-2.5 text-sm text-slate-600 select-none cursor-pointer">
                <input
                  id="login-remember-me"
                  type="checkbox"
                  name="rememberMe"
                  className="rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500 focus:ring-offset-0 size-4.5 cursor-pointer"
                />
                Remember me
              </label>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loginPending}
              className="w-full h-11 sm:h-12 inline-flex justify-center items-center gap-2 rounded-xl bg-indigo-700 hover:bg-indigo-800 text-white font-semibold text-base transition-all shadow-sm disabled:opacity-50 disabled:pointer-events-none active:scale-[0.99] cursor-pointer mt-1"
            >
              {loginPending ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  Signing in...
                </span>
              ) : (
                'Sign in'
              )}
            </button>

            {/* Switch to Signup */}
            <p className="text-center text-sm sm:text-base text-slate-600 pt-1.5">
              Don&apos;t have an account?{' '}
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault()
                  openSignup()
                }}
                className="font-bold text-indigo-700 hover:text-indigo-900 hover:underline transition cursor-pointer"
              >
                Sign up free
              </button>
            </p>
          </form>
        )}

        {/* SIGNUP FORM */}
        {mode === 'signup' && !verifyEmail && (
          <form className="w-full space-y-2.5" action={signupFormAction}>
            {/* Row 1: Owner Name */}
            <div>
              <label
                className="mb-1 block text-base font-medium text-slate-900"
                htmlFor="signup-owner"
              >
                Full name <span className="text-rose-700">*</span>
              </label>
              <div className="relative flex items-center">
                <User className="absolute left-3.5 size-4.5 text-slate-500 pointer-events-none" />
                <input
                  id="signup-owner"
                  type="text"
                  name="ownerName"
                  placeholder="Rajesh Mehta"
                  style={{ paddingLeft: '2.75rem' }}
                  className="w-full h-10.5 rounded-xl border border-stone-200 bg-stone-50/70 hover:bg-white focus:bg-white pr-3.5 text-base text-slate-950 placeholder:text-slate-500 focus:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-600/20 transition"
                  required
                />
              </div>
            </div>

            {/* Row 2: Email address */}
            <div>
              <label
                className="mb-1 block text-base font-medium text-slate-900"
                htmlFor="signup-email"
              >
                Email address <span className="text-rose-700">*</span>
              </label>
              <div className="relative flex items-center">
                <Mail className="absolute left-3.5 size-4.5 text-slate-500 pointer-events-none" />
                <input
                  id="signup-email"
                  type="email"
                  name="email"
                  placeholder="you@company.com"
                  style={{ paddingLeft: '2.75rem' }}
                  className="w-full h-10.5 rounded-xl border border-stone-200 bg-stone-50/70 hover:bg-white focus:bg-white pr-3.5 text-base text-slate-950 placeholder:text-slate-500 focus:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-600/20 transition"
                  required
                />
              </div>
            </div>

            {/* Row 3: Password + Confirm password */}
            <div className="grid gap-3.5 sm:grid-cols-2">
              <div>
                <label
                  className="mb-1 block text-base font-medium text-slate-900"
                  htmlFor="signup-pass"
                >
                  Password <span className="text-rose-700">*</span>
                </label>
                <div className="relative flex items-center">
                  <Lock className="absolute left-3.5 size-4.5 text-slate-500 pointer-events-none" />
                  <input
                    id="signup-pass"
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    placeholder="••••••••"
                    value={passwordInput}
                    onChange={(e) => setPasswordInput(e.target.value)}
                    style={{ paddingLeft: '2.75rem', paddingRight: '2.75rem' }}
                    className="w-full h-10.5 rounded-xl border border-stone-200 bg-stone-50/70 hover:bg-white focus:bg-white text-base text-slate-950 placeholder:text-slate-500 focus:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-600/20 transition"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-3 text-slate-500 hover:text-zinc-700 transition cursor-pointer p-1"
                  >
                    {showPassword ? <EyeOff className="size-4.5" /> : <Eye className="size-4.5" />}
                  </button>
                </div>
              </div>

              <div>
                <label
                  className="mb-1 block text-base font-medium text-slate-900"
                  htmlFor="signup-confirm"
                >
                  Confirm password <span className="text-rose-700">*</span>
                </label>
                <div className="relative flex items-center">
                  <Lock className="absolute left-3.5 size-4.5 text-slate-500 pointer-events-none" />
                  <input
                    id="signup-confirm"
                    type={showConfirmPassword ? 'text' : 'password'}
                    name="confirmPassword"
                    placeholder="••••••••"
                    style={{ paddingLeft: '2.75rem', paddingRight: '2.75rem' }}
                    className="w-full h-10.5 rounded-xl border border-stone-200 bg-stone-50/70 hover:bg-white focus:bg-white text-base text-slate-950 placeholder:text-slate-500 focus:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-600/20 transition"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                    className="absolute right-3 text-slate-500 hover:text-zinc-700 transition cursor-pointer p-1"
                  >
                    {showConfirmPassword ? <EyeOff className="size-4.5" /> : <Eye className="size-4.5" />}
                  </button>
                </div>
              </div>
            </div>

            {/* Password Strength Meter */}
            {passwordInput && (
              <div className="pt-0.5">
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-slate-600">Strength</span>
                  <span className="font-bold uppercase tracking-wider text-zinc-700">
                    {strengthLabel}
                  </span>
                </div>
                <div className="flex gap-1.5">
                  {[1, 2, 3, 4].map((index) => (
                    <div
                      key={index}
                      className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${
                        index <= strengthScore ? strengthColor : 'bg-zinc-100'
                      }`}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Terms Checkbox */}
            <div className="flex items-start gap-2.5 pt-0.5">
              <input
                type="checkbox"
                id="terms"
                required
                className="mt-0.5 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500 focus:ring-offset-0 size-4 cursor-pointer shrink-0"
              />
              <label
                htmlFor="terms"
                className="text-sm text-slate-600 leading-normal select-none cursor-pointer"
              >
                I agree to the{' '}
                <Link
                  href="/terms"
                  target="_blank"
                  className="text-indigo-700 font-medium hover:underline"
                >
                  Terms of Service
                </Link>{' '}
                and{' '}
                <Link
                  href="/privacy"
                  target="_blank"
                  className="text-indigo-700 font-medium hover:underline"
                >
                  Privacy Policy
                </Link>
              </label>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={signupPending}
              className="w-full h-10.5 sm:h-11 inline-flex justify-center items-center gap-2 rounded-xl bg-indigo-700 hover:bg-indigo-800 text-white font-semibold text-sm sm:text-base transition-all shadow-sm disabled:opacity-50 disabled:pointer-events-none active:scale-[0.99] cursor-pointer mt-1"
            >
              {signupPending ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  Creating account...
                </span>
              ) : (
                'Create account'
              )}
            </button>

            {/* Switch to Login */}
            <p className="text-center text-sm text-slate-600 pt-1">
              Already have an account?{' '}
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault()
                  openLogin()
                }}
                className="font-bold text-indigo-700 hover:text-indigo-900 hover:underline transition cursor-pointer"
              >
                Sign in
              </button>
            </p>
          </form>
        )}
        {!verifyEmail && <SocialSignInPreview key={mode} />}
      </div>
    </div>,
    document.body
  )
}

function SocialSignInPreview() {
  const [provider, setProvider] = useState<string | null>(null)
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (dismissTimer.current !== null) clearTimeout(dismissTimer.current)
  }, [])

  function showPreview(name: string) {
    if (dismissTimer.current !== null) clearTimeout(dismissTimer.current)
    setProvider(name)
    dismissTimer.current = setTimeout(() => {
      setProvider(null)
      dismissTimer.current = null
    }, 5000)
  }

  return (
    <div className="mt-3 w-full">
      <p className="mb-2 flex items-center gap-2 text-center text-sm font-medium text-slate-600 before:h-px before:flex-1 before:bg-stone-200 after:h-px after:flex-1 after:bg-stone-200">
        Continue Sign-in using
      </p>
      <div className="grid grid-cols-3 gap-1.5">
        <button type="button" onClick={() => showPreview('Google')} className={socialButtonClass}>
          <svg aria-hidden="true" viewBox="0 0 48 48" className="size-4 shrink-0">
            <path fill="#4285F4" d="M43.61 24.46c0-1.36-.12-2.67-.34-3.93H24v7.44h11.02a9.42 9.42 0 0 1-4.09 6.18v5.14h6.61c3.87-3.57 6.07-8.83 6.07-14.83Z" />
            <path fill="#34A853" d="M24 44c5.51 0 10.13-1.82 13.54-4.71l-6.61-5.14c-1.83 1.22-4.17 1.94-6.93 1.94-5.33 0-9.85-3.6-11.47-8.44H5.71v5.3A20 20 0 0 0 24 44Z" />
            <path fill="#FBBC05" d="M12.53 27.65a12 12 0 0 1 0-7.3v-5.3H5.71a20 20 0 0 0 0 17.9l6.82-5.3Z" />
            <path fill="#EA4335" d="M24 11.91c3 0 5.69 1.03 7.81 3.05l5.86-5.86C34.12 5.79 29.51 4 24 4A20 20 0 0 0 5.71 15.05l6.82 5.3C14.15 15.51 18.67 11.91 24 11.91Z" />
          </svg>
          Google
        </button>
        <button type="button" onClick={() => showPreview('LinkedIn')} className={socialButtonClass}>
          <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 shrink-0">
            <rect width="24" height="24" rx="2" fill="#0A66C2" />
            <path fill="#fff" d="M4 9h3.5v11H4zm1.75-5a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM10 9h3.3v1.5h.05c.46-.87 1.58-1.8 3.25-1.8 3.48 0 4.12 2.28 4.12 5.24V20h-3.45v-5.37c0-1.28-.02-2.93-1.78-2.93-1.79 0-2.06 1.4-2.06 2.84V20H10z" />
          </svg>
          LinkedIn
        </button>
        <button type="button" onClick={() => showPreview('Microsoft 365')} className={socialButtonClass}>
          <svg aria-hidden="true" viewBox="0 0 23 23" className="size-4 shrink-0">
            <path fill="#F25022" d="M0 0h11v11H0z" />
            <path fill="#7FBA00" d="M12 0h11v11H12z" />
            <path fill="#00A4EF" d="M0 12h11v11H0z" />
            <path fill="#FFB900" d="M12 12h11v11H12z" />
          </svg>
          Microsoft 365
        </button>
      </div>
      <div role="status">
        {provider && (
          <p className="mt-2 text-center text-sm leading-snug text-slate-600">
            {provider} sign-in is coming soon. Continue with email and password.
          </p>
        )}
      </div>
    </div>
  )
}
