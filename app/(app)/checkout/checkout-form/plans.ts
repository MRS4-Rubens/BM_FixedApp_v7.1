import { PLAN_PRICING } from '@/lib/subscriptions/entitlements';
import { PLAN_CATALOG, formatPlanPrice } from '@/lib/subscriptions/plan-catalog';

export type PlanId = 'essentials' | 'professional';
export type BillingCycle = 'monthly' | 'yearly';
export type PaymentMethod = 'upi_qr' | 'upi_id' | 'bank_transfer';

// CLEAN-002: the yearly saving shown on the toggle is computed from PLAN_PRICING (was a hand-typed, wrong "20%").
export const ESSENTIALS_YEARLY_SAVING = formatPlanPrice('essentials', 'yearly').savingsPercent;

// Plan pricing definitions
export const PLANS = [
  {
    id: 'essentials' as const,
    name: PLAN_CATALOG.essentials.name,
    tagline: PLAN_CATALOG.essentials.tagline,
    monthlyPricePaise: PLAN_PRICING.essentials.monthlyPaise,
    yearlyPricePaise: PLAN_PRICING.essentials.yearlyPaise,
    features: PLAN_CATALOG.essentials.features,
    purchasable: PLAN_CATALOG.essentials.purchasable,
    popular: true,
  },
  {
    id: 'professional' as const,
    name: PLAN_CATALOG.professional.name,
    tagline: PLAN_CATALOG.professional.tagline,
    monthlyPricePaise: PLAN_PRICING.professional.monthlyPaise,
    yearlyPricePaise: PLAN_PRICING.professional.yearlyPaise,
    features: PLAN_CATALOG.professional.features,
    purchasable: PLAN_CATALOG.professional.purchasable,
    popular: false,
  },
];

