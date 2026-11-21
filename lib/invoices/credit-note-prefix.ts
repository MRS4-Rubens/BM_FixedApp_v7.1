/**
 * Credit-note numbers are `<PREFIX>/<yy-yy>/<seq>` (e.g. CN/26-27/001) and must be at most 16 characters
 * (CGST Rule 53). The fixed part `/yy-yy/001` is 10 characters, so the prefix may use at most 6 (MONEY-04).
 * Pure module: shared by the settings validation, the settings live preview and the real numbering
 * (lib/invoices/credit-note-numbering.ts), so they can never disagree.
 */
export const CREDIT_NOTE_NUMBER_MAX_LENGTH = 16;
export const CREDIT_NOTE_PREFIX_MAX_LENGTH = 6;
export const CREDIT_NOTE_PREFIX_PATTERN = /^[A-Za-z0-9/-]+$/;
const DEFAULT_CREDIT_NOTE_PREFIX = 'CN';

export const CREDIT_NOTE_PREFIX_LENGTH_MESSAGE = `Prefix must be ${CREDIT_NOTE_PREFIX_MAX_LENGTH} characters or fewer (credit-note numbers are limited to ${CREDIT_NOTE_NUMBER_MAX_LENGTH} characters, e.g. CN/26-27/001).`;

/** The credit-note number for a prefix, an FY label ("2026-27") and a sequence value. Same rules as finalize. */
export function formatCreditNoteNumber(prefix: string, fyLabel: string, sequence: number): string {
  const cleanPrefix = prefix.trim().toUpperCase() || DEFAULT_CREDIT_NOTE_PREFIX;
  const shortFy = fyLabel.length >= 5 ? fyLabel.slice(-5) : fyLabel;
  const seqStr = String(sequence).padStart(3, '0');
  return `${cleanPrefix}/${shortFy}/${seqStr}`;
}
