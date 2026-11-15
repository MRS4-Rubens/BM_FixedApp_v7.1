import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { CheckoutForm } from './checkout-form';
import { getCurrentAppUser } from '@/lib/auth/session';
import { getCurrentBusiness } from '@/lib/auth/current-business';
import { isOwnerRole } from '@/lib/auth/rbac';
import { db } from '@/lib/db/client';
import { subscriptionRequests } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { getAuthoritativePayeeConfig, describePayeeProblems } from '@/lib/config/payee';
import { logWarn } from '@/lib/actions/_shared/logger';
import { SUPPORT_EMAIL } from '@/lib/config/contact';
import { PLAN_PRICING } from '@/lib/subscriptions/entitlements';
import { PURCHASABLE_PLAN_IDS, isPurchasablePlan } from '@/lib/subscriptions/plan-catalog';
import { buildUpiPaymentUri } from '@/lib/payments/upi-intent';
import { buildUpiQrDataUrl } from '@/lib/payments/upi-qr';
import type { UpiPaymentsMap } from '@/lib/payments/types';

export const metadata: Metadata = {
  title: 'Upgrade Subscription',
};

export const dynamic = 'force-dynamic';

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams?: Promise<{ plan?: string; cycle?: string; action?: string }>;
}) {
  const user = await getCurrentAppUser();
  if (!user) {
    redirect('/login');
  }
  if (!isOwnerRole(user.role)) {
    redirect('/dashboard');
  }

  const resolvedParams = searchParams ? await searchParams : undefined;
  const initialPlan = resolvedParams?.plan && isPurchasablePlan(resolvedParams.plan) ? resolvedParams.plan : 'essentials';
  const initialCycle = resolvedParams?.cycle;
  const initialAction = resolvedParams?.action;

  // 1. Force business profile completion first
  if (!user.business_id) {
    redirect('/settings');
  }

  // 2. Fetch business profile
  const business = await getCurrentBusiness();
  if (!business) {
    redirect('/settings');
  }

  // 3. Resolve payee details. FAIL CLOSED: never show customers placeholder or partial payment details.
  const payee = await getAuthoritativePayeeConfig();
  if (payee.status === 'unavailable') {
    logWarn(
      'checkout:payee-config',
      `[checkout] Payments unavailable - payee configuration problems: ${describePayeeProblems(payee.problems)}`
    );
    return <PaymentsUnavailable supportEmail={SUPPORT_EMAIL} />;
  }

  // 3b. Build localized UPI payment options and SVG QR data URLs for all plan/cycle combinations
  const PLAN_DISPLAY_NAMES = {
    essentials: 'Essentials Pro Plan',
    professional: 'Professional',
  } as const;

  const plans = PURCHASABLE_PLAN_IDS;
  const cycles = ['monthly', 'yearly'] as const;

  const paymentEntries = await Promise.all(
    plans.flatMap((plan) =>
      cycles.map(async (cycle) => {
        const amountPaise =
          cycle === 'monthly' ? PLAN_PRICING[plan].monthlyPaise : PLAN_PRICING[plan].yearlyPaise;
        const note = `BM Sub ${PLAN_DISPLAY_NAMES[plan]} ${cycle}`;
        const uri = buildUpiPaymentUri({
          payeeVpa: payee.config.upiId,
          payeeName: payee.config.upiName,
          amountPaise,
          note,
        });
        const qrDataUrl = await buildUpiQrDataUrl(uri);
        const key = `${plan}:${cycle}` as const;
        return [key, { amountPaise, uri, qrDataUrl }] as const;
      })
    )
  );

  const upiPayments = Object.fromEntries(paymentEntries) as UpiPaymentsMap;

  // 4. Fetch any existing pending claim requests
  const pendingRequests = await db
    .select()
    .from(subscriptionRequests)
    .where(
      and(
        eq(subscriptionRequests.business_id, user.business_id),
        eq(subscriptionRequests.status, 'pending')
      )
    )
    .limit(1);

  const pending = pendingRequests.length > 0
    ? {
        id: pendingRequests[0].id,
        plan_name: pendingRequests[0].plan_name,
        billing_cycle: pendingRequests[0].billing_cycle,
        amount_paise: pendingRequests[0].amount_paise,
        payment_reference: pendingRequests[0].payment_reference,
        created_at: pendingRequests[0].created_at.toISOString(),
      }
    : null;

  const businessProp = {
    id: business.id,
    legal_name: business.legal_name,
    gstin: business.gstin,
    subscription_plan: business.subscription_plan,
    subscription_status: business.subscription_status,
    subscription_activated_at: business.subscription_activated_at
      ? business.subscription_activated_at.toISOString()
      : null,
    subscription_ends_at: business.subscription_ends_at
      ? business.subscription_ends_at.toISOString()
      : null,
    trial_ends_at: business.trial_ends_at
      ? business.trial_ends_at.toISOString()
      : null,
    active_utr_no: business.active_utr_no,
  };

  return (
    <div className="w-full space-y-5">
      <div className="flex flex-col gap-1 border-b border-border/40 pb-3 mb-5">
        <span className="inline-flex w-fit items-center rounded-lg bg-indigo-50 border border-indigo-200/80 px-2.5 py-1 text-sm font-bold text-indigo-700 shadow-xs">
          Billing & Plans
        </span>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-foreground font-heading uppercase">
          Subscription Portal
        </h1>
        <p className="text-sm text-muted-foreground">
          Manage your plan, check active service status, or upgrade to unlock unlimited billing.
        </p>
      </div>

      <CheckoutForm
        business={businessProp}
        pendingRequest={pending}
        upiConfig={payee.config}
        upiPayments={upiPayments}
        initialPlan={initialPlan}
        initialCycle={initialCycle}
        initialAction={initialAction}
      />
    </div>
  );
}

function PaymentsUnavailable({ supportEmail }: { supportEmail: string }) {
  return (
    <div className="w-full space-y-5">
      <div className="flex flex-col gap-1 border-b border-border/40 pb-3 mb-5">
        <span className="inline-flex w-fit items-center rounded-lg bg-indigo-50 border border-indigo-200/80 px-2.5 py-1 text-sm font-bold text-indigo-700 shadow-xs">
          Billing & Plans
        </span>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-foreground font-heading uppercase">
          Subscription Portal
        </h1>
      </div>

      <div
        role="status"
        className="rounded-2xl border border-amber-300/60 bg-amber-50 p-6 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/5 dark:text-amber-300"
      >
        <h2 className="text-lg font-bold">Payments are temporarily unavailable</h2>
        <p className="mt-2 text-sm leading-relaxed">
          We can&apos;t accept subscription payments right now. Please do not send any money until this is
          resolved. Contact{' '}
          <a className="font-semibold underline" href={`mailto:${supportEmail}`}>
            {supportEmail}
          </a>{' '}
          and we will help you upgrade.
        </p>
        <Link href="/dashboard" className="mt-4 inline-block text-sm font-semibold underline">
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
