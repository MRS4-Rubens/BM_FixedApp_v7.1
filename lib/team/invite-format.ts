/**
 * Team invite helpers that are safe in client and server code (feature A). No imports.
 */
export const INVITE_TTL_DAYS = 7;
const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Cheap shape check before any database lookup (rejects junk, path tricks and oversized input). */
export function isWellFormedInviteToken(value: unknown): value is string {
  return typeof value === 'string' && INVITE_TOKEN_PATTERN.test(value);
}

export function computeInviteExpiry(now: Date): Date {
  return new Date(now.getTime() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export function isInviteExpired(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() <= now.getTime();
}

/** E-mail identity for invites: trimmed and lower-cased (matches the DB CHECK business_invitations_email_normalised). */
export function normaliseInviteEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** "rahul.sharma@gmail.com" -> "ra***@gmail.com". Used where the full address must not be shown to whoever holds the link. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const visible = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${visible}***@${domain}`;
}

export function buildInvitePath(token: string): string {
  return `/invite/${token}`;
}
