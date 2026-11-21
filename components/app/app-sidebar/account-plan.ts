/**
 * What the sidebar account pill and account menu show for the business's plan.
 * PURE: the layout passes the already-resolved plan (resolveBusinessPlan), so a plan whose end date has passed reads
 * as expired here even before the nightly job flips the stored status.
 */

export interface SidebarSubscription {
  /** Resolved tier: 'free' | 'trial' | 'essentials' | 'professional'. */
  plan: string
  /** Resolved status: 'trial' | 'active' | 'expired' | 'suspended'. */
  status: string
  endsAt: string | null
}

export type UpgradeAction =
  /** No upgrade row at all (platform admin console, no business). */
  | { kind: 'hidden' }
  /** Owner can open checkout. */
  | { kind: 'link'; href: string; label: string }
  /** Shown greyed out (already on the top plan, or the account is suspended). */
  | { kind: 'muted'; label: string; reason: string }
  /** Staff / accountant: only the owner can buy. */
  | { kind: 'ask-owner' }

export interface AccountPlanDisplay {
  /** Small tag after the role in the menu header ("Owner · Trial"); null = role only. */
  statusTag: 'Trial' | 'Expired' | 'Suspended' | null
  /** Second line of the bottom pill. 'upgrade' renders the "UPGRADE TO PRO →" text. */
  pill: { kind: 'upgrade' } | { kind: 'plan'; label: string } | { kind: 'role' } | { kind: 'suspended' }
  upgrade: UpgradeAction
}

const UPGRADE_LABEL = 'Upgrade to Pro'

export function describeAccountPlan(subscription: SidebarSubscription | null | undefined, role: string | undefined): AccountPlanDisplay {
  if (!subscription) return { statusTag: null, pill: { kind: 'role' }, upgrade: { kind: 'hidden' } }

  // Same rule as roleLabel(): only staff and accountants are not owners.
  const isOwner = role !== 'staff' && role !== 'accountant'
  const ownerOr = (action: UpgradeAction): UpgradeAction =>
    action.kind === 'link' && !isOwner ? { kind: 'ask-owner' } : action
  // Staff and accountants cannot buy, so their pill keeps saying who they are ("Team member").
  const pillFor = (ownerPill: AccountPlanDisplay['pill']): AccountPlanDisplay['pill'] => (isOwner ? ownerPill : { kind: 'role' })

  if (subscription.status === 'suspended') {
    return {
      statusTag: 'Suspended',
      pill: { kind: 'suspended' },
      upgrade: { kind: 'muted', label: UPGRADE_LABEL, reason: 'Contact support to restore your account first' },
    }
  }

  if (subscription.status === 'active' && subscription.plan === 'professional') {
    return {
      statusTag: null,
      pill: pillFor({ kind: 'plan', label: 'Professional' }),
      upgrade: { kind: 'muted', label: UPGRADE_LABEL, reason: 'You are already on the top plan' },
    }
  }

  if (subscription.status === 'active' && subscription.plan === 'essentials') {
    return {
      statusTag: null,
      pill: pillFor({ kind: 'plan', label: 'Essentials Pro' }),
      upgrade: ownerOr({ kind: 'link', href: '/checkout?plan=professional', label: 'Upgrade to Professional' }),
    }
  }

  const statusTag = subscription.status === 'trial' ? 'Trial' : subscription.status === 'expired' ? 'Expired' : null
  return { statusTag, pill: pillFor({ kind: 'upgrade' }), upgrade: ownerOr({ kind: 'link', href: '/checkout', label: UPGRADE_LABEL }) }
}
