# Staging Preview Environment Setup Guide (E2E / TEST-003)

This guide documents how to provision and maintain an isolated staging environment for Bill Matrix's Playwright End-to-End test suite.

---

## 1. Neon Staging Database Branch

To guarantee complete isolation from production data and schemas, the E2E suite runs exclusively against a dedicated Neon Postgres branch (e.g., `staging-e2e`).

1. Open the **Neon Console** -> Select your Project.
2. Click **Branches** -> **New Branch**.
3. Set **Branch Name**: `staging-e2e`.
4. Set **Parent Branch**: `main` (or latest stable schema).
5. Obtain the connection strings from the Connection Details widget:
   - **Pooled connection string**: Use for `E2E_STAGING_DATABASE_URL`
   - **Direct / Unpooled connection string**: Use for `E2E_STAGING_DATABASE_URL_UNPOOLED`

> [!IMPORTANT]
> The database name or host must contain `staging` or `test`, and must never point to the production database or root `main` branch. The E2E runner will abort if pointing to production.

---

## 2. Vercel Preview Deployment Overrides

Vercel Preview Deployments should point to the staging infrastructure:

1. In the **Vercel Dashboard**, open the Bill Matrix project -> **Settings** -> **Environment Variables**.
2. For the **Preview** environment:
   - `DATABASE_URL`: Set to Neon `staging-e2e` pooled connection string.
   - `DATABASE_URL_UNPOOLED`: Set to Neon `staging-e2e` unpooled connection string.
   - `NEON_AUTH_BASE_URL`: Set to the staging Neon Auth URL.
   - `UPSTASH_REDIS_REST_URL`: Set to the staging Redis instance.
   - `UPSTASH_REDIS_REST_TOKEN`: Set to the staging Redis token.
   - `VERCEL_AUTOMATION_BYPASS_SECRET`: Generate a random 32-character string to allow Playwright bypass headers on preview deployments with Deployment Protection enabled.

---

## 3. Upstash Redis Staging Namespace

To prevent rate limits from interfering with test runs:
1. Create a dedicated staging database in the **Upstash Console** (or use separate token credentials).
2. Note the REST URL and REST Token.
3. The global setup routine cleans rate-limit test keys matching `@upstash/ratelimit:auth*` before each test suite execution.

---

## 4. GitHub Secrets & Variables Configuration

Configure the following secrets in **GitHub Repository** -> **Settings** -> **Secrets and variables** -> **Actions**:

### Secrets
| Secret Name | Description | Example / Note |
|---|---|---|
| `E2E_CONFIRM_STAGING` | Mandatory safety confirmation | Must be exact string: `yes-this-is-not-production` |
| `E2E_STAGING_DATABASE_URL` | Neon staging pooled connection string | `postgresql://user:pass@ep-staging-xyz-pooler.neon.tech/neondb` |
| `E2E_STAGING_DATABASE_URL_UNPOOLED` | Neon staging unpooled connection string | `postgresql://user:pass@ep-staging-xyz.neon.tech/neondb` |
| `E2E_ADMIN_EMAIL` | Pre-existing platform admin email | `admin-staging@billmatrix.in` |
| `E2E_ADMIN_PASSWORD` | Platform admin password | Strong password (min 12 chars) |
| `E2E_UPSTASH_REDIS_REST_URL` | Staging Redis REST URL | `https://staging-redis.upstash.io` |
| `E2E_UPSTASH_REDIS_REST_TOKEN` | Staging Redis REST Token | Upstash REST token |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | Vercel Deployment Protection bypass | 32-character hex/random string |
| `MAILOSAUR_API_KEY` | Optional: Mailosaur API Key for mailbox project | From Mailosaur dashboard |
| `MAILOSAUR_SERVER_ID` | Optional: Mailosaur Server ID | From Mailosaur dashboard |

### Variables (Repository Variables)
| Variable Name | Default Value | Description |
|---|---|---|
| `E2E_EXPECT_VERIFICATION_REQUIRED` | `true` | Set to `false` if staging has email verification disabled |
| `E2E_VERIFY_MODE` | `direct_db` | Verification method: `direct_db` or `mailbox` |

---

## 5. Accessibility Baseline Recording

The test suite uses a ratchet pattern for accessibility auditing (`05-a11y.spec.ts`).
When a new view is introduced or baseline violations are updated:

```bash
UPDATE_A11Y_BASELINE=1 pnpm e2e --project=quality
```

Review the updated diff in `e2e/a11y-baseline.json` and commit it alongside the changes.

---

## 6. Staging Database Reset & Recovery

If test data builds up or inconsistent states occur on the staging branch:
1. In the **Neon Console**, delete the `staging-e2e` branch.
2. Re-create the `staging-e2e` branch from `main`.
3. Run the migrations:
   ```bash
   pnpm e2e:migrate-staging
   ```
4. The global setup routine will automatically recreate the initial admin user during the next E2E run.

