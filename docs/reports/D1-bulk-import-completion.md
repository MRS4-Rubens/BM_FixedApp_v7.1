# D1 — Bulk customer and product import: backend (feature D)

**Branch:** `feat/bulk-import` · **Built by:** Claude Code (route: file upload + bulk writes, built here) · **Date:** 2026-11-16

## What it does
A business on **Professional** can upload an Excel (.xlsx) or CSV file of customers or products:
1. Download the template.
2. Upload the filled file. **Check** previews every row ("ready", "duplicate" or "error", with the reason by column) and writes nothing.
3. **Import** saves every ready row in one transaction and skips the rest.

The upload screen itself is **D2**.

## Approved decisions applied (memory `bulk-import-feature`)
| # | Decision | Where |
|---|---|---|
| 1 | Professional only | `canImportData` entitlement; `lib/import/entitlement.ts` |
| 2 | .xlsx and .csv, our template | `lib/import/read-file.ts`, `lib/import/template.ts`, `GET /api/import/template?kind=` |
| 3 | ≤ 1,000 rows, ≤ 2 MB | `IMPORT_MAX_ROWS`, `IMPORT_MAX_BYTES` (schema + reader) |
| 4 | Check first; import all ready rows in ONE transaction; skip the rest | `check-bulk-import`, `run-bulk-import` |
| 5 | Duplicates skipped, never updated | `lib/import/validate-rows.ts` |
| 6 | Owner + staff only (never the CA) | both actions `roles: EDITOR_ROLES` |
| 7 | GST %, units with aliases, rupees | `normaliseGstRate`, `resolveUnit`, the product schema |

**One refinement found by testing (decision 5):** customers **without** a GSTIN have nothing unique to match on. Re-importing the same file therefore created a second copy of them. They are now matched by **name** (ignoring case and spaces): an existing name is skipped, and the same name twice in one file is an error. Customers with a GSTIN are still matched by GSTIN only.

## Safety
- **File type comes from the content:** zip magic for .xlsx; UTF-8 without NUL bytes for .csv. A renamed file is refused.
- **Zip-bomb guard:** the .xlsx central directory is read before anything is inflated. Files with more than 200 entries, more than 30 MB uncompressed, ZIP64, or a malformed directory are refused.
- **Size and row limits** are checked before parsing (base64 length), after decoding (bytes) and while parsing (rows; CSV stops early).
- **Excel formulas** contribute only their displayed result, never the formula.
- **Same rules as the forms:** every row goes through the same zod schema the single-record forms use: GSTIN checksum, GSTIN/state match, pincode, HSN, units, price limits, tax rate.
- **The import never trusts the preview:** it re-parses the file, then re-checks duplicates under the business row lock. The plan and the customer/product quotas are enforced inside the same transaction. One audit entry per import records counts only, never row data.
- **The insert payload never leaves the server:** the check result has no `value` and no `business_id`.
- **Rate limits:** both actions use the fail-closed export limiter.

## Files
**New:**
- `lib/import/columns.ts`: client-safe column definitions, aliases, limits.
- `lib/import/read-file.ts`: reader, CSV parser, zip guard.
- `lib/import/validate-rows.ts`: pure row checks.
- `lib/import/prepare.ts`: parse/map, DB lookups, summary.
- `lib/import/template.ts`, `lib/import/entitlement.ts`.
- `lib/actions/import/check-bulk-import.ts`, `lib/actions/import/run-bulk-import.ts`.
- `lib/validations/bulk-import.ts`.
- `app/api/import/template/route.ts`.
- Tests: `tests/unit/bulk-import-reader.test.ts` (9), `tests/unit/bulk-import-rows.test.ts` (10), `tests/integration/bulk-import.test.ts` (5, PGlite, all migrations).

**Changed:**
- `lib/subscriptions/entitlements.ts`: `canImportData`.
- `lib/audit/log.ts`: `business.customers_imported` and `business.products_imported`.
- `lib/auth/action-permissions.ts`: `check-bulk-import` and `run-bulk-import` are `editor`.
- `tests/unit/ca-role-guards.test.ts`: the pinned editor list now has 18 entries.
- `tests/unit/clean002-flag-enforcement.test.ts`: maps `canImportData`.

## Verification
- `pnpm typecheck` ✅ · `pnpm lint:ratchet` ✅ 0/0 · `pnpm knip` ✅ · `pnpm build` (Turbopack) ✅
- `pnpm test` ✅ 233 files / 1953 tests (24 new)
- No database migration (no schema change).
- **Live check** on the dev server:
  - signed in, `/api/import/template?kind=customers` and `?kind=products` return real .xlsx files (8.5 KB / 8.2 KB, correct type and file name);
  - signed out the route returns 401, and an unknown kind returns 400.
- The template round-trips: both templates read back with all headers mapped and both example rows present. The customer example uses a checksum-valid GSTIN.

## Noticed, not changed here
- The database has **no** unique constraint on a customer's GSTIN within a business. `CUSTOMER_MAPPINGS` maps a `customers_biz_gstin_uq` constraint that does not exist, so the normal Add Customer form allows duplicate GSTINs today. Import prevents them on its own side. A partial unique index needs a migration (and a de-duplication check on existing data), so it is proposed as its own task.

## Left for D2 (UI)
- An Import button on the Customers and Products pages (owner and staff on Professional; otherwise a "Professional plan" hint; hidden for the CA).
- The upload dialog: template download link, file picker (.xlsx/.csv, 2 MB), then Check.
- The preview table: summary counts and rows with status, row number, name, and issues by column; filter by status.
- The Import button shows the ready count, followed by a result summary and a list refresh.
- Flip "Bulk customer and product import" to included.
- E2E: admin sets Professional → owner imports a small customers file and a products file → the rows appear → re-import shows duplicates → plan restored.
