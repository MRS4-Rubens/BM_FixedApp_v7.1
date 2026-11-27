import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// LAUNCH-L5 (docs/LAUNCH_CHECKLIST.md 2.7, 2.8): guards on the backup and E2E workflows.

const read = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');

describe('LAUNCH-L5 nightly backup workflow', () => {
  const wf = read('.github/workflows/backup-db.yml');

  it('runs at 21:00 UTC (02:30 IST) and has a manual button', () => {
    expect(wf).toContain("cron: '0 21 * * *'");
    expect(wf).toContain('workflow_dispatch:');
  });

  it('is off until BACKUPS_ENABLED=true, never runs in forks, and is read-only on the repo', () => {
    expect(wf).toContain("if: github.event.repository.fork == false && vars.BACKUPS_ENABLED == 'true'");
    expect(wf).toMatch(/permissions:\s*\n\s*contents: read/);
    expect(wf).not.toContain('pull_request');
  });

  it('fails loudly when enabled but a secret is missing (no silent skip)', () => {
    expect(wf).toContain('::error::Backups are enabled but these secrets are missing');
  });

  it('dumps with Postgres 18, checks the dump, encrypts with AES-256 and shreds the plain copy before upload', () => {
    expect(wf).toContain('PG_IMAGE: postgres:18');
    expect(wf).toContain("grep -q 'TABLE public invoices'");
    expect(wf).toContain('--symmetric --cipher-algo AES256');
    expect(wf).toContain('shred -u "$RUNNER_TEMP/backup/db.dump"');
    const encryptAt = wf.indexOf('- name: Encrypt');
    const uploadAt = wf.indexOf('- name: Upload');
    expect(encryptAt).toBeGreaterThan(0);
    expect(uploadAt).toBeGreaterThan(encryptAt);
    // Only the encrypted file is ever uploaded.
    expect(wf.match(/aws s3 cp [^\n]*\n\s*"\$RUNNER_TEMP\/backup\/[^"]+"/g)?.every((line) => line.includes('db.dump.gpg'))).toBe(true);
  });

  it('keeps 7 daily + 4 weekly copies in bizfolio-backups', () => {
    expect(wf).toContain("S3_BUCKET: ${{ vars.BACKUP_S3_BUCKET || 'bizfolio-backups' }}");
    expect(wf).toContain('prune daily 7');
    expect(wf).toContain('prune weekly 4');
  });
});

describe('LAUNCH-L5 E2E workflow runs the app on the runner', () => {
  const wf = read('.github/workflows/e2e.yml');

  it('builds and starts the pull request on localhost and waits for /ping', () => {
    expect(wf).toContain('E2E_BASE_URL: http://localhost:3000');
    expect(wf).toContain('run: pnpm build');
    expect(wf).toContain('nohup pnpm start');
    expect(wf).toContain('http://localhost:3000/ping');
  });

  it('no longer depends on Vercel previews, the bypass secret or Mailosaur', () => {
    for (const gone of ['wait-for-preview', 'neon-auth-trusted-origin', 'E2E_VERCEL_BYPASS_SECRET', 'MAILOSAUR', 'preview_url']) {
      expect(wf).not.toContain(gone);
    }
    expect(fs.existsSync(path.resolve(process.cwd(), 'e2e/specs/07-mailbox-verification.spec.ts'))).toBe(false);
  });

  it('confirms e-mail via the test database and uses only fake PDF / e-mail / storage keys', () => {
    expect(wf).toContain('E2E_VERIFY_MODE: db');
    expect(wf).toContain('BREVO_API_KEY: e2e-placeholder-brevo-key');
    expect(wf).toContain('CLOUDFLARE_ACCOUNT_ID: e2e-placeholder-not-a-real-account');
    expect(wf).toContain('IDRIVE_E2_ENDPOINT: https://s3.e2e.example.invalid');
  });

  it('uses fake payee details that pass the fail-closed payee rules, so checkout shows the QR', async () => {
    const { UPI_ID_PATTERN, IFSC_PATTERN, ACCOUNT_NUMBER_PATTERN } = await import('@/lib/config/payee');
    const value = (name: string) => new RegExp(`${name}: '?([^'\n]+)'?`).exec(wf)?.[1]?.trim() ?? '';
    expect(UPI_ID_PATTERN.test(value('ADMIN_UPI_ID'))).toBe(true);
    expect(IFSC_PATTERN.test(value('ADMIN_BANK_IFSC'))).toBe(true);
    expect(ACCOUNT_NUMBER_PATTERN.test(value('ADMIN_BANK_ACC_NO'))).toBe(true);
  });

  it('generates fresh cookie and cron secrets every run (masked, never stored)', () => {
    expect(wf).toContain('openssl rand -hex 32');
    expect(wf).toContain('::add-mask::$cookie');
    expect(wf).not.toMatch(/NEON_AUTH_COOKIE_SECRET:\s*\$\{\{\s*secrets\./);
  });

  it('keeps the fork guard, read-only permissions and one-run-at-a-time on the shared test database', () => {
    expect(wf).toContain('github.repository == github.event.pull_request.head.repo.full_name');
    expect(wf).toMatch(/permissions:\s*\n\s*contents: read\s*\n/);
    expect(wf).toContain('cancel-in-progress: false');
    expect(wf).not.toContain('pull_request_target');
  });

  it('CI-01: fails (not skips) when the E2E secrets are missing on a same-repo PR or manual run', () => {
    const check = wf.slice(wf.indexOf('- name: Check staging configuration'), wf.indexOf('  e2e:'));
    expect(check).toContain('::error::E2E is not configured');
    expect(check).toMatch(/configured=false" >> "\$GITHUB_OUTPUT"\s*\n\s*exit 1/);
    expect(check).not.toContain('::notice::');
  });
});
