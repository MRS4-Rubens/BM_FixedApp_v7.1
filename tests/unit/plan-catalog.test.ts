import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { listComponentSourceFiles, readComponentSources } from '../helpers/component-sources';
import {
  PLAN_CATALOG,
  PURCHASABLE_PLAN_IDS,
  formatPlanPrice,
  isPurchasablePlan,
} from '@/lib/subscriptions/plan-catalog';

describe('Plan Catalog (CLEAN-002)', () => {
  it('formatPlanPrice produces exact expected strings for both plans and cycles', () => {
    // Essentials
    const essMonthly = formatPlanPrice('essentials', 'monthly');
    expect(essMonthly.headline).toBe('₹399');
    expect(essMonthly.perMonthPaise).toBe(39900);
    expect(essMonthly.note).toBe('Billed monthly');

    const essYearly = formatPlanPrice('essentials', 'yearly');
    expect(essYearly.headline).toBe('₹291');
    expect(essYearly.perMonthPaise).toBe(29158); // Math.floor(349900 / 12)
    expect(essYearly.note).toBe('Billed yearly (₹3,499/yr — save 27%)');

    // Professional
    const proMonthly = formatPlanPrice('professional', 'monthly');
    expect(proMonthly.headline).toBe('₹599');
    expect(proMonthly.perMonthPaise).toBe(59900);
    expect(proMonthly.note).toBe('Billed monthly');

    const proYearly = formatPlanPrice('professional', 'yearly');
    expect(proYearly.headline).toBe('₹416');
    expect(proYearly.perMonthPaise).toBe(41658); // Math.floor(499900 / 12)
    expect(proYearly.note).toBe('Billed yearly (₹4,999/yr — save 30%)');
  });

  it('PURCHASABLE_PLAN_IDS equals ["essentials"]', () => {
    expect(PURCHASABLE_PLAN_IDS).toEqual(['essentials']);
    expect(isPurchasablePlan('essentials')).toBe(true);
    expect(isPurchasablePlan('professional')).toBe(false);
    expect(isPurchasablePlan('free')).toBe(false);
    expect(isPurchasablePlan('trial')).toBe(false);
  });

  it('plan-catalog.ts imports only from ./entitlements', () => {
    const filePath = path.resolve(process.cwd(), 'lib/subscriptions/plan-catalog.ts');
    const content = fs.readFileSync(filePath, 'utf8');
    const importLines = content
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('import ') || l.startsWith('import type '));

    for (const line of importLines) {
      expect(line).toMatch(/from\s+['"]\.\/entitlements['"]/);
    }
  });

  it('team tiering and purchasability invariants', () => {
    // Essentials includes team feature
    const essTeamFeature = PLAN_CATALOG.essentials.features.find(
      (f) => f.label === 'Team members: you + 2 staff'
    );
    expect(essTeamFeature).toBeDefined();
    expect(essTeamFeature?.status).toBe('included');

    // No essentials feature is coming_soon
    const essComingSoon = PLAN_CATALOG.essentials.features.filter(
      (f) => f.status === 'coming_soon'
    );
    expect(essComingSoon.length).toBe(0);

    // Essentials is purchasable and has unique included features
    const essIncluded = PLAN_CATALOG.essentials.features.filter(
      (f) => f.status === 'included' && !f.label.startsWith('Everything in')
    );
    expect(essIncluded.length).toBeGreaterThan(0);
    expect(PLAN_CATALOG.essentials.purchasable).toBe(true);

    // Professional includes unlimited team members
    const proTeamFeature = PLAN_CATALOG.professional.features.find(
      (f) => f.label === 'Unlimited team members'
    );
    expect(proTeamFeature).toBeDefined();
    expect(proTeamFeature?.status).toBe('included');

    // Professional remains coming soon and not purchasable
    expect(PLAN_CATALOG.professional.purchasable).toBe(false);
  });

  it('INVARIANT: every purchasable plan has at least one unique included feature not in the previous tier', () => {
    // (The converse no longer holds: Professional now has a shipped unique feature but stays unpurchasable until
    // its remaining features ship, roadmap item G.)
    for (const plan of Object.values(PLAN_CATALOG)) {
      if (!plan.purchasable) continue;
      const unique = plan.features.filter((f) => f.status === 'included' && !f.label.startsWith('Everything in'));
      expect(unique.length, `${plan.id} is purchasable but has no unique included feature`).toBeGreaterThan(0);
    }
  });
});


describe('CLEAN-002 reviewer: one source for prices', () => {
  it('formatPlanPrice exposes the yearly total and saving for both cycles', async () => {
    const { formatPlanPrice: f, formatPlanPriceSummary } = await import('@/lib/subscriptions/plan-catalog');
    expect(f('essentials', 'monthly').yearlyTotal).toBe('₹3,499');
    expect(f('essentials', 'yearly').yearlyTotal).toBe('₹3,499');
    expect(f('essentials', 'yearly').savingsPercent).toBe(27);
    expect(f('professional', 'monthly').yearlyTotal).toBe('₹4,999');
    expect(f('professional', 'yearly').savingsPercent).toBe(30);
    expect(formatPlanPriceSummary('essentials')).toBe('₹399 / month (or ₹3,499 / year)');
    expect(formatPlanPriceSummary('professional')).toBe('₹599 / month (or ₹4,999 / year)');
  });

  it('plan screens never hand-type a non-zero rupee price (they must use PLAN_PRICING / formatPlanPrice)', () => {
    const files = [
      'components/landing/pricing-section.tsx',
      ...listComponentSourceFiles('components/app/settings/billing-tab.tsx'),
      'components/app/subscription/upgrade-prompt-modal.tsx',
      ...listComponentSourceFiles('app/(app)/checkout/checkout-form.tsx'),
    ];
    const offenders: string[] = [];
    for (const rel of files) {
      const lines = fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8').split(/\r?\n/);
      lines.forEach((line, i) => {
        // "₹" followed by a digit other than a lone 0 (₹0 for free/trial is fine).
        if (/₹\s?(?!0\b)\d/.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('TRIAL_DURATION_DAYS has one definition, re-exported for the signup transaction', async () => {
    const ent = await import('@/lib/subscriptions/entitlements');
    expect(ent.TRIAL_DURATION_DAYS).toBe(14);
    const src = fs.readFileSync(path.resolve(process.cwd(), 'lib/business/save-profile-tx.ts'), 'utf8');
    expect(src).not.toMatch(/export const TRIAL_DURATION_DAYS\s*=/);
  });

  it("plan screens never hand-type a saving percentage or an unsupported tax claim", () => {
    const files = [
      "components/landing/pricing-section.tsx",
      ...listComponentSourceFiles("components/app/settings/billing-tab.tsx"),
      "components/app/subscription/upgrade-prompt-modal.tsx",
    ];
    const offenders: string[] = [];
    for (const rel of files) {
      const src = fs.readFileSync(path.resolve(process.cwd(), rel), "utf8");
      for (const re of [/save\s+(?:up\s+to\s+)?\d+\s*%/i, /tax\s+deductible/i, /input\s+tax\s+credit/i]) {
        const m = src.match(re);
        if (m) offenders.push(rel + ": " + m[0]);
      }
    }
    const checkoutSrc = readComponentSources('app/(app)/checkout/checkout-form.tsx');
    for (const re of [/save\s+(?:up\s+to\s+)?\d+\s*%/i, /tax\s+deductible/i, /input\s+tax\s+credit/i]) {
      const m = checkoutSrc.match(re);
      if (m) offenders.push('app/(app)/checkout/checkout-form.tsx: ' + m[0]);
    }
    expect(offenders).toEqual([]);
  });
});
