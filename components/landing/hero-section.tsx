'use client'

import Link from 'next/link'
import { ArrowRight, Check, FileText, Megaphone, Play } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useAuthModal } from '@/components/auth/auth-modal-context'

const benefits = ['Free forever plan', 'No credit card', 'Setup in 5 minutes']
// Product facts only (never usage numbers we cannot prove). Each one is checked by
// tests/unit/landing-trust-guards.test.ts against the code it describes.
const productFacts = [
  { target: 0, prefix: '₹', label: 'To start (free plan)', color: 'text-stone-900' },
  { target: 36, prefix: '', label: 'States & UTs covered', color: 'text-stone-900' },
  { target: 4, prefix: '', label: 'GST & ITR Excel reports', color: 'text-emerald-700' },
]
const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-600'

function ProductFacts() {
  const strip = useRef<HTMLDivElement>(null)
  const [progress, setProgress] = useState(1)

  useEffect(() => {
    const element = strip.current
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (!element || motion.matches || !('IntersectionObserver' in window)) return

    let frame = 0
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return
      observer.disconnect()
      if (motion.matches) return

      const start = performance.now()
      setProgress(0)
      function animate(now: number) {
        const elapsed = Math.min((now - start) / 1500, 1)
        setProgress(motion.matches ? 1 : 1 - (1 - elapsed) ** 3)
        if (!motion.matches && elapsed < 1) frame = requestAnimationFrame(animate)
      }
      frame = requestAnimationFrame(animate)
    }, { threshold: 0.1 })
    observer.observe(element)

    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [])

  return (
    <div ref={strip} className="mt-4 max-w-lg rounded-xl border border-stone-200 bg-white/80">
      <dl className="grid grid-cols-3 divide-x divide-stone-200 py-3">
        {productFacts.map(({ target, prefix, label, color }) => {
          // Whole numbers only, so the count-up never shows odd in-between values.
          const current = Math.round(target * progress)

          return (
            <div key={label} className="flex flex-col gap-1 px-1 text-center">
              <dt className="text-sm leading-tight font-medium text-slate-700">{label}</dt>
              <dd className={`order-first whitespace-nowrap text-[clamp(1rem,5vw,1.875rem)] leading-none font-bold tracking-tight tabular-nums ${color}`}>
                <span aria-hidden="true">{prefix}{current}</span>
                <span className="sr-only">{prefix}{target}</span>
              </dd>
            </div>
          )
        })}
      </dl>
    </div>
  )
}

function InvoicePreview() {
  return (
    <figure className="min-w-0 overflow-hidden rounded-3xl border border-stone-200 bg-[radial-gradient(ellipse_at_top_left,#fff_0%,transparent_55%),linear-gradient(145deg,#f8f0e3,#eee3d2)] p-2.5 sm:p-4">
      <figcaption className="mb-2 flex items-center gap-2 px-1 text-sm font-semibold text-stone-800">
        <FileText aria-hidden="true" className="size-4" />
        Sample GST invoice
      </figcaption>

      <div className="rounded-2xl border border-slate-200/80 bg-white p-3 text-slate-900 shadow-[0_18px_45px_-24px_#57534e45] sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-2.5 border-b border-slate-200 pb-3">
          <div className="flex items-center gap-2.5">
            <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-lg bg-teal-900 text-xs font-bold text-white sm:size-11 sm:text-sm">
              SN
            </span>
            <div>
              <p className="text-lg font-bold leading-tight tracking-tight sm:text-[1.35rem]">Studio North</p>
              <p className="mt-0.5 text-sm leading-snug text-slate-600">12 Lake Rd, Pune</p>
            </div>
          </div>
          <div className="rounded-lg border border-stone-200 bg-stone-50 px-2 py-1.5 text-right sm:px-3">
            <p className="text-sm leading-tight font-bold text-stone-900">Tax Invoice</p>
            <p className="mt-0.5 font-mono text-xs leading-tight text-slate-700 sm:text-sm">INV-2026-014</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-1 gap-y-1.5 py-2.5 sm:py-3">
          <dl className="flex flex-auto flex-wrap items-baseline justify-between gap-x-1 gap-y-1">
            <div className="flex items-baseline gap-1 whitespace-nowrap">
              <dt className="text-sm text-slate-600">From</dt>
              <dd className="text-sm font-semibold sm:text-base">Studio North</dd>
            </div>
            <div className="flex items-baseline gap-1 whitespace-nowrap">
              <dt className="text-sm text-slate-600">Bill to</dt>
              <dd className="text-sm font-semibold sm:text-base">Mango & Co.</dd>
            </div>
          </dl>
          <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-sm font-semibold text-emerald-800">
            <Check aria-hidden="true" className="size-3.5" />
            Paid
          </span>
        </div>

        <table className="w-full text-sm sm:text-base">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th scope="col" className="w-1 whitespace-nowrap rounded-l-lg px-2 py-2 text-center font-medium">S.No.</th>
              <th scope="col" className="px-2 py-2 text-left font-medium">Description</th>
              <th scope="col" className="rounded-r-lg px-2 py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            <tr>
              <td className="px-2 py-2 text-center tabular-nums text-slate-600">1</td>
              <td className="px-2 py-2">Brand design</td>
              <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">₹15,000.00</td>
            </tr>
            <tr>
              <td className="px-2 py-2 text-center tabular-nums text-slate-600">2</td>
              <td className="px-2 py-2">Design assets</td>
              <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">₹5,000.00</td>
            </tr>
          </tbody>
        </table>

        <dl className="mt-1 border-t border-slate-200 pt-1.5 text-sm tabular-nums sm:text-base">
          <div className="flex justify-between gap-2 px-2 py-1 text-slate-600">
            <dt>CGST (9%)</dt>
            <dd>₹1,800.00</dd>
          </div>
          <div className="flex justify-between gap-2 px-2 py-1 text-slate-600">
            <dt>SGST (9%)</dt>
            <dd>₹1,800.00</dd>
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2 rounded-xl bg-teal-50 px-3 py-2.5 font-semibold text-teal-900">
            <dt>Invoice total</dt>
            <dd className="text-lg sm:text-2xl">₹23,600.00</dd>
          </div>
        </dl>
      </div>
    </figure>
  )
}

