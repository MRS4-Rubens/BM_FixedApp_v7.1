/**
 * Plan Catalog & Feature Matrix for Invoice BizFolio
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
      { label: 'Invoice BizFolio watermark on invoices', status: 'included' },
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
      { label: 'Team members: you + 2 staff', status: 'included' },
    ],
  },
  professional: {
    id: 'professional',
    name: 'Professional',
    tagline: 'For accountants and multi-user teams',
    purchasable: true,
    features: [
      { label: 'Everything in Essentials Pro', status: 'included' },
      { label: 'Unlimited team members', status: 'included' },
      { label: 'Read-only access for your CA', status: 'included' },
      { label: 'Bulk customer and product import', status: 'included' },
    ],
  },
};

export const PURCHASABLE_PLAN_IDS: readonly ('essentials' | 'professional')[] = (
  ['essentials', 'professional'] as const
).filter((id) => PLAN_CATALOG[id].purchasable);

export function isPurchasablePlan(id: string): boolean {
  return (PURCHASABLE_PLAN_IDS as readonly string[]).includes(id);
}

export interface PlanPriceDisplay {
  /** Price shown big: the monthly price, or the yearly price spread per month. */
  headline: string;
  perMonthPaise: number;
  note: string;
  /** Full yearly charge, e.g. "₹3,499" (same for both cycles). */
  yearlyTotal: string;
  /** Whole-percent saving of the yearly plan versus 12 monthly payments. */
  savingsPercent: number;
}

const inrFormatter = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const rupees = (paise: number): string => `₹${inrFormatter.format(Math.floor(paise / 100))}`;

export function formatPlanPrice(plan: 'essentials' | 'professional', cycle: BillingCycle): PlanPriceDisplay {
  const pricing = PLAN_PRICING[plan];
  const yearlyTotal = rupees(pricing.yearlyPaise);
  const savingsPercent = Math.round((1 - pricing.yearlyPaise / (pricing.monthlyPaise * 12)) * 100);

  if (cycle === 'monthly') {
    return {
      headline: rupees(pricing.monthlyPaise),
      perMonthPaise: pricing.monthlyPaise,
      note: 'Billed monthly',
      yearlyTotal,
      savingsPercent,
    };
  }

  const perMonthPaise = Math.floor(pricing.yearlyPaise / 12);
  return {
    headline: rupees(perMonthPaise),
    perMonthPaise,
    note: `Billed yearly (${yearlyTotal}/yr — save ${savingsPercent}%)`,
    yearlyTotal,
    savingsPercent,
  };
}

/** One-line summary for settings, e.g. "₹399 / month (or ₹3,499 / year)". */
export function formatPlanPriceSummary(plan: 'essentials' | 'professional'): string {
  const p = formatPlanPrice(plan, 'monthly');
  return `${p.headline} / month (or ${p.yearlyTotal} / year)`;
}

