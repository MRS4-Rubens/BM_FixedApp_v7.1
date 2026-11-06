import { test, expect } from '../fixtures/test';
import { loadE2eEnv } from '../support/env';
import { MailosaurSink } from '../support/mail-sink';
import { generateTestPassword } from '../support/identity';

test.describe('07 - Real Email Mailbox Verification', () => {
  test('signs up with real mail sink and verifies via emailed link', async ({ page, authModal }) => {
    const env = loadE2eEnv(process.env);
    const apiKey = env.MAILOSAUR_API_KEY ?? env.E2E_MAILOSAUR_API_KEY;
    const serverId = env.MAILOSAUR_SERVER_ID ?? env.E2E_MAILOSAUR_SERVER_ID;

    if (
      env.E2E_VERIFY_MODE !== 'mailbox' ||
      !apiKey ||
      !serverId
    ) {
      test.skip(
        true,
        'MAILBOX NOT CONFIGURED: Set E2E_VERIFY_MODE=mailbox, MAILOSAUR_API_KEY, and MAILOSAUR_SERVER_ID to run live email verification tests'
      );
      return;
    }

    const mailSink = new MailosaurSink(apiKey, serverId);
    const testEmail = mailSink.generateTestEmail('e2e-mail-verify');
    const testPassword = generateTestPassword();
    const ownerName = 'Mail Verification Test User';

    // Step 1: Open Signup and fill details
    await authModal.openSignup();
    await authModal.fillSignup({
      ownerName,
      email: testEmail,
      password: testPassword,
    });
    await authModal.submitSignup();

    // Step 2: Expect verification notice
    await authModal.expectVerificationNotice();

    // Step 3: Wait for verification email
    const verificationUrl = await mailSink.waitForVerificationEmail(testEmail, 30_000);
    expect(verificationUrl).toBeTruthy();

    // Step 4: Navigate to verification URL
    await page.goto(verificationUrl);

    // Step 5: Assert verification succeeds
    await expect(page.getByText(/verified|successful|confirmed|welcome/i).first()).toBeVisible();
  });
});

