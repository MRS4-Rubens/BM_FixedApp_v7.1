/**
 * Plan Catalog & Feature Matrix for Bill Matrix
 *
 * Single source of truth for user-facing plan definitions, taglines,
 * feature availability (included vs coming_soon), and pricing presentation.
 * Client-safe: imports ONLY from ./entitlements.
 */

import { type PlanTier, type BillingCycle, PLAN_PRICING } from './entitlements';

export type PlanFeatureStatus = 'included' | 'coming_soon';

export interface PlanFeature {
  label: string;
  status: PlanFeatureStatus;
}

export interface PlanCatalogEntry {
  id: PlanTier;
  name: string;
  tagline: string;
  purchasable: boolean;
  features: readonly PlanFeature[];
}

export const PLAN_CATALOG: Record<PlanTier, PlanCatalogEntry> = {
  free: {
    id: 'free',
    name: 'Free',
    tagline: 'For getting started',
    purchasable: false,
    features: [
      { label: 'Up to 30 invoices per month', status: 'included' },
      { label: 'Up to 30 customers and 30 products', status: 'included' },
      { label: 'Classic Slate invoice template', status: 'included' },
      { label: 'GST invoices and credit notes', status: 'included' },
      { label: 'E-mail invoices (PDF) and payment reminders', status: 'included' },
      { label: 'Payment tracking and sales reports', status: 'included' },
      { label: 'Bill Matrix watermark on invoices', status: 'included' },
    ],
  },
  trial: {
    id: 'trial',
    name: 'Free Trial',
    tagline: 'Try every Essentials Pro feature',
    purchasable: false,
    features: [
      { label: 'Everything in Essentials Pro during your trial', status: 'included' },
    ],
  },
  essentials: {
    id: 'essentials',
    name: 'Essentials Pro',
    tagline: 'For growing retailers, wholesalers and traders',
    purchasable: true,
    features: [
      { label: 'Unlimited invoices, customers and products', status: 'included' },
      { label: 'All 4 invoice templates', status: 'included' },
      { label: 'Your logo on invoices, no watermark', status: 'included' },
      { label: 'WhatsApp invoice sharing', status: 'included' },
      { label: 'GSTR-1, HSN, Sales Register and ITR 44AD Excel exports', status: 'included' },
      { label: 'Custom invoice number format and prefix', status: 'included' },
      { label: 'E-mail invoices (PDF) and payment reminders', status: 'included' },
      { label: 'Team members and roles', status: 'coming_soon' },
    ],
  },
  professional: {
    id: 'professional',
    name: 'Professional',
    tagline: 'For accountants and multi-user teams',
    purchasable: false,
    features: [
      { label: 'Everything in Essentials Pro', status: 'included' },
      { label: 'Unlimited team members', status: 'coming_soon' },
      { label: 'Read-only access for your CA', status: 'coming_soon' },
      { label: 'Bulk customer and product import', status: 'coming_soon' },
      { label: 'Multiple invoice number series', status: 'coming_soon' },
    ],
  },
};

export const PURCHASABLE_PLAN_IDS: readonly ('essentials' | 'professional')[] = (
  ['essentials', 'professional'] as const
).filter((id) => PLAN_CATALOG[id].purchasable);

export function isPurchasablePlan(id: string): boolean {
  return (PURCHASABLE_PLAN_IDS as readonly string[]).includes(id);
}

export function formatPlanPrice(
  plan: 'essentials' | 'professional',
  cycle: BillingCycle
): { headline: string; perMonthPaise: number; note: string } {
  const pricing = PLAN_PRICING[plan];
  const inrFormatter = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

  if (cycle === 'monthly') {
    const rupees = Math.floor(pricing.monthlyPaise / 100);
    return {
      headline: `₹${inrFormatter.format(rupees)}`,
      perMonthPaise: pricing.monthlyPaise,
      note: 'Billed monthly',
    };
  }

  const perMonthPaise = Math.floor(pricing.yearlyPaise / 12);
  const perMonthRupees = Math.floor(perMonthPaise / 100);
  const yearlyRupees = Math.floor(pricing.yearlyPaise / 100);
  const savingsPercent = Math.round(
    (1 - pricing.yearlyPaise / (pricing.monthlyPaise * 12)) * 100
  );

  return {
    headline: `₹${inrFormatter.format(perMonthRupees)}`,
    perMonthPaise,
    note: `Billed yearly (₹${inrFormatter.format(yearlyRupees)}/yr — save ${savingsPercent}%)`,
  };
}

