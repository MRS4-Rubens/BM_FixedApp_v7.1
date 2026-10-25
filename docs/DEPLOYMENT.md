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
