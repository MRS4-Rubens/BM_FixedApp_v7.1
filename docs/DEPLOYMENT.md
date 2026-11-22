# Delivery pipeline and deployments

> **Launch setup (LAUNCH-L6, 2026-11-19).** The live app runs on **Render** (one Free web service, Singapore, `next start`).
> Scheduled jobs are called by **cron-job.org**, uptime is watched by **UptimeRobot**, and the production database is
> backed up nightly by GitHub Actions. Accounts, settings and the test → production switch are in
> [`docs/LAUNCH_CHECKLIST.md`](LAUNCH_CHECKLIST.md) (sections 3–8). Until launch, Vercel still builds previews of pull
> requests; it is not used for production and is removed after the switch.

## Everyday flow
1. Work happens on a branch (never directly on `main`).
2. Open a pull request. GitHub runs **7 checks**: Quality gates (typecheck, lint ratchet, migration-history check, tests, production build), Dependency audit, Real-Postgres integration tests, E2E staging configuration, Playwright E2E Suite (the PR built and started on the runner, against the test database), and the two Vercel preview checks (until Vercel is removed).
3. Merge only when **all checks are green on the latest commit**. After every new push, wait for all of them again.
4. Render deploys `main` automatically after the merge (build `pnpm install --frozen-lockfile && pnpm build`, start `node_modules/.bin/next start`: Next runs directly, without an extra pnpm process, to save memory on the 512 MB instance; checklist 3.10).

## Hosting (Render) and scheduled jobs
- **Render Free web service**, region Singapore: 512 MB RAM, 0.1 CPU, sleeps after 15 minutes without traffic (the first request then takes up to about a minute), 5 GB outbound bandwidth per month. Upgrade path: Starter ($7/month) when the first shop pays or pages feel slow (checklist section 10).
- **Environment variables** live in the Render service settings (checklist section 4.1). Never set `SKIP_ENV_VALIDATION` there: on Render it is ignored anyway (`RENDER=true`), and the server refuses to start if a required variable is missing.
- **Release tag for Sentry**: taken from `RENDER_GIT_COMMIT`; the environment name from `NEXT_PUBLIC_SENTRY_ENVIRONMENT` (`test` while testing, `production` after the switch).
- **E-mail**: Brevo's HTTPS API (Render Free blocks SMTP ports). Customer e-mails are switched off for the pilot (`lib/config/features.ts`).
- **Scheduled jobs** (`lib/cron/schedules.ts`), called by cron-job.org with the header `Authorization: Bearer <CRON_SECRET>`:
  - `GET /api/cron/retry-invoice-archival`, daily **20:00 UTC** (01:30 IST);
  - `GET /api/cron/daily-notifications`, daily **03:30 UTC** (09:00 IST).
  Both reply **202** at once and finish the work in the background (cron-job.org gives up after 30 s). Running a job twice is safe. If cron-job.org is down, use GitHub → Actions → **Run cron job now (manual)** (`.github/workflows/run-cron-now.yml`, secrets `CRON_APP_URL` + `CRON_SECRET`).

## What the gates mean
- **Typecheck / tests / db:check / build**: must pass.
- **Lint ratchet**: the number of lint problems may not go up (baseline in `scripts/ci/lint-baseline.json`). When you fix some, run `pnpm lint:ratchet --update` and commit the lower baseline.
- **Dependency audit** (`scripts/ci/audit-gate.mjs`): **blocking**. Any high/critical advisory fails the PR unless it is in `security/audit-allowlist.json` with a reason and an expiry date (`docs/security/dependencies.md`). An expired entry fails too; an entry that is no longer reported is printed as `STALE` and should be removed.
- Run the same checks locally with `pnpm verify` (plus `pnpm build`).
- **Local production build:** `pnpm build` on your PC needs a public HTTPS app address, because the build checks `NEXT_PUBLIC_APP_URL`. Use a placeholder that is never served: `NEXT_PUBLIC_APP_URL=https://bm-local.test pnpm build` (PowerShell: `$env:NEXT_PUBLIC_APP_URL='https://bm-local.test'; pnpm build`).

