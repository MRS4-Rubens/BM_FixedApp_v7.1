export const REMINDER_COOLDOWN_SECONDS = 24 * 60 * 60;
export const INVOICE_EMAIL_COOLDOWN_SECONDS = 60; // anti double-click / duplicate-send guard
export const EMAIL_BURST_LIMIT = 5;
export const EMAIL_BURST_WINDOW = '60 s';
export const EMAIL_DAILY_CAP_PER_BUSINESS = 50; // invoice e-mails + reminders combined
export const EMAIL_DAILY_WINDOW = '1 d';

export type CooldownDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly retryAfterSeconds: number };

export function evaluateCooldown(
  lastAt: Date | null,
  now: Date,
  cooldownSeconds: number,
): CooldownDecision {
  if (lastAt === null) return { allowed: true };
  const remainingMs = cooldownSeconds * 1000 - (now.getTime() - lastAt.getTime());
  if (remainingMs <= 0) return { allowed: true };
  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.min(cooldownSeconds, Math.ceil(remainingMs / 1000))),
  };
}

/** "23 hours 12 minutes" / "45 seconds": for user-facing cooldown messages. */
export function formatRetryAfter(seconds: number): string {
  const boundedSeconds = Math.max(0, Math.floor(seconds));
  if (boundedSeconds === 0) return '0 seconds';

  const hours = Math.floor(boundedSeconds / 3600);
  const minutes = Math.floor((boundedSeconds % 3600) / 60);
  const remainingSeconds = boundedSeconds % 60;

  if (hours > 0) {
    const parts: string[] = [hours === 1 ? '1 hour' : `${hours} hours`];
    if (minutes > 0) {
      parts.push(minutes === 1 ? '1 minute' : `${minutes} minutes`);
    }
    return parts.join(' ');
  }

  if (minutes > 0) {
    const parts: string[] = [minutes === 1 ? '1 minute' : `${minutes} minutes`];
    if (remainingSeconds > 0) {
      parts.push(remainingSeconds === 1 ? '1 second' : `${remainingSeconds} seconds`);
    }
    return parts.join(' ');
  }

  return remainingSeconds === 1 ? '1 second' : `${remainingSeconds} seconds`;
}

export type SenderVerificationDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly code: 'EMAIL_NOT_VERIFIED'; readonly message: string };

/** Paid tiers are exempt. Everyone else (trial/free) must have a verified e-mail. Anything other than literal `true` is unverified. */
export function evaluateSenderVerification(input: {
  readonly isPaidTier: boolean;
  readonly emailVerified: unknown;
}): SenderVerificationDecision {
  if (input.isPaidTier) {
    return { allowed: true };
  }
  if (input.emailVerified === true) {
    return { allowed: true };
  }
  return {
    allowed: false,
    code: 'EMAIL_NOT_VERIFIED',
    message: 'Please verify your e-mail address before sending e-mails to customers. Check your inbox for the verification link.',
  };
}

/** Strips control characters / line breaks, collapses whitespace, truncates. For subjects & header values. */
export function sanitizeEmailHeaderText(value: string, maxLength = 120): string {
  const stripped = value.replace(/[\x00-\x1F\x7F-\x9F\u2028\u2029]/g, ' ');
  const collapsed = stripped.replace(/\s+/g, ' ').trim();
  return collapsed.slice(0, maxLength);
}

const SINGLE_EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

/** `{}` unless the address is a plain, single, well-formed mailbox. Never throws. */
export function buildListUnsubscribeHeader(
  contactEmail: string | null | undefined,
): Readonly<Record<string, string>> {
  if (!contactEmail || typeof contactEmail !== 'string') return {};
  const trimmed = contactEmail.trim();
  if (trimmed.includes(' ') || trimmed.includes(',') || trimmed.includes('<') || trimmed.includes('>')) {
    return {};
  }
  if (!SINGLE_EMAIL_REGEX.test(trimmed)) {
    return {};
  }
  return {
    'List-Unsubscribe': `<mailto:${trimmed}?subject=Unsubscribe>`,
  };
}

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** Whole days between two ISO dates (YYYY-MM-DD), UTC arithmetic, never negative, 0 on invalid input. */
export function computeDaysOverdue(dueDateIso: string, todayIso: string): number {
  if (!ISO_DATE_REGEX.test(dueDateIso) || !ISO_DATE_REGEX.test(todayIso)) {
    return 0;
  }
  const [dueY, dueM, dueD] = dueDateIso.split('-').map(Number);
  const [todayY, todayM, todayD] = todayIso.split('-').map(Number);
  const dueUtc = Date.UTC(dueY, dueM - 1, dueD);
  const todayUtc = Date.UTC(todayY, todayM - 1, todayD);
  if (isNaN(dueUtc) || isNaN(todayUtc)) {
    return 0;
  }
  const diffMs = todayUtc - dueUtc;
  if (diffMs <= 0) {
    return 0;
  }
  return Math.floor(diffMs / (24 * 60 * 60 * 1000));
}
