# Bill Matrix

A GST billing and invoicing web application for Indian small businesses.

## Prerequisites

- **Node.js** — Node 24 (exact version pinned in `.nvmrc`; `package.json` engines is `24.x`; use the same major on Render). If you have [nvm](https://github.com/nvm-sh/nvm) installed, run `nvm use` to select the version automatically.
- **pnpm** — pnpm 11 (pinned in `package.json` as `pnpm@11.9.0`). Run `corepack enable` to ensure the correct package manager is active. Do not use npm or yarn.

## Local Setup

1. Clone the repository:
   ```bash
   git clone <repo-url>
   cd <repo-folder>
   ```

2. Enable corepack and install dependencies:
   ```bash
   corepack enable
   pnpm install
   ```

3. Copy `.env.example` to `.env.local` and configure required local values:
   ```bash
   cp .env.example .env.local
   ```
   **Minimum to start the app locally.** The server refuses to start without the Core group (checked at boot by `lib/env-boot.ts`, development included):
   - `DATABASE_URL` (+ `DATABASE_URL_UNPOOLED` for migrations; a disposable Neon branch works);
   - `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET` (32+ characters);
   - `CRON_SECRET` (32+ characters);
   - `PLATFORM_ADMIN_USER_IDS` or `PLATFORM_ADMIN_EMAILS`.

   `NEXT_PUBLIC_APP_URL` defaults to `http://localhost:3000`. Feature variables (storage, PDF, e-mail, Upstash) may stay as placeholders; only the feature that needs them reports an error. Exception: signing up needs a working Upstash Redis, because the signup rate limit fails closed. The checkout page needs the `ADMIN_UPI_*` / `ADMIN_BANK_*` payee values. The full table is in [Environment Variables](#environment-variables); see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for production.

   **IDRIVE_E2_ENDPOINT** — the iDrive e2 S3 endpoint. Both `s3.<region>.idrivee2.com` and `https://s3.<region>.idrivee2.com` are accepted; trailing slashes are ignored. Must be a bare host without bucket paths, query strings, or credentials.

4. Apply migrations and seed reference data:
   ```bash
   pnpm db:migrate
   pnpm db:seed
   ```

5. Start the local development server:
   ```bash
   pnpm dev
   ```
   The application will be accessible at [http://localhost:3000](http://localhost:3000).

## Available Scripts

The repository defines 31 scripts in `package.json`. Use `pnpm verify` as the standard pre-push check.

| Group | Script | Command | Description & Usage |
|---|---|---|---|
| **Develop** | `dev` | `next dev` | Starts the Next.js development server with hot-module replacement on localhost:3000. |
| **Develop** | `start` | `next start` | Runs the compiled production build locally for pre-deployment inspection. |
| **Develop** | `preinstall` | `npx only-allow pnpm` | Enforces pnpm as the exclusive package manager across all developer machines and CI. |
| **Quality** | `lint` | `eslint` | Executes ESLint across the codebase. |
| **Quality** | `typecheck` | `tsc --noEmit` | Runs the TypeScript compiler in no-emit mode to verify type correctness. |
| **Quality** | `lint:ratchet` | `tsx scripts/ci/lint-ratchet.ts` | Enforces zero-warning and zero-error ratchet baseline; fails if new lint warnings are introduced. |
| **Quality** | `knip` | `knip` | Detects unused files, dead code, unused exports, and unreferenced dependencies (CLEAN-001). |
| **Quality** | `verify` | `pnpm typecheck && pnpm lint:ratchet && pnpm db:check && pnpm test` | **Pre-push quality gate**: runs typecheck, lint ratchet, migration history check, and the full test suite. |
| **Tests** | `test` | `vitest run` | Runs all unit and in-memory PGlite integration tests once and exits. |
| **Tests** | `test:coverage` | `vitest run --coverage` | Runs the Vitest test suite with V8 code coverage collection. |
| **Tests** | `test:integration` | `vitest run tests/integration` | Runs PGlite integration test suites covering database rules, tenant isolation, and workflows. |
| **Tests** | `test:realdb` | `vitest run --config vitest.realdb.config.mts` | Runs multi-connection concurrency tests against real PostgreSQL 17 (Docker or disposable Neon branch). |
| **Tests** | `test:realdb:watch`| `vitest --config vitest.realdb.config.mts` | Runs real-database concurrency tests in interactive watch mode. |
| **Tests** | `test:watch` | `vitest` | Starts Vitest in interactive file-watching mode for unit test development. |
| **Database** | `db:generate` | `drizzle-kit generate` | Generates a new SQL migration file and snapshot from schema changes in `lib/db/schema/`. |
| **Database** | `db:migrate` | `drizzle-kit migrate` | Applies pending migration files to the database using `DATABASE_URL_UNPOOLED`. |
| **Database** | `db:push` | `drizzle-kit push` | Pushes schema changes directly to the database without generating migrations. **Only for throwaway local DBs.** |
| **Database** | `db:studio` | `drizzle-kit studio` | Opens the local Drizzle Studio browser GUI for inspecting and editing database rows. |
| **Database** | `db:seed` | `tsx --env-file=.env.local lib/db/seed.ts` | Seeds statutory GST tax rates and initial reference data. |
| **Database** | `db:check` | `drizzle-kit check` | Validates migration history integrity against existing schema snapshots. |
| **E2E** | `e2e` | `playwright test` | Runs the complete Playwright end-to-end journey suite against staging. |
| **E2E** | `e2e:headed` | `playwright test --headed` | Runs Playwright tests with a visible browser window. |
| **E2E** | `e2e:ui` | `playwright test --ui` | Launches the interactive Playwright UI runner with time-travel debugging. |
| **E2E** | `e2e:list` | `playwright test --list` | Discovers and prints all E2E test cases without running them. |
| **E2E** | `e2e:report` | `playwright show-report` | Opens the HTML report generated by the last Playwright test run. |
| **E2E** | `e2e:migrate-staging` | `tsx scripts/ci/migrate-staging.ts` | Applies pending database migrations to the isolated Neon E2E staging branch. |
| **E2E** | `e2e:redis-proxy` | `tsx scripts/ci/upstash-local-proxy.ts` | CI only: forwards the app's Redis calls to the local look-alike, removing the Upstash-only `allow-key-locking` script flag. |
| **Performance & Ops** | `build` | `next build` | Creates the optimized Next.js production build. |
| **Performance & Ops** | `ops:audit-gstin` | `tsx scripts/ops/audit-gstin-checksums.ts` | Read-only audit: re-checks the GSTIN checksum of every stored business and customer GSTIN and lists invalid ones (needs `DATABASE_URL`). |
| **Performance & Ops** | `perf:first-load` | `node scripts/perf/first-load-js.mjs` | After `pnpm build`, prints gzip first-load JS per main route from the build manifests (PERF-005). Informational; no budgets are enforced. |
| **Performance & Ops** | `perf:export-benchmark` | `tsx scripts/perf/export-benchmark.ts` | Runs the 100,000-row synthetic GSTR-1 Excel streaming stress benchmark (PERF-002b). |
| **Performance & Ops** | `print-css:build` | `tsx scripts/build-print-css.ts` | Compiles print stylesheet classes into `lib/pdf/print-stylesheet.generated.ts`. |

## Environment Variables

Environment variables are validated centrally and lazily via `lib/env.ts`, split into Core, Feature, Ops, and Build groups.

| Variable Name | Group | Public? | Required in Prod? | Purpose | Missing / Failure Behavior |
|---|---|---|---|---|---|
| `NEXT_PUBLIC_APP_URL` | Core: App | Yes | **Yes** | Fully qualified canonical origin of the application (e.g. `https://<name>.onrender.com`). | Fails boot / build (`EnvConfigError`). Non-prod falls back to `http://localhost:3000`; Vercel preview falls back to `https://$VERCEL_URL`. |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | Core: Contact | Yes | No | Customer-facing support email address rendered in navigation, footer, and help text. | Required in production (the server refuses to start without it). Outside production falls back to the placeholder `support@example.invalid` (`lib/config/contact.ts`). |
| `FEEDBACK_RECIPIENT_EMAIL` | Core: Contact | No | No | Internal recipient address for user feedback submissions. | Falls back to `NEXT_PUBLIC_SUPPORT_EMAIL` (`lib/config/contact.ts`). |
| `BILLING_EMAIL` | Core: Contact | No | No | Inbox for payment-claim notices (e.g. a Gmail `+billing` alias, so they arrive labelled). Sent as "Invoice BizFolio Billing". | Unset: notices go to `PLATFORM_ADMIN_EMAILS`. Must be one valid address. |
| `DATABASE_URL` | Core: Database | No | **Yes** | Neon pooled PostgreSQL connection string used for all application queries. | Fails boot (`EnvConfigError`). Must be valid `postgres://` or `postgresql://`. |
| `DATABASE_URL_UNPOOLED` | Ops: Database | No | **Yes (Migrations)** | Direct compute Neon PostgreSQL connection string (unpooled) for schema migrations. | Migration scripts (`drizzle.config.ts`, CI workflow) fail if unset. |
| `NEON_AUTH_BASE_URL` | Core: Auth | No | **Yes** | Base URL of the Neon Auth service for session authentication. | Fails boot (`EnvConfigError`). Must be a valid `https://` URL. |
| `NEON_AUTH_COOKIE_SECRET` | Core: Auth | No | **Yes** | Symmetric key used to encrypt and sign authentication session cookies. | Fails boot (`EnvConfigError`). Must be at least 32 characters long. |
| `IDRIVE_E2_ENDPOINT` | Feature: Storage | No | **Yes** (Archival) | S3-compatible endpoint host for iDrive e2 object storage (PDF archival and logos). | Fails callers on use. Logged as issue at boot. Bare host required. |
| `IDRIVE_E2_REGION` | Feature: Storage | No | **Yes** (Archival) | Storage region identifier for iDrive e2 bucket (e.g. `ap-southeast-2`, the region the launch buckets use). | Fails callers on use. Logged as issue at boot. |
| `IDRIVE_E2_BUCKET_NAME` | Feature: Storage | No | **Yes** (Archival) | Bucket name for storing archived statutory invoice/credit-note PDFs and business logos. | Fails callers on use. Logged as issue at boot. |
| `IDRIVE_E2_ACCESS_KEY` | Feature: Storage | No | **Yes** (Archival) | S3 access key ID for iDrive e2 bucket authentication. | Fails callers on use. Logged as issue at boot. |
| `IDRIVE_E2_SECRET_KEY` | Feature: Storage | No | **Yes** (Archival) | S3 secret access key for iDrive e2 bucket authentication. | Fails callers on use. Logged as issue at boot. |
| `CLOUDFLARE_ACCOUNT_ID` | Feature: PDF | No | **Yes** (Archival) | Cloudflare account ID (32 hex characters) for Browser Rendering, which turns finalized documents into PDFs. | Fails callers on use. Logged as issue at boot. |
| `CLOUDFLARE_API_TOKEN` | Feature: PDF | No | **Yes** (Archival) | Cloudflare API token with only the **Browser Run - Edit** permission. | Fails callers on use. Logged as issue at boot. |
| `BREVO_API_KEY` | Feature: Email | No | **Yes** (Email) | API key for the Brevo transactional e-mail API (sent over HTTPS). | Fails callers on use. Logged as issue at boot. |
| `EMAIL_FROM` | Feature: Email | No | **Yes** (Email) | Sender verified in Brevo, as `email` or `Name <email>` (pilot: your Gmail). | Fails callers on use. Must match sender format pattern. |
| `UPSTASH_REDIS_REST_URL` | Feature: Rate Limit | No | **Yes** (Rate Limit) | HTTPS REST endpoint for Upstash Redis used in distributed rate limiting. Plain `http://localhost` (the CI Redis look-alike) is accepted only when `SKIP_ENV_VALIDATION` applies, never on Render. | Fails callers on use; logged at boot. Rate limit enforcement fails closed or open per policy. |
| `UPSTASH_REDIS_REST_TOKEN` | Feature: Rate Limit | No | **Yes** (Rate Limit) | REST authentication token for Upstash Redis. | Fails callers on use; logged at boot. |
| `CRON_SECRET` | Core: Cron | No | **Yes** | Bearer secret authorizing the cron endpoints (`/api/cron/retry-invoice-archival`, `/api/cron/daily-notifications`), sent by cron-job.org. | Fails boot (`EnvConfigError`). Must be at least 32 characters long. |
| `PLATFORM_ADMIN_USER_IDS` | Core: Admin | No | **Yes** (or emails) | Comma-separated list of platform administrator user IDs (preferred). | Fails boot if both admin IDs and admin emails are unset. |
| `PLATFORM_ADMIN_EMAILS` | Core: Admin | No | **Yes** (or IDs) | Comma-separated list of platform administrator emails (fallback for verified emails). | Fails boot if both admin IDs and admin emails are unset. |
| `ADMIN_UPI_ID` | Ops: Payments | No | **Yes** (Checkout) | Platform payee UPI VPA address (e.g. `merchant@upi`) for manual subscription QR. | `/checkout` fails closed (`status: 'unavailable'`) if missing or placeholder. |
| `ADMIN_UPI_NAME` | Ops: Payments | No | **Yes** (Checkout) | Platform payee business name displayed on UPI payment apps. | `/checkout` fails closed (`status: 'unavailable'`) if missing. |
| `ADMIN_BANK_NAME` | Ops: Payments | No | **Yes** (Checkout) | Platform collection bank name for manual NEFT/RTGS/IMPS payments. | `/checkout` fails closed (`status: 'unavailable'`) if missing. |
| `ADMIN_BANK_ACC_NAME` | Ops: Payments | No | **Yes** (Checkout) | Account holder name for platform manual bank transfer instructions. | `/checkout` fails closed (`status: 'unavailable'`) if missing. |
| `ADMIN_BANK_ACC_NO` | Ops: Payments | No | **Yes** (Checkout) | Platform collection bank account number (9 to 18 digits). | `/checkout` fails closed (`status: 'unavailable'`) if missing or placeholder. |
| `ADMIN_BANK_IFSC` | Ops: Payments | No | **Yes** (Checkout) | Platform collection bank IFSC code (e.g. `SBIN0000000`). | `/checkout` fails closed (`status: 'unavailable'`) if missing or placeholder. |
| `SENTRY_DSN` | Ops: Monitoring | No | Recommended | Private Sentry DSN for server-side error capturing (Node.js and Edge runtimes). | Server Sentry initialization skipped; server errors unmonitored. |
| `NEXT_PUBLIC_SENTRY_DSN` | Ops: Monitoring | Yes | Recommended | Public Sentry DSN for browser-side error reporting and CSP report-uri endpoint. | Browser Sentry initialization skipped; client errors unmonitored. |
| `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | Ops: Monitoring | Yes | Recommended | Sentry environment name (`test` during go-live testing, `production` after the switch). Read at build time. | Falls back to `VERCEL_ENV`, then `NODE_ENV`. |
| `SENTRY_AUTH_TOKEN` | Build: Sentry | No | **Yes** (Build) | Sentry authentication token for uploading source maps during production builds. | Build issues a console warning; source maps are not uploaded to Sentry. |
| `SENTRY_ORG` | Build: Sentry | No | **Yes** (Build) | Sentry organization slug used by `withSentryConfig` in `next.config.mjs`. | Build issues a console warning; source maps are not uploaded to Sentry. |
| `SENTRY_PROJECT` | Build: Sentry | No | **Yes** (Build) | Sentry project slug used by `withSentryConfig` in `next.config.mjs`. | Build issues a console warning; source maps are not uploaded to Sentry. |
| `SKIP_ENV_VALIDATION` | Build: CI | No | No | Skips boot-time environment validation during local builds and CI quality jobs (`1`). | Strictly ignored on Render (`RENDER=true`) and on Vercel production (`VERCEL_ENV === 'production'`). |
| `TEST_DATABASE_URL` | Tests: RealDB | No | No | Connection string for dedicated disposable test database used in `pnpm test:realdb`. | Real-database tests fail immediately if unset (`url-guard.ts`). |
| `TEST_DATABASE_IS_DISPOSABLE` | Tests: RealDB | No | No | Explicit confirmation flag (`1`) required when running real-DB tests on remote hosts. | Real-database tests refuse execution against non-localhost targets. |
| `E2E_BASE_URL` | Tests: E2E | No | No | Address of the app under test: `http://localhost:3000` (the PR built and started on the CI runner). | Required: the suite refuses to start (env validation in `e2e/support/env.ts`). |
| `E2E_CONFIRM_STAGING` | Tests: E2E | No | No | Affirmative safety string (`yes-this-is-not-production`) required before running E2E. | E2E suite aborts immediately if absent or invalid. |
| `E2E_FORBIDDEN_HOSTS` | Tests: E2E | No | No | Comma-separated deny list of production hostnames to prevent targeting production. | E2E suite aborts if target matches any forbidden host. |
| `E2E_DATABASE_URL` | Tests: E2E | No | No | Database connection string for the isolated staging Neon branch (used for verification queries). | Required: the suite refuses to start. |
| `E2E_DB_HOST_ALLOWLIST` | Tests: E2E | No | No | Comma-separated allowlist of permitted staging database hostnames. | Required; the suite aborts if the database host is not allowlisted. |
| `E2E_FORBIDDEN_DB_HOSTS` | Tests: E2E | No | No | Comma-separated deny list of production database hostnames. | Required; the suite aborts if the database host matches one. |
| `E2E_VERIFY_MODE` | Tests: E2E | No | No | How signup e-mails are verified: `db` (mark verified directly in the test DB; `direct_db` is an alias). The CI workflow forces `db`. | Defaults to `db`. |
| `E2E_EXPECT_VERIFICATION_REQUIRED` | Tests: E2E | No | No | Flag indicating whether email verification is enforced on signup (`true`/`false`). | Defaults to `true`. |
| `E2E_ADMIN_EMAIL` | Tests: E2E | No | No | Email address of the dedicated platform admin account used in E2E tests (must also be in the preview's `PLATFORM_ADMIN_EMAILS`). | Required: the suite refuses to start. |
| `E2E_ADMIN_PASSWORD` | Tests: E2E | No | No | Password of the E2E platform admin account (8+ characters). | Required: the suite refuses to start. |
| `E2E_UPSTASH_REST_URL` | Tests: E2E | No | No | Optional, local runs only: Upstash endpoint whose auth rate-limit keys are cleared before a run. CI uses a fresh local Redis and does not flush. | Rate limit cleanup skipped if absent. |
| `E2E_UPSTASH_REST_TOKEN` | Tests: E2E | No | No | Staging Upstash Redis authentication token. | Rate limit cleanup skipped if absent. |
| `E2E_UPSTASH_ALLOW_FLUSH` | Tests: E2E | No | No | Permission flag allowing flush of test rate-limit keys on staging Redis. | Defaults to `false`. |
| `E2E_UPSTASH_HOST_ALLOWLIST` | Tests: E2E | No | No | Hostname allowlist for staging Redis instances permitted to be flushed. | Flush aborted if host not allowlisted. |
| `E2E_EXPECT_ARCHIVAL` | Tests: E2E | No | No | `true` makes the journey require that finalized PDFs are actually archived. Keep `false` while the PDF provider quota is too small (see the launch-day notes). | Defaults to `false`: archival is checked but not required. |
| `E2E_UPDATE_A11Y_BASELINE` | Tests: E2E | No | No | Flag (`true`/`1`) to update the axe-core accessibility baseline file `e2e/a11y-baseline.json`. | Baseline is verified without updating when false. |
| `E2E_STAGING_DATABASE_URL_UNPOOLED` | Tests: E2E | No | No | Direct compute unpooled database connection string for running staging migrations. | Staging migration runner fails if unset. |

### Validation Rules

- **Production rules**: `NEXT_PUBLIC_APP_URL` must use `https://` and be a publicly reachable host (not localhost, `.local`, or `.internal`). `NEON_AUTH_COOKIE_SECRET` and `CRON_SECRET` must be at least 32 characters. At least one administrator must be configured in `PLATFORM_ADMIN_USER_IDS` or `PLATFORM_ADMIN_EMAILS` (comma-separated valid emails).
- **Development defaults**: In non-production environments (`NODE_ENV !== 'production'`), `NEXT_PUBLIC_APP_URL` defaults to `http://localhost:3000` if omitted.
- **Build time bypass**: `SKIP_ENV_VALIDATION=1` skips the boot-time check and relaxes production URL strictness for local and CI builds. It is strictly ignored on Render (`RENDER=true`) and when `VERCEL_ENV === 'production'`. It never fabricates missing variables; builds still require syntactically valid auth and database variables (dummy-valid values are acceptable in CI).

## Database & Migrations

Bill Matrix uses Drizzle ORM with PostgreSQL (Neon Serverless).

### Everyday Migration Workflow

1. Modify schema definitions in `lib/db/schema/`.
2. Generate migration SQL and schema snapshot:
   ```bash
   pnpm db:generate
   ```
3. Inspect and review the generated SQL file in `drizzle/`.
4. Check migration consistency against existing history:
   ```bash
   pnpm db:check
   ```
5. Apply migration locally:
   ```bash
   pnpm db:migrate
   ```

### Production Migration Execution

Migrations are **never applied automatically during deployment**. Schema changes are executed manually via GitHub Actions:
- Workflow: `.github/workflows/migrate-production.yml` ("Production DB migration (manual)").
- Guards: Requires creating a fresh Neon backup branch of production first (`backup_branch_created: yes`), typing the exact confirmation phrase `MIGRATE`, and configuring the secret `DATABASE_URL_UNPOOLED` (direct, unpooled connection).
- Safety: The migration executes inside a single database transaction; failure rolls back atomically leaving the database unchanged.
- **Applied migrations are immutable**: Never edit previously applied migration SQL files or snapshots.
- **`pnpm db:push` restriction**: `db:push` is permitted **only** on throwaway local sandbox databases; it is strictly forbidden on shared, staging, or production databases.

## Background Jobs

Invoice BizFolio runs two scheduled jobs (schedules in `lib/cron/schedules.ts`). **cron-job.org** calls them with
`Authorization: Bearer <CRON_SECRET>`; each route replies **202** at once and finishes the work in the background.
- **`/api/cron/retry-invoice-archival`**, daily `0 20 * * *` (20:00 UTC / 01:30 IST): retries PDF archival of
  finalized invoices and credit notes to IDrive e2 object storage, using lease claims (`archival_claimed_at` with
  `SKIP LOCKED`) and up to 5 attempts. Monitored by the Sentry cron monitor `retry-invoice-archival`; reports
  documents still unarchived after 60 minutes.
- **`/api/cron/daily-notifications`**, daily `30 3 * * *` (03:30 UTC / 09:00 IST): creates the bell reminders
  (overdue invoices, GST due dates, plan expiry). Watched by cron-job.org failure e-mails.
- **Fallback**: GitHub → Actions → "Run cron job now (manual)" (`.github/workflows/run-cron-now.yml`).

## Deploying & Operating

Production runs on **Render** (one Free web service, Singapore, `next start`), with uptime checks from UptimeRobot
(`/ping`, `/health-db`), a nightly encrypted database backup (`.github/workflows/backup-db.yml`) and the CI checks on
GitHub. Set-up, environment variables and the test → production switch: [docs/LAUNCH_CHECKLIST.md](docs/LAUNCH_CHECKLIST.md).
Operational procedures in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md):
- [Build Configuration Decisions](docs/DEPLOYMENT.md#build-configuration-decisions-opt-003): TypeScript target ES2022, Node 24 pinning, native image rendering, and standalone build decisions.
- [Monitoring & Alerting](docs/DEPLOYMENT.md#monitoring--alerting-opt-001): UptimeRobot checks, request ID correlation, and Sentry production alert rules.
- [Data Requests & Account Closure](docs/DEPLOYMENT.md#data-requests-export-and-account-closure-opt-002a): DPDP self-serve JSON export, owner verification, account closure workflow, and statutory 8-year record retention under Section 36 of the CGST Act.
- [Backup & Restore](docs/DEPLOYMENT.md#backup-and-restore-opt-002): Neon's 6-hour history, the nightly encrypted dump (7 daily + 4 weekly), the quarterly restore drill, and honest recovery targets.
- *Launch-Day Note*: All external provider accounts (Neon, Render, Upstash, IDrive e2, Brevo, Sentry, CustomJS, cron-job.org, UptimeRobot) are created fresh on launch day; nothing from development is reused.

## Documentation Map

- [ARCHITECTURE.md](ARCHITECTURE.md): System architecture, folder reference, Server Action contracts, concurrency locking order, and subsystem design rules.
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): Production delivery pipeline, database integrity guards, monitoring & alerting, data rights runbooks, and disaster recovery.
- [docs/TESTING.md](docs/TESTING.md): Testing strategy, Unit / PGlite / Real-Postgres suites, concurrency test harness, and guard test catalog.
- [docs/GST_COMPLIANCE_NOTES.md](docs/GST_COMPLIANCE_NOTES.md): Indian GST statutory compliance logic (B2CL/B2CS turnover thresholds, CDNUR return netting, UTGST rules).
- [docs/STATUTORY_ARCHIVAL_BLUEPRINT.md](docs/STATUTORY_ARCHIVAL_BLUEPRINT.md): Long-term legal retention architecture and planned 8-year financial year archival design.
- [docs/e2e-staging-setup.md](docs/e2e-staging-setup.md): Playwright E2E set-up: the PR built and started on the CI runner, the test database, secrets and safety guards.
- [docs/LAUNCH_CHECKLIST.md](docs/LAUNCH_CHECKLIST.md): Launch decisions, account set-up for test and production, environment variables, go-live tests and the switch.
- [docs/security/dependencies.md](docs/security/dependencies.md): Dependency security policy, `@neondatabase/auth` pinning, server component cookie patch, and CI audit gate.
- [e2e/README.md](e2e/README.md): Playwright end-to-end test suite structure, Page Object Models, test execution modes, and safety models.

> **Note on Historical Records**: Files located in `docs/reports/` and `docs/BM_FinApp_v1.1_Production-Readiness Audit.md` are archived milestone completion reports and audit baselines. They are preserved for historical auditability and are not actively maintained.

## Dependencies & Security

Every CI run audits production dependencies with a blocking gate (`scripts/ci/audit-gate.mjs`); high/critical advisories fail CI unless they are on an expiring, reviewed allowlist (`security/audit-allowlist.json`). Transitive packages get same-major security floors via `pnpm-workspace.yaml` overrides. The core authentication dependency `@neondatabase/auth` is pinned to `0.4.2-beta` with a Server Component cookie patch (`patches/@neondatabase__auth.patch`). See [docs/security/dependencies.md](docs/security/dependencies.md) for full details on dependency policies, overrides, and the audit allowlist.

## Project Status

Phases 1 through 4 of the comprehensive production-readiness audit are complete. All core accounting features, statutory compliance rules, performance optimizations, and security gates are implemented, verified, and locked with regression tests. Remaining pre-launch tasks are operational infrastructure provisioning and credential setup as documented in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
