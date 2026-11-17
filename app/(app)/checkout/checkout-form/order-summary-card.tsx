'use client';

import { CheckCircle, ChevronDown, ChevronUp, ShieldCheck } from 'lucide-react';
import { formatPaiseAsInr } from '@/lib/money';
import type { PlanId, BillingCycle } from './plans';
import { PlanChangeNote, type PlanPurchaseSummary } from './plan-change-note';

export function OrderSummaryCard({
  business,
  planDetails,
  selectedPlan,
  currentPurchase,
  billingCycle,
  activePricePaise,
  projectedExpiryString,
  openFaq,
  setOpenFaq,
}: {
  business: {
    legal_name: string;
    gstin?: string | null;
    subscription_plan: string;
  };
  planDetails: {
    name: string;
  };
  selectedPlan: PlanId;
  currentPurchase?: PlanPurchaseSummary | null;
  billingCycle: BillingCycle;
  activePricePaise: number;
  projectedExpiryString: string;
  openFaq: number | null;
  setOpenFaq: (idx: number | null) => void;
}) {
  return (
    <div className="lg:col-span-4 space-y-4">
      {/* Sticky Summary Card */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-4.5 sm:p-5 shadow-xs sticky top-5">
        <h2 className="text-lg font-extrabold text-slate-900 font-heading tracking-tight border-b border-slate-100 pb-2.5">
          Subscription Summary
        </h2>

        <div className="space-y-2.5 mt-3">
          {/* Business info */}
          <div className="flex justify-between items-center py-0.5">
            <span className="text-sm text-slate-500 font-semibold">Account:</span>
            <span className="text-sm font-bold text-slate-900 truncate max-w-44 text-right">
              {business.legal_name}
            </span>
          </div>

          {business.gstin && (
            <div className="flex justify-between items-center py-0.5">
              <span className="text-sm text-slate-500 font-semibold">GSTIN:</span>
              <span className="text-sm font-mono font-bold text-slate-900">{business.gstin}</span>
            </div>
          )}

          <div className="flex justify-between items-center py-0.5 border-b border-dashed border-slate-200 pb-2">
            <span className="text-sm text-slate-500 font-semibold">Current Tier:</span>
            <span className="text-sm font-bold bg-slate-100 px-2.5 py-0.5 rounded capitalize text-slate-800">
              {business.subscription_plan}
            </span>
          </div>

          {/* Plan breakdown item */}
          <div className="pt-0">
            <div className="flex justify-between items-start">
              <div>
                <b className="text-sm font-extrabold text-slate-900 block">{planDetails.name}</b>
                <span className="text-xs text-slate-500 font-semibold block capitalize mt-0.5">
                  Billed {billingCycle}
                </span>
              </div>
              <span className="text-sm font-black text-slate-900 font-heading">
                {formatPaiseAsInr(activePricePaise)}
              </span>
            </div>
          </div>

          {/* Validity extension preview */}
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-2.5 text-sm space-y-1">
            <div className="flex justify-between items-center text-slate-500">
              <span>Coverage Period:</span>
              <span className="font-bold text-slate-900">
                {billingCycle === 'yearly' ? '12 Months (1 Year)' : '1 Month'}
              </span>
            </div>
            <div className="flex justify-between items-center text-slate-500">
              <span>Valid Until:</span>
              <span className="font-bold text-emerald-700">{projectedExpiryString}</span>
            </div>
          </div>

          <PlanChangeNote purchase={currentPurchase} plan={selectedPlan} cycle={billingCycle} />

          <div className="-mx-5 border-t border-slate-100 my-2.5" />

          {/* Total Amount Due */}
          <div className="flex justify-between items-baseline">
            <span className="text-base font-bold text-slate-900">Total Amount Due:</span>
            <span className="text-2xl font-black text-indigo-700 font-heading">
              {formatPaiseAsInr(activePricePaise)}
            </span>
          </div>

          {/* Security Guarantee Badges */}
          <div className="mt-3 space-y-1.5 pt-1">
            <div className="flex items-start gap-2 text-xs text-slate-600">
              <ShieldCheck className="size-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>A payment receipt is available under Settings → Billing &amp; Usage after approval.</span>
            </div>
            <div className="flex items-start gap-2 text-xs text-slate-600">
              <CheckCircle className="size-4 text-indigo-600 shrink-0 mt-0.5" />
              <span>Your plan is activated as soon as we verify the payment.</span>
            </div>
          </div>

          {/* FAQ Accordion */}
          <div className="mt-3.5 pt-2.5 border-t border-slate-100 space-y-1.5">
            <span className="text-sm font-bold text-slate-900 block uppercase tracking-wider mb-1.5">
              Frequently Asked Questions
            </span>

            {[
              {
                q: 'How long does verification take?',
                a: 'Admin verification usually takes 15–30 minutes during business hours. In rare cases of bank clearing delays, it can take up to 2 hours.',
              },
              {
                q: 'Will my existing invoices be affected?',
                a: 'Never. All your finalized invoices, customers, and product items remain 100% immutable and intact.',
              },
              {
                q: 'Can I switch between monthly and annual plans?',
                a: 'Yes, any new plan claim will automatically extend your subscription duration from your current renewal date.',
              },
            ].map((faq, idx) => (
              <div key={idx} className="rounded-lg border border-slate-200 bg-slate-50/50 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setOpenFaq(openFaq === idx ? null : idx)}
                  className="w-full flex justify-between items-center px-3 py-1.5 text-left text-sm font-semibold text-slate-800 hover:bg-slate-100 transition cursor-pointer"
                >
                  <span>{faq.q}</span>
                  {openFaq === idx ? <ChevronUp className="size-4 shrink-0 text-slate-500" /> : <ChevronDown className="size-4 shrink-0 text-slate-500" />}
                </button>
                {openFaq === idx && (
                  <div className="px-3 pb-2 text-xs text-slate-500 leading-relaxed">
                    {faq.a}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

