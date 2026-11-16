/**
 * Who may accept a team invite (feature A). PURE: shared by the accept page (to explain the state) and the
 * accept action (to enforce it), so both always agree.
 */
export interface InviteForAccept {
  readonly status: 'pending' | 'accepted' | 'revoked';
  readonly email: string;
  readonly expiresAt: Date;
  readonly businessId: string;
  readonly acceptedBy: string | null;
}

export interface AcceptingUser {
  readonly appUserId: string;
  readonly businessId: string | null;
  readonly sessionEmail: string | null;
  readonly emailVerified: boolean;
}

export type AcceptDecision =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code:
        | 'INVITE_REVOKED'
        | 'INVITE_USED'
        | 'ALREADY_MEMBER'
        | 'INVITE_EXPIRED'
        | 'EMAIL_MISMATCH'
        | 'EMAIL_NOT_VERIFIED'
        | 'ALREADY_IN_BUSINESS';
      readonly message: string;
    };

export function evaluateAccept(invite: InviteForAccept, user: AcceptingUser, now: Date): AcceptDecision {
  if (invite.status === 'revoked') {
    return { ok: false, code: 'INVITE_REVOKED', message: 'This invite was cancelled by the business owner.' };
  }
  if (invite.status === 'accepted') {
    if (invite.acceptedBy === user.appUserId && user.businessId === invite.businessId) {
      return { ok: false, code: 'ALREADY_MEMBER', message: 'You have already joined this business.' };
    }
    return { ok: false, code: 'INVITE_USED', message: 'This invite has already been used.' };
  }
  if (user.businessId === invite.businessId) {
    return { ok: false, code: 'ALREADY_MEMBER', message: 'You are already a member of this business.' };
  }
  if (invite.expiresAt.getTime() <= now.getTime()) {
    return {
      ok: false,
      code: 'INVITE_EXPIRED',
      message: 'This invite has expired. Ask the business owner to send you a new one.',
    };
  }
  const sessionEmail = user.sessionEmail?.trim().toLowerCase() ?? '';
  if (sessionEmail === '' || sessionEmail !== invite.email) {
    return {
      ok: false,
      code: 'EMAIL_MISMATCH',
      message: 'This invite was sent to a different e-mail address. Sign in with the invited address to accept it.',
    };
  }
  if (!user.emailVerified) {
    return {
      ok: false,
      code: 'EMAIL_NOT_VERIFIED',
      message:
        'Please verify your e-mail address first (check your inbox for the verification link), then open this invite link again to accept.',
    };
  }
  if (user.businessId !== null) {
    return {
      ok: false,
      code: 'ALREADY_IN_BUSINESS',
      message:
        'This account already belongs to a business, and an account can belong to only one business. Ask the owner to invite a different e-mail address.',
    };
  }
  return { ok: true };
}
