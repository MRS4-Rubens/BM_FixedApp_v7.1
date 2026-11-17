import {
  PLAN_CATALOG,
  formatPlanPriceSummary,
  type PlanFeature,
} from '@/lib/subscriptions/plan-catalog';
import {
  FREE_TIER_LIMITS,
  PLAN_PRICING,
  TRIAL_DURATION_DAYS,
} from '@/lib/subscriptions/entitlements';

export const STATUS_FILTERS = ['all', 'approved', 'pending', 'rejected'] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export const ITEMS_PER_PAGE = 3;

export interface PlanDefinition {
  name: string;
  price: string;
  monthlyPaise: number;
  yearlyPaise: number;
  invoiceMonthlyLimit: number | null; // null = unlimited
  features: readonly PlanFeature[];
  badge?: string;
}

// CLEAN-002: names, features, prices and limits all come from the plan catalogue / entitlements (no hand-typed copies).
export const PLAN_CONFIGS: Record<string, PlanDefinition> = {
  free: {
    name: PLAN_CATALOG.free.name,
    price: '₹0 / month',
    monthlyPaise: 0,
    yearlyPaise: 0,
    invoiceMonthlyLimit: FREE_TIER_LIMITS.invoiceMonthlyLimit,
    features: PLAN_CATALOG.free.features,
  },
  trial: {
    name: PLAN_CATALOG.trial.name,
    price: `₹0 for ${TRIAL_DURATION_DAYS} days`,
    monthlyPaise: 0,
    yearlyPaise: 0,
    invoiceMonthlyLimit: null,
    features: PLAN_CATALOG.trial.features,
  },
  essentials: {
    name: PLAN_CATALOG.essentials.name,
    price: formatPlanPriceSummary('essentials'),
    monthlyPaise: PLAN_PRICING.essentials.monthlyPaise,
    yearlyPaise: PLAN_PRICING.essentials.yearlyPaise,
    invoiceMonthlyLimit: null,
    features: PLAN_CATALOG.essentials.features,
    badge: 'Popular Tier',
  },
  professional: {
    name: PLAN_CATALOG.professional.name,
    price: formatPlanPriceSummary('professional'),
    monthlyPaise: PLAN_PRICING.professional.monthlyPaise,
    yearlyPaise: PLAN_PRICING.professional.yearlyPaise,
    invoiceMonthlyLimit: null,
    features: PLAN_CATALOG.professional.features,
    badge: 'For teams & CAs',
  },
};

const SHORT_MONTHS: Record<string, string> = {
  january: 'Jan',
  february: 'Feb',
  march: 'Mar',
  april: 'Apr',
  may: 'May',
  june: 'June',
  july: 'July',
  august: 'Aug',
  september: 'Sept',
  october: 'Oct',
  november: 'Nov',
  december: 'Dec',
};

export function formatShortMonth(label?: string): string {
  if (!label) return '';
  const parts = label.trim().split(/\s+/);
  if (parts.length >= 2) {
    const monthKey = parts[0].toLowerCase();
    const shortM = SHORT_MONTHS[monthKey] || parts[0].slice(0, 3);
    return `${shortM} ${parts[1]}`;
  }
  return label;
}

