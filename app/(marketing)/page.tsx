import type { Metadata } from 'next'
import { HeroSection } from '@/components/landing/hero-section'
import { LiveDashboard } from '@/components/landing/live-dashboard'
import { SecurityBand } from '@/components/landing/security-band'
import { FeaturesSection } from '@/components/landing/features-section'
import { CalculatorSection } from '@/components/landing/calculator-section'
import { HowItWorks } from '@/components/landing/how-it-works'
import { ComparisonTable } from '@/components/landing/comparison-table'
import { PricingSection } from '@/components/landing/pricing-section'
import { FaqSection } from '@/components/landing/faq-section'
import { AuthTriggerButton } from '@/components/auth/trigger-button'
import { ArrowRight, CheckCircle2 } from 'lucide-react'

export const metadata: Metadata = {
  alternates: {
    canonical: '/',
  },
}

// B7: the home page is the same for everyone, so it is served as a static page (no per-visit session lookup).
// The pricing buttons check "signed in?" only when clicked (PricingSection).
export default function MarketingHomePage() {
  return (
    <>
      {/* SVG Sprite Definition Block (Keep existing symbols) */}
      <svg style={{ display: 'none' }} xmlns="http://www.w3.org/2000/svg">
        <symbol id="sparkle" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2l1.5 5.5L19 7.5l-5 4.5 1.5 6L12 14.5l-5.5 3.5 1.5-6L3 7.5l5.5 0z" />
        </symbol>
        <symbol id="check-circle" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="11" fill="#10b981" />
          <path d="M7 12l3 3 7-7" stroke="white" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </symbol>
        <symbol id="check" viewBox="0 0 24 24">
          <path d="M5 13l4 4L19 7" stroke="#10b981" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </symbol>
        <symbol id="cross" viewBox="0 0 24 24">
          <path d="M6 6l12 12M18 6L6 18" stroke="#9ca3af" strokeWidth="2.5" strokeLinecap="round" />
        </symbol>
        <symbol id="lock" viewBox="0 0 24 24">
          <rect x="5" y="11" width="14" height="10" rx="2" fill="#f59e0b" />
          <path d="M8 11V7a4 4 0 018 0v4" stroke="#f59e0b" strokeWidth="2" fill="none" />
          <circle cx="12" cy="16" r="1.5" fill="white" />
        </symbol>
        <symbol id="india-flag" viewBox="0 0 48 32">
          <rect width="48" height="10.67" fill="#FF9933" />
          <rect y="10.67" width="48" height="10.66" fill="white" />
          <rect y="21.33" width="48" height="10.67" fill="#138808" />
          <circle cx="24" cy="16" r="4" fill="none" stroke="#000080" strokeWidth="1.5" />
          <circle cx="24" cy="16" r="1.5" fill="#000080" />
        </symbol>
        <symbol id="shield" viewBox="0 0 24 24">
          <path d="M12 2L4 5v6c0 5.5 3.8 10.7 8 12 4.2-1.3 8-6.5 8-12V5l-8-3z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </symbol>
        <symbol id="phone" viewBox="0 0 24 24">
          <path d="M6.62 10.79a15.05 15.05 0 006.59 6.59l2.2-2.2a1 1 0 011.06-.24 11.36 11.36 0 003.53.56 1 1 0 011 .98V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 01.98 1 11.36 11.36 0 00.56 3.53 1 1 0 01-.24 1.06l-2.18 2.2z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </symbol>
        <symbol id="invoice" viewBox="0 0 24 24">
          <path d="M4 2h16v20l-3-2-3 2-3-2-3 2V2z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          <line x1="8" y1="7" x2="16" y2="7" stroke="currentColor" strokeWidth="2" />
          <line x1="8" y1="11" x2="16" y2="11" stroke="currentColor" strokeWidth="2" />
          <line x1="8" y1="15" x2="12" y2="15" stroke="currentColor" strokeWidth="2" />
        </symbol>
        <symbol id="lightning" viewBox="0 0 24 24">
          <path d="M13 2L4.5 13H11l-1.5 9L19.5 11H13l1.5-9z" fill="currentColor" />
        </symbol>
        <symbol id="bar-chart" viewBox="0 0 24 24">
          <rect x="4" y="12" width="4" height="8" rx="1" fill="currentColor" />
          <rect x="10" y="8" width="4" height="12" rx="1" fill="currentColor" />
          <rect x="16" y="4" width="4" height="16" rx="1" fill="currentColor" />
        </symbol>
        <symbol id="folder" viewBox="0 0 24 24">
          <path d="M2 6a2 2 0 012-2h5l2 2h9a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        </symbol>
        <symbol id="users" viewBox="0 0 24 24">
          <circle cx="9" cy="7" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M1 21v-2a4 4 0 014-4h8a4 4 0 014 4v2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M17 11a4 4 0 010-8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M23 21v-2a4 4 0 00-3-3.87" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </symbol>
        <symbol id="chat-bubble" viewBox="0 0 24 24">
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" fill="currentColor" />
        </symbol>
        <symbol id="smartphone" viewBox="0 0 24 24">
          <rect x="5" y="2" width="14" height="20" rx="2" ry="2" fill="none" stroke="currentColor" strokeWidth="2" />
          <line x1="12" y1="18" x2="12" y2="18.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </symbol>
        <symbol id="star" viewBox="0 0 24 24">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="#f59e0b" />
        </symbol>
        <symbol id="diamond" viewBox="0 0 24 24">
          <path d="M12 2l8 10-8 10L4 12l8-10z" fill="currentColor" />
        </symbol>
        <symbol id="question" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
          <line x1="12" y1="17" x2="12.01" y2="17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </symbol>
        <symbol id="heart" viewBox="0 0 24 24">
          <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" fill="#ef4444" />
        </symbol>
        <symbol id="trending-up" viewBox="0 0 24 24">
          <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <polyline points="17 6 23 6 23 12" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </symbol>
        <symbol id="bell" viewBox="0 0 24 24">
          <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 01-3.46 0" />
        </symbol>
        <symbol id="refresh" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="23 4 23 10 17 10" />
          <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
        </symbol>
        <symbol id="clock" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </symbol>
        <symbol id="dollar" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="1" x2="12" y2="23" />
          <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
        </symbol>
        <symbol id="thumbs-up" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 9V5a3 3 0 00-3-3l-4 9v11h11.28a2 2 0 002-1.7l1.38-9a2 2 0 00-2-2.3H16zM7 22H4a2 2 0 01-2-2v-7a2 2 0 012-2h3" />
        </symbol>
      </svg>

      {/* Landing Page Content Sections */}
      <HeroSection />
      <LiveDashboard />
      <SecurityBand />
      <FeaturesSection />
      <CalculatorSection />
      <HowItWorks />
      <ComparisonTable />
      <PricingSection />
      <FaqSection />

      <section aria-labelledby="signup-heading" className="px-5 pb-8 pt-3 sm:px-8 sm:pb-10 sm:pt-4">
        <div className="mx-auto max-w-6xl rounded-3xl border border-emerald-400/15 bg-[radial-gradient(ellipse_at_top_left,#244038_0%,transparent_68%),linear-gradient(135deg,#202624,#151817)] px-4 py-6 text-center text-white shadow-[0_18px_40px_-25px_#15231c65] sm:px-8 sm:py-8">
          <div className="mx-auto max-w-3xl">
            <h2 id="signup-heading" className="text-balance text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
              Start invoicing with <span className="whitespace-nowrap text-emerald-200">Invoice BizFolio</span>
            </h2>

            <p className="mx-auto mt-2 max-w-2xl text-pretty text-base leading-relaxed text-slate-200 sm:text-xl">
              Create GST invoices, share them with customers, and keep your sales records ready for reporting.
            </p>

            <AuthTriggerButton
              mode="signup"
              className="group mt-4 inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-white px-5 py-2.5 text-lg font-semibold text-indigo-950 shadow-sm transition-colors hover:bg-indigo-50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-200 sm:w-auto"
            >
              Create a free account
              <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-indigo-700 motion-safe:transition-transform motion-safe:group-hover:translate-x-0.5" />
            </AuthTriggerButton>

            <ul className="mt-3.5 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-sm font-medium text-slate-200">
              {['Free forever plan', 'No credit card', 'GSTIN format validation'].map(benefit => (
                <li key={benefit} className="inline-flex items-center gap-1.5">
                  <CheckCircle2 aria-hidden="true" className="size-4 shrink-0 text-emerald-300" />
                  {benefit}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </>
  )
}
