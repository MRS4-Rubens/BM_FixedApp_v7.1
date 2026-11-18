import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// LAUNCH-L4 (docs/LAUNCH_CHECKLIST.md 2.3): the code-entry screen.

vi.mock('@/app/(auth)/signup/verify-actions', () => ({
  verifySignupCodeAction: vi.fn(),
  resendSignupCodeAction: vi.fn(),
}));

import { VerifyEmailCodeForm } from '@/components/auth/verify-email-code-form';

function renderForm() {
  return renderToStaticMarkup(
    <VerifyEmailCodeForm
      email="asha@shop.in"
      initialNotice="Account created. We sent a 6-digit code to asha@shop.in. It expires in 15 minutes."
      onChangeEmail={() => undefined}
      onGoToSignIn={() => undefined}
    />,
  );
}

describe('LAUNCH-L4 VerifyEmailCodeForm', () => {
  it('shows a numeric one-time-code box, the address, the 15-minute expiry and the sign-up notice', () => {
    const html = renderForm();
    expect(html).toContain('name="code"');
    expect(html).toContain('inputMode="numeric"');
    expect(html).toContain('autoComplete="one-time-code"');
    expect(html).toContain('maxLength="6"');
    expect(html).toContain('asha@shop.in');
    expect(html).toContain('15 minutes');
    expect(html).toContain('Account created. We sent a 6-digit code');
  });

  it('sends the e-mail with both forms and offers Resend code and Use a different e-mail', () => {
    const html = renderForm();
    expect(html.match(/type="hidden" name="email" value="asha@shop.in"/g)).toHaveLength(2);
    expect(html).toContain('Resend code');
    expect(html).toContain('Use a different e-mail');
    expect(html).toContain('Confirm e-mail');
  });

  it('keeps Confirm disabled until 6 digits are typed, and never mentions a link', () => {
    const html = renderForm();
    expect(html).toMatch(/<button type="submit" disabled=""[^>]*>Confirm e-mail<\/button>/);
    expect(html).not.toMatch(/link/i);
  });
});
