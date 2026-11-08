import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
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

  it('INVARIANT: a plan is purchasable only if it has at least one unique included feature not in the previous tier', () => {
    // Professional has 'Everything in Essentials Pro' as its only included feature,
    // and no other unique included features shipped yet -> must NOT be purchasable.
    const proIncluded = PLAN_CATALOG.professional.features.filter(
      (f) => f.status === 'included' && !f.label.startsWith('Everything in')
    );
    expect(proIncluded.length).toBe(0);
    expect(PLAN_CATALOG.professional.purchasable).toBe(false);

    // Essentials has unique included features -> purchasable
    const essIncluded = PLAN_CATALOG.essentials.features.filter(
      (f) => f.status === 'included' && !f.label.startsWith('Everything in')
    );
    expect(essIncluded.length).toBeGreaterThan(0);
    expect(PLAN_CATALOG.essentials.purchasable).toBe(true);
  });
});

