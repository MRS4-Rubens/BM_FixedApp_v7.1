'use client';

import { CheckCircle2, Maximize2, Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatPaiseAsInr } from '@/lib/money';
import type { PendingRequestItem } from './types';

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
        <div className="grid gap-4 md:grid-cols-2">
          {pendingRequests.map((req) => (
            <div
              key={req.id}
              className="rounded-xl border border-border bg-card p-5 shadow-xs space-y-4 hover:border-border/80 transition-all"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h4 className="text-base font-bold text-foreground font-heading">{req.businessName}</h4>
                  <p className="text-xs text-muted-foreground font-semibold mt-0.5">
                    GSTIN: <span className="font-mono text-foreground font-bold">{req.businessGstin || 'Unregistered'}</span>
                    {req.userName && ` · Submitted by ${req.userName}`}
                  </p>
                </div>
                <span className="rounded-md bg-indigo-50 border border-indigo-200 px-2 py-0.5 text-xs font-bold text-indigo-700 uppercase tracking-wide">
                  {req.planName} ({req.billingCycle})
                </span>
              </div>

              {/* Payment Details Card */}
              <div className="grid grid-cols-2 gap-3 rounded-lg bg-muted/40 p-3 text-sm border border-border/40">
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground block">
                    Amount Paid
                  </span>
                  <span className="text-base font-extrabold text-foreground font-heading">
                    {formatPaiseAsInr(req.amountPaise)}
                  </span>
                </div>

                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground block">
                    Payment Method
                  </span>
                  <span className="font-semibold text-foreground capitalize">
                    {req.paymentMethod.replace(/_/g, ' ')}
                  </span>
                </div>

                <div className="col-span-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground block">
                    UTR / Transaction Reference No
                  </span>
                  <div className="flex items-center justify-between mt-0.5">
                    <span className="font-mono text-sm font-extrabold text-indigo-600 tracking-wider">
                      {req.paymentReference}
                    </span>
                    <button
                      type="button"
                      onClick={() => onCopy(req.paymentReference, `utr-${req.id}`)}
                      className="flex items-center gap-1 rounded bg-background px-2 py-0.5 text-xs font-bold text-muted-foreground border border-border/80 hover:text-indigo-600 transition cursor-pointer"
                    >
                      {copiedKey === `utr-${req.id}` ? (
                        <>
                          <Check className="size-3.5 text-emerald-700" /> Copied
                        </>
                      ) : (
                        <>
                          <Copy className="size-3.5" /> Copy UTR
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* Action row */}
              <div className="flex items-center justify-between pt-1 border-t border-border/40">
                {req.hasScreenshot ? (
                  <button
                    type="button"
                    onClick={() => void onOpenProof(req)}
                    className="inline-flex items-center gap-1 text-sm font-bold text-indigo-600 hover:text-indigo-700 cursor-pointer"
                  >
                    <Maximize2 className="size-4" /> View Payment Proof
                  </button>
                ) : (
                  <span className="text-xs font-semibold text-muted-foreground italic">
                    No image uploaded
                  </span>
                )}

                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isPending}
                    onClick={() => onReject(req)}
                    className="h-8 text-sm font-bold text-rose-600 hover:bg-rose-50 border-rose-200"
                  >
                    Reject
                  </Button>
                  <Button
                    size="sm"
                    disabled={isPending}
                    onClick={() => onApprove(req.id)}
                    className="h-8 text-sm font-bold bg-indigo-600 hover:bg-indigo-700 text-white"
                  >
                    Approve Claim
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

