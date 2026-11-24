'use client';

import { CheckCircle2, Maximize2, Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatPaiseAsInr } from '@/lib/money';
import { PLAN_CATALOG } from '@/lib/subscriptions/plan-catalog';
import { formatIstDate } from '@/lib/invoices/ist-date';
import type { PendingRequestItem } from './types';

function formatPlanChangeSummary(req: PendingRequestItem): string | null {
  if (!req.planChange) return null;
  const { kind, fromPlan, unusedDays, creditedDays, endsAt } = req.planChange;
  const date = formatIstDate(endsAt, { day: 'numeric', month: 'short', year: 'numeric' });
  const targetPlanName =
    req.planName in PLAN_CATALOG
      ? PLAN_CATALOG[req.planName as keyof typeof PLAN_CATALOG].name
      : req.planName;

  if (kind === 'upgrade' || kind === 'downgrade') {
    const sourcePlan = fromPlan ?? req.currentPlan;
    const sourcePlanName =
      sourcePlan in PLAN_CATALOG
        ? PLAN_CATALOG[sourcePlan as keyof typeof PLAN_CATALOG].name
        : sourcePlan;
    return `${sourcePlanName} \u2192 ${targetPlanName}: ${unusedDays} unused days \u2192 ${creditedDays} days, then the paid cycle. Expiry if approved now: ${date}`;
  }

  if (kind === 'renewal') {
    return `Renewal: adds after current expiry. Expiry if approved now: ${date}`;
  }

  if (kind === 'new') {
    return `New subscription. Expiry if approved now: ${date}`;
  }

  return null;
}

interface PendingClaimsTabProps {
  pendingRequests: PendingRequestItem[];
  isPending: boolean;
  copiedKey: string | null;
  onCopy: (text: string, key: string) => void;
  onOpenProof: (req: { id: string; businessName: string; paymentReference: string }) => void;
  onApprove: (id: string) => void;
  onReject: (req: PendingRequestItem) => void;
}

