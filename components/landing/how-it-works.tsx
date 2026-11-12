'use client'

import { Rocket } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

const steps = [
  {
    title: 'Set up your business',
    description: 'Enter your GSTIN and business details once. Invoice BizFolio checks the GSTIN format.',
    accent: 'from-rose-500 to-pink-600 ring-rose-200',
    pulse: 'motion-safe:animate-[pulseRingRose_2s_ease-out_2]',
  },
  {
    title: 'Add customers & products',
    description: 'Save customer and product details once and reuse them on every invoice.',
    accent: 'from-amber-600 to-orange-600 ring-amber-200',
    pulse: 'motion-safe:animate-[pulseRingAmber_2s_ease-out_2]',
  },
  {
    title: 'Invoice & share',
    description: 'Choose a customer and items, finalize the invoice, then email the PDF or share it on WhatsApp.',
    accent: 'from-emerald-600 to-teal-600 ring-emerald-200',
    pulse: 'motion-safe:animate-[pulseRingEmerald_2s_ease-out_2]',
  },
  {
    title: 'Track payments',
    description: 'Record payments, check outstanding balances, and send reminders.',
    accent: 'from-indigo-600 to-violet-600 ring-indigo-200',
    pulse: 'motion-safe:animate-[pulseRingIndigo_2s_ease-out_2]',
  },
]

export function HowItWorks() {
  const listRef = useRef<HTMLOListElement>(null)
  const [pulseSteps, setPulseSteps] = useState(false)

  useEffect(() => {
    const list = listRef.current
    if (!list || !('IntersectionObserver' in window)) return

    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return
      setPulseSteps(true)
      observer.disconnect()
    }, { threshold: 0.25 })
    observer.observe(list)
    return () => observer.disconnect()
  }, [])

  return (
    <section id="how" aria-labelledby="how-heading" className="scroll-mt-24 px-5 py-8 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-6xl">
        <div className="mb-7 text-center sm:mb-9">
          <p className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-indigo-100 bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-800">
            <Rocket aria-hidden="true" className="size-3.5" />
            Get started
          </p>
          <h2 id="how-heading" className="text-3xl font-bold leading-tight tracking-tight text-slate-950 sm:text-5xl">
            Ready in four simple steps
          </h2>
          <p className="mt-1.5 text-base leading-relaxed text-slate-700 sm:text-lg">
            From setting up your business to tracking payments.
          </p>
        </div>

        <ol ref={listRef} role="list" className="grid gap-5 sm:grid-cols-2 sm:gap-7 lg:grid-cols-4 lg:gap-5">
          {steps.map(({ title, description, accent, pulse }, index) => (
            <li key={title} className="flex items-start gap-4 sm:flex-col sm:items-center sm:text-center">
              <span aria-hidden="true" className="relative grid size-11 shrink-0 place-items-center rounded-xl sm:size-14 sm:rounded-2xl">
                <span className={`pointer-events-none absolute inset-0 rounded-[inherit] ${pulseSteps ? pulse : ''}`} />
                <span className={`relative grid size-full place-items-center rounded-[inherit] bg-linear-to-br text-xl font-bold leading-none text-white ring-2 sm:text-2xl ${accent}`}>
                  {index + 1}
                </span>
              </span>
              <div>
                <h3 className="text-lg font-medium leading-tight tracking-tight text-slate-950 sm:text-xl">{title}</h3>
                <p className="mt-1 text-base leading-snug text-slate-600">{description}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
