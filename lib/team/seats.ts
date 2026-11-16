/**
 * Team seat rules (feature A). Pure; callers pass counts read under the business row lock.
 * A seat is taken by every member (owner included) AND every open (pending, unexpired) invite,
 * so an owner can never send more invites than the plan allows.
 * `limit === null` means unlimited (Professional).
 */
export interface SeatUsage {
  readonly members: number;
  readonly openInvites: number;
  readonly limit: number | null;
}

export type SeatDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly code: 'TEAM_PLAN_REQUIRED' | 'TEAM_SEAT_LIMIT'; readonly message: string };

export function seatsUsed(usage: SeatUsage): number {
  return usage.members + usage.openInvites;
}

/** Can the owner open ONE more invite? */
export function evaluateNewInvite(usage: SeatUsage): SeatDecision {
  if (usage.limit !== null && usage.limit <= 1) {
    return {
      allowed: false,
      code: 'TEAM_PLAN_REQUIRED',
      message: 'Your current plan includes only the owner account. Upgrade to Essentials Pro to add team members.',
    };
  }
  if (usage.limit !== null && seatsUsed(usage) >= usage.limit) {
    return {
      allowed: false,
      code: 'TEAM_SEAT_LIMIT',
      message: `Your plan allows ${usage.limit} users (including you). Remove a member or cancel a pending invite first.`,
    };
  }
  return { allowed: true };
}

/**
 * Can an invited person join now? The invite being accepted already holds a seat at invite time, but the plan
 * may have shrunk since (downgrade or expiry), so only the members are re-checked here: joining must not
 * push the member count past the CURRENT limit.
 */
export function evaluateJoin(usage: Pick<SeatUsage, 'members' | 'limit'>): SeatDecision {
  if (usage.limit !== null && usage.members + 1 > usage.limit) {
    return {
      allowed: false,
      code: usage.limit <= 1 ? 'TEAM_PLAN_REQUIRED' : 'TEAM_SEAT_LIMIT',
      message:
        'This business has no free team seats on its current plan. Ask the business owner to upgrade or free a seat, then try again.',
    };
  }
  return { allowed: true };
}
