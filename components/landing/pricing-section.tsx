'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthModal } from '@/components/auth/auth-modal-context'
import { PLAN_CATALOG, formatPlanPrice } from '@/lib/subscriptions/plan-catalog'

/** B7: asked only when a plan button is clicked, so the home page itself can stay static. */
async function isSignedIn(): Promise<boolean> {
  try {
    const { authClient } = await import('@/lib/auth/client')
    const session = await authClient.getSession()
    return Boolean(session?.data?.user)
  } catch {
    return false
  }
}

export function PricingSection() {
  const router = useRouter()
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('monthly')
  const { openSignup } = useAuthModal()

  const handlePlanSelect = async (plan: 'free' | 'essentials' | 'professional') => {
    const isLoggedIn = await isSignedIn()
    if (plan === 'free') {
      if (isLoggedIn) {
        router.push('/dashboard')
      } else {
        openSignup()
      }
      return
    }

    const cycleParam = billingCycle === 'annual' ? 'yearly' : 'monthly'
    if (isLoggedIn) {
      router.push(`/checkout?plan=${plan}&cycle=${cycleParam}`)
    } else {
      openSignup()
    }
  }

  const cycle = billingCycle === 'annual' ? 'yearly' : 'monthly'
  const freePlan = PLAN_CATALOG.free
  const essentialsPlan = PLAN_CATALOG.essentials
  const professionalPlan = PLAN_CATALOG.professional

  const essPrice = formatPlanPrice('essentials', cycle)
  const proPrice = formatPlanPrice('professional', cycle)

  return (
    <section id="pricing" aria-labelledby="pricing-heading" className="scroll-mt-24 px-5 py-8 sm:px-8 sm:py-10 relative overflow-hidden">
      <div className="orb orb-3"></div>
      <div className="max-w-6xl mx-auto relative z-10">
        <div className="text-center mb-7 sm:mb-8">
          <span className="reveal in inline-block text-xs font-bold text-amber-900 bg-amber-50 border border-amber-200 rounded-full px-3 py-1 mb-2 tracking-wide uppercase">
            <svg className="w-4 h-4 inline mr-1.5">
              <use href="#diamond" />
            </svg>{' '}
            Simple Pricing
          </span>
          <h2 id="pricing-heading" className="reveal in text-3xl sm:text-4xl font-bold heading">Fair pricing, built for growth</h2>
          <p className="reveal in text-zinc-600 mt-2 text-base sm:text-lg">
            Start free, upgrade when you need to. No hidden charges.
          </p>

          {/* Billing Cycle Toggle */}
          <div role="group" aria-label="Billing cycle" className="reveal in inline-flex items-center gap-1 border border-slate-200 bg-slate-100 p-1 rounded-full mt-4">
            <button
              type="button" aria-pressed={billingCycle === 'monthly'} onClick={() => setBillingCycle('monthly')}
              className={`min-h-10 px-3.5 sm:px-4 rounded-full text-base font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 cursor-pointer ${
                billingCycle === 'monthly'
                  ? 'bg-white text-zinc-900 shadow'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              Monthly
            </button>
            <button
              type="button" aria-pressed={billingCycle === 'annual'} onClick={() => setBillingCycle('annual')}
              className={`min-h-10 px-3.5 sm:px-4 rounded-full text-base font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 inline-flex items-center gap-1.5 cursor-pointer ${
                billingCycle === 'annual'
                  ? 'bg-white text-zinc-900 shadow'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              Annual
              <span className="whitespace-nowrap text-xs text-emerald-800 font-bold bg-emerald-50 px-1.5 py-0.5 rounded">
                Save {essPrice.savingsPercent}%
              </span>
            </button>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-5 md:gap-3 xl:gap-4 items-stretch">
          {/* Plan 1: Free */}
          <div className="reveal in card-hover bg-white border border-zinc-200 rounded-2xl p-4 lg:p-5 flex flex-col justify-between hover:border-zinc-300">
            <div>
              <div className="font-semibold text-zinc-500 text-sm uppercase tracking-wide">{freePlan.name}</div>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-5xl font-bold heading text-zinc-900">₹0</span>
                <span className="text-zinc-600 text-base">/mo</span>
              </div>
              <p className="text-zinc-600 text-sm mt-1.5">{freePlan.tagline}</p>
              <div className="border-t border-zinc-100 my-3.5"></div>
              <ul className="space-y-2 text-zinc-700 text-base leading-snug">
                {freePlan.features.map((feat, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <svg aria-hidden="true" className="mt-0.5 w-4 h-4 shrink-0">
                      <use href="#check-circle" />
                    </svg>
                    <span>{feat.label}</span>
                  </li>
                ))}
              </ul>
            </div>
            <button
              type="button" onClick={() => void handlePlanSelect('free')}
              className="block w-full text-center border-2 border-zinc-200 hover:border-indigo-600 hover:text-indigo-600 text-zinc-700 font-semibold min-h-11 px-2 py-2 rounded-xl transition-colors mt-4 text-base cursor-pointer"
            >
              Start Free
            </button>
          </div>

          {/* Plan 2: Essentials (Popular) */}
          <div className="reveal in card-hover bg-white border-2 border-indigo-600 rounded-2xl p-4 lg:p-5 flex flex-col justify-between relative shadow-xl shadow-indigo-100/50">
            <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 border border-amber-300 bg-amber-100 text-amber-950 font-bold text-xs px-4 py-1 rounded-full uppercase tracking-wider shadow">
              Most Popular
            </span>
            <div>
              <div className="font-semibold text-indigo-600 text-sm uppercase tracking-wide">
                {essentialsPlan.name}
              </div>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-5xl font-bold heading text-zinc-900">
                  {essPrice.headline}
                </span>
                <span className="text-zinc-600 text-base">/mo</span>
              </div>
              <p className="text-zinc-600 text-sm mt-1.5">
                {essPrice.note}
              </p>
              <div className="border-t border-indigo-100 my-3.5"></div>
              <ul className="space-y-2 text-zinc-700 text-base leading-snug">
                {essentialsPlan.features.map((feat, idx) => (
                  feat.status === 'included' ? (
                    <li key={idx} className="flex items-start gap-2">
                      <svg aria-hidden="true" className="mt-0.5 w-4 h-4 shrink-0">
                        <use href="#check-circle" />
                      </svg>
                      <span className={idx === 0 ? "font-medium text-zinc-800" : ""}>{feat.label}</span>
                    </li>
                  ) : (
                    <li key={idx} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-zinc-700">
                      <span>{feat.label}</span>
                      <span className="text-xs font-semibold bg-zinc-100 text-zinc-700 border border-zinc-200 px-1.5 py-0.5 rounded-md whitespace-nowrap shrink-0">
                        Coming soon
                      </span>
                    </li>
                  )
                ))}
              </ul>
            </div>
            <button
              type="button" onClick={() => void handlePlanSelect('essentials')}
              className="btn-shine-violet block w-full text-center bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-semibold min-h-11 px-2 py-2 rounded-xl transition-colors mt-4 text-base glow-btn cursor-pointer"
            >
              Get Started →
            </button>
          </div>

          {/* Plan 3: Professional */}
          <div className="reveal in card-hover bg-white border border-zinc-200 rounded-2xl p-4 lg:p-5 flex flex-col justify-between hover:border-zinc-300 relative">
            <div>
              <div className="font-semibold text-zinc-500 text-sm uppercase tracking-wide">
                {professionalPlan.name}
              </div>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-5xl font-bold heading text-zinc-900">
                  {proPrice.headline}
                </span>
                <span className="text-zinc-600 text-base">/mo</span>
              </div>
              <p className="text-zinc-600 text-sm mt-1.5">
                {proPrice.note}
              </p>
              <div className="border-t border-zinc-100 my-3.5"></div>
              <ul className="space-y-2 text-zinc-700 text-base leading-snug">
                {professionalPlan.features.map((feat, idx) => (
                  feat.status === 'included' ? (
                    <li key={idx} className="flex items-start gap-2">
                      <svg aria-hidden="true" className="mt-0.5 w-4 h-4 shrink-0">
                        <use href="#check-circle" />
                      </svg>
                      <span className="font-medium text-zinc-800">{feat.label}</span>
                    </li>
                  ) : (
                    <li key={idx} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-zinc-700">
                      <span>{feat.label}</span>
                      <span className="text-xs font-semibold bg-zinc-100 text-zinc-700 border border-zinc-200 px-1.5 py-0.5 rounded-md whitespace-nowrap shrink-0">
                        Coming soon
                      </span>
                    </li>
                  )
                ))}
              </ul>
            </div>
            <button
              type="button" onClick={() => void handlePlanSelect('professional')}
              className="btn-shine-violet block w-full text-center bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-semibold min-h-11 px-2 py-2 rounded-xl transition-colors mt-4 text-base glow-btn cursor-pointer"
            >
              Get Started →
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
