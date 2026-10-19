'use client'

import { useState, useEffect, useRef, useActionState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import {
  Eye,
  EyeOff,
  X,
  Mail,
  Lock,
  User,
  AlertCircle,
} from 'lucide-react'
import { useAuthModal } from './auth-modal-context'
import { loginAction } from '@/app/(auth)/login/actions'
import { signupAction } from '@/app/(auth)/signup/actions'
import { SUPPORT_EMAIL } from '@/lib/config/contact'

export function AuthenticationModal() {
  const { isOpen, mode, openLogin, openSignup, closeModal } = useAuthModal()

  const [mounted, setMounted] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [passwordInput, setPasswordInput] = useState('')
  const [shake, setShake] = useState(false)

  // Login Action State
  const [loginState, loginFormAction, loginPending] = useActionState(loginAction, null)
  // Signup Action State
  const [signupState, signupFormAction, signupPending] = useActionState(signupAction, null)

  const modalRef = useRef<HTMLDivElement>(null)
  const lastActiveElementRef = useRef<HTMLElement | null>(null)

  // Handle mounting on client side for Portals
  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 0)
    return () => {
      clearTimeout(timer)
      setMounted(false)
    }
  }, [])

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

  // Prevent background scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
      document.documentElement.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
      document.documentElement.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
      document.documentElement.style.overflow = ''
    }
  }, [isOpen])

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

    // Set initial focus to email input if exists, else first element
    const emailInput = modal.querySelector<HTMLInputElement>('input[name="email"]')
    if (emailInput) {
      emailInput.focus()
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
  }, [isOpen, mode])

  // Trigger shake animation when form state error changes
  const activeError = mode === 'login' ? loginState?.error : signupState?.error
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
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-zinc-950/60 backdrop-blur-md"
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
        className={`relative w-full mx-auto bg-white border border-zinc-200/90 shadow-2xl rounded-3xl p-5 sm:p-7 flex flex-col items-center max-h-[92dvh] overflow-y-auto ${
          shake ? 'animate-shake' : ''
        }`}
      >
        {/* Close Button */}
        <button
          onClick={closeModal}
          type="button"
          aria-label="Close dialog"
          className="absolute right-4 top-4 rounded-full p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 transition cursor-pointer"
        >
          <X className="size-5" />
        </button>

        {/* Brand Header */}
        <div className="flex flex-col items-center text-center w-full mb-4">
          <div className="flex items-center gap-2.5 mb-2">
            <span className="flex size-8 sm:size-9 items-center justify-center rounded-xl bg-indigo-600 font-bold text-white text-base shadow-md shadow-indigo-200">
              B
            </span>
            <span className="font-bold text-lg tracking-tight text-zinc-900">
              Bill Matrix
            </span>
          </div>

          <h2
            id="auth-modal-title"
            className="text-2xl sm:text-3xl font-bold text-zinc-950 tracking-tight"
          >
            {mode === 'login' ? 'Welcome back' : 'Create your account'}
          </h2>
          <p className="mt-1 text-sm sm:text-base text-zinc-500">
            {mode === 'login'
              ? 'Welcome back! Please enter your details.'
              : 'Start your 14-day free trial. No credit card required.'}
          </p>
        </div>

        {/* Error Alert Banner */}
        {activeError && (
          <div className="w-full mb-3 rounded-xl bg-rose-50 border border-rose-200/80 p-2.5 sm:p-3 flex items-center gap-2.5 text-sm font-medium text-rose-700">
            <AlertCircle className="size-5 shrink-0 text-rose-500" />
            <span>{activeError}</span>
          </div>
        )}

        {/* LOGIN FORM */}
        {mode === 'login' && (
          <form className="w-full space-y-3.5" action={loginFormAction}>
            {/* Email Field */}
            <div>
              <label
                className="mb-1.5 block text-sm font-semibold text-zinc-700"
                htmlFor="login-email"
              >
                Email
              </label>
              <div className="relative flex items-center">
                <Mail className="absolute left-3.5 size-4.5 text-zinc-400 pointer-events-none" />
                <input
                  id="login-email"
                  type="email"
                  name="email"
                  placeholder="you@company.com"
                  style={{ paddingLeft: '2.75rem' }}
                  className="w-full h-11 rounded-xl border border-zinc-200 bg-zinc-50/50 hover:bg-white focus:bg-white pr-3.5 text-base text-zinc-900 placeholder:text-zinc-400 focus:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-600/20 transition"
                  required
                />
              </div>
            </div>

            {/* Password Field */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  className="text-sm font-semibold text-zinc-700"
                  htmlFor="login-password"
                >
                  Password
                </label>
                <a
                  href={`mailto:${SUPPORT_EMAIL}?subject=Password%20Reset%20Request%20-%20Bill%20Matrix`}
                  className="text-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline transition"
                >
                  Forgot password?
                </a>
              </div>
              <div className="relative flex items-center">
                <Lock className="absolute left-3.5 size-4.5 text-zinc-400 pointer-events-none" />
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  placeholder="••••••••"
                  style={{ paddingLeft: '2.75rem', paddingRight: '2.75rem' }}
                  className="w-full h-11 rounded-xl border border-zinc-200 bg-zinc-50/50 hover:bg-white focus:bg-white text-base text-zinc-900 placeholder:text-zinc-400 focus:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-600/20 transition"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-3 text-zinc-400 hover:text-zinc-700 transition cursor-pointer p-1"
                >
                  {showPassword ? <EyeOff className="size-4.5" /> : <Eye className="size-4.5" />}
                </button>
              </div>
            </div>

            {/* Remember Me */}
            <div className="flex items-center justify-between pt-0.5">
              <label className="flex items-center gap-2.5 text-sm text-zinc-600 select-none cursor-pointer">
                <input
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
              className="w-full h-11 sm:h-12 inline-flex justify-center items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-base transition-all shadow-md shadow-indigo-100 hover:shadow-lg hover:shadow-indigo-200 disabled:opacity-50 disabled:pointer-events-none active:scale-[0.99] cursor-pointer mt-1"
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
            <p className="text-center text-sm sm:text-base text-zinc-500 pt-1.5">
              Don&apos;t have an account?{' '}
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault()
                  openSignup()
                }}
                className="font-bold text-indigo-600 hover:text-indigo-700 hover:underline transition cursor-pointer"
              >
                Sign up free
              </button>
            </p>
          </form>
        )}

        {/* SIGNUP FORM */}
        {mode === 'signup' && (
          <form className="w-full space-y-3" action={signupFormAction}>
            {/* Row 1: Owner Name */}
            <div>
              <label
                className="mb-1 block text-sm font-semibold text-zinc-700"
                htmlFor="signup-owner"
              >
                Full Name <span className="text-rose-500">*</span>
              </label>
              <div className="relative flex items-center">
                <User className="absolute left-3.5 size-4.5 text-zinc-400 pointer-events-none" />
                <input
                  id="signup-owner"
                  type="text"
                  name="ownerName"
                  placeholder="Rajesh Mehta"
                  style={{ paddingLeft: '2.75rem' }}
                  className="w-full h-10.5 rounded-xl border border-zinc-200 bg-zinc-50/50 hover:bg-white focus:bg-white pr-3.5 text-sm sm:text-base text-zinc-900 placeholder:text-zinc-400 focus:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-600/20 transition"
                  required
                />
              </div>
            </div>

            {/* Row 2: Email Address */}
            <div>
              <label
                className="mb-1 block text-sm font-semibold text-zinc-700"
                htmlFor="signup-email"
              >
                Email Address <span className="text-rose-500">*</span>
              </label>
              <div className="relative flex items-center">
                <Mail className="absolute left-3.5 size-4.5 text-zinc-400 pointer-events-none" />
                <input
                  id="signup-email"
                  type="email"
                  name="email"
                  placeholder="you@company.com"
                  style={{ paddingLeft: '2.75rem' }}
                  className="w-full h-10.5 rounded-xl border border-zinc-200 bg-zinc-50/50 hover:bg-white focus:bg-white pr-3.5 text-sm sm:text-base text-zinc-900 placeholder:text-zinc-400 focus:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-600/20 transition"
                  required
                />
              </div>
            </div>

            {/* Row 3: Password + Confirm Password */}
            <div className="grid gap-3.5 sm:grid-cols-2">
              <div>
                <label
                  className="mb-1 block text-sm font-semibold text-zinc-700"
                  htmlFor="signup-pass"
                >
                  Password <span className="text-rose-500">*</span>
                </label>
                <div className="relative flex items-center">
                  <Lock className="absolute left-3.5 size-4.5 text-zinc-400 pointer-events-none" />
                  <input
                    id="signup-pass"
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    placeholder="••••••••"
                    value={passwordInput}
                    onChange={(e) => setPasswordInput(e.target.value)}
                    style={{ paddingLeft: '2.75rem', paddingRight: '2.75rem' }}
                    className="w-full h-10.5 rounded-xl border border-zinc-200 bg-zinc-50/50 hover:bg-white focus:bg-white text-sm sm:text-base text-zinc-900 placeholder:text-zinc-400 focus:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-600/20 transition"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-3 text-zinc-400 hover:text-zinc-700 transition cursor-pointer p-1"
                  >
                    {showPassword ? <EyeOff className="size-4.5" /> : <Eye className="size-4.5" />}
                  </button>
                </div>
              </div>

              <div>
                <label
                  className="mb-1 block text-sm font-semibold text-zinc-700"
                  htmlFor="signup-confirm"
                >
                  Confirm Password <span className="text-rose-500">*</span>
                </label>
                <div className="relative flex items-center">
                  <Lock className="absolute left-3.5 size-4.5 text-zinc-400 pointer-events-none" />
                  <input
                    id="signup-confirm"
                    type={showConfirmPassword ? 'text' : 'password'}
                    name="confirmPassword"
                    placeholder="••••••••"
                    style={{ paddingLeft: '2.75rem', paddingRight: '2.75rem' }}
                    className="w-full h-10.5 rounded-xl border border-zinc-200 bg-zinc-50/50 hover:bg-white focus:bg-white text-sm sm:text-base text-zinc-900 placeholder:text-zinc-400 focus:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-600/20 transition"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                    className="absolute right-3 text-zinc-400 hover:text-zinc-700 transition cursor-pointer p-1"
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
                  <span className="text-zinc-500">Strength</span>
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
                className="text-xs sm:text-sm text-zinc-500 leading-normal select-none cursor-pointer"
              >
                I agree to the{' '}
                <Link
                  href="/terms"
                  target="_blank"
                  className="text-indigo-600 font-medium hover:underline"
                >
                  Terms of Service
                </Link>{' '}
                and{' '}
                <Link
                  href="/privacy"
                  target="_blank"
                  className="text-indigo-600 font-medium hover:underline"
                >
                  Privacy Policy
                </Link>
              </label>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={signupPending}
              className="w-full h-10.5 sm:h-11 inline-flex justify-center items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm sm:text-base transition-all shadow-md shadow-indigo-100 hover:shadow-lg hover:shadow-indigo-200 disabled:opacity-50 disabled:pointer-events-none active:scale-[0.99] cursor-pointer mt-1"
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
            <p className="text-center text-xs sm:text-sm text-zinc-500 pt-1">
              Already have an account?{' '}
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault()
                  openLogin()
                }}
                className="font-bold text-indigo-600 hover:text-indigo-700 hover:underline transition cursor-pointer"
              >
                Sign in
              </button>
            </p>
          </form>
        )}
      </div>
    </div>,
    document.body
  )
}
