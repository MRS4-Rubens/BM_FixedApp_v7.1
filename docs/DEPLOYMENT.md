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
- Triggers make FINALIZED invoices and credit notes immutable: only payment status, archive/PDF fields, email counters (invoices) and void/PDF fields (credit notes) may change; finalized records cannot be deleted; their line items cannot be inserted, updated or deleted. Drafts stay fully editable.
- The guards use an ALLOW-LIST. A new column on invoices/credit_notes is immutable after finalization by default. If a future feature must write a new column on a finalized record, add a migration that replaces `bm_guard_invoices()` / `bm_guard_credit_notes()` with the column added to `mutable_cols`, and update `tests/integration/db001-immutability.test.ts`.
- Finalize code must update line items BEFORE flipping the invoice to `finalized`.
- Emergency maintenance on a finalized record is a deliberate, manual act by the database owner (backup branch first, then temporarily `ALTER TABLE ... DISABLE TRIGGER`, then re-enable). TRUNCATE is not guarded by row triggers.

## Tenant (business) isolation guards (DB-002)
- `UNIQUE (business_id, id)` exists on customers, products, invoices and credit_notes. Composite foreign keys `invoices_customer_same_biz`, `credit_notes_invoice_same_biz` and `payments_invoice_same_biz` make it impossible for an invoice, credit note or payment to point at another business's customer/invoice.
- Line items: triggers `bm_invoice_line_items_tenant` / `bm_credit_note_line_items_tenant` reject a product that belongs to another business.
- Status: the three foreign keys are `NOT VALID` (they check every NEW or changed row; existing rows are validated in DB-002 PART B, after API-001 is deployed and the cross-tenant audit queries return zero rows). The older single-column foreign keys stay until PART B.
- If the audit queries ever return rows, treat it as a data-leak incident: stop, quarantine the rows, and inform the affected businesses.