## Database migrations (production)
Migrations are NOT applied automatically. Use GitHub -> Actions -> "Production DB migration (manual)".
1. Create a fresh Neon backup branch of production first.
2. Additive change (new table/column/index): run the workflow from the PR branch BEFORE merging, then merge.
3. Destructive change (drop/rename): merge first, then run the workflow.
4. Run with: backup = yes, confirm = MIGRATE. Requires repository secret `DATABASE_URL_UNPOOLED` (Neon direct, non-pooled URL).
5. Migrations run inside one transaction; a failure leaves the database unchanged. Restore from the backup branch only as a last resort.

## Rules for migration files
- Generate with `pnpm db:generate`; commit the SQL AND the snapshot. Never hand-write snapshots; never use `db:push` on shared databases.
- `pnpm db:check` and `tests/unit/migrations.test.ts` fail CI if the history is inconsistent.

## Required GitHub settings (done in the GitHub website)
- Branch ruleset on `main`: require a pull request and require the **Quality gates** check.
- Secret scanning, push protection and fork-PR approval: checklist section 3.3.
- Secrets and variables (migration, backup, cron fallback, E2E): the full list is in checklist section 4.2.

## Environment variables

The authoritative reference for every configuration variable is the table in [`README.md`](../README.md#environment-variables), which documents all variables in `.env.example`, their group, production requirement, and missing-variable behavior.

Key deployment requirements:
- **Production variables**: set in the Render service (checklist section 4.1, "During testing" vs "After switch"). `NEXT_PUBLIC_APP_URL` is the Render address (`https://<name>.onrender.com`) and `NEXT_PUBLIC_SUPPORT_EMAIL` is required.
- **Direct database access**: `DATABASE_URL_UNPOOLED` is a GitHub repository secret, used by the manual production migration workflow (`.github/workflows/migrate-production.yml`) and the nightly backup (`.github/workflows/backup-db.yml`).
- **Browser tests (E2E)**: run against the separate test Neon project, as described in [`docs/e2e-staging-setup.md`](e2e-staging-setup.md).

## Database integrity guards (DB-001)
- CHECK constraints reject negative money, zero/negative payments, non-positive quantities, and finalized invoices/credit notes missing their number, finalization time or date.
- Triggers make FINALIZED invoices and credit notes immutable: only payment status, archive/PDF fields (`archival_claimed_at` on invoices; `archival_status, archival_attempts, archived_at, archival_claimed_at` on credit notes), email counters (invoices) and void/PDF fields (credit notes) may change; finalized records cannot be deleted; their line items cannot be inserted, updated or deleted. Drafts stay fully editable.
- The guards use an ALLOW-LIST. A new column on invoices/credit_notes is immutable after finalization by default. If a future feature must write a new column on a finalized record, add a migration that replaces `bm_guard_invoices()` / `bm_guard_credit_notes()` with the column added to `mutable_cols`, and update `tests/integration/db001-immutability.test.ts`.
- Finalize code must update line items BEFORE flipping the invoice to `finalized`.
- Emergency maintenance on a finalized record is a deliberate, manual act by the database owner (backup branch first, then temporarily `ALTER TABLE ... DISABLE TRIGGER`, then re-enable). TRUNCATE is not guarded by row triggers.

## Tenant (business) isolation guards (DB-002)
- `UNIQUE (business_id, id)` exists on customers, products, invoices and credit_notes. Composite foreign keys `invoices_customer_same_biz`, `credit_notes_invoice_same_biz` and `payments_invoice_same_biz` make it impossible for an invoice, credit note or payment to point at another business's customer/invoice.
- Line items: triggers `bm_invoice_line_items_tenant` / `bm_credit_note_line_items_tenant` reject a product that belongs to another business.
- Status: the three composite foreign keys are VALIDATED (DB-002 part B). The three older single-column keys (`invoices_customer_id_customers_id_fk`, `credit_notes_original_invoice_id_invoices_id_fk`, `payments_invoice_id_invoices_id_fk`) were removed because the composite keys also guarantee existence. The two product keys on line items are intentionally kept.
- If the audit queries ever return rows, treat it as a data-leak incident: stop, quarantine the rows, and inform the affected businesses.

## Tenant isolation rules for server actions (API-001)
- Never load a customer or product by id alone. Use `findOwnedCustomer` / `assertOwnedCustomer` / `assertOwnedProducts` from `lib/actions/_shared/ownership.ts`, or write `and(eq(x.id, id), eq(x.business_id, businessId))`.
- Every join of `customers` or `products` must include `eq(<table>.business_id, invoices.business_id)` in its ON condition.
- Return the same NOT_FOUND for "not yours" and "does not exist" so ids cannot be probed.
- `tests/unit/tenant-scoping.test.ts` fails CI when an unscoped customer/product lookup or join is added; do not add exceptions to it.
- These application checks complement the database guards from DB-002 (composite foreign keys, line-item triggers).

## Rule for new tenant-linked columns (DB-002 part B)
- A new column that points at another business-owned table must be declared with a composite foreign key `(business_id, <column>) -> <table> (business_id, id)` (the target table needs `UNIQUE (business_id, id)`), plus an ownership check in the server action (`lib/actions/_shared/ownership.ts`).
- If a migration is ever blocked by `*_same_biz` during VALIDATE, a cross-business row exists: treat it as a data-leak incident (stop, quarantine, inform the affected businesses); never drop the constraint to make the migration pass.



## State-column check constraints (DB-004)
Migration `0020_db004_state_check_constraints.sql` adds 10 CHECK constraints enforcing valid values across closed text columns in `payments`, `credit_notes`, `businesses`, `invoices`, and `subscription_requests`.

Because the migration runs `VALIDATE CONSTRAINT` within the migration transaction, **any existing row violating these constraints will cause the entire migration to fail and roll back**.

### Pre-flight audit queries
Run these 10 queries on production before applying migration `0020`. Each query MUST return `0`:

```sql
-- 1. payments.status
SELECT COUNT(*) FROM payments WHERE status NOT IN ('active', 'void');

-- 2. credit_notes.status
SELECT COUNT(*) FROM credit_notes WHERE status NOT IN ('draft', 'finalized', 'void');

-- 3. businesses.subscription_plan
SELECT COUNT(*) FROM businesses WHERE subscription_plan NOT IN ('trial', 'free', 'essentials', 'professional');

-- 4. businesses.subscription_status
SELECT COUNT(*) FROM businesses WHERE subscription_status NOT IN ('trial', 'active', 'past_due', 'grace_period', 'expired');

-- 5. businesses.default_invoice_template
SELECT COUNT(*) FROM businesses WHERE default_invoice_template NOT IN ('classic', 'modern', 'minimal', 'thermal');

-- 6. invoices.invoice_template
SELECT COUNT(*) FROM invoices WHERE invoice_template NOT IN ('classic', 'modern', 'minimal', 'thermal');

-- 7. subscription_requests.plan_name
SELECT COUNT(*) FROM subscription_requests WHERE plan_name NOT IN ('trial', 'free', 'essentials', 'professional');

-- 8. subscription_requests.billing_cycle
SELECT COUNT(*) FROM subscription_requests WHERE billing_cycle NOT IN ('monthly', 'yearly', 'manual_override');

-- 9. subscription_requests.payment_method
SELECT COUNT(*) FROM subscription_requests WHERE payment_method NOT IN ('upi_qr', 'bank_transfer', 'manual_override');

-- 10. subscription_requests.status
SELECT COUNT(*) FROM subscription_requests WHERE status NOT IN ('pending', 'approved', 'rejected');
```

### Remediation SQL (if violations are found)
If any query returns a non-zero count, remediate legacy rows before migrating:
- **Businesses with invalid subscription status** (e.g. legacy `'cancelled'`):
  ```sql
  UPDATE businesses SET subscription_status = 'expired' WHERE subscription_status NOT IN ('trial', 'active', 'past_due', 'grace_period', 'expired');
  ```
- **Businesses or invoices with invalid templates** (e.g. unknown or empty strings):
  ```sql
  UPDATE businesses SET default_invoice_template = 'classic' WHERE default_invoice_template NOT IN ('classic', 'modern', 'minimal', 'thermal');
  UPDATE invoices SET invoice_template = 'classic' WHERE invoice_template NOT IN ('classic', 'modern', 'minimal', 'thermal');
  ```
- **Subscription requests with invalid status or overrides**:
  ```sql
  -- Inspect and map to closest valid domain value before re-running migration:
  SELECT id, plan_name, billing_cycle, payment_method, status FROM subscription_requests WHERE status NOT IN ('pending', 'approved', 'rejected');
  ```

## Database connection pool (DB-006)
- **Running App vs. Migrations**: The running application uses the pooled connection string (`DATABASE_URL`), which routes through Neon's connection pooler. `DATABASE_URL_UNPOOLED` is direct to compute and is used strictly for migrations (`drizzle.config.ts` / manual migration workflow).
- **Settings in `lib/db/pool-config.ts`**:
  - `DB_POOL_MAX_CONNECTIONS = 5`: Limits concurrent connections per serverless instance to prevent overwhelming Neon's pooler under burst load.
  - `DB_POOL_IDLE_TIMEOUT_MS = 10_000`: Closes idle sockets quickly (10s) because serverless isolates freeze and idle sockets rot.
  - `DB_POOL_CONNECTION_TIMEOUT_MS = 15_000` (`lib/db/pool-config.ts`): a query fails after 15 s instead of hanging when the pool is fully used or the network is disrupted. It was 5 s until 2026-11-14; that was too tight for a new Neon connection plus a waking (scale-to-zero) compute.
- **Error Observability**: Idle client terminations (e.g. compute suspends or restarts) emit an `'error'` event on the pool. This is caught safely by `attachPoolErrorHandler` and logged under scope `db-pool` (with Sentry tag `scope=db-pool`).
- **Tuning Guidance**: To tune pool limits, edit `lib/db/pool-config.ts` directly (re-checking Neon compute/pooler limits). There is intentionally no environment variable override.

### PDF Archival Runbook (API-008)
- **Re-queue an exhausted document:**
  ```sql
  UPDATE invoices SET archival_attempts = 0, archival_status = 'pending', archival_claimed_at = NULL WHERE id = '<uuid>';
  -- Or for credit notes:
  UPDATE credit_notes SET archival_attempts = 0, archival_status = 'pending', archival_claimed_at = NULL WHERE id = '<uuid>';
  ```
- **Pre-deploy backlog check:**
  ```sql
  SELECT count(*) FROM credit_notes WHERE lifecycle_status = 'finalized' AND pdf_storage_key IS NULL;
  ```
  *(Note: Each un-archived credit note will trigger a vendor render during the first cron sweeps, incurring vendor credits).*
- **Print stylesheet updates:**
  After modifying any Tailwind CSS class used by print views or templates, run:
  ```bash
  pnpm print-css:build
  ```
  and commit the generated `lib/pdf/print-stylesheet.generated.ts`.


### Invoice Display Preferences Migration (FE-001 · 0026)
- **Migration Details**: Migration `0026_fe001_invoice_display_prefs.sql` adds `invoice_display_prefs` to `businesses` (default `'{}'::jsonb`) and `display_prefs_snapshot` to `invoices` (nullable `jsonb`), each with `jsonb_typeof(...) = 'object'` check constraints.
- **Idempotency & Zero Downtime**: Uses `ADD COLUMN IF NOT EXISTS` and `DROP CONSTRAINT IF EXISTS ... ADD CONSTRAINT ...` within a single transaction. Safe to run against live databases without locking tables.
- **No Backfill Needed**: Pre-existing finalized invoices have `display_prefs_snapshot IS NULL`. The application layer (`resolveFinalizedDisplayPrefs`) deterministically maps `null` to statutory defaults.

## Build configuration decisions (OPT-003)

- TypeScript target ES2022 affects type-checking only; browser output is controlled by Next.js/SWC and its browserslist.
- Node: .nvmrc is the exact version (local and CI; set the same major on Render); package.json engines is "24.x"; a unit test keeps the majors equal. Upgrading Node = change both in one PR.
- Images: plain <img> is deliberate (data/blob URLs, expiring signed URLs, print templates); no next/image, so no images config. If next/image is ever added for remote images, configure images.remotePatterns at that time.
- Not used, on purpose: output: 'standalone' (Render runs `next start` from the normal build); Renovate (Dependabot already configured in .github/dependabot.yml); experimental.serverActions.allowedOrigins (only needed if a proxy/CDN in front of the app changes the Host header; re-check if one is ever added).

## Monitoring & alerting (OPT-001)

### Uptime monitoring (UptimeRobot)
- **`GET /ping`** every **5 minutes**: answers 200 without touching the database or Redis, so it never wakes Neon or uses Upstash commands. It also keeps the Render service awake.
- **`GET /health-db`** every **6 hours**: checks the database only (10 s timeout, enough for a cold Neon wake); 200 `{"status":"ok"}` or 503 `{"status":"error"}`. Infrequent on purpose: each check wakes Neon and uses compute hours. It is public, so a real check runs **at most once every 10 minutes** per instance (1 minute after a failure); other requests get the last answer, so nobody can keep Neon awake by polling it (SVC-05).
- **Alert** after **2 failed checks**, to your Gmail (checklist 3.13).
- **`GET /api/health`** (database + Redis) is for **manual checks only** and is **private** (SVC-05): send `Authorization: Bearer <CRON_SECRET>` (otherwise 401). No monitor polls it; each call wakes Neon and uses an Upstash command. Its response:
  ```json
  {
    "status": "ok",
    "checks": {
      "database": "ok",
      "redis": "ok"
    }
  }
  ```
  - `"status": "ok"` / HTTP 200: Both PostgreSQL (Neon) and Redis (Upstash) answered within 10 s.
  - `"status": "error"` / HTTP 503: At least one dependency check failed or exceeded 10 s. The `checks` object indicates specifically which subsystem is degraded (`database` or `redis`).
  - The endpoint never exposes stack traces, credentials, environment variables, or hostnames.
- **Caching**: Results are memoized in module scope for **10 seconds** to prevent quota exhaustion or denial-of-service against Neon or Upstash. Any failed check logs `health-check` to server logs and Sentry once per computation (not on cached hits).

### Request correlation & logs
- **Request IDs**: Every server action (via `runValidatedHandler` in `lib/actions/_shared/create-action.ts`) and the API routes we own (`/api/health`, `/api/cron/retry-invoice-archival`, `/api/reports/export`, `/api/business/[id]/logo`) run inside a request context, so their error log lines carry `requestId` and their Sentry events carry the tag `request_id`. The Neon Auth routes under `/api/auth/**` are library-owned and not wrapped.
- **Incoming IDs**: the ID adopts a valid incoming `x-vercel-id` (Vercel previews) or `x-request-id`; otherwise it generates a cryptographically secure UUID (`node:crypto`). On Render the server logs (Render dashboard → Logs) carry the same `requestId`.
- **Response header**: `/api/health`, the cron route and the report export return it as `x-request-id`. The logo route deliberately does not, because its responses are cached publicly for a year and the header would be frozen into every cached copy.

### Sentry alert rules (production)
Configure the following 6 alert rules in the production Sentry project:
1. **New issue in production**:
   - Filter: `event.environment:production` AND `is:unresolved`
   - Trigger: Alert on first seen / new unresolved issue.
2. **Archival exhausted backlog**:
   - Filter: `event.environment:production` AND `scope:archival-exhausted-summary`
   - Trigger: Documents have reached maximum archival attempts (5) without succeeding. Requires operational triage.
3. **Archival stale backlog**:
   - Filter: `event.environment:production` AND `scope:archival-stale-pending`
   - Trigger: after the nightly sweep, finalized documents are still pending/failed (under the attempt limit) more than 60 minutes after finalization. This is checked once a day at the end of the 20:00 UTC cron, so it reports what the sweep could not clear (deadline reached or renders failing); it is not a real-time alarm.
4. **Rate limiter unavailable (fail-open or fail-closed)**:
   - Filter: `event.environment:production` AND `scope:rate-limit-unavailable*` (logged by `lib/rate-limit/enforce.ts`).
   - Trigger: Upstash Redis is unreachable or timing out during rate limit evaluation.
5. **Health check degradation**:
   - Filter: `event.environment:production` AND `scope:health-check`
   - Trigger: `/api/health` dependency check failed (database or Redis unreachable or timing out). `/health-db` failures are only logged as warnings (no Sentry issue); UptimeRobot alerts on them.
6. **Cron monitor missed or failed**:
   - Filter: Sentry Cron Monitor `retry-invoice-archival` (registered with schedule `0 20 * * *`, matching `lib/cron/schedules.ts`).
   - Trigger: Missed check-in or execution error / timeout. *(Note: Created automatically on the first check-in).*
7. **Daily notifications cron missed or failed** (feature C):
   - No Sentry cron monitor (the free Sentry plan includes one, used by the archival job). Watched instead by cron-job.org failure e-mails (schedule `30 3 * * *` UTC = 09:00 IST, in `lib/cron/schedules.ts`) and by `notifications-cron` errors in Sentry.
   - Trigger: failed call or execution error. A missed day is caught up by the next run (BUG-01): it also creates the missed days' overdue, due-soon, GST and 31 March reminders (up to 7 days back, never twice; reminders whose date has passed are dropped). The last finished day is stored in `platform_settings` key `daily_notifications_last_run`. Urgent e-mails left pending are retried by the next run (up to 3 tries within 3 days).

> **Note**: These alert rules are configured on launch day with the new Sentry account (checklist 3.9); uptime monitors with UptimeRobot (3.13).

## Data requests: export and account closure (OPT-002a)

### How requests arrive
- **Data Export**: Generated self-serve by business owners via `GET /api/account/export`. Each export logs an audit row with `action = 'data_export'` (`AUDIT_EVENTS.business.data_export`) inside `audit_log`.
- **Account Closure**: Submitted self-serve by business owners via Settings → General → "Request account closure" modal. This creates an audit row with `action = 'account_closure_requested'` (`AUDIT_EVENTS.business.account_closure_requested`) containing the requester's IP, user agent, and optional reason, and automatically dispatches a notification email via Brevo to `SUPPORT_EMAIL`.

### SLAs and identity verification
- **SLA**: Acknowledge and review closure requests within **5 business days**; complete operational processing within **30 days**.
- **Verification before action**:
  1. Verify the requester's email address matches the authenticated business owner (`users.role = 'owner'`).
  2. Verify that the submitted confirmation GSTIN strictly matches the active business record (`businesses.gstin`).
  3. Verify against `audit_log` to confirm the request timestamp and authenticity.

### Operational workflows

#### 1. Data export
- **Self-Serve**: The business owner downloads their complete JSON export directly from workspace Settings.
- **Support-Assisted**: If a business owner cannot access their account and requests an export via support:
  - Verify identity out-of-band via registered email and GSTIN certificate.
  - There is no operator export command. Preferred: help the owner regain access (password reset to the verified login email), then they use Settings → General → Download your data. If that is impossible, a developer can produce the identical file by calling `loadDataExport(db, businessId)` from `lib/account/data-export.ts` in a one-off, read-only script, and send it only to the verified owner.

#### 2. Account closure
Follow this checklist when processing an account closure request:
1. **Prevent new activity**: Set the business subscription status to `suspended` (or `expired`) in the database so no new invoices or credit notes can be finalized:
   ```sql
   UPDATE businesses SET subscription_status = 'expired' WHERE id = '<business_id>';
   ```
2. **Send written acknowledgement**: Email the requester confirming receipt, stating the 30-day timeline and outlining statutory retention obligations.
3. **Audit financial years & determine retention period**:
   - Query all finalized invoices and credit notes for the business to identify their respective financial years:
     ```sql
     SELECT DISTINCT financial_year_id FROM invoices WHERE business_id = '<business_id>' AND lifecycle_status = 'finalized';
     ```
   - **8-Year Retention Rule**: Under Section 36 of the CGST Act, 2017 and the Indian Income-tax Act, records must be retained for at least 8 years after the end of the financial year. For example, records for FY 2025–26 (April 1, 2025 – March 31, 2026) must remain archived until **March 31, 2034**.
   - **DO NOT DELETE** any `invoices`, `invoice_line_items`, `credit_notes`, `credit_note_line_items`, `payments`, `businesses`, or `customers` records linked to finalized documents until their legal retention date has passed.
4. **Purge non-statutory data after 30 days**:
   - Soft-delete or purge draft documents:
     ```sql
     DELETE FROM invoices WHERE business_id = '<business_id>' AND lifecycle_status = 'draft';
     DELETE FROM credit_notes WHERE business_id = '<business_id>' AND lifecycle_status = 'draft';
     ```
   - Remove user memberships / unlink authentication identity:
     ```sql
     DELETE FROM users WHERE business_id = '<business_id>';
     ```
   - Clear custom assets (logo image files, signature images) from object storage (`IDrive e2` / R2).
   - Purge non-retained ephemeral audit logs after retention expiry.
5. **Close support ticket**: Log the internal support ticket resolution along with the exact `audit_log` entry ID of the closure request.

---

## Backup and restore (OPT-002)

> Rewritten for the launch (LAUNCH-L6). Earlier versions of this page described a 7-day point-in-time window, weekly
> dumps, an 8-year Object Lock and a 5-minute recovery point. **None of those exist on the pilot setup.** What is
> real is below.

### What protects the data
| Layer | What it covers | Kept for |
|---|---|---|
| **Neon history (Free plan)** | Restore the production database to any moment in the last **6 hours** (Neon console → Restore, or a branch from a past time) | 6 hours |
| **Nightly encrypted dump** (`.github/workflows/backup-db.yml`) | Whole production database, **including users** (the `neon_auth` schema is in the same database), every night at 21:00 UTC (02:30 IST) | 7 daily + 4 weekly (Sunday) copies |
| **Invoice PDFs** | Stored privately in IDrive e2 `bizfolio-prod-files`; **no Object Lock** on the pilot, so a deleted file cannot be recovered | Until deleted |

- The dump is `pg_dump` (Postgres 17, custom format, compressed), checked to contain the `invoices` table, encrypted with gpg AES-256 using `BACKUP_ENCRYPTION_PASSPHRASE`, and uploaded to the private bucket `bizfolio-backups` (`daily/`, `weekly/`). The plain copy never leaves the runner.
- **Off until launch**: the workflow only runs when the GitHub variable `BACKUPS_ENABLED` is `true` (checklist 7.11). Once on, a missing secret fails the run instead of skipping silently.
- **The passphrase is the only key.** It lives in the password manager (PRODUCTION folder) and as a GitHub secret. Without it no backup can be opened.
- **Statutory retention (8 years, CGST Act s.36)** is a business obligation that this pilot setup does **not** guarantee on its own: keep the GSTR-1 exports and PDFs you file, and revisit Object Lock / longer retention when the plan grows (checklist section 10).

### Restore (drill every 3 months, never over production)
1. Download the newest file: `aws s3 cp --endpoint-url <BACKUP_S3_ENDPOINT> s3://bizfolio-backups/daily/<file>.dump.gpg .`
2. Decrypt in a terminal: `gpg --pinentry-mode loopback --decrypt --output db.dump <file>.dump.gpg`. It asks for the passphrase (do **not** add `--batch`: batch mode never asks, so decryption would fail).
3. In the **test** Neon project, create a new branch and an **empty** database in it (e.g. `restore_check`), then restore into that database and stop at the first error: `pg_restore --exit-on-error --no-owner --no-acl --dbname "<restore_check direct URL>" db.dump` (Postgres 17 client). Check the exit status is **0** (`echo $?`). Without `--exit-on-error`, `pg_restore` skips failed objects (for example a missing constraint or guard trigger) and still finishes, so the data checks below could pass on an incomplete copy. If it fails, drop and re-create the empty database and try again; never continue on a partial restore.
4. Check with SQL, running the same queries on the **restored** database and on a **frozen reference** of the source.
   The live source keeps changing after the dump (new invoices, payments, sign-ups), so never compare with it directly.
   **Reference:** in the source Neon project, create a branch **from a past time** = the moment the dump ran: open the
   backup run in GitHub → Actions → step **"Dump the database"** and use the time it **finished** (UTC; the step
   takes seconds). `pg_dump` takes its snapshot inside that step, so the reference and the dump differ by seconds at
   most. Neon's Free history covers **6 hours**, so restore and check within 6 hours of the dump: for a drill, start
   the backup workflow by hand (Run workflow) at a quiet time and continue right away. Run the queries on that
   reference branch and delete it afterwards; production is never paused for a drill.
   **Reading the result:** every count must match. If one differs, list the extra or missing rows (`created_at`,
   `updated_at`): the backup is fine only if **each** of them was written during the "Dump the database" step; any
   other difference means the restore is incomplete, so do not trust that backup and find out why.
   Signing in cannot test logins here: the Render app and its Auth URL point at another database, so count the login
   rows instead.
   ```sql
   -- Users and logins (Neon Auth lives in the same database), then the money tables.
   SELECT
     (SELECT count(*) FROM neon_auth."user")  AS auth_users,
     (SELECT count(*) FROM neon_auth.account) AS auth_accounts,
     (SELECT count(*) FROM users)             AS app_users,
     (SELECT count(*) FROM businesses)        AS businesses,
     (SELECT count(*) FROM invoices)          AS invoices,
     (SELECT count(*) FROM credit_notes)      AS credit_notes,
     (SELECT count(*) FROM payments)          AS payments,
     (SELECT count(*) FROM tax_rates)         AS tax_rates;
   -- Numbering: the counters and the newest invoice number of every business.
   SELECT business_id, period_key, counter_value FROM invoice_number_counters ORDER BY business_id, period_key;
   SELECT DISTINCT ON (business_id) business_id, invoice_number, created_at
     FROM invoices WHERE lifecycle_status <> 'draft' ORDER BY business_id, created_at DESC;
   ```
5. Record the result (date, file, time taken) and delete the branch.

For a real incident (both paths: Neon 6-hour restore **and** restore from a dump):

1. **Stop all writes first, whichever path you take**, user and automated alike: **suspend the Render service** (Render → service → Suspend) and **pause both cron-job.org jobs**; do not run the manual cron workflow. Asking users to pause is not enough, because scheduled jobs would keep writing. Note the time. Anything written after the restore point and before this moment exists only in the pre-restore database.
2. **Keep the pre-restore database** until step 4 is done:
   - restore from a dump, or a **new branch created from a past time**: the original branch is untouched and is the pre-restore database;
   - **in-place restore** of the branch (Neon instant restore): Neon keeps the pre-restore state as a separate backup branch; find it in the branch list after restoring ([Neon instant restore](https://neon.com/docs/postgres/backup-restore/branch-restore)).
3. **Restore** to the chosen point: the Neon 6-hour restore if the problem is that recent, otherwise the latest good dump as above (exit status 0), and check it.
4. **Reconcile the gap** between the restore point and the moment writes stopped, comparing the restored copy with the pre-restore database:
   - **New or changed rows** exist only in the pre-restore database: list new sign-ups and account data (`users`, `businesses`, team invitations, subscription requests) as well as invoices, credit notes, payments, customers and products with `created_at` / `updated_at` after the restore point. A new sign-up's login lives in the same database (`neon_auth`), so restore it together with its app rows. **Decide for each one** whether it is a valid change (re-enter it) or part of the damage that caused the incident (leave it out; the restored value is the correct one). **Draft invoices and their line items:** compare them directly between the two databases rather than by timestamp (saving a draft does not always update its `updated_at`). Write the valid ones down here; they are **re-entered through the app after step 5, never with SQL**, so invoice numbering, seller snapshots, checks and the audit log stay correct.
   - **Deleted rows come back** in the restored copy (a deleted row leaves no timestamp to find). List rows present in the restored copy but missing from the pre-restore database for `businesses`, `users`, `customers`, draft `invoices` and draft `credit_notes`. Also check `audit_log` for `account_closure_requested` (and other deletions) after the restore point. **Review each listed row** with its audit trail: repeat only deletions that were intended (for example a processed account closure or a purged draft), so a closed account cannot be used again. Keep rows that disappeared **because of the incident itself**: restoring them is the point of the recovery. Finalized invoices and credit notes are never deleted (guard triggers), so they need no check.
5. **Switch** only after step 4, then resume the service (keep the cron-job.org jobs paused until step 6 is done):
   - Render `DATABASE_URL` → the recovered database's **pooled** URL (the app);
   - if the recovered database is a **new branch**: Render `NEON_AUTH_BASE_URL` → that branch's **Auth URL** (each Neon branch has its own sign-in service), and add the Render address to that branch's trusted domains. An in-place restore keeps the same Auth URL. Then **check that a sign-in works** before reopening;
   - GitHub secret `DATABASE_URL_UNPOOLED` → its **direct** URL (otherwise the nightly backup and the migration workflow keep using the old one);
   - run the backup workflow once by hand and check a new file appears.
6. **Re-enter the valid changes** from step 4 through the app (pilot: with each shop owner, who holds off other work until it is done), then un-pause the cron-job.org jobs and tell everyone the app is back.

### Recovery targets (pilot, honest)
- **Data loss (RPO)**: up to **6 hours** back is exact (Neon history); older problems lose up to **about 24 hours** (since the last nightly dump), **if that night's backup actually ran and is not affected**. GitHub can delay or skip a scheduled run, so check the **Nightly database backup** runs in Actions regularly (checklist section 9); a missed night makes the newest good dump older. If the damage is already in the latest dump, restore an earlier good one: the loss then goes back to that dump, which can be several days (up to 7 daily, then weekly copies).
- **Time to recover (RTO)**: about **1–2 hours** by hand (download, decrypt, restore, check, switch). Prove it in the first restore drill and update this line.
