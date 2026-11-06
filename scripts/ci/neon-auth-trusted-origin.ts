/**
 * scripts/ci/neon-auth-trusted-origin.ts
 *
 * Adds or removes ONE exact origin on the Neon Auth trusted-domain list of the isolated staging branch.
 *
 * Why: Neon Auth only accepts sign-in requests from trusted origins, and it only allows a wildcard as the
 * leftmost label (https://*.example.com). Vercel preview addresses are single labels under vercel.app
 * (<project>-<hash>-<team>.vercel.app), so the only wildcard Neon would accept is https://*.vercel.app, which
 * would trust every Vercel site. Instead the E2E workflow trusts the exact preview origin for the duration of
 * the run and removes it afterwards.
 *
 * Usage:
 *   tsx scripts/ci/neon-auth-trusted-origin.ts add    <origin>
 *   tsx scripts/ci/neon-auth-trusted-origin.ts remove <origin>
 *
 * Env: NEON_API_KEY (project-scoped key), NEON_PROJECT_ID, NEON_STAGING_BRANCH_ID, optional E2E_FORBIDDEN_HOSTS.
 * `add` writes added=true|false to $GITHUB_OUTPUT so the cleanup step only removes an origin this run added.
 */

import { appendFileSync } from 'node:fs';

const API = 'https://console.neon.tech/api/v2';

class TrustedOriginError extends Error {}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new TrustedOriginError(`Missing required environment variable ${name}.`);
  return value;
}

/** Accepts only a bare https origin on a Vercel deployment host that is not a forbidden (production) host. */
export function normalizePreviewOrigin(input: string, forbiddenHostsCsv = ''): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new TrustedOriginError('Origin is not a valid URL.');
  }
  if (url.protocol !== 'https:') throw new TrustedOriginError('Origin must use https://.');
  if (url.pathname.replace(/\/+$/, '') !== '' || url.search !== '' || url.hash !== '' || url.username !== '') {
    throw new TrustedOriginError('Origin must be a bare origin (no path, query or credentials).');
  }
  const host = url.hostname.toLowerCase();
  if (!/^[a-z0-9-]+\.vercel\.app$/.test(host)) {
    throw new TrustedOriginError(`Refusing to trust ${host}: only single-label *.vercel.app preview hosts are allowed.`);
  }
  const forbidden = forbiddenHostsCsv
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (forbidden.includes(host)) {
    throw new TrustedOriginError(`Refusing to trust forbidden (production) host ${host}.`);
  }
  return url.origin;
}

async function neon(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${required('NEON_API_KEY')}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  });
}

async function assertStagingBranch(projectId: string, branchId: string): Promise<void> {
  const response = await neon(`/projects/${projectId}/branches/${branchId}`);
  if (!response.ok) throw new TrustedOriginError(`Could not read the staging branch (HTTP ${response.status}).`);
  const body = (await response.json()) as { branch?: { default?: boolean; name?: string } };
  if (body.branch?.default) {
    throw new TrustedOriginError('Refusing to change trusted domains on the default (production) branch.');
  }
}

function writeOutput(key: string, value: string): void {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath) appendFileSync(outputPath, `${key}=${value}\n`);
}

async function main(): Promise<void> {
  const [command, rawOrigin] = process.argv.slice(2);
  if ((command !== 'add' && command !== 'remove') || !rawOrigin) {
    throw new TrustedOriginError('Usage: neon-auth-trusted-origin.ts <add|remove> <origin>');
  }
  const origin = normalizePreviewOrigin(rawOrigin, process.env.E2E_FORBIDDEN_HOSTS ?? '');
  const projectId = required('NEON_PROJECT_ID');
  const branchId = required('NEON_STAGING_BRANCH_ID');
  await assertStagingBranch(projectId, branchId);
  const path = `/projects/${projectId}/branches/${branchId}/auth/domains`;

  if (command === 'add') {
    const response = await neon(path, {
      method: 'POST',
      body: JSON.stringify({ domain: origin, auth_provider: 'better_auth' }),
    });
    if (response.ok) {
      console.log(`[neon-auth] Trusted ${origin} on the staging branch.`);
      writeOutput('added', 'true');
      return;
    }
    const text = await response.text();
    if (response.status === 400 && /already exists/i.test(text)) {
      console.log(`[neon-auth] ${origin} was already trusted; leaving it in place.`);
      writeOutput('added', 'false');
      return;
    }
    throw new TrustedOriginError(`Adding the trusted origin failed (HTTP ${response.status}).`);
  }

  const response = await neon(path, {
    method: 'DELETE',
    body: JSON.stringify({ auth_provider: 'better_auth', domains: [{ domain: origin }] }),
  });
  if (!response.ok) throw new TrustedOriginError(`Removing the trusted origin failed (HTTP ${response.status}).`);
  console.log(`[neon-auth] Removed ${origin} from the staging branch.`);
}

const isDirectRun = process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/ci/neon-auth-trusted-origin.ts');
if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(`[neon-auth] ERROR: ${error instanceof Error ? error.message : 'unknown error'}`);
    process.exitCode = 1;
  });
}
