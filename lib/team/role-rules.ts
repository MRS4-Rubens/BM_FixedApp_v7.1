import type { InvitableRole } from '@/lib/db/domain-values';

/**
 * Feature B: which team role may be GIVEN (invite, resend, join, change role) on the business's current plan.
 * PURE. The read-only accountant (CA) role needs Professional (`canUseAccountantRole`). An accountant who already
 * has access keeps it after a downgrade (decision 6); only new grants are refused.
 */
export type RoleGrantDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly code: 'ACCOUNTANT_PLAN_REQUIRED'; readonly message: string };

export function evaluateRoleGrant(role: InvitableRole, entitlements: { readonly canUseAccountantRole: boolean }): RoleGrantDecision {
  if (role === 'accountant' && !entitlements.canUseAccountantRole) {
    return {
      allowed: false,
      code: 'ACCOUNTANT_PLAN_REQUIRED',
      message: 'Read-only access for your CA is part of the Professional plan.',
    };
  }
  return { allowed: true };
}

/** Human label used in e-mails and messages. */
export function teamRoleLabel(role: InvitableRole): string {
  return role === 'accountant' ? 'Accountant (read-only)' : 'Team member';
}
