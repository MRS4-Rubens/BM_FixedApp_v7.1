import { describe, expect, it } from 'vitest';
import {
  extractAuthErrorMessage,
  loginFormSchema,
  readFormString,
  signupFormSchema,
} from '@/lib/validations/auth';

describe('Auth Validations (AUTH-002)', () => {
  describe('loginFormSchema', () => {
    it('requires both email and password with legacy message', () => {
      const emptyResult = loginFormSchema.safeParse({ email: '', password: '' });
      expect(emptyResult.success).toBe(false);
      if (!emptyResult.success) {
        expect(emptyResult.error.issues[0]?.message).toBe('Please enter both email and password.');
      }

      const missingPass = loginFormSchema.safeParse({ email: 'user@example.com', password: '' });
      expect(missingPass.success).toBe(false);
      if (!missingPass.success) {
        expect(missingPass.error.issues[0]?.message).toBe('Please enter both email and password.');
      }
    });

    it('accepts valid login payloads', () => {
      const valid = loginFormSchema.safeParse({
        email: 'user@example.com',
        password: 'my-strong-password-123',
      });
      expect(valid.success).toBe(true);
    });
  });

  describe('signupFormSchema', () => {
    it('requires all fields with legacy message', () => {
      const empty = signupFormSchema.safeParse({
        ownerName: '',
        email: '',
        password: '',
        confirmPassword: '',
      });
      expect(empty.success).toBe(false);
      if (!empty.success) {
        expect(empty.error.issues[0]?.message).toBe('Please fill in all required fields.');
      }
    });

    it('gives password mismatch precedence over password policy errors', () => {
      const mismatch = signupFormSchema.safeParse({
        ownerName: 'Test Owner',
        email: 'test@example.com',
        password: 'short', // policy would fail
        confirmPassword: 'different', // mismatch
      });
      expect(mismatch.success).toBe(false);
      if (!mismatch.success) {
        expect(mismatch.error.issues[0]?.message).toBe('Passwords do not match.');
      }
    });

    it('surfaces password policy errors when passwords match', () => {
      const weak = signupFormSchema.safeParse({
        ownerName: 'Test Owner',
        email: 'test@example.com',
        password: 'password123',
        confirmPassword: 'password123',
      });
      expect(weak.success).toBe(false);
      if (!weak.success) {
        expect(weak.error.issues[0]?.message).toBe(
          'This password is too common. Please choose a different one.'
        );
      }
    });

    it('validates email format', () => {
      const badEmail = signupFormSchema.safeParse({
        ownerName: 'Test Owner',
        email: 'not-an-email',
        password: 'strong-pass-phrase-123',
        confirmPassword: 'strong-pass-phrase-123',
      });
      expect(badEmail.success).toBe(false);
      if (!badEmail.success) {
        expect(badEmail.error.issues[0]?.message).toBe('Please enter a valid email address.');
      }
    });

    it('accepts completely valid signup payload', () => {
      const valid = signupFormSchema.safeParse({
        ownerName: 'Jane Doe',
        email: 'jane.doe@example.com',
        password: 'correct horse battery',
        confirmPassword: 'correct horse battery',
      });
      expect(valid.success).toBe(true);
    });
  });

  describe('readFormString', () => {
    it('reads string values correctly', () => {
      const fd = new FormData();
      fd.append('name', 'Alice');
      expect(readFormString(fd, 'name')).toBe('Alice');
    });

    it('returns empty string when key is missing or not a string', () => {
      const fd = new FormData();
      expect(readFormString(fd, 'missing')).toBe('');

      const file = new File(['content'], 'test.txt', { type: 'text/plain' });
      fd.append('upload', file);
      expect(readFormString(fd, 'upload')).toBe('');
    });
  });

  describe('extractAuthErrorMessage', () => {
    it('extracts body.message if present as a non-empty string', () => {
      const err = { body: { message: 'Invalid credentials provided by provider.' } };
      expect(extractAuthErrorMessage(err)).toBe('Invalid credentials provided by provider.');
    });

    it('returns null for non-objects, null, standard Error instances, or non-string messages', () => {
      expect(extractAuthErrorMessage(null)).toBeNull();
      expect(extractAuthErrorMessage(undefined)).toBeNull();
      expect(extractAuthErrorMessage('string error')).toBeNull();
      expect(extractAuthErrorMessage(123)).toBeNull();
      expect(extractAuthErrorMessage(new Error('plain message'))).toBeNull();
      expect(extractAuthErrorMessage({ body: { message: 42 } })).toBeNull();
      expect(extractAuthErrorMessage({ body: { message: '   ' } })).toBeNull();
      expect(extractAuthErrorMessage({ message: 'direct message' })).toBeNull();
    });
  });
});

