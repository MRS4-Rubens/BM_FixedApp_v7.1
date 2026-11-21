import { describe, expect, it } from 'vitest';
import { signedOutSince } from '@/components/app/invoices/invoice-form/use-unsaved-invoice-draft';

// The 'storage' event that tells other tabs about a sign-out is delivered asynchronously, so a form in another tab
// may run its pending write first. That write checks the sign-out marker synchronously and must be refused.
describe('unsaved invoice copies after sign-out (cross-tab gate)', () => {
  const opened = 1_700_000_000_000;

  it('blocks a pending write from a form opened before the sign-out (write runs before the storage event)', () => {
    expect(signedOutSince(String(opened + 5_000), opened)).toBe(true);
    expect(signedOutSince(String(opened), opened)).toBe(true);
  });

  it('allows writes from a form opened after the sign-out (next sign-in in this browser)', () => {
    expect(signedOutSince(String(opened - 1), opened)).toBe(false);
  });

  it('allows writes when no sign-out happened or the marker is unreadable', () => {
    expect(signedOutSince(null, opened)).toBe(false);
    expect(signedOutSince('not-a-number', opened)).toBe(false);
  });
});
