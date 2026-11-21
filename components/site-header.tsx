'use client'

import { useState } from 'react'
import Link from 'next/link'
import { InvoiceBizFolioLogo } from '@/components/brand/invoice-bizfolio-logo'
import { useAuthModal } from '@/components/auth/auth-modal-context'
import { 
  Menu, 
  X, 
  Sparkles, 
  BarChart3, 
  Layers, 
  CreditCard, 
  HelpCircle, 
  ArrowRight,
  Calculator
} from 'lucide-react'

interface SiteHeaderProps {
  scrolled?: boolean
}

export function SiteHeader({ scrolled }: SiteHeaderProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const { openLogin, openSignup } = useAuthModal()

  return (
    <header
      id="nav"
      className={`fixed top-0 inset-x-0 z-50 transition-[background-color,box-shadow] duration-300 ${
        scrolled
          ? 'bg-[#fcfaf6f2] backdrop-blur-xl shadow-[0_4px_16px_#2925240d] border-b border-stone-200 py-2.5'
          : 'bg-[#fcfaf6e6] backdrop-blur-xl border-b border-stone-200/70 py-2.5'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-3">
        <InvoiceBizFolioLogo href="/" className="w-40 sm:w-44" />

        {/* Desktop Navigation Links */}
        <nav className="hidden xl:flex items-center gap-1 rounded-xl border border-stone-200/80 bg-stone-100/75 p-1 text-base font-medium text-slate-700">
          <Link
            href="/#features"
            className="whitespace-nowrap rounded-lg px-2.5 py-1.5 hover:text-teal-900 hover:bg-white transition-colors 2xl:px-3.5"
          >
            Features
          </Link>
          <Link
            href="/#dashboard"
            className="whitespace-nowrap rounded-lg px-2.5 py-1.5 hover:text-teal-900 hover:bg-white transition-colors 2xl:px-3.5 flex items-center gap-1.5"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 ring-2 ring-emerald-500/15"></span>
            Live Simulator
          </Link>
          <Link
            href="/#calculator"
            className="whitespace-nowrap rounded-lg px-2.5 py-1.5 hover:text-teal-900 hover:bg-white transition-colors 2xl:px-3.5"
          >
            ROI Calculator
          </Link>
          <Link
            href="/#how"
            className="whitespace-nowrap rounded-lg px-2.5 py-1.5 hover:text-teal-900 hover:bg-white transition-colors 2xl:px-3.5"
          >
            How it Works
          </Link>
          <Link
            href="/#pricing"
            className="whitespace-nowrap rounded-lg px-2.5 py-1.5 hover:text-teal-900 hover:bg-white transition-colors 2xl:px-3.5"
          >
            Pricing
          </Link>
          <Link
            href="/#faq"
            className="whitespace-nowrap rounded-lg px-2.5 py-1.5 hover:text-teal-900 hover:bg-white transition-colors 2xl:px-3.5"
          >
            FAQ
          </Link>
        </nav>

        {/* Desktop Actions */}
        <div className="hidden sm:flex shrink-0 items-center gap-2">
          <button
            onClick={openLogin}
            className="text-base font-semibold text-slate-800 hover:text-slate-950 px-3 py-2 rounded-lg hover:bg-stone-100 transition-colors cursor-pointer"
          >
            Sign In
          </button>
          <button
            onClick={openSignup}
            className="group inline-flex min-h-10 items-center gap-2 whitespace-nowrap rounded-lg border border-indigo-800/20 bg-indigo-700 px-3.5 text-base font-semibold text-white shadow-[inset_0_1px_0_#ffffff26,0_3px_8px_#3730a325] transition-colors hover:bg-indigo-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 cursor-pointer"
          >
            <span>Start free</span>
            <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
          </button>
        </div>

        {/* Mobile Menu Button */}
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="xl:hidden p-2 rounded-lg text-slate-700 hover:text-slate-900 hover:bg-slate-100 transition-colors"
          aria-label="Toggle navigation menu"
          aria-expanded={mobileMenuOpen}
        >
          {mobileMenuOpen ? <X className="w-6 h-6 text-red-500 dark:text-red-400" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Mobile Drawer Menu */}
      {mobileMenuOpen && (
        <div className="xl:hidden fixed inset-x-4 top-16 max-h-[calc(100dvh-5rem)] overflow-y-auto bg-[#fcfaf6f2] backdrop-blur-2xl border border-slate-200 rounded-2xl p-3 shadow-xl space-y-2 z-50 animate-fadeIn">
          <div className="space-y-1">
            <Link
              href="/#features"
              onClick={() => setMobileMenuOpen(false)}
              className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-slate-700 hover:bg-indigo-50/80 hover:text-indigo-700 transition font-medium text-base"
            >
              <Sparkles className="w-4 h-4 text-indigo-600" />
              Features
            </Link>
            <Link
              href="/#dashboard"
              onClick={() => setMobileMenuOpen(false)}
              className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-slate-700 hover:bg-indigo-50/80 hover:text-indigo-700 transition font-medium text-base"
            >
              <BarChart3 className="w-4 h-4 text-indigo-600" />
              Live GST Simulator
            </Link>
            <Link
              href="/#calculator"
              onClick={() => setMobileMenuOpen(false)}
              className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-slate-700 hover:bg-indigo-50/80 hover:text-indigo-700 transition font-medium text-base"
            >
              <Calculator className="w-4 h-4 text-indigo-600" />
              ROI & Savings Calculator
            </Link>
            <Link
              href="/#how"
              onClick={() => setMobileMenuOpen(false)}
              className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-slate-700 hover:bg-indigo-50/80 hover:text-indigo-700 transition font-medium text-base"
            >
              <Layers className="w-4 h-4 text-indigo-600" />
              How it Works
            </Link>
            <Link
              href="/#pricing"
              onClick={() => setMobileMenuOpen(false)}
              className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-slate-700 hover:bg-indigo-50/80 hover:text-indigo-700 transition font-medium text-base"
            >
              <CreditCard className="w-4 h-4 text-indigo-600" />
              Pricing Plans
            </Link>
            <Link
              href="/#faq"
              onClick={() => setMobileMenuOpen(false)}
              className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-slate-700 hover:bg-indigo-50/80 hover:text-indigo-700 transition font-medium text-base"
            >
              <HelpCircle className="w-4 h-4 text-indigo-600" />
              Frequently Asked Questions
            </Link>
          </div>

          <div className="pt-3 border-t border-slate-100 flex flex-col gap-2">
            <button
              onClick={() => {
                setMobileMenuOpen(false)
                openLogin()
              }}
              className="w-full text-center py-3 rounded-xl text-slate-700 font-semibold text-sm hover:bg-slate-50 transition cursor-pointer"
            >
              Sign In to Your Account
            </button>
            <button
              onClick={() => {
                setMobileMenuOpen(false)
                openSignup()
              }}
              className="w-full text-center py-3.5 rounded-xl bg-indigo-700 hover:bg-indigo-800 text-white font-semibold text-base shadow-sm cursor-pointer flex items-center justify-center gap-2"
            >
              <span>Start free</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </header>
  )
}