export function PendingClaimsTab({
  pendingRequests,
  isPending,
  copiedKey,
  onCopy,
  onOpenProof,
  onApprove,
  onReject,
}: PendingClaimsTabProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold text-foreground font-heading">
            Pending Subscription Claims ({pendingRequests.length})
          </h3>
          <p className="text-xs font-semibold text-muted-foreground">
            Inspect bank transaction references (UTR) and verify proof before subscription activation.
          </p>
        </div>
      </div>

      {pendingRequests.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-12 text-center shadow-xs">
          <CheckCircle2 className="mx-auto size-10 text-emerald-500 mb-2" />
          <h4 className="text-base font-bold text-foreground">Reconciliation Queue Empty</h4>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
            No manual UPI or bank transfer claims are currently awaiting review. New claims submitted by tenants will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-3.5 w-full">
          {pendingRequests.map((req) => (
            <div
              key={req.id}
              className="rounded-xl border border-border bg-card p-4 sm:p-5 shadow-xs space-y-3 hover:border-border/80 transition-all w-full"
            >
              {/* Card Header: Business Title + Subtitle in Parenthesis on Left, Action Buttons on Right */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div className="flex flex-wrap items-baseline gap-1.5">
                  <h4 className="text-base font-bold text-foreground font-heading">{req.businessName}</h4>
                  <span className="text-xs font-normal text-muted-foreground">
                    (GSTIN: <span className="font-mono text-foreground font-semibold">{req.businessGstin || 'Unregistered'}</span>
                    {req.userName && ` · Submitted by ${req.userName}`})
                  </span>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isPending}
                    onClick={() => onReject(req)}
                    className="h-8 text-xs font-bold text-rose-600 hover:bg-rose-50 border-rose-200 cursor-pointer"
                  >
                    Reject
                  </Button>
                  <Button
                    size="sm"
                    disabled={isPending}
                    onClick={() => onApprove(req.id)}
                    className="btn-shine-indigo h-8 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer"
                  >
                    Approve Claim
                  </Button>
                </div>
              </div>

              {/* Content-Proportional Single Row Data Layout */}
              <div className="flex flex-col sm:flex-row sm:flex-wrap lg:flex-nowrap items-start sm:items-center justify-between gap-y-3 gap-x-5 lg:gap-x-7 rounded-lg bg-muted/40 p-3.5 text-sm border border-border/40">
                {/* 1. Plan Details */}
                <div className="shrink-0">
                  <span className="text-muted-foreground font-semibold text-xs sm:text-sm">Plan Details: </span>
                  <span className="font-bold text-foreground text-xs sm:text-sm capitalize">
                    {req.planName} ({req.billingCycle.replace('_', ' ')})
                  </span>
                </div>

                {/* 2. Amount Paid */}
                <div className="shrink-0">
                  <span className="text-muted-foreground font-semibold text-xs sm:text-sm">Amount Paid: </span>
                  <span className="font-extrabold text-foreground text-sm sm:text-base font-heading">
                    {formatPaiseAsInr(req.amountPaise)}
                  </span>
                </div>

                {/* 3. Payment Method & Target */}
                <div className="text-xs sm:text-sm leading-tight shrink-0 min-w-fit">
                  <div>
                    <span className="text-muted-foreground font-semibold">Payment Method &amp; Target: </span>
                    <span className="font-bold text-foreground uppercase whitespace-nowrap">
                      {req.paymentMethod.replace(/_/g, ' ')}
                    </span>
                  </div>
                  {req.paidToVpa && (
                    <span className="block font-mono text-[11px] text-muted-foreground truncate" title={req.paidToVpa}>
                      To: {req.paidToVpa}
                    </span>
                  )}
                  {req.paidToAccount && (
                    <span
                      className="block font-mono text-[11px] text-muted-foreground truncate"
                      title={`A/C ${req.paidToAccount} (${req.paidToIfsc || ''})`}
                    >
                      To: A/C {req.paidToAccount} {req.paidToIfsc ? `(${req.paidToIfsc})` : ''}
                    </span>
                  )}
                </div>

                {/* 4. UTR / Ref No (with full visibility and icon-only copy button) */}
                <div className="flex items-center gap-1.5 text-xs sm:text-sm shrink-0 min-w-fit">
                  <span className="text-muted-foreground font-semibold shrink-0">UTR / Ref No: </span>
                  <span className="font-mono font-extrabold text-indigo-600 dark:text-indigo-400 tracking-wider">
                    {req.paymentReference}
                  </span>
                  <button
                    type="button"
                    onClick={() => onCopy(req.paymentReference, `utr-${req.id}`)}
                    className="p-1 rounded bg-background text-muted-foreground border border-border/80 hover:text-indigo-600 transition cursor-pointer shrink-0"
                    title="Copy UTR Reference"
                  >
                    {copiedKey === `utr-${req.id}` ? (
                      <Check className="size-3.5 text-emerald-700" />
                    ) : (
                      <Copy className="size-3.5" />
                    )}
                  </button>
                </div>

                {/* 5. Payment Proof Button */}
                <div className="flex sm:justify-start lg:justify-end items-center shrink-0 sm:ml-auto lg:ml-0">
                  {req.hasScreenshot ? (
                    <button
                      type="button"
                      onClick={() => void onOpenProof(req)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50/70 hover:bg-indigo-100 dark:bg-indigo-950/50 dark:border-indigo-800 px-3 py-1.5 text-xs font-bold text-indigo-700 dark:text-indigo-300 transition cursor-pointer"
                    >
                      <Maximize2 className="size-3.5" /> View Proof
                    </button>
                  ) : (
                    <span className="text-xs font-semibold text-muted-foreground italic">
                      No image uploaded
                    </span>
                  )}
                </div>
              </div>

              {/* Plan Change Conversion Estimate */}
              {req.planChange && (() => {
                const isPlanChange =
                  req.planChange.kind === 'upgrade' || req.planChange.kind === 'downgrade';
                const summary = formatPlanChangeSummary(req);
                if (!summary) return null;
                return (
                  <div
                    className={
                      isPlanChange
                        ? 'rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200'
                        : 'rounded-lg border border-border/60 bg-muted/30 p-2.5 text-xs text-muted-foreground'
                    }
                  >
                    <p className="font-semibold">{summary}</p>
                    <p className="text-[11px] opacity-80 mt-0.5">estimate — recalculated when you approve</p>
                  </div>
                );
              })()}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

