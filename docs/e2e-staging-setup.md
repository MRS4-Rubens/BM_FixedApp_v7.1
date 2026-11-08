# E2E Staging Setup (TEST-003)

The Playwright suite (`e2e/`) runs in GitHub Actions (`.github/workflows/e2e.yml`) against the **Vercel Preview
deployment of each pull request's head commit**. Preview deployments talk to an isolated Neon branch, so tests
never touch development or production data.

```
PR push ──► Vercel builds a Preview (env: Preview variables ──► Neon branch staging-e2e / neondb)
        └─► GitHub Action: wait for that Preview ──► migrate staging ──► trust the preview origin on Neon Auth
                           ──► Playwright (bypassing Vercel Authentication) ──► remove the trusted origin
```

If the required secrets/variables are absent the workflow **skips with a notice** instead of failing. Dependabot and fork PRs do not receive repository secrets, so the E2E check shows as "skipped" (grey); such PRs must be verified locally against their Vercel preview with `.claude/reviewer-tools` without pasting secrets.

---

## 1. Vercel project

- Project: `bm-fixed-app-v7-1` (Hobby). **Production Branch = `production`** (Settings → Environments →
  Production → Branch Tracking). `main` and every PR branch therefore produce **Preview** deployments only.
  The `production` branch must exist on GitHub before Vercel accepts it.
- **Deployment Protection → Vercel Authentication**: enabled (Standard Protection), so previews are private.
- **Protection Bypass for Automation**: one generated secret. Vercel exposes it to deployments as
  `VERCEL_AUTOMATION_BYPASS_SECRET`; the tests send it as the `x-vercel-protection-bypass` header
  (`playwright.config.ts`) from the `E2E_VERCEL_BYPASS_SECRET` GitHub secret.

### Preview environment variables

Added on Settings → Environments → **Preview** → Environment Variables, Preview only:

| Variable | Value |
|---|---|
| `DATABASE_URL` / `DATABASE_URL_UNPOOLED` | `staging-e2e` branch, database **`neondb`**, pooled / direct |
| `NEON_AUTH_BASE_URL` | The **staging-e2e branch's** Auth URL (each Neon branch has its own auth) |
| `NEON_AUTH_COOKIE_SECRET`, `CRON_SECRET` | Fresh random values (≥ 32 chars), not the dev ones |
| `PLATFORM_ADMIN_EMAILS` | The E2E admin email (`E2E_ADMIN_EMAIL`) |
| Email, Upstash, PDF, UPI/bank settings | Dev values (rotated with fresh accounts at launch) |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | Type **Config** (it is public by design); everything else type **Secret** |

**Do not set `NEXT_PUBLIC_APP_URL` for Preview.** Every preview has its own address; when the variable is unset
and `VERCEL_ENV=preview`, `lib/env.ts` uses `https://$VERCEL_URL`. Production never falls back (ARCH-002).
Do not add `SENTRY_*` to Preview (test runs would flood the error tracker).

---

## 2. Neon staging branch

- Project `invoice_matrix_v2` (`quiet-lab-45633403`), branch **`staging-e2e`** (`br-hidden-sky-atpt4hgy`),
  created from the default branch with current data. Database: **`neondb`**.
- Why `neondb`: the `neon_auth` schema lives only in `neondb`. The tests mark sign-up emails verified directly in
  `neon_auth.user`, so the app and the tests must use the same database as the auth service.
- On creation the branch's `neondb` was reset (drop and recreate `public` and `drizzle`; `neon_auth` untouched),
  then all migrations were applied and tax rates seeded. The workflow re-runs `pnpm e2e:migrate-staging` on every
  run, so new migrations reach staging automatically.

### Trusted origins (Neon Auth)

Neon Auth only accepts a wildcard as the **leftmost** label (`https://*.example.com`). Vercel preview hosts are
single labels under `vercel.app`, so the only accepted wildcard would be `https://*.vercel.app`, which trusts
every site on Vercel. **Never add that.** Instead the workflow calls
`scripts/ci/neon-auth-trusted-origin.ts add <preview origin>` before the tests and `remove` afterwards. The
script refuses non-`https`, non-`*.vercel.app`, multi-label, forbidden (production) hosts, and the default
branch. To click around a preview manually, add that **exact** origin in Neon Console → staging-e2e → Settings →
Better Auth → Domains, and remove it when done.

---

## 3. GitHub secrets and variables

Repository → Settings → Secrets and variables → Actions.

| Secrets | |
|---|---|
| `E2E_CONFIRM_STAGING` | Exactly `yes-this-is-not-production` |
| `E2E_STAGING_DATABASE_URL` | Staging pooled URL (also used as `E2E_DATABASE_URL`) |
| `E2E_STAGING_DATABASE_URL_UNPOOLED` | Staging direct URL (migrations) |
| `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD` | E2E platform admin; created by global setup on first run |
| `E2E_VERCEL_BYPASS_SECRET` | Vercel Protection Bypass for Automation secret |
| `E2E_UPSTASH_REST_URL`, `E2E_UPSTASH_REST_TOKEN` | Upstash used by Preview; global setup clears `auth*` rate-limit keys |
| `NEON_API_KEY` | **Project-scoped** Neon API key (Organization settings → API keys → Project-scoped) |
| `MAILOSAUR_API_KEY`, `MAILOSAUR_SERVER_ID` | Optional, only for the `mailbox` project |

| Variables | |
|---|---|
| `NEON_PROJECT_ID`, `NEON_STAGING_BRANCH_ID` | Identify the staging branch for the trusted-origin script |
| `E2E_DB_HOST_ALLOWLIST` | Staging pooled + direct hostnames (comma-separated) |
| `E2E_FORBIDDEN_DB_HOSTS` | Dev/production database hostnames |
| `E2E_FORBIDDEN_HOSTS` | Production app host(s), e.g. `bm-fixed-app-v7-1.vercel.app` |
| `E2E_UPSTASH_HOST_ALLOWLIST` | Upstash hostname allowed to be flushed |
| `E2E_VERIFY_MODE` (optional) | `direct_db` (default) or `mailbox` |
| `E2E_EXPECT_VERIFICATION_REQUIRED` (optional) | `true` (default) |

---

## 4. Running locally against a preview

Keep the values in git-ignored `.env.e2e.local`, export the same names as the workflow, set `E2E_BASE_URL` to the
preview origin, trust that origin (section 2), then `pnpm e2e`. Load env files with `node --env-file`, not shell
`source`: the database URLs contain `&`.

---

## 5. Accessibility baseline

```bash
UPDATE_A11Y_BASELINE=1 pnpm e2e --project=quality
```

Review the diff in `e2e/a11y-baseline.json` and commit it with the change.

---

## 6. Resetting staging

1. Neon Console: delete `staging-e2e`, re-create it from the default branch (current data).
2. Reset `public` + `drizzle` in its `neondb`, run the migrations against its direct URL, seed tax rates.
3. Update the staging URLs, `NEON_AUTH_BASE_URL` (Vercel Preview) and `NEON_STAGING_BRANCH_ID`, plus the host
   allowlist variable, because a new branch gets new IDs and hosts.
4. The E2E admin is re-created by global setup on the next run.
