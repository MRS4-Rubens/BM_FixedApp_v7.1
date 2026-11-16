# Delivery pipeline and deployments

## Everyday flow
1. Work happens on a branch (never directly on `main`).
2. Open a pull request. GitHub runs **CI / Quality gates** automatically (typecheck, lint ratchet, migration-history check, tests, production build).
3. Merge only when **Quality gates** is green. Vercel deploys `main` after the merge.

## What the gates mean
- **Typecheck / tests / db:check / build**: must pass.
- **Lint ratchet**: the number of lint problems may not go up (baseline in `scripts/ci/lint-baseline.json`). When you fix some, run `pnpm lint:ratchet --update` and commit the lower baseline.
- **Dependency audit (report only)**: informational until the known advisories are resolved; then make it blocking.
- Run the same checks locally with `pnpm verify` (plus `pnpm build`).

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
- Repository secret `DATABASE_URL_UNPOOLED` (only needed for the migration workflow).

## Environment variables

The authoritative reference for every configuration variable is the table in [`README.md`](../README.md#environment-variables), which documents all variables in `.env.example`, their group, production requirement, and missing-variable behavior.

Key deployment requirements:
- **Production Variables**: Set in Vercel Project Settings -> Environment Variables (Production environment). Ensure `NEXT_PUBLIC_APP_URL` points to the canonical production URL (e.g. `https://app.billmatrix.in`).
- **Direct Database Access**: `DATABASE_URL_UNPOOLED` must be configured as a GitHub Repository Secret for the manual production migration workflow (`.github/workflows/migrate-production.yml`).
- **Staging & Previews**: Configured with isolated preview credentials as detailed in [`docs/e2e-staging-setup.md`](e2e-staging-setup.md).

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
  - `DB_POOL_CONNECTION_TIMEOUT_MS = 5_000`: Fails fast (5s) instead of hanging indefinitely when the pool is fully subscribed or the network is disrupted.
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
- Node: .nvmrc is the exact version (local + CI); package.json engines "24.x" is what Vercel uses; a unit test keeps the majors equal. Upgrading Node = change both in one PR.
- Images: plain <img> is deliberate (data/blob URLs, expiring signed URLs, print templates); no next/image, so no images config. If next/image is ever added for remote images, configure images.remotePatterns at that time.
- Not used, on purpose: output: 'standalone' (only for self-hosting; we deploy on Vercel); Renovate (Dependabot already configured in .github/dependabot.yml); experimental.serverActions.allowedOrigins (only needed if a proxy/CDN in front of Vercel changes the Host header — re-check on launch day).

## Monitoring & alerting (OPT-001)

### Uptime monitoring
- **Endpoint**: Configure an external uptime monitor (e.g. Better Uptime, Datadog Synthetics, or Pingdom) to poll `GET <origin>/api/health` once every minute (`1m` interval).
- **Alert trigger**: Alert on non-`200` HTTP status (e.g. `503 Service Unavailable`) for **2 consecutive checks** (prevents alerting on transient network hiccups).
- **Response structure**:
  ```json
  {
    "status": "ok",
    "checks": {
      "database": "ok",
      "redis": "ok"
    }
  }
  ```
  - `"status": "ok"` / HTTP 200: Both PostgreSQL (Neon) and Redis (Upstash) answered within 3000 ms.
  - `"status": "error"` / HTTP 503: At least one dependency check failed or exceeded 3000 ms. The `checks` object indicates specifically which subsystem is degraded (`database` or `redis`).
  - The endpoint never exposes stack traces, credentials, environment variables, or hostnames.
- **Caching**: Results are memoized in module scope for **10 seconds** to prevent quota exhaustion or denial-of-service against Neon or Upstash. Any failed check logs `health-check` to server logs and Sentry once per computation (not on cached hits).

### Request correlation & logs
- **Request IDs**: Every server action (via `runValidatedHandler` in `lib/actions/_shared/create-action.ts`) and the API routes we own (`/api/health`, `/api/cron/retry-invoice-archival`, `/api/reports/export`, `/api/business/[id]/logo`) run inside a request context, so their error log lines carry `requestId` and their Sentry events carry the tag `request_id`. The Neon Auth routes under `/api/auth/**` are library-owned and not wrapped.
- **Vercel correlation**: When deployed on Vercel, the ID automatically adopts Vercel's incoming `x-vercel-id` (if valid), allowing 1:1 cross-referencing directly in Vercel Function logs. Otherwise, it falls back to `x-request-id` or generates a cryptographically secure UUID (`node:crypto`).
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
   - Trigger: `/api/health` dependency check failed (database or Redis unreachable or timing out).
6. **Cron monitor missed or failed**:
   - Filter: Sentry Cron Monitor `retry-invoice-archival` (registered with schedule `0 20 * * *` matching `vercel.json`).
   - Trigger: Missed check-in or execution error / timeout. *(Note: Created automatically on the first check-in).*
7. **Daily notifications cron missed or failed** (feature C):
   - Filter: Sentry Cron Monitor `daily-notifications` (schedule `30 3 * * *` UTC = 09:00 IST, matching `vercel.json`).
   - Trigger: Missed check-in or execution error. A missed day means that day's reminders (overdue invoices, GST due dates, plan expiry) are not created; nothing wrong is ever sent. Urgent e-mails left pending are retried by the next run (up to 3 tries within 3 days).

> **Note**: These monitors and alert rules are configured on launch day with the final Sentry account and chosen uptime provider.

## Data requests: export and account closure (OPT-002a)

### How requests arrive
- **Data Export**: Generated self-serve by business owners via `GET /api/account/export`. Each export logs an audit row with `action = 'data_export'` (`AUDIT_EVENTS.business.data_export`) inside `audit_log`.
- **Account Closure**: Submitted self-serve by business owners via Settings → General → "Request account closure" modal. This creates an audit row with `action = 'account_closure_requested'` (`AUDIT_EVENTS.business.account_closure_requested`) containing the requester's IP, user agent, and optional reason, and automatically dispatches a notification email via Resend to `SUPPORT_EMAIL`.

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

### Database backups (Neon Postgres)
- **Continuous Point-in-Time Recovery (PITR)**:
  - Neon automatic continuous WAL-based point-in-time recovery is enabled with a minimum **7-day retention window** on the production branch.
  - Allows restoring the database to any millisecond within the past 7 days.
- **Weekly Logical Backups (pg_dump)**:
  - An automated scheduled GitHub Actions workflow (or external cron worker) takes a weekly logical snapshot using `pg_dump` with `--clean --if-exists --no-owner --no-privileges`.
  - Encrypted dumps are offloaded to secondary cold storage in an S3-compatible bucket on IDrive e2.
- **Quarterly Restoration Drill Checklist**:
  1. Spin up a temporary Neon database branch from a specific PITR timestamp (e.g. 24 hours prior).
  2. Point a staging/test environment at the temporary branch connection string.
  3. Run validation gates:
     ```bash
     pnpm typecheck
     pnpm exec vitest run tests/integration
     ```
  4. Run invariant audits: verify sequence counters (`invoice_number_counters`), tenant foreign keys, and audit log sequence continuity.
  5. Tear down the temporary Neon branch after recording the drill outcome.

### Archival PDF storage (IDrive e2)
- **Object Lock Compliance Mode**:
  - The production invoice PDF archive bucket is configured with S3 Object Lock in **Compliance Mode** with an **8-year retention policy**.
  - In compliance mode, a protected object version cannot be overwritten or deleted by any user, including the root account or AWS/S3 access keys, until the retention period expires.
  - This satisfies statutory preservation requirements under Indian tax regulations.

### Disaster recovery RPO / RTO targets (to confirm at launch)

These are targets, not guarantees: they depend on the Neon plan (PITR window) and backup schedule chosen on launch day. Confirm or adjust them then, and prove them in the first restore drill.

- **RPO (Recovery Point Objective)**: **&le; 5 minutes**. Neon continuous WAL streaming ensures minimal data loss in any catastrophic zone failure.
- **RTO (Recovery Time Objective)**: **&le; 1 hour**. Neon's copy-on-write branching enables instant database recovery, while Vercel allows immediate failover and re-deployment of application compute.

