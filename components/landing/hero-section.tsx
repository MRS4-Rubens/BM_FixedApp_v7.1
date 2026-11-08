'use client'

import Link from 'next/link'
import { useAuthModal } from '@/components/auth/auth-modal-context'

export function HeroSection() {
  const { openSignup } = useAuthModal()
  return (
    <section className="relative pt-32 pb-20 px-6 overflow-hidden">
      {/* Background Orbs */}
      <div className="orb orb-1"></div>
      <div className="orb orb-2"></div>
      <div className="orb orb-3"></div>
      <div className="orb orb-4"></div>

      <div className="max-w-5xl mx-auto text-center relative z-10">
        <div className="reveal in inline-flex items-center gap-2 bg-white/80 backdrop-blur-sm border border-indigo-200 rounded-full px-5 py-2 text-sm font-medium text-indigo-700 mb-8 shadow-lg shadow-indigo-100">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          GSTR-1 auto-export is live
          <svg className="w-4 h-4 text-indigo-400">
            <use href="#sparkle" />
          </svg>
        </div>

        <h1 className="reveal in text-5xl md:text-7xl font-extrabold tracking-tight leading-[1.05] heading">
          Invoice Smarter.<br />
          <span className="gradient-text">Comply Faster.</span> Grow Better.
        </h1>

        <p className="reveal in mt-6 text-lg md:text-xl text-zinc-500 max-w-2xl mx-auto leading-relaxed">
          Create GST-compliant invoices, track sales in real time, and export ITR-ready data in one click —{' '}
          <span className="text-zinc-700 font-medium">built for growing Indian businesses.</span>
        </p>

        <div className="reveal in mt-8 flex flex-wrap justify-center gap-4">
          <button
            onClick={openSignup}
            className="group bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white transition-all font-semibold px-8 py-4 rounded-full glow-btn text-lg inline-flex items-center gap-2 cursor-pointer"
          >
            Start free — no card needed
            <span className="group-hover:translate-x-1 transition-transform">→</span>
          </button>
          <Link
            href="#dashboard"
            className="group border-2 border-zinc-200 hover:border-indigo-300 bg-white/80 backdrop-blur-sm transition-all px-8 py-4 rounded-full font-medium text-lg inline-flex items-center gap-2 hover:bg-indigo-50"
          >
            <span className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 group-hover:scale-110 transition-transform">
              ▶
            </span>
            Watch live demo
          </Link>
        </div>

        <div className="reveal in mt-6 flex flex-wrap items-center justify-center gap-6 text-sm text-zinc-500">
          <span className="flex items-center gap-1.5">
            <svg className="w-5 h-5">
              <use href="#check-circle" />
            </svg>{' '}
            Free forever plan
          </span>
          <span className="flex items-center gap-1.5">
            <svg className="w-5 h-5">
              <use href="#check-circle" />
            </svg>{' '}
            No credit card
          </span>
          <span className="flex items-center gap-1.5">
            <svg className="w-5 h-5">
              <use href="#check-circle" />
            </svg>{' '}
            Setup in 5 minutes
          </span>
        </div>

        <div className="reveal in mt-12 grid grid-cols-3 gap-8 max-w-lg mx-auto">
          <div>
            <div className="text-4xl font-bold text-zinc-900 heading">
              4
            </div>
            <div className="text-sm text-zinc-500 mt-1 font-medium">Invoice templates</div>
          </div>
          <div>
            <div className="text-4xl font-bold text-zinc-900 heading">
              4
            </div>
            <div className="text-sm text-zinc-500 mt-1 font-medium">Excel reports (GSTR-1, HSN, Sales, ITR)</div>
          </div>
          <div>
            <div className="text-4xl font-bold text-emerald-700 heading">
              ₹0
            </div>
            <div className="text-sm text-zinc-500 mt-1 font-medium">To start</div>
          </div>
        </div>
      </div>
    </section>
  )
}
