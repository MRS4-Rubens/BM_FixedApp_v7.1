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
