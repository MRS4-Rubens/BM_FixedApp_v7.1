'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Check, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatIstTime } from '@/lib/invoices/ist-date';
import { formatPaiseAsInr } from '@/lib/money';
import { PLANS } from './plans';

export interface PendingRequestData {
  id: string;
  plan_name: string;
  billing_cycle: string;
  amount_paise: number;
  payment_reference: string;
  created_at: string;
}

export function PendingClaimScreen({
  pendingRequest,
}: {
  pendingRequest: PendingRequestData;
}) {
  const router = useRouter();
  const pendingPlan = PLANS.find((p) => p.id === pendingRequest.plan_name);

  return (
    <div className="mx-auto max-w-5xl rounded-2xl border border-amber-200/90 bg-white p-5 sm:p-7 shadow-md">
      <div className="flex flex-col items-center text-center space-y-3.5">
        <div className="size-13 rounded-full bg-amber-50 flex items-center justify-center text-amber-600 border border-amber-200 shadow-2xs">
          <Clock className="size-6 animate-pulse" />
        </div>

        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-200 px-3 py-0.5 text-xs font-bold text-amber-800 mb-1.5">
            Verification In Progress
          </span>
          <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-900 font-heading">
            Payment Claim Under Review
          </h2>
          <div className="mt-1.5 text-xs sm:text-sm text-slate-600 leading-relaxed text-center space-y-0.5">
            <p className="block">Your transaction reference has been logged. Our super administrators are verifying the bank statement.</p>
            <p className="block">Your subscription will activate automatically upon approval.</p>
          </div>
        </div>

        {/* 3-Step Verification Timeline (Expanded Horizontally) */}
        <div className="w-full max-w-2xl py-3 border-y border-slate-100 my-1">
          <div className="flex items-center justify-between text-xs">
            <div className="flex flex-col items-center gap-1 text-center shrink-0">
              <span className="size-6 rounded-full bg-emerald-500 text-white flex items-center justify-center font-bold text-xs shadow-2xs">
                <Check className="size-3.5" />
              </span>
              <span className="font-bold text-xs sm:text-sm text-slate-900 whitespace-nowrap">Claim Logged</span>
              <span className="text-[11px] text-slate-500 whitespace-nowrap">
                {formatIstTime(pendingRequest.created_at, { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>

            <div className="h-0.5 flex-1 bg-amber-300 mx-3 sm:mx-6" />

            <div className="flex flex-col items-center gap-1 text-center shrink-0">
              <span className="size-6 rounded-full bg-amber-700 text-white flex items-center justify-center font-bold text-xs shadow-2xs">
                2
              </span>
              <span className="font-bold text-xs sm:text-sm text-amber-800 whitespace-nowrap">Bank Reconciliation</span>
              <span className="text-[11px] text-slate-600 whitespace-nowrap">In progress</span>
            </div>

            <div className="h-0.5 flex-1 bg-slate-200 mx-3 sm:mx-6" />

            <div className="flex flex-col items-center gap-1 text-center shrink-0">
              <span className="size-6 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center font-bold text-xs">
                3
              </span>
              <span className="font-bold text-xs sm:text-sm text-slate-600 whitespace-nowrap">Activation</span>
              <span className="text-[11px] text-slate-600 whitespace-nowrap">Instant</span>
            </div>
          </div>
        </div>

        {/* Claim Metadata Single Grid with Vertical Division (Format B Single-Line) */}
        <div className="w-full rounded-xl bg-slate-50 border border-slate-200/90 overflow-hidden shadow-2xs">
          <div className="grid grid-cols-1 md:grid-cols-[1.35fr_0.85fr_1.1fr] divide-y md:divide-y-0 md:divide-x divide-slate-200 text-xs sm:text-sm">
            <div className="px-4 py-2.5 flex items-center justify-center gap-1.5 text-center whitespace-nowrap">
              <span className="text-slate-500 font-medium shrink-0">Selected Plan:</span>
              <span className="font-bold text-slate-900 capitalize shrink-0">
                {pendingPlan?.name || pendingRequest.plan_name} ({pendingRequest.billing_cycle})
              </span>
            </div>
            <div className="px-4 py-2.5 flex items-center justify-center gap-1.5 text-center whitespace-nowrap">
              <span className="text-slate-500 font-medium shrink-0">Claimed Amount:</span>
              <span className="font-black text-slate-900 font-heading shrink-0">
                {formatPaiseAsInr(pendingRequest.amount_paise)}
              </span>
            </div>
            <div className="px-4 py-2.5 flex items-center justify-center gap-1.5 text-center whitespace-nowrap">
              <span className="text-slate-500 font-medium shrink-0">Claimed UTR / Ref:</span>
              <span className="font-mono font-bold text-indigo-700 shrink-0">
                {pendingRequest.payment_reference}
              </span>
            </div>
          </div>
        </div>

        <p className="text-xs text-slate-500 whitespace-nowrap text-center">
          Verification typically takes 15–30 minutes during standard business hours. Feel free to continue using your account in the meantime.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto pt-1">
          <Button
            variant="outline"
            onClick={() => router.push('/dashboard')}
            className="font-bold text-sm cursor-pointer h-9.5 px-5 border-slate-200"
          >
            Back to Dashboard
          </Button>
          <Link href="/settings?tab=Billing & Usage">
            <Button className="btn-shine-indigo w-full sm:w-auto font-bold text-sm cursor-pointer h-9.5 px-5 bg-indigo-600 hover:bg-indigo-700 text-white shadow-2xs">
              View Billing Settings
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