export function HeroSection() {
  const { openSignup } = useAuthModal()

  return (
    <section className="bg-[radial-gradient(ellipse_at_top_left,#f5eadc_0%,#fcfaf6_70%)] px-5 pb-7 pt-24 sm:px-8 sm:pb-8 sm:pt-26">
      <div className="mx-auto mb-4 flex max-w-6xl justify-center sm:mb-5">
        <p className="relative inline-flex items-center gap-2.5 rounded-full border border-stone-200 bg-white/85 py-1.5 pl-8 pr-3.5 text-sm font-semibold text-stone-800 shadow-sm shadow-stone-200">
          <span className="absolute -left-2 -top-2 grid size-8 -rotate-6 place-items-center rounded-[0.65rem] rounded-bl-sm border border-white/80 bg-linear-to-br from-teal-600 to-teal-800 text-white shadow-md shadow-teal-800/25">
            <Megaphone aria-hidden="true" className="size-4" />
            <span className="sr-only">Announcement:</span>
          </span>
          <span aria-hidden="true" className="relative grid size-2 place-items-center">
            <span className="absolute inset-0 rounded-full bg-emerald-400/75 motion-safe:animate-[ping_1.4s_ease-out_3_forwards] motion-reduce:hidden" />
            <span className="relative size-2 rounded-full bg-emerald-600 shadow-[0_0_8px_#10b981a6]" />
          </span>
          GSTR-1 Excel export is live
        </p>
      </div>
      <div className="mx-auto grid max-w-6xl gap-7 lg:grid-cols-[1.18fr_1fr] lg:items-end lg:gap-8">
        <div>
          <h1 className="text-[clamp(2.15rem,7vw,3.85rem)] font-bold leading-[1.08] tracking-tight text-slate-950 lg:text-[clamp(2.75rem,4.35vw,3.85rem)]">
            Invoice Smarter.<br />
            <span className="text-teal-800">Comply Faster.</span><br />
            Grow Better.
          </h1>

          <p className="mt-3 max-w-2xl text-base leading-relaxed text-pretty text-slate-700 lg:text-[0.96875rem] xl:text-lg">
            Create GST-compliant invoices, track sales in real time, and export{' '}
            <br className="hidden lg:inline" />
            <span className="whitespace-nowrap">ITR-ready</span> data in one click. Built for growing Indian businesses.
          </p>

          <div className="mt-4 flex flex-wrap gap-2.5">
            <button
              type="button"
              onClick={openSignup}
              className={`inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-full bg-indigo-700 px-4 text-base font-semibold text-white shadow-sm transition-colors hover:bg-indigo-800 ${focusRing}`}
            >
              Start free
              <ArrowRight aria-hidden="true" className="size-4" />
            </button>
            <Link
              href="#dashboard"
              className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-base font-semibold text-slate-800 transition-colors hover:border-teal-200 hover:bg-teal-50 ${focusRing}`}
            >
              <Play aria-hidden="true" className="size-3.5 text-teal-800" />
              Watch live demo
            </Link>
          </div>

          <ul className="mt-3 flex flex-wrap gap-x-3.5 gap-y-1 text-sm text-slate-700">
            {benefits.map((benefit) => (
              <li key={benefit} className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="grid size-[1.125rem] shrink-0 place-items-center rounded-full bg-emerald-700 text-white">
                  <Check className="size-3" strokeWidth={3} />
                </span>
                {benefit}
              </li>
            ))}
          </ul>

          <ProductFacts />
        </div>

        <InvoicePreview />
      </div>
    </section>
  )
}
