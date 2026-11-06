export interface PlatformAdminAllowlist {
  readonly emails: readonly string[]; // already lower-cased
  readonly userIds: readonly string[];
}

export interface SessionUserLike {
  readonly id?: unknown;
  readonly email?: unknown;
  readonly emailVerified?: unknown;
}

export interface PlatformAdminIdentity {
  readonly id: string;
  readonly email: string;
  readonly via: 'user_id' | 'verified_email';
}

export type PlatformAdminDecision =
  | { readonly allowed: true; readonly identity: PlatformAdminIdentity }
  | { readonly allowed: false; readonly reason: 'no_session' | 'not_allowlisted' | 'email_unverified' };

/** PURE policy. A user-id match is authorised (ids are server-generated); an e-mail match needs emailVerified === true. */
export function evaluatePlatformAdmin(
  user: SessionUserLike | null | undefined,
  allow: PlatformAdminAllowlist
): PlatformAdminDecision {
  if (!user || typeof user.id !== 'string' || user.id === '') {
    return { allowed: false, reason: 'no_session' };
  }
  const email = typeof user.email === 'string' ? user.email.trim().toLowerCase() : '';
  if (allow.userIds.includes(user.id)) {
    return { allowed: true, identity: { id: user.id, email, via: 'user_id' } };
  }
  if (email === '' || !allow.emails.includes(email)) {
    return { allowed: false, reason: 'not_allowlisted' };
  }
  if (user.emailVerified !== true) {
    return { allowed: false, reason: 'email_unverified' };
  }
  return { allowed: true, identity: { id: user.id, email, via: 'verified_email' } };
}

