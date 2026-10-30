import { describe, expect, it } from 'vitest';
import { classifyAuthRoute } from '@/lib/auth/auth-path';

describe('Auth Path Classification (AUTH-002)', () => {
  it('classifies POST /api/auth/sign-in/email as login', () => {
    expect(classifyAuthRoute('POST', '/api/auth/sign-in/email')).toBe('login');
  });

  it('classifies POST /api/auth/sign-up/email as signup', () => {
    expect(classifyAuthRoute('POST', '/api/auth/sign-up/email')).toBe('signup');
  });

  it('classifies recovery and verification endpoints as recovery', () => {
    const recoveryPaths = [
      '/api/auth/forget-password',
      '/api/auth/forgot-password',
      '/api/auth/request-password-reset',
      '/api/auth/reset-password',
      '/api/auth/send-verification-email',
      '/api/auth/send-verification',
      '/api/auth/verify-email',
      '/api/auth/email-otp/verify-email',
    ];

    for (const path of recoveryPaths) {
      expect(classifyAuthRoute('POST', path)).toBe('recovery');
    }
  });

  it('handles case-insensitivity and trailing slashes in pathnames and methods', () => {
    expect(classifyAuthRoute('post', '/API/AUTH/sign-in/email')).toBe('login');
    expect(classifyAuthRoute('POST', '/api/auth/sign-in/')).toBe('login');
    expect(classifyAuthRoute('POST', '/api/auth/SIGN-UP/email')).toBe('signup');
    expect(classifyAuthRoute('POST', '/api/auth/Reset-Password')).toBe('recovery');
  });

  it('returns null for non-POST requests (e.g. GET get-session)', () => {
    expect(classifyAuthRoute('GET', '/api/auth/get-session')).toBeNull();
    expect(classifyAuthRoute('GET', '/api/auth/sign-in/email')).toBeNull();
    expect(classifyAuthRoute('PUT', '/api/auth/sign-in/email')).toBeNull();
  });

  it('returns null for unthrottled or non-state-changing POST endpoints', () => {
    expect(classifyAuthRoute('POST', '/api/auth/sign-out')).toBeNull();
    expect(classifyAuthRoute('POST', '/api/auth/revoke-session')).toBeNull();
  });

  it('returns null for routes outside /api/auth/*', () => {
    expect(classifyAuthRoute('POST', '/api/authx/sign-in')).toBeNull();
    expect(classifyAuthRoute('POST', '/api/other/sign-in')).toBeNull();
    expect(classifyAuthRoute('POST', '/api/auth/')).toBeNull();
    expect(classifyAuthRoute('POST', '')).toBeNull();
  });
});

