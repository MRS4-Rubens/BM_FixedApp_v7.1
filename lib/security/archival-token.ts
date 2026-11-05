import crypto from 'crypto';
import { getArchivalEnv } from '@/lib/env';

export const ARCHIVAL_TOKEN_TTL_SECONDS = 120;
export const MAX_ARCHIVAL_TOKEN_TTL_SECONDS = 300;
export const ARCHIVAL_JTI_GRACE_SECONDS = 60;

export type ArchivalDocumentType = 'invoice' | 'credit_note';

const TYPE_TO_CODE: Readonly<Record<ArchivalDocumentType, string>> = { invoice: 'inv', credit_note: 'cn' };
const CODE_TO_TYPE: Readonly<Record<string, ArchivalDocumentType | undefined>> = { inv: 'invoice', cn: 'credit_note' };

const DOMAIN = 'bm-archival-v2';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JTI_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const EXPIRY_PATTERN = /^\d{10,11}$/;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function sign(secret: string, typeCode: string, documentId: string, jti: string, expiresAt: number): string {
  return crypto.createHmac('sha256', secret).update(`${DOMAIN}|${typeCode}|${documentId}|${jti}|${expiresAt}`).digest('base64url');
}

export function createArchivalToken(
  type: ArchivalDocumentType,
  documentId: string,
  ttlSeconds: number = ARCHIVAL_TOKEN_TTL_SECONDS,
  nowMs: number = Date.now(),
): string {
  if (!UUID_PATTERN.test(documentId)) throw new RangeError('documentId must be a UUID');
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > MAX_ARCHIVAL_TOKEN_TTL_SECONDS) {
    throw new RangeError(`ttlSeconds must be an integer between 1 and ${MAX_ARCHIVAL_TOKEN_TTL_SECONDS}`);
  }
  const secret = getArchivalEnv().ARCHIVAL_SIGNING_SECRET;
  const typeCode = TYPE_TO_CODE[type];
  const id = documentId.toLowerCase();
  const jti = crypto.randomBytes(16).toString('base64url');
  const expiresAt = Math.floor(nowMs / 1000) + ttlSeconds;
  return `${typeCode}.${id}.${jti}.${expiresAt}.${sign(secret, typeCode, id, jti, expiresAt)}`;
}

export type ArchivalTokenFailure = 'MALFORMED' | 'BAD_SIGNATURE' | 'EXPIRED' | 'TTL_TOO_LONG' | 'WRONG_DOCUMENT';

export type ArchivalTokenVerification =
  | { readonly valid: true; readonly jti: string; readonly expiresAt: number }
  | { readonly valid: false; readonly reason: ArchivalTokenFailure };

export interface ExpectedArchivalDocument {
  readonly type: ArchivalDocumentType;
  readonly documentId: string;
}

/**
 * Pure verification (no I/O). Signature is checked FIRST in constant time so later failures are not an oracle.
 * Intentionally lets an EnvConfigError (missing signing secret) propagate: callers must treat it as a server fault.
 */
export function verifyArchivalToken(
  token: string,
  expected: ExpectedArchivalDocument,
  nowMs: number = Date.now(),
): ArchivalTokenVerification {
  const parts = token.split('.');
  if (parts.length !== 5) return { valid: false, reason: 'MALFORMED' };
  const [typeCode, documentId, jti, expiryText, signature] = parts;
  if (
    typeCode === undefined || documentId === undefined || jti === undefined || expiryText === undefined || signature === undefined ||
    CODE_TO_TYPE[typeCode] === undefined || !UUID_PATTERN.test(documentId) || !JTI_PATTERN.test(jti) ||
    !EXPIRY_PATTERN.test(expiryText) || !SIGNATURE_PATTERN.test(signature)
  ) {
    return { valid: false, reason: 'MALFORMED' };
  }

  const expiresAt = Number(expiryText);
  const secret = getArchivalEnv().ARCHIVAL_SIGNING_SECRET;
  const expectedSignature = sign(secret, typeCode, documentId, jti, expiresAt);
  if (!crypto.timingSafeEqual(Buffer.from(signature, 'utf8'), Buffer.from(expectedSignature, 'utf8'))) {
    return { valid: false, reason: 'BAD_SIGNATURE' };
  }

  const nowSeconds = Math.floor(nowMs / 1000);
  if (nowSeconds > expiresAt) return { valid: false, reason: 'EXPIRED' };
  if (expiresAt - nowSeconds > MAX_ARCHIVAL_TOKEN_TTL_SECONDS) return { valid: false, reason: 'TTL_TOO_LONG' };
  if (CODE_TO_TYPE[typeCode] !== expected.type || documentId.toLowerCase() !== expected.documentId.toLowerCase()) {
    return { valid: false, reason: 'WRONG_DOCUMENT' };
  }
  return { valid: true, jti, expiresAt };
}

const TOKEN_QUERY_PATTERN = /([?&]token=)[^&\s"'<>]+/gi;
const TOKEN_SHAPE_PATTERN = /\b(?:inv|cn)\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{22}\.\d{10,11}\.[A-Za-z0-9_-]{43}\b/gi;

/** Removes anything that looks like an archival token from text that may be logged or returned. */
export function redactArchivalTokens(text: string): string {
  return text.replace(TOKEN_QUERY_PATTERN, '$1[redacted]').replace(TOKEN_SHAPE_PATTERN, '[redacted-token]');
}
