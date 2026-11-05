import crypto from 'crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  createArchivalToken,
  verifyArchivalToken,
  ARCHIVAL_TOKEN_TTL_SECONDS,
  MAX_ARCHIVAL_TOKEN_TTL_SECONDS,
} from '@/lib/security/archival-token';

const TEST_SECRET = '0123456789abcdef0123456789abcdef';

vi.mock('@/lib/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/env')>();
  return {
    ...actual,
    getArchivalEnv: vi.fn(() => ({
      ARCHIVAL_SIGNING_SECRET: TEST_SECRET,
    })),
  };
});

import { getArchivalEnv } from '@/lib/env';

describe('Archival Token (SEC-004)', () => {
  const validUuid = '12345678-1234-4234-8234-1234567890ab';

  it('round trip returns the same jti and expiresAt', () => {
    const fixedNowMs = 1_700_000_000_000;
    const token = createArchivalToken('invoice', validUuid, 120, fixedNowMs);
    const result = verifyArchivalToken(token, { type: 'invoice', documentId: validUuid }, fixedNowMs);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.expiresAt).toBe(1_700_000_120);
      expect(typeof result.jti).toBe('string');
      expect(result.jti).toMatch(/^[A-Za-z0-9_-]{22}$/);
    }
  });

  it('default TTL is 120 seconds', () => {
    expect(ARCHIVAL_TOKEN_TTL_SECONDS).toBe(120);
    const fixedNowMs = 1_700_000_000_000;
    const token = createArchivalToken('invoice', validUuid, undefined, fixedNowMs);
    const parts = token.split('.');
    expect(parts[3]).toBe('1700000120');
  });

  it('throws RangeError for invalid ttlSeconds: 0, 301, and 1.5', () => {
    expect(MAX_ARCHIVAL_TOKEN_TTL_SECONDS).toBe(300);
    expect(() => createArchivalToken('invoice', validUuid, 0)).toThrow(RangeError);
    expect(() => createArchivalToken('invoice', validUuid, MAX_ARCHIVAL_TOKEN_TTL_SECONDS + 1)).toThrow(RangeError);
    expect(() => createArchivalToken('invoice', validUuid, 1.5)).toThrow(RangeError);
  });

  it('throws RangeError for invalid documentId', () => {
    expect(() => createArchivalToken('invoice', 'not-a-uuid')).toThrow(RangeError);
  });

  it('generates 1,000 unique tokens with distinct jtis', () => {
    const jtis = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const token = createArchivalToken('invoice', validUuid);
      const parts = token.split('.');
      const jti = parts[2];
      if (jti) {
        jtis.add(jti);
      }
    }
    expect(jtis.size).toBe(1000);
  });

  it('rejects tampering with each segment with MALFORMED or BAD_SIGNATURE', () => {
    const token = createArchivalToken('invoice', validUuid);
    const parts = token.split('.');

    // Tampering segment count
    expect(verifyArchivalToken('invalid', { type: 'invoice', documentId: validUuid })).toEqual({
      valid: false,
      reason: 'MALFORMED',
    });
    expect(verifyArchivalToken(`${token}.extra`, { type: 'invoice', documentId: validUuid })).toEqual({
      valid: false,
      reason: 'MALFORMED',
    });

    // Tamper typeCode
    const badType = ['bad', parts[1], parts[2], parts[3], parts[4]].join('.');
    expect(verifyArchivalToken(badType, { type: 'invoice', documentId: validUuid })).toEqual({
      valid: false,
      reason: 'MALFORMED',
    });

    // Tamper documentId with non-UUID
    const nonUuid = [parts[0], 'bad-id', parts[2], parts[3], parts[4]].join('.');
    expect(verifyArchivalToken(nonUuid, { type: 'invoice', documentId: validUuid })).toEqual({
      valid: false,
      reason: 'MALFORMED',
    });

    // Tamper documentId with another valid UUID (fails signature check)
    const otherUuid = '87654321-4321-4321-8321-0987654321ba';
    const badUuidToken = [parts[0], otherUuid, parts[2], parts[3], parts[4]].join('.');
    expect(verifyArchivalToken(badUuidToken, { type: 'invoice', documentId: validUuid })).toEqual({
      valid: false,
      reason: 'BAD_SIGNATURE',
    });

    // Tamper jti (valid length/chars but different -> bad signature)
    const alteredJti = 'A'.repeat(22);
    const badJtiToken = [parts[0], parts[1], alteredJti, parts[3], parts[4]].join('.');
    expect(verifyArchivalToken(badJtiToken, { type: 'invoice', documentId: validUuid })).toEqual({
      valid: false,
      reason: 'BAD_SIGNATURE',
    });

    // Tamper expiry (valid format but changed -> bad signature)
    const alteredExpiry = String(Number(parts[3]) + 10);
    const badExpiryToken = [parts[0], parts[1], parts[2], alteredExpiry, parts[4]].join('.');
    expect(verifyArchivalToken(badExpiryToken, { type: 'invoice', documentId: validUuid })).toEqual({
      valid: false,
      reason: 'BAD_SIGNATURE',
    });

    // Tamper signature (valid base64url length but wrong chars -> bad signature)
    const alteredSig = parts[4]?.slice(0, -1) + (parts[4]?.endsWith('a') ? 'b' : 'a');
    const badSigToken = [parts[0], parts[1], parts[2], parts[3], alteredSig].join('.');
    expect(verifyArchivalToken(badSigToken, { type: 'invoice', documentId: validUuid })).toEqual({
      valid: false,
      reason: 'BAD_SIGNATURE',
    });
  });

  it('rejects verification if signing secret differs', () => {
    const token = createArchivalToken('invoice', validUuid);
    vi.mocked(getArchivalEnv).mockReturnValueOnce({
      ARCHIVAL_SIGNING_SECRET: 'different-secret-0123456789abcdef',
    });
    expect(verifyArchivalToken(token, { type: 'invoice', documentId: validUuid })).toEqual({
      valid: false,
      reason: 'BAD_SIGNATURE',
    });
  });

  it('rejects token when expiry is one second in the past (EXPIRED)', () => {
    const fixedNowMs = 1_700_000_000_000;
    const token = createArchivalToken('invoice', validUuid, 120, fixedNowMs);
    // At nowMs = fixedNowMs + 121 seconds (1s past expiry)
    const verification = verifyArchivalToken(
      token,
      { type: 'invoice', documentId: validUuid },
      fixedNowMs + 121_000,
    );
    expect(verification).toEqual({ valid: false, reason: 'EXPIRED' });
  });

  it('rejects token when expiry is more than 300 s ahead (TTL_TOO_LONG)', () => {
    const nowMs = 1_700_000_000_000;
    const nowSeconds = Math.floor(nowMs / 1000);
    const forgedExpiry = nowSeconds + 400; // 400s > MAX (300s)
    const jti = 'a'.repeat(22);
    const sig = crypto
      .createHmac('sha256', TEST_SECRET)
      .update(`bm-archival-v2|inv|${validUuid}|${jti}|${forgedExpiry}`)
      .digest('base64url');
    const forgedToken = `inv.${validUuid}.${jti}.${forgedExpiry}.${sig}`;

    const verification = verifyArchivalToken(
      forgedToken,
      { type: 'invoice', documentId: validUuid },
      nowMs,
    );
    expect(verification).toEqual({ valid: false, reason: 'TTL_TOO_LONG' });
  });

  it('rejects wrong document type or document id with WRONG_DOCUMENT', () => {
    const otherUuid = '99999999-9999-4999-8999-999999999999';
    // Mismatched document type
    const cnToken = createArchivalToken('credit_note', validUuid);
    expect(verifyArchivalToken(cnToken, { type: 'invoice', documentId: validUuid })).toEqual({
      valid: false,
      reason: 'WRONG_DOCUMENT',
    });

    // Mismatched document ID
    const invToken = createArchivalToken('invoice', validUuid);
    expect(verifyArchivalToken(invToken, { type: 'invoice', documentId: otherUuid })).toEqual({
      valid: false,
      reason: 'WRONG_DOCUMENT',
    });
  });

  it('rejects old 3-part format as MALFORMED', () => {
    const oldToken = `${validUuid}.1700000600.someoldsignature`;
    expect(verifyArchivalToken(oldToken, { type: 'invoice', documentId: validUuid })).toEqual({
      valid: false,
      reason: 'MALFORMED',
    });
  });

  it('never throws for garbage, empty, or oversized strings', () => {
    const inputs = ['', '...', 'not.enough.parts', 'a.b.c.d.e', 'x'.repeat(10_000)];
    for (const input of inputs) {
      expect(() => verifyArchivalToken(input, { type: 'invoice', documentId: validUuid })).not.toThrow();
      expect(verifyArchivalToken(input, { type: 'invoice', documentId: validUuid })).toEqual({
        valid: false,
        reason: 'MALFORMED',
      });
    }
  });

  it('matches document id case-insensitively (uppercase in expected matches lowercase token)', () => {
    const token = createArchivalToken('invoice', validUuid.toLowerCase());
    const verification = verifyArchivalToken(token, {
      type: 'invoice',
      documentId: validUuid.toUpperCase(),
    });
    expect(verification.valid).toBe(true);
  });
});
