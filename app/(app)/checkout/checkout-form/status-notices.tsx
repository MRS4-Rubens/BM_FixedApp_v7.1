'use client';

import Link from 'next/link';
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock, Crown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatIstDate } from '@/lib/invoices/ist-date';
import { TRIAL_DURATION_DAYS } from '@/lib/subscriptions/entitlements';

export function StatusNotices({
  isActive,
  isExpired,
  daysRemaining,
  subscriptionPlan,
  subscriptionStatus,
  targetExpiry,
  formSuccess,
  formError,
}: {
  isActive: boolean;
  isExpired: boolean;
  daysRemaining: number | null;
  subscriptionPlan: string;
  subscriptionStatus: string;
  targetExpiry?: string | null;
  formSuccess: boolean;
  formError: string | null;
}) {
  return (
    <>
      {/* Top Active Status Notification */}
      {isActive && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-indigo-200 bg-gradient-to-r from-indigo-50/80 via-purple-50/30 to-white py-2.5 px-3.5 shadow-xs">
          <div className="flex items-center gap-3">
            <Crown className="size-5 text-amber-500 shrink-0" />
            <div>
              <p className="text-sm font-bold text-slate-900">
                Active Subscription:{' '}
                <span className="capitalize font-black text-indigo-700">{subscriptionPlan}</span>{' '}
                ({daysRemaining} days left)
              </p>
              <p className="text-xs text-slate-500">
                Submitting a claim below will extend your validity or switch your plan upon admin approval.
              </p>
            </div>
          </div>
          <Link href="/settings?tab=Billing & Usage">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-sm font-semibold gap-1.5 shrink-0 self-start sm:self-auto cursor-pointer rounded-lg border-slate-200 bg-white hover:bg-slate-50"
            >
              <ArrowLeft className="size-4" />
              View Current Plan
            </Button>
          </Link>
        </div>
      )}

      {/* Expired Notice */}
      {isExpired && (
        <div className="flex items-center gap-3 rounded-2xl border border-rose-200 bg-rose-50 py-2.5 px-3.5 text-rose-800 shadow-xs">
          <AlertTriangle className="size-5 shrink-0 text-rose-500" />
          <div>
            <b className="text-sm font-bold block">Your Subscription Has Expired</b>
            <span className="text-xs mt-0.5 block text-rose-700">
              Your previous plan expired on{' '}
              {targetExpiry ? formatIstDate(targetExpiry) : 'recently'}. Please select a plan and submit your payment claim to restore services.
            </span>
          </div>
        </div>
      )}

      {/* Free Trial Notice */}
      {subscriptionStatus === 'trial' && !isExpired && (
        <div className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 py-2.5 px-3.5 text-amber-800 shadow-xs">
          <Clock className="size-5 shrink-0 text-amber-500" />
          <div>
            <b className="text-sm font-bold block">
              Free Trial Active ({daysRemaining ?? TRIAL_DURATION_DAYS} Days Left)
            </b>
            <span className="text-xs mt-0.5 block text-amber-700">
              Upgrade to Essentials now to lock in continuous access and avoid feature interruption.
            </span>
          </div>
        </div>
      )}

      {/* Form Alerts */}
      {formSuccess && (
        <div role="status" className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 py-2.5 px-3.5 text-emerald-800 shadow-xs">
          <CheckCircle2 className="size-5 shrink-0 text-emerald-600" />
          <div>
            <b className="text-base font-bold block">Claim Submitted Successfully!</b>
            <span className="text-sm mt-1 block">
              Your transaction reference has been recorded. Our administrators will verify the bank clearance shortly.
            </span>
          </div>
        </div>
      )}

      {formError && (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 py-2.5 px-3.5 text-rose-800 shadow-xs animate-shake">
          <AlertTriangle className="size-5 shrink-0 text-rose-500" />
          <div>
            <b className="text-base font-bold block">Submission Failed</b>
            <span className="text-sm mt-1 block">{formError}</span>
          </div>
        </div>
      )}
    </>
  );
}

