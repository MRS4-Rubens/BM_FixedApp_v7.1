import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  PlanChangeNote,
  type PlanPurchaseSummary,
} from '@/app/(app)/checkout/checkout-form/plan-change-note';

describe('PlanChangeNote (G2)', () => {
  it('renders upgrade conversion note (300 -> 199 days)', () => {
    const purchase: PlanPurchaseSummary = {
      kind: 'upgrade',
      fromPlan: 'essentials',
      unusedDays: 300,
      creditedDays: 199,
      endsAt: '2028-01-18T10:00:00.000Z',
    };

    const html = renderToStaticMarkup(
      <PlanChangeNote purchase={purchase} plan="professional" cycle="yearly" />,
    );

    expect(html).toContain(
      'Switching from Essentials Pro: your 300 unused days become 199 days of Professional, then your paid year starts. New expiry: 18 Jan 2028.',
    );
    expect(html).toContain(
      'No refunds or part-payments: you always pay the plan&#x27;s normal price.',
    );
  });

  it('renders downgrade conversion note (30 -> 45 days)', () => {
    const purchase: PlanPurchaseSummary = {
      kind: 'downgrade',
      fromPlan: 'professional',
      unusedDays: 30,
      creditedDays: 45,
      endsAt: '2027-03-15T10:00:00.000Z',
    };

    const html = renderToStaticMarkup(
      <PlanChangeNote purchase={purchase} plan="essentials" cycle="monthly" />,
    );

    expect(html).toContain(
      'Switching from Professional: your 30 unused days become 45 days of Essentials Pro, then your paid month starts. New expiry: 15 Mar 2027.',
    );
    expect(html).toContain(
      'No refunds or part-payments: you always pay the plan&#x27;s normal price.',
    );
  });

  it('renders renewal note with added cycle', () => {
    const purchase: PlanPurchaseSummary = {
      kind: 'renewal',
      fromPlan: 'essentials',
      unusedDays: 10,
      creditedDays: 0,
      endsAt: '2027-03-15T10:00:00.000Z',
    };

    const html = renderToStaticMarkup(
      <PlanChangeNote purchase={purchase} plan="essentials" cycle="monthly" />,
    );

    expect(html).toContain(
      'Your current Essentials Pro plan continues; this month is added after it ends. New expiry: 15 Mar 2027.',
    );
    expect(html).toContain(
      'No refunds or part-payments: you always pay the plan&#x27;s normal price.',
    );
  });

  it('renders nothing for kind "new"', () => {
    const purchase: PlanPurchaseSummary = {
      kind: 'new',
      fromPlan: null,
      unusedDays: 0,
      creditedDays: 0,
      endsAt: '2027-01-01T10:00:00.000Z',
    };

    const html = renderToStaticMarkup(
      <PlanChangeNote purchase={purchase} plan="essentials" cycle="monthly" />,
    );

    expect(html).toBe('');
  });
});
