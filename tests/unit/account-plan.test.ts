import { describe, expect, it } from 'vitest';
import { describeAccountPlan } from '@/components/app/app-sidebar/account-plan';

const sub = (plan: string, status: string) => ({ plan, status, endsAt: null });

describe('describeAccountPlan (sidebar account pill + menu)', () => {
  it('trial owner: "Owner · Trial", UPGRADE TO PRO pill, upgrade goes to checkout', () => {
    expect(describeAccountPlan(sub('trial', 'trial'), 'owner')).toEqual({
      statusTag: 'Trial',
      pill: { kind: 'upgrade' },
      upgrade: { kind: 'link', href: '/checkout', label: 'Upgrade to Pro' },
    });
  });

  it('expired trial or plan: "Owner · Expired", upgrade enabled', () => {
    const d = describeAccountPlan(sub('free', 'expired'), 'owner');
    expect(d.statusTag).toBe('Expired');
    expect(d.pill).toEqual({ kind: 'upgrade' });
    expect(d.upgrade).toEqual({ kind: 'link', href: '/checkout', label: 'Upgrade to Pro' });
  });

  it('Essentials: plan name on the pill, no status tag, upgrade to Professional', () => {
    expect(describeAccountPlan(sub('essentials', 'active'), 'owner')).toEqual({
      statusTag: null,
      pill: { kind: 'plan', label: 'Essentials Pro' },
      upgrade: { kind: 'link', href: '/checkout?plan=professional', label: 'Upgrade to Professional' },
    });
  });

  it('Professional: plan name on the pill, upgrade muted', () => {
    const d = describeAccountPlan(sub('professional', 'active'), 'owner');
    expect(d.statusTag).toBeNull();
    expect(d.pill).toEqual({ kind: 'plan', label: 'Professional' });
    expect(d.upgrade.kind).toBe('muted');
  });

  it('suspended: tag + muted upgrade, regardless of plan', () => {
    const d = describeAccountPlan(sub('professional', 'suspended'), 'owner');
    expect(d.statusTag).toBe('Suspended');
    expect(d.pill).toEqual({ kind: 'suspended' });
    expect(d.upgrade.kind).toBe('muted');
  });

  it('staff and accountants cannot buy: their pill shows their role and the upgrade link becomes "ask your owner"', () => {
    for (const role of ['staff', 'accountant']) {
      expect(describeAccountPlan(sub('trial', 'trial'), role).pill).toEqual({ kind: 'role' });
      expect(describeAccountPlan(sub('essentials', 'active'), role).pill).toEqual({ kind: 'role' });
      expect(describeAccountPlan(sub('trial', 'trial'), role).statusTag).toBe('Trial');
      expect(describeAccountPlan(sub('trial', 'trial'), role).upgrade).toEqual({ kind: 'ask-owner' });
      expect(describeAccountPlan(sub('essentials', 'active'), role).upgrade).toEqual({ kind: 'ask-owner' });
      expect(describeAccountPlan(sub('professional', 'active'), role).upgrade.kind).toBe('muted');
    }
  });

  it('no business (platform admin console): role on the pill, no upgrade row', () => {
    expect(describeAccountPlan(null, 'owner')).toEqual({ statusTag: null, pill: { kind: 'role' }, upgrade: { kind: 'hidden' } });
  });
});
