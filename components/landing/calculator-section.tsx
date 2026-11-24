'use client'

import { useState } from 'react'
import { Calculator, Sparkles, ArrowRight } from 'lucide-react'
import { useAuthModal } from '@/components/auth/auth-modal-context'
import { estimateSavings, MINUTES_PER_INVOICE_IN_APP } from './savings-estimate'

const invoicePresets = [
  { value: 20, label: '20', accessibleLabel: '20 invoices per month' },
  { value: 500, label: '500', accessibleLabel: '500 invoices per month' },
  { value: 1000, label: '1,000', accessibleLabel: '1,000 invoices per month' },
  { value: 1500, label: '1,500+', accessibleLabel: '1,500 invoices per month' },
]
const timePresets = [
  { value: 5, label: '5 min (Templates)', accessibleLabel: '5 minutes per invoice' },
  { value: 15, label: '15 min (Excel/Word)', accessibleLabel: '15 minutes per invoice' },
  { value: 30, label: '30 min (Complex Math)', accessibleLabel: '30 minutes per invoice' },
]
const ratePresets = [
  { value: 100, label: '₹100', accessibleLabel: '₹100 per hour' },
  { value: 500, label: '₹500', accessibleLabel: '₹500 per hour' },
  { value: 1000, label: '₹1,000', accessibleLabel: '₹1,000 per hour' },
  { value: 1500, label: '₹1,500', accessibleLabel: '₹1,500 per hour' },
]

interface PresetSliderProps {
  label: string
  presets: typeof invoicePresets
  step: number
  value: number
  onChange: (value: number) => void
}

function PresetSlider({ label, presets, step, value, onChange }: PresetSliderProps) {
  const min = presets[0].value
  const max = presets[presets.length - 1].value

  return (
    <div className="space-y-2">
      <div className="relative">
        <input
          type="range"
          aria-label={label}
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={event => onChange(Number(event.target.value))}
          className="block h-2.5 w-full cursor-pointer appearance-none rounded-lg bg-slate-800 accent-emerald-400 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-300"
        />
        <div role="group" aria-label={`${label} presets`} className="pointer-events-none absolute inset-y-0 inset-x-2">
          {presets.map(preset => (
            <button
              key={preset.value}
              type="button"
              aria-label={preset.accessibleLabel}
              aria-pressed={value === preset.value}
              title={preset.label}
              onClick={() => onChange(preset.value)}
              style={{ left: `${(preset.value - min) / (max - min) * 100}%` }}
              className="group pointer-events-auto absolute top-1/2 grid size-6 -translate-x-1/2 -translate-y-1/2 cursor-pointer place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-emerald-300 aria-pressed:pointer-events-none"
            >
              <span aria-hidden="true" className="size-1.5 rounded-full bg-slate-400 transition-colors group-hover:bg-emerald-200 group-aria-pressed:opacity-0" />
            </button>
          ))}
        </div>
      </div>
      <div aria-hidden="true" className="flex justify-between gap-2 font-mono text-xs text-slate-400 sm:text-sm">
        {presets.map(preset => <span key={preset.value}>{preset.label}</span>)}
      </div>
    </div>
  )
}

