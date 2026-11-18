/**
 * Launch feature switches (LAUNCH-L1, docs/LAUNCH_CHECKLIST.md 2.1).
 *
 * CUSTOMER_EMAILS_ENABLED: e-mailing invoices and payment reminders to a business's own customers.
 * Off for the free pilot: without our own sending domain, those e-mails would land in strangers' spam folders.
 * The code stays in place; set this to true (after a domain is authenticated in Brevo) to switch the feature back on.
 */
export const CUSTOMER_EMAILS_ENABLED = false;
