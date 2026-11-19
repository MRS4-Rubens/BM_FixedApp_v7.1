import { getContactEnv, getEmailEnv } from '@/lib/env';
import { DEV_SUPPORT_EMAIL } from '@/lib/config/contact';

/**
 * Who each app e-mail is "from" and where replies go (launch 3.8 follow-up).
 *
 * One verified Brevo sender (EMAIL_FROM) is used for everything; only the display NAME changes per kind, so the
 * recipient can tell an alert from a billing notice. Replies are routed to Gmail plus-addresses so they arrive
 * already labelled (e.g. NEXT_PUBLIC_SUPPORT_EMAIL = yourapp+support@gmail.com, BILLING_EMAIL = yourapp+billing@…).
 */
export type SenderKind = 'general' | 'alerts' | 'billing';

const SENDER_NAMES: Readonly<Record<SenderKind, string>> = {
  general: 'Invoice BizFolio',
  alerts: 'Invoice BizFolio Alerts',
  billing: 'Invoice BizFolio Billing',
};

/** `Name <address>` using the verified sender address from EMAIL_FROM. Throws EnvConfigError if e-mail is not configured. */
export function appSender(kind: SenderKind): string {
  const { EMAIL_FROM } = getEmailEnv();
  // EMAIL_FROM is `Name <address>` or a bare address (validated in lib/env.ts); keep only the address.
  const address = (/<([^<>\s]+@[^<>\s]+)>\s*$/.exec(EMAIL_FROM)?.[1] ?? EMAIL_FROM).trim();
  return `${SENDER_NAMES[kind]} <${address}>`;
}

/** Reply-to for e-mails sent to users (invites, notifications): the public support address, when one is configured. */
export function supportReplyTo(): string | undefined {
  const support = getContactEnv().NEXT_PUBLIC_SUPPORT_EMAIL ?? DEV_SUPPORT_EMAIL;
  return support !== DEV_SUPPORT_EMAIL ? support : undefined;
}

/** Inbox for payment-claim notices: BILLING_EMAIL when set (validated in lib/env.ts), otherwise null (use the admins). */
export function billingInbox(): string | null {
  return getContactEnv().BILLING_EMAIL ?? null;
}
