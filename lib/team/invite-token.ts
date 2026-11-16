import { createHash, randomBytes } from 'node:crypto';

/**
 * Team invite tokens (feature A). SERVER-ONLY (node:crypto). Client-safe helpers live in ./invite-format.ts.
 * - The raw token only ever lives in the invite e-mail / link; the database stores its SHA-256 hash.
 * - 32 random bytes = 256 bits of entropy, encoded base64url (43 characters, URL-safe, no padding).
 */
const INVITE_TOKEN_BYTES = 32;

export function generateInviteToken(): string {
  return randomBytes(INVITE_TOKEN_BYTES).toString('base64url');
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