export function CalculatorSection() {
  const [invoicesCount, setInvoicesCount] = useState<number>(150)
  const [minutesPerInvoice, setMinutesPerInvoice] = useState<number>(12)
  const [hourlyRate, setHourlyRate] = useState<number>(300)
  const { openSignup } = useAuthModal()

  const { hoursSavedMonthly, annualSavingsRupees } = estimateSavings({
    invoicesPerMonth: invoicesCount,
    manualMinutesPerInvoice: minutesPerInvoice,
    hourlyRateRupees: hourlyRate,
  })

  return (
    <section id="calculator" className="py-10 sm:py-12 px-4 sm:px-6 lg:px-8 bg-neutral-900 text-white relative overflow-hidden">
      <div className="max-w-6xl mx-auto relative z-10">
        <div className="text-center max-w-3xl mx-auto mb-7 sm:mb-9">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-950 border border-emerald-500/30 text-emerald-200 text-xs font-semibold uppercase tracking-wider mb-3">
            <Calculator className="w-3.5 h-3.5" />
            ROI & Time Savings Calculator
          </div>
          <h2 className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight heading">
            Calculate your business time & cost savings
          </h2>
          <p className="mt-3 text-slate-400 text-base sm:text-xl">
            Enter your own numbers to see roughly how many hours, and how much staff time, your team could save.
          </p>
        </div>

        <div className="grid lg:grid-cols-12 gap-5 sm:gap-6 items-center bg-neutral-950 border border-neutral-800 rounded-3xl p-4 sm:p-6 shadow-2xl">
          {/* Sliders Area (7 cols) */}
          <div className="lg:col-span-7 space-y-5 sm:space-y-6">
            {/* Slider 1: Invoices per month */}
            <div className="space-y-2">
              <div className="flex justify-between items-center gap-2 text-base font-semibold">
                <span className="text-slate-300">Monthly Invoices Created</span>
                <span className="font-mono text-2xl font-extrabold text-emerald-300">
                  {invoicesCount.toLocaleString('en-IN')} <span className="text-sm text-slate-400 font-normal">invoices/mo</span>
                </span>
              </div>
              <PresetSlider
                label="Monthly Invoices Created"
                presets={invoicePresets}
                step={10}
                value={invoicesCount}
                onChange={setInvoicesCount}
              />
            </div>

            {/* Slider 2: Minutes spent per invoice */}
            <div className="space-y-2">
              <div className="flex justify-between items-center gap-2 text-base font-semibold">
                <span className="text-slate-300">Current Manual Time Spent Per Invoice</span>
                <span className="font-mono text-2xl font-extrabold text-emerald-300">
                  {minutesPerInvoice} <span className="text-sm text-slate-400 font-normal">minutes</span>
                </span>
              </div>
              <PresetSlider
                label="Current Manual Time Spent Per Invoice"
                presets={timePresets}
                step={1}
                value={minutesPerInvoice}
                onChange={setMinutesPerInvoice}
              />
            </div>

            {/* Slider 3: Cost of staff time */}
            <div className="space-y-2">
              <div className="flex justify-between items-center gap-2 text-base font-semibold">
                <span className="text-slate-300">Cost of Your Time Per Hour</span>
                <span className="font-mono text-2xl font-extrabold text-emerald-300">
                  ₹{hourlyRate.toLocaleString('en-IN')} <span className="text-sm text-slate-400 font-normal">/ hour</span>
                </span>
              </div>
              <PresetSlider
                label="Cost of Your Time Per Hour"
                presets={ratePresets}
                step={50}
                value={hourlyRate}
                onChange={setHourlyRate}
              />
            </div>

            {/* Note box */}
            <div className="p-3 rounded-2xl bg-neutral-900 border border-neutral-800 text-sm text-slate-400 space-y-1">
              <div className="font-semibold text-slate-300 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-emerald-300" />
                With Invoice BizFolio:
              </div>
              <p>Most invoices take <strong className="text-white">about a minute</strong>. Customers and products are saved once, and GST is calculated for you.</p>
            </div>
          </div>

          {/* Results Summary Box (5 cols) */}
          <div className="lg:col-span-5 bg-gradient-to-br from-[#17332d] to-neutral-900 border border-emerald-500/25 rounded-3xl p-4 sm:p-5 flex flex-col justify-between space-y-4">
            <div>
              <div className="text-sm font-mono font-bold uppercase tracking-wider text-emerald-200">
                Your Estimated Returns
              </div>

              <div className="mt-3 pb-3 border-b border-slate-800 space-y-1">
                <div className="text-sm text-slate-400">Time Recovered Monthly</div>
                <div className="text-4xl font-extrabold font-mono text-white flex items-baseline gap-2 heading">
                  <span>{hoursSavedMonthly}</span>
                  <span className="text-sm font-normal text-emerald-200">Hours / month</span>
                </div>
              </div>

              <div className="mt-3 pb-3 border-b border-slate-800 space-y-1">
                <div className="text-sm text-slate-400">Estimated Annual Cost Savings</div>
                <div className="text-4xl font-extrabold font-mono text-emerald-400 heading">
                  ₹{annualSavingsRupees.toLocaleString('en-IN')}
                  <span className="text-xs font-normal text-slate-400 ml-1.5">/ year</span>
                </div>
              </div>

              <p className="mt-3 text-sm text-slate-400">
                Estimate only: (your minutes − {MINUTES_PER_INVOICE_IN_APP} minute) × invoices per month × your hourly cost × 12.
              </p>
            </div>

            <button
              onClick={openSignup}
              className="btn-shine-indigo w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-base glow-btn transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg"
            >
              <span>Claim Your Free Account</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
