import { describe, expect, it } from 'vitest';
import { validatePasswordPolicy } from '@/lib/auth/password-policy';

describe('Password Policy (AUTH-002)', () => {
  it('rejects passwords shorter than 10 characters with specific length message', () => {
    const result = validatePasswordPolicy('short123');
    expect(result).toEqual({
      ok: false,
      message: 'Password must be at least 10 characters long.',
    });
  });

  it('accepts strong passwords of exactly 10 characters', () => {
    const result = validatePasswordPolicy('xK9#vL2!mP');
    expect(result).toEqual({ ok: true });
  });

  it('rejects passwords longer than 128 characters with max length message', () => {
    const longPassword = 'a'.repeat(129);
    const result = validatePasswordPolicy(longPassword);
    expect(result).toEqual({
      ok: false,
      message: 'Password must be at most 128 characters long.',
    });
  });

  it('rejects deny-list entries case-insensitively', () => {
    const denyListSamples = ['password123', 'PASSWORD123', 'Welcome123', 'BillMatrix123', 'Admin12345'];
    for (const pw of denyListSamples) {
      const result = validatePasswordPolicy(pw);
      expect(result).toEqual({
        ok: false,
        message: 'This password is too common. Please choose a different one.',
      });
    }
  });

  it('rejects repeated single characters like aaaaaaaaaa', () => {
    const result = validatePasswordPolicy('aaaaaaaaaa');
    expect(result).toEqual({
      ok: false,
      message: 'This password is too common. Please choose a different one.',
    });
  });

  it('rejects sequence substrings of length 10 (forward and reversed)', () => {
    const sequences = ['1234567890', '0987654321', 'qwertyuiop', 'abcdefghij'];
    for (const seq of sequences) {
      const result = validatePasswordPolicy(seq);
      expect(result).toEqual({
        ok: false,
        message: 'This password is too common. Please choose a different one.',
      });
    }
  });

  it('rejects passwords containing email local-part if >= 4 chars, but allows short local parts (< 4)', () => {
    // Local-part >= 4 chars: "john" -> rejected
    const rejected = validatePasswordPolicy('my-john-pass123', { email: 'john@example.com' });
    expect(rejected).toEqual({
      ok: false,
      message: 'Password must not contain your email name.',
    });

    // Case-insensitive email check
    const rejectedCase = validatePasswordPolicy('my-JOHN-pass123', { email: 'John@Example.com' });
    expect(rejectedCase).toEqual({
      ok: false,
      message: 'Password must not contain your email name.',
    });

    // Short local-part < 4 chars: "bob" -> allowed
    const allowed = validatePasswordPolicy('my-bob-pass123', { email: 'bob@example.com' });
    expect(allowed).toEqual({ ok: true });
  });

  it('accepts multi-word passphrases with spaces and unicode', () => {
    const result = validatePasswordPolicy('correct horse battery');
    expect(result).toEqual({ ok: true });

    const unicodeResult = validatePasswordPolicy('शानदार-पासवर्ड-12345');
    expect(unicodeResult).toEqual({ ok: true });
  });

  it('does not enforce complex composition rules (no forced symbols)', () => {
    // Pure alphanumeric passphrases without symbols or uppercase are valid if strong
    const result = validatePasswordPolicy('simplestrongphrase');
    expect(result).toEqual({ ok: true });
  });
});

