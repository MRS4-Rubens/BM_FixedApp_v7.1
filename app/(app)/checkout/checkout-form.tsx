'use client';

import { useState, useTransition, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { subscriptionClaimSchema, SubscriptionClaimInput } from '@/lib/validations/subscription';
import { submitPaymentClaim } from '@/lib/actions/subscriptions/submit-payment-claim';
import { formatIstDate } from '@/lib/invoices/ist-date';
import { isPurchasablePlan } from '@/lib/subscriptions/plan-catalog';
import type { UpiPaymentsMap } from '@/lib/payments/types';

import { PLANS, type PlanId, type BillingCycle, type PaymentMethod } from './checkout-form/plans';
import { PendingClaimScreen } from './checkout-form/pending-claim-screen';
import { StatusNotices } from './checkout-form/status-notices';
import { PlanPickerCard } from './checkout-form/plan-picker-card';
import { PaymentMethodCard } from './checkout-form/payment-method-card';
import { ClaimSubmitCard } from './checkout-form/claim-submit-card';
import { OrderSummaryCard } from './checkout-form/order-summary-card';
import { useScreenshotUpload } from './checkout-form/use-screenshot-upload';
import type { PlanPurchaseSummary } from './checkout-form/plan-change-note';

interface CheckoutFormProps {
  business: {
    id: string;
    legal_name: string;
    gstin?: string | null;
    subscription_plan: string;
    subscription_status: string;
    subscription_activated_at?: string | null;
    subscription_ends_at: string | null;
    trial_ends_at?: string | null;
    active_utr_no?: string | null;
  };
  pendingRequest: {
    id: string;
    plan_name: string;
    billing_cycle: string;
    amount_paise: number;
    payment_reference: string;
    created_at: string;
  } | null;
  upiConfig: {
    upiId: string;
    upiName: string;
    bankName: string;
    accName: string;
    accNo: string;
    ifsc: string;
  };
  upiPayments: UpiPaymentsMap;
  planPurchases?: Record<string, PlanPurchaseSummary>;
  initialPlan?: string;
  initialCycle?: string;
  initialAction?: string;
}

export function CheckoutForm({
  business,
  pendingRequest,
  upiConfig,
  upiPayments,
  planPurchases,
  initialPlan,
  initialCycle,
}: CheckoutFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const normalizedInitialPlan: PlanId =
    initialPlan && isPurchasablePlan(initialPlan) ? (initialPlan as PlanId) : 'essentials';
  const normalizedInitialCycle: BillingCycle =
    initialCycle?.toLowerCase() === 'yearly' || initialCycle?.toLowerCase() === 'annual'
      ? 'yearly'
      : 'monthly';

  const [selectedPlan, setSelectedPlan] = useState<PlanId>(normalizedInitialPlan);
  const [billingCycle, setBillingCycle] = useState<BillingCycle>(normalizedInitialCycle);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('upi_qr');

  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [showUtrGuide, setShowUtrGuide] = useState<boolean>(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<boolean>(false);

  // Expiration calculation
  const targetExpiry = business.subscription_ends_at || business.trial_ends_at;
  const daysRemaining = useMemo(() => {
    if (!targetExpiry) return null;
    return Math.ceil((new Date(targetExpiry).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
  }, [targetExpiry]);
  const isExpired = daysRemaining !== null && daysRemaining <= 0;
  const isActive = business.subscription_status === 'active' && !isExpired;

  // Active pricing calculation
  const planDetails = PLANS.find((p) => p.id === selectedPlan)!;
  const activePricePaise =
    billingCycle === 'monthly' ? planDetails.monthlyPricePaise : planDetails.yearlyPricePaise;

  // Calculate annual savings
  const annualSavingsPaise = planDetails.monthlyPricePaise * 12 - planDetails.yearlyPricePaise;

  // Active plan conversion / purchase calculation
  const currentPurchase = planPurchases?.[`${selectedPlan}:${billingCycle}`];

  // Projected validity extension
  const projectedExpiryString = useMemo(() => {
    if (currentPurchase?.endsAt) {
      return formatIstDate(currentPurchase.endsAt, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    }
    const nowTime = new Date().getTime();
    const baseDate = targetExpiry && new Date(targetExpiry).getTime() > nowTime
      ? new Date(targetExpiry)
      : new Date();
    const futureDate = new Date(baseDate);
    if (billingCycle === 'yearly') {
      futureDate.setFullYear(futureDate.getFullYear() + 1);
    } else {
      futureDate.setMonth(futureDate.getMonth() + 1);
    }
    return formatIstDate(futureDate, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }, [currentPurchase, targetExpiry, billingCycle]);

  // React Hook Form setup
  const {
    register,
    handleSubmit,
    setValue,
    reset,
    formState: { errors },
  } = useForm<SubscriptionClaimInput>({
    resolver: zodResolver(subscriptionClaimSchema),
    defaultValues: {
      plan_name: normalizedInitialPlan,
      billing_cycle: normalizedInitialCycle,
      amount_paise: activePricePaise,
      payment_method: 'upi_qr',
      payment_reference: '',
      screenshot_base64: '',
      screenshot_mime: '',
    },
  });

  const {
    screenshotBase64,
    setScreenshotBase64,
    fileName,
    setFileName,
    fileSizeStr,
    handleScreenshotChange,
    handleRemoveScreenshot,
    isPreparingScreenshot,
  } = useScreenshotUpload({
    setValue,
    setFormError,
  });

  // Handle plan and cycle changes
  const handlePlanChange = (planId: PlanId) => {
    if (!isPurchasablePlan(planId)) return;
    setSelectedPlan(planId);
    setValue('plan_name', planId);

    const targetPlan = PLANS.find((p) => p.id === planId)!;
    const price = billingCycle === 'monthly' ? targetPlan.monthlyPricePaise : targetPlan.yearlyPricePaise;
    setValue('amount_paise', price);
  };

  const handleCycleChange = (cycle: BillingCycle) => {
    setBillingCycle(cycle);
    setValue('billing_cycle', cycle);

    const price = cycle === 'monthly' ? planDetails.monthlyPricePaise : planDetails.yearlyPricePaise;
    setValue('amount_paise', price);
  };

  const handleMethodChange = (method: PaymentMethod) => {
    setPaymentMethod(method);
    setValue('payment_method', method);
  };

  // Clipboard copy helper
  const copyToClipboard = (text: string, fieldKey: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldKey);
    setTimeout(() => setCopiedField(null), 2000);
  };

  // Form submission handler
  const onSubmit = (data: SubscriptionClaimInput) => {
    setFormError(null);
    setFormSuccess(false);

    startTransition(async () => {
      const result = await submitPaymentClaim({
        ...data,
        amount_paise: activePricePaise, // enforce exact active price
      });

      if (!result.success) {
        setFormError(result.error?.message || 'Something went wrong. Please check fields.');
      } else {
        setFormSuccess(true);
        reset();
        setScreenshotBase64('');
        setFileName('');
        router.refresh();
      }
    });
  };

  // Active localized UPI payment option generated server-side
  const activeUpiPayment = upiPayments[`${selectedPlan}:${billingCycle}`];

  // ── Pending Verification Screen ──────────────────────────────────────────
  if (pendingRequest) {
    return <PendingClaimScreen pendingRequest={pendingRequest} />;
  }

  return (
    <div className="grid gap-5 sm:gap-6 lg:grid-cols-12 w-full">
      {/* Column 1 & 2: Plan Selectors, Instructions, and Claim Form */}
      <div className="lg:col-span-8 space-y-4">
        <StatusNotices
          isActive={isActive}
          isExpired={isExpired}
          daysRemaining={daysRemaining}
          subscriptionPlan={business.subscription_plan}
          subscriptionStatus={business.subscription_status}
          targetExpiry={targetExpiry}
          formSuccess={formSuccess}
          formError={formError}
        />

        <PlanPickerCard
          billingCycle={billingCycle}
          handleCycleChange={handleCycleChange}
          selectedPlan={selectedPlan}
          handlePlanChange={handlePlanChange}
          currentSubscriptionPlan={business.subscription_plan}
          annualSavingsPaise={annualSavingsPaise}
        />

        <PaymentMethodCard
          paymentMethod={paymentMethod}
          handleMethodChange={handleMethodChange}
          activeUpiPayment={activeUpiPayment}
          upiConfig={upiConfig}
          activePricePaise={activePricePaise}
          businessLegalName={business.legal_name}
          copiedField={copiedField}
          copyToClipboard={copyToClipboard}
        />

        <ClaimSubmitCard
          register={register}
          errors={errors}
          onSubmit={handleSubmit(onSubmit)}
          isPending={isPending}
          showUtrGuide={showUtrGuide}
          setShowUtrGuide={setShowUtrGuide}
          fileName={fileName}
          fileSizeStr={fileSizeStr}
          screenshotBase64={screenshotBase64}
          handleScreenshotChange={handleScreenshotChange}
          handleRemoveScreenshot={handleRemoveScreenshot}
          isPreparingScreenshot={isPreparingScreenshot}
        />
      </div>

      {/* Column 2: Cart summary details and Trust FAQs */}
      <OrderSummaryCard
        business={business}
        planDetails={planDetails}
        selectedPlan={selectedPlan}
        currentPurchase={currentPurchase}
        billingCycle={billingCycle}
        activePricePaise={activePricePaise}
        projectedExpiryString={projectedExpiryString}
        openFaq={openFaq}
        setOpenFaq={setOpenFaq}
      />
    </div>
  );
}
