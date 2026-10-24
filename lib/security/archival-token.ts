import crypto from 'crypto';
import { getArchivalEnv } from '@/lib/env';

/**
 * Generates a signed token to authorize access to the archival render route.
 */
export function createArchivalToken(invoiceId: string, expiresInSeconds = 600): string {
  const secret = getArchivalEnv().ARCHIVAL_SIGNING_SECRET;
  const expiryTimestamp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const payload = `${invoiceId}.${expiryTimestamp}`;

  const signature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('base64url');

  return `${payload}.${signature}`;
}

/**
 * Verifies the archival token in constant time and ensures it hasn't expired.
 */
export function verifyArchivalToken(token: string): { valid: boolean; invoiceId?: string } {
  const secret = getArchivalEnv().ARCHIVAL_SIGNING_SECRET;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return { valid: false };

    const [invoiceId, expiryStr, signature] = parts;
    if (!invoiceId || !expiryStr || !signature) {
      return { valid: false };
    }

    const expiryTimestamp = parseInt(expiryStr, 10);

    if (isNaN(expiryTimestamp) || Math.floor(Date.now() / 1000) > expiryTimestamp) {
      return { valid: false };
    }

    const payload = `${invoiceId}.${expiryTimestamp}`;
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('base64url');

    const sigBuf = Buffer.from(signature, 'utf8');
    const expectedBuf = Buffer.from(expectedSignature, 'utf8');

    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return { valid: false };
    }

    return { valid: true, invoiceId };
  } catch {
    return { valid: false };
  }
}
