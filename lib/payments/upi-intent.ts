/**
 * Pure UPI intent URI builder.
 *
 * Implements NPCI UPI Linking Specifications for payment URLs (upi://pay).
 * Pure functions only: no imports from React, Next.js, or external libraries.
 */

export interface UpiPaymentIntentInput {
  payeeVpa: string;
  payeeName: string;
  amountPaise: number;
  note: string;
}

/**
 * Formats an amount in paise to standard 2-decimal rupee string (e.g. 39900 -> "399.00").
 * Throws a plain Error if amountPaise is not a positive safe integer.
 */
export function formatUpiAmount(amountPaise: number): string {
  if (typeof amountPaise !== 'number' || !Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
    throw new Error('Amount in paise must be a positive safe integer');
  }

  const rupees = Math.floor(amountPaise / 100);
  const paise = String(amountPaise % 100).padStart(2, '0');
  return `${rupees}.${paise}`;
}

/**
 * Builds an RFC-compliant upi://pay URI.
 *
 * All values are encoded via encodeURIComponent (spaces as %20, never '+').
 * The note is trimmed and capped at 50 characters per NPCI specifications.
 */
export function buildUpiPaymentUri(input: UpiPaymentIntentInput): string {
  const { payeeVpa, payeeName, amountPaise, note } = input;

  if (typeof payeeVpa !== 'string' || !payeeVpa.trim()) {
    throw new Error('Payee VPA is required');
  }

  if (typeof payeeName !== 'string' || !payeeName.trim()) {
    throw new Error('Payee name is required');
  }

  if (typeof note !== 'string' || !note.trim()) {
    throw new Error('Payment note is required');
  }

  const formattedAmount = formatUpiAmount(amountPaise);
  const trimmedVpa = payeeVpa.trim();
  const trimmedName = payeeName.trim();
  const trimmedNote = note.trim().slice(0, 50);

  // The VPA is written verbatim (e.g. "name@okaxis"), the canonical form used by NPCI examples and printed
  // merchant QRs; some UPI apps do not decode "%40". Only VPA-safe characters are accepted, so no encoding is
  // needed (same shape as UPI_ID_PATTERN in lib/config/payee.ts).
  if (!/^[A-Za-z0-9._-]{2,256}@[A-Za-z][A-Za-z0-9]{1,63}$/.test(trimmedVpa)) {
    throw new Error('Payee VPA is not a valid UPI ID');
  }
  const pa = trimmedVpa;
  const pn = encodeURIComponent(trimmedName);
  const am = encodeURIComponent(formattedAmount);
  const cu = 'INR';
  const tn = encodeURIComponent(trimmedNote);

  return `upi://pay?pa=${pa}&pn=${pn}&am=${am}&cu=${cu}&tn=${tn}`;
}

