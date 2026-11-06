# Bill Matrix (BM\_FinApp v1.1) — Production-Readiness & Autonomous Remediation Audit

**Audited artifact:** `BM_Fixed_P7_1.zip` → `BM_FinApp_v1.1/` (Next.js 16.2.6 App Router, React 19, Drizzle ORM + Neon Postgres, Neon Auth, iDrive e2 S3, Resend, Upstash, Sentry; \~595 files, \~67k lines of TS/TSX/SQL/MD). **Audit date:** 20 Oct 2026. **Method:** static review plus tool-backed checks (`tsc`, `eslint`, `drizzle-kit generate` drift probe, targeted greps, one web lookup for a GST rule).

## 0. How to use this report (for a follow-up AI agent)

1. Execute issues **strictly in the order of the Execution Chains in Section D** (they respect dependencies). Each issue is self-contained: file paths, line numbers (as of this zip), before/after code, verification.
2. After each issue: run `pnpm typecheck && pnpm lint`, then the issue's verification steps, then commit with the Issue ID in the message.
3. Line numbers refer to the uploaded zip; if a file changed, locate by the quoted code.
4. Project conventions to respect (from `ARCHITECTURE.md`): Server Actions via `createAuthenticatedAction`; kebab-case files; money as integer paise; **the ERP-density UI tokens listed under "High-Density ERP UI Specifications (Strict Freeze)" (row buttons `size-7.5`, sidebar toggle `size-6`, line-item delete `size-7`) are an intentional, documented exception — this report does NOT ask to change them.**

### 0.1 Evidence collected by running tools

| Check | Result |
| --- | --- |
| `tsc --noEmit` (strict) | **0 errors** (good baseline) |
| `eslint .` | **65 errors, 53 warnings**: 40× `no-explicit-any`, 11× `react-hooks/set-state-in-effect`, 4× `react-hooks/purity`, 6× `react/no-unescaped-entities`, 1× `no-require-imports`, 2× `prefer-const`, 1× `preserve-manual-memoization`, 49× unused vars |
| `drizzle-kit generate` on the repo as-is | **Produces a new migration** (`0014`) that re-adds columns/indexes already in hand-written `0013` → schema snapshots are out of sync (see ARCH-004) |
| Automated tests / CI | **None** (no `*.test.*`, no `.github/`, no `test` script) |
| Security headers / CSP | **None** (`next.config.mjs`, `proxy.ts`) |
| `error.tsx` / `loading.tsx` / `not-found.tsx` / `robots` / `sitemap` | **None** |
| Role checks (`owner`/`staff`) anywhere in code | **None** |

### 0.2 Coverage statement (read this)

- **Read line-by-line:** all root configs; `lib/actions/_shared`, `lib/auth`, `lib/db` (client + all schemas + migration 0013), `lib/rate-limit`, `lib/security`, `lib/storage`, `lib/pdf/html-to-pdf-provider`, `lib/gst/calculate`, `lib/invoices/*` (numbering, rollover, number-format, ist-date, credit-note numbering), `lib/subscriptions/entitlements`, `lib/validations/{invoice,payment,business,feedback,subscription}`; actions for invoices (draft, finalize, get, list, email, reminder, settings, next-sequence), payments (record, void), credit-notes (draft, finalize), subscriptions (all admin + claim), business (profile, logo), feedback, customers/products (create); all 6 route handlers; auth actions; admin and app layouts.
- **Sampled via targeted reads/greps:** `void-credit-note`, dashboard stats, reports (GSTR-1/ITR/export builders), large UI components (`invoice-form`, `admin-console`, `checkout-form`, templates, sidebar), marketing pages.
- **Not executed:** the app was not run against a live DB; `next build` was not run (needs secrets). Findings marked **\[verify\]** need a runtime confirmation. Recommend a final sweep with the command in API-001 §Verification to catch any unscoped query I did not read.

## A. Master Issue Index (in remediation order)

| # | ID | Sev | Title |
| --- | --- | --- | --- |
| 1 | ARCH-001 | Critical | iDrive e2 endpoint built as `https://https://…` — storage broken with the documented env |
| 2 | ARCH-006 | High | Placeholder UPI/bank fallbacks shown to paying customers when env is missing |
| 3 | ARCH-002 | High | Env validation is scattered, import-time, and crashes unrelated routes |
| 4 | ARCH-004 | High | Migration 0013 hand-written with no snapshot → drizzle drift |
| 5 | ARCH-003 | High | No CI / quality gates / migration step |
| 6 | ARCH-005 | Medium | Sentry/instrumentation gaps |
| 7 | DB-001 | High | Missing CHECK constraints and finalized-row immutability guard |
| 8 | DB-002 | High | No cross-tenant referential integrity (composite FKs) |
| 9 | DB-003 | Medium | `integer` paise columns overflow at ₹2.14 crore |
| 10 | DB-004 | Medium | Free-text status/plan columns |
| 11 | DB-005 | Medium | Redundant + missing indexes; no pending-claim uniqueness |
| 12 | DB-006 | Medium | Pool has no error handler/limits |
| 13 | DB-007 | Medium | `audit_log` is mutable and sparsely written |
| 14 | DB-008 | Medium | `is_current` flapping; inconsistent FY date writes |
| 15 | API-001 | Critical | Cross-tenant IDOR via `customer_id` / `product_id` |
| 16 | API-002 | Critical | Finalize race → duplicate/gapped statutory sequence numbers |
| 17 | API-003 | High | Payment/void concurrency + weak payment validation |
| 18 | API-004 | High | Credit-note price/tax not bound to original invoice |
| 19 | COMP-001 | High | Finalized invoices are not immutable (seller data, `finalized_at`, dates) |
| 20 | COMP-002 | High | GSTR-1 B2CL threshold is ₹2.5 L; law is ₹1 L since 1 Aug 2024 |
| 21 | API-007 | High | Business-profile action bypasses plan gating and silently resets settings |
| 22 | API-009 | High | Subscription claim double-approval race; unvalidated manual override |
| 23 | API-005 | High | Raw DB errors leaked to users; unlogged failures |
| 24 | API-006 | High | Input validation gaps (bounds, dates, enums, float paise) |
| 25 | API-008 | High | Archival pipeline unreliable on serverless |
| 26 | API-010 | Medium | Quota/entitlement logic inconsistent and bypassable |
| 27 | COMP-003 | Medium | Place-of-supply silently overridden at finalize |
| 28 | API-011 | Medium | Email actions: spam vector, counters, double logging |
| 29 | API-012 | Low | Logo upload deletes old object before new one succeeds |
| 30 | AUTH-001 | High | Platform-admin = unverified email string, copy-pasted 9× |
| 31 | AUTH-002 | High | Public auth catch-all bypasses rate limits; app-user row not self-healing |
| 32 | AUTH-003 | Medium | RBAC absent |
| 33 | AUTH-004 | Medium | GSTIN squatting / unverified business claim |
| 34 | AUTH-005 | Low | Proxy `next-action` skip + stale matcher |
| 35 | FE-001 | High | Invoice display prefs in `localStorage` → print ≠ archived PDF |
| 36 | FE-002 | Medium | React-hooks lint errors (hydration/purity) |
| 37 | FE-003 | Medium | No route-level error/loading/not-found |
| 38 | FE-004 | Medium | Accessibility gaps |
| 39 | FE-005 | Medium | UPI QR generated by third-party site |
| 40 | FE-006 | Low | Metadata/SEO/marketing hygiene |
| 41 | PERF-001 | High | No pagination on any list |
| 42 | PERF-002 | Medium | Report/export memory + timeout risk |
| 43 | PERF-003 | Medium | Logo proxied through function on every request |
| 44 | PERF-004 | Medium | Duplicate session/DB lookups per request |
| 45 | PERF-005 | Low | Oversized client components |
| 46 | SEC-001 | High | No security headers / CSP |
| 47 | SEC-002 | High | Upload validation trusts the client (3 paths) |
| 48 | SEC-003 | Medium | 7-day signed URLs for payment evidence |
| 49 | SEC-004 | Medium | Archival token in URL, replayable for 10 min |
| 50 | SEC-005 | Medium | Rate-limit coverage gaps and IP trust |
| 51 | SEC-006 | Low | Logging lacks PII scrubbing |
| 52 | SEC-007 | Low | Beta auth dependency with a dist patch |
| 53 | CLEAN-001 | Low | Dead code / orphan files |
| 54 | CLEAN-002 | Medium | Advertised plan features never enforced |
| 55 | CLEAN-003 | Low | Documentation drift |
| 56 | DEBT-001 | Medium | 65 lint errors / `any` |
| 57 | DEBT-002 | Medium | Duplicated settlement/ownership/admin logic |
| 58 | DEBT-003 | Low | Mega-components |
| 59 | TEST-001 | High | No unit tests on money/GST/numbering |
| 60 | TEST-002 | High | No integration tests for tenancy/concurrency |
| 61 | TEST-003 | Medium | No E2E tests |
| 62 | OPT-001 | Medium | Health checks, structured logs, alerts |
| 63 | OPT-002 | Medium | Backup/DR and statutory retention controls |
| 64 | OPT-003 | Low | Build/dependency hygiene |

---

# SECTION 1 — Foundational Architecture & Config

### ARCH-001 — iDrive e2 endpoint double scheme

**Severity:** Critical **Location:** `lib/storage/idrive.ts:4,15-16`; `.env.example:21` **Description:** The client is built with `endpoint: \`https://${endpoint}\`` , but  `.env.example`documents`IDRIVE\_E2\_ENDPOINT=https://s3.ap-southeast-1.idrivee2.com` . Anyone following the template gets  `https://https://s3…` . **Root Cause:** Code and template were written against different assumptions about whether the scheme is included. **Impact:** Every upload/download fails: logo upload, PDF archival (invoices and credit notes), invoice emailing (needs archived PDF), payment screenshots. Finalization still succeeds (archival is best-effort), so the failure is **silent**: invoices stay  `pending`/`failed\` and cannot be emailed. **Recommended Fix:** Normalise in code so both forms work.

```ts
// before (idrive.ts:15-16)
endpoint: `https://${endpoint}`,
// after
const normalizedEndpoint = /^https?:\/\//i.test(endpoint) ? endpoint : `https://${endpoint}`;
// ...
endpoint: normalizedEndpoint.replace(/\/+$/, ''),
```

Also keep `.env.example` as-is (with scheme) and document it in README. **Dependencies:** None. Do first. ARCH-002 will later move this check into `lib/env.ts`. **Verification:** With the `.env.example` value, run a script calling `uploadFileToStorage('healthcheck/x.txt', Buffer.from('ok'), 'text/plain')` then `getFileBuffer`; both succeed. Finalize an invoice and confirm `archival_status='archived'`.

### ARCH-006 — Placeholder payment details shown to customers

**Severity:** High **Location:** `app/(app)/checkout/page.tsx:68-72`; `app/(admin)/admin/page.tsx:77-82` **Description:** `upiId: process.env.ADMIN_UPI_ID || 'admin@okaxis'`, `accNo: … || '12345678901'`, `ifsc: … || 'SBIN0001234'`, etc. **Root Cause:** Dev-time convenience defaults left in production code paths. **Impact:** If env vars are missing/misnamed in Vercel, paying customers are shown a **fake or third-party UPI ID/bank account** and a QR for it. Direct financial loss and fraud/liability exposure; manual UTR matching will not find the money. **Recommended Fix:** Remove fallbacks; fail closed.

```ts
function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}
const upiConfig = {
  upiId: required('ADMIN_UPI_ID'), upiName: required('ADMIN_UPI_NAME'),
  bankName: required('ADMIN_BANK_NAME'), accName: required('ADMIN_BANK_ACC_NAME'),
  accNo: required('ADMIN_BANK_ACC_NO'), ifsc: required('ADMIN_BANK_IFSC'),
};
```

If throwing is too harsh, render a "Payments temporarily unavailable" state instead of a form. Final form of this check moves into `lib/env.ts` (ARCH-002). **Dependencies:** Before ARCH-002 (which absorbs it). **Verification:** Unset `ADMIN_UPI_ID`, open `/checkout` → error/unavailable state, never a UPI ID. Set it → real value shown.

### ARCH-002 — Centralised, lazy, typed environment validation

**Severity:** High **Location:** import-time throws in `lib/rate-limit/upstash.ts:5-7`, `lib/security/archival-token.ts:5-7`, `lib/storage/idrive.ts:10-12`, `lib/pdf/html-to-pdf-provider.ts:5-7`, `lib/email/resend.ts:3-5`, `lib/db/client.ts:10-12`; non-null assertions `lib/auth/server.ts:6,8`, `email-invoice.ts:107`, `send-payment-reminder.ts:145`; silent default `NEXT_PUBLIC_APP_URL || 'http://localhost:3000'` in `lib/storage/archive-invoice.ts:8` and `submit-payment-claim.ts:153`. **Description:** Each module validates its own env at import. Because modules are chained (e.g. `finalize-invoice` → `archive-invoice` → `html-to-pdf-provider`), a missing `HTML_TO_PDF_API_KEY` makes **finalize itself fail to load**; a missing Upstash var breaks **login/signup**. `next build` fails during page-data collection if any are absent in CI. Meanwhile some vars (`RESEND_FROM_EMAIL`, `NEON_AUTH_*`) are never validated, and `NEXT_PUBLIC_APP_URL` silently falls back to localhost, making archival render URLs unreachable by the PDF vendor. **Root Cause:** Per-feature fail-fast written without a shared env layer. **Impact:** Unrelated features go down together; misconfig discovered at runtime on a user request; archival silently targets `localhost`. **Recommended Fix:**

1. Create `lib/env.ts` with a zod schema (all vars from `.env.example`; `NEXT_PUBLIC_APP_URL` must be `https://` in production; `CRON_SECRET`, `ARCHIVAL_SIGNING_SECRET`, `NEON_AUTH_COOKIE_SECRET` ≥ 32 chars; `PLATFORM_ADMIN_EMAILS` non-empty; payee vars from ARCH-006).
2. Export a lazily-evaluated getter: `export const env = () => (cached ??= schema.parse(process.env))`.
3. Replace every `process.env.X` read in the files above with `env().X`; remove module-level `throw`s; construct clients lazily (`getRedis()`, `getS3()`, `getResend()`).
4. Call `env()` once in `instrumentation.ts` `register()` (nodejs runtime) so a bad deployment fails at boot, not on a user request. Skip when `process.env.SKIP_ENV_VALIDATION==='1'` for CI builds.
5. Remove the `localhost` fallback in production. **Dependencies:** After ARCH-001/ARCH-006 (absorbs them). Before AUTH-002, API-008. **Verification:** `pnpm build` with only dummy-but-valid env succeeds; with `HTML_TO_PDF_API_KEY` unset, `/login` still works and finalize works (archival reports a configuration error and stays pending); boot with a malformed `NEXT_PUBLIC_APP_URL` fails fast with a readable message.

### ARCH-004 — Migration 0013 has no snapshot; drizzle drift

**Severity:** High **Location:** `drizzle/0013_schema_sync_and_indexes.sql`, `drizzle/meta/_journal.json` (entry idx 13, `when: 1788200000000`), missing `drizzle/meta/0013_snapshot.json` **Description:** 0013 was hand-written (uses `IF NOT EXISTS`) and added to the journal without a snapshot. Running `drizzle-kit generate` on this repo emits a new `0014` containing `ADD COLUMN "email"`, `ADD COLUMN "status"` (credit\_notes, payments), voided\_\* columns and the same indexes/FKs **without** `IF NOT EXISTS`. **Root Cause:** Manual SQL used to "sync" a DB that had drifted from the schema, bypassing drizzle-kit's snapshot chain. **Impact:** The next developer who runs `db:generate && db:migrate` will hit `column already exists` on every environment that already ran 0013 — blocking all future schema changes, possibly at deploy time. **Recommended Fix (safe path):**

1. Back up prod. Confirm prod already has every object from 0013 (`\d credit_notes`, `\d payments`, `\d users`).
2. Delete the hand-made `0013_*.sql` and its journal entry; run `pnpm db:generate --name=schema_sync_and_indexes` so drizzle-kit produces `0013` **with** snapshot.
3. Edit the generated SQL so every statement is idempotent (`ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS` before `ADD CONSTRAINT`) — required because environments already applied the old 0013.
4. In already-migrated DBs, mark it applied: `INSERT INTO drizzle.__drizzle_migrations (hash, created_at)` using the new hash/timestamp only if the old row's hash differs (or run the idempotent SQL once; it is a no-op).
5. Run `pnpm db:generate` again → must report **"No schema changes"**. **Dependencies:** Before every other DB-xxx item (they add migrations). **Verification:** Fresh Neon branch: `pnpm db:migrate` from empty succeeds; `drizzle-kit generate` yields no diff; prod-clone branch: applying the new 0013 is a no-op.

### ARCH-003 — CI/CD and quality gates

**Severity:** High **Location:** repo root (no `.github/`), `package.json` scripts, `vercel.json` **Description:** No pipeline, no test script, no migration step. `next.config.mjs` does not ignore build errors (good) but nothing enforces lint/type/test before deploy. **Root Cause:** Phase-driven build by AI agents without a delivery pipeline. **Impact:** Any regression (e.g. the issues in this report) reaches production undetected; schema/app version skew. **Recommended Fix:** Add `.github/workflows/ci.yml` (Node 22, pnpm 10/11 per `packageManager`): `pnpm install --frozen-lockfile` → `pnpm typecheck` → `pnpm lint` (after DEBT-001 or with `--max-warnings` baseline) → `pnpm test` (TEST-001/002) → `pnpm build` with `SKIP_ENV_VALIDATION=1` → `pnpm audit --prod`. Add `"test": "vitest run"`, `"db:check": "drizzle-kit check"` scripts. Require the workflow on `main` (branch protection). Run migrations in a controlled deploy step (`pnpm db:migrate` against `DATABASE_URL_UNPOOLED`) **before** promoting the Vercel deployment. **Dependencies:** After ARCH-004. Gates later items (TEST-xxx). **Verification:** Open a PR with a deliberate type error → CI fails; clean PR → green.

### ARCH-005 — Sentry / instrumentation gaps

**Severity:** Medium **Location:** `instrumentation.ts`, `instrumentation-client.ts`, `next.config.mjs:15-19`, `components/sentry-init.tsx` **Description:** No `onRequestError` export (so RSC/route-handler errors are not captured automatically); server init uses `NEXT_PUBLIC_SENTRY_DSN` rather than `SENTRY_DSN`; identical init for `nodejs` and `edge`; no `environment`/`release`; no `beforeSend` scrubbing; `org`/`project` hard-coded in config; client init is forced via a `SentryInit` workaround. **Root Cause:** Minimal Sentry wiring, partly to work around a Turbopack issue. **Impact:** Missing production errors; PII (GSTINs, emails, customer names) may be sent in event extras; no release correlation. **Recommended Fix:** `export const onRequestError = Sentry.captureRequestError;` in `instrumentation.ts`; use `dsn: process.env.SENTRY_DSN`, `environment: process.env.VERCEL_ENV`, `release: process.env.VERCEL_GIT_COMMIT_SHA`; add `beforeSend` that redacts keys matching `/gstin|email|phone|account|ifsc|token/i` (see SEC-006); read `org/project` from env. **Dependencies:** After ARCH-002. **Verification:** Throw in a route handler in staging → event appears with environment/release and redacted extras.

---

# SECTION 2 — Database Schema & Query

### DB-001 — CHECK constraints and finalized-row immutability

**Severity:** High **Location:** `lib/db/schema/{invoices,credit_notes,payments,invoice_line_items,credit_note_line_items,businesses,customers}.ts`; new migration **Description:** Nothing at the DB level prevents negative money, zero/negative payments, a `finalized` invoice without a number/sequence/finalized\_at, or edits to a finalized invoice's financial columns. All immutability is application-only. **Root Cause:** Integrity enforced solely in Server Actions. **Impact:** A bug (or a future script/admin tool) can corrupt statutory records with no safety net; auditors cannot rely on the database. **Recommended Fix:** Add a migration (idempotent SQL):

```sql
ALTER TABLE invoices ADD CONSTRAINT invoices_money_nonneg CHECK (subtotal_paise>=0 AND total_tax_paise>=0 AND grand_total_paise>=0) NOT VALID;
ALTER TABLE invoices ADD CONSTRAINT invoices_final_requires_number CHECK (lifecycle_status='draft' OR (invoice_sequence IS NOT NULL AND finalized_at IS NOT NULL AND invoice_date IS NOT NULL)) NOT VALID;
ALTER TABLE credit_notes ADD CONSTRAINT credit_notes_final_requires_number CHECK (lifecycle_status='draft' OR (credit_note_sequence IS NOT NULL AND finalized_at IS NOT NULL AND issue_date IS NOT NULL)) NOT VALID;
ALTER TABLE payments ADD CONSTRAINT payments_amount_positive CHECK (amount_paise>0) NOT VALID;
ALTER TABLE invoice_line_items ADD CONSTRAINT ili_nonneg CHECK (quantity>0 AND unit_price_paise>=0 AND discount_paise>=0 AND taxable_value_paise>=0) NOT VALID;
ALTER TABLE credit_note_line_items ADD CONSTRAINT cnli_nonneg CHECK (quantity>0 AND unit_price_paise>=0 AND discount_paise>=0 AND taxable_value_paise>=0) NOT VALID;
-- then: ALTER TABLE ... VALIDATE CONSTRAINT <name>; (after checking no violating rows)
```

Add an immutability trigger on `invoices` that raises when `OLD.lifecycle_status='finalized'` and any of `customer_id, invoice_number, invoice_sequence, invoice_date, due_date, subtotal_paise, total_*_paise, grand_total_paise, seller_gstin_snapshot, billing_*_snapshot, place_of_supply_state_code, gst_rate_type, invoice_template, finalized_at, lifecycle_status` change. **Allow** changes to `payment_status, pdf_storage_key, archival_status, archival_attempts, archived_at, emailed_at, email_send_count, updated_at` (these are legitimately updated post-finalization). Mirror for `invoice_line_items` (block UPDATE/DELETE when parent finalized) and for `credit_notes` (allow `status`, `voided_*`, `pdf_storage_key`, `updated_at`). Mirror the CHECKs in the drizzle schema with `check(...)` so snapshots stay in sync (generate via drizzle-kit, then append the trigger SQL by hand and note it in a comment). **Dependencies:** After ARCH-004. API-002 and COMP-001 must keep the finalize UPDATE compatible (the finalize UPDATE moves status draft→finalized, which the trigger allows because `OLD.lifecycle_status='draft'`). **Verification:** In psql: `UPDATE invoices SET grand_total_paise=1 WHERE lifecycle_status='finalized'` → error; `UPDATE ... SET payment_status='paid'` → OK. Run the whole app flow (draft→finalize→payment→archive→email) → no trigger errors.

### DB-002 — Cross-tenant referential integrity

**Severity:** High **Location:** FKs in `invoices.customer_id`, `invoice_line_items.product_id`, `credit_note_line_items.product_id`, `payments.invoice_id`, `credit_notes.original_invoice_id` **Description:** FKs only reference `id`; nothing ensures the referenced row belongs to the same `business_id`. This is the DB-level half of API-001. **Root Cause:** Single-column FKs with global UUIDs. **Impact:** One missed ownership check in code = cross-tenant data link. **Recommended Fix:** Add `UNIQUE (business_id, id)` on `customers`, `products`, `invoices`, `credit_notes`; add `business_id` to `invoice_line_items`/`credit_note_line_items` (backfill from parent) if you want line-level enforcement; replace FKs with composite ones, **added `NOT VALID` first**:

```sql
ALTER TABLE customers ADD CONSTRAINT customers_biz_id_uq UNIQUE (business_id, id);
ALTER TABLE invoices ADD CONSTRAINT invoices_customer_same_biz FOREIGN KEY (business_id, customer_id) REFERENCES customers (business_id, id) NOT VALID;
-- audit for bad rows before VALIDATE:
SELECT i.id FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE c.business_id<>i.business_id;
```

Repeat for payments→invoices and credit\_notes→invoices. Run `VALIDATE CONSTRAINT` only after API-001 is deployed and the audit query returns zero rows (if rows exist, treat as a data-leak incident: quarantine, notify affected tenants). **Dependencies:** After DB-001. VALIDATE step after API-001. **Verification:** Attempt to insert an invoice with another tenant's `customer_id` directly in SQL → FK violation.

### DB-003 — Paise stored as 32-bit integers

**Severity:** Medium **Location:** all `*_paise integer` columns (`invoices.ts:30-35`, `credit_notes.ts:20-25`, `payments.ts:12`, line-item tables) **Description:** `integer` max = 2,147,483,647 paise ≈ **₹2.14 crore** per value. A single large invoice or `grand_total` overflows and the insert fails with a generic error. `unit_price`, `quantity` have no zod upper bound (API-006). **Root Cause:** Default Drizzle `integer()` choice. **Impact:** Legitimate high-value B2B invoices cannot be finalized; error surfaces as "could not save". **Recommended Fix:** Immediate: cap inputs in zod (API-006: unit price ≤ ₹99,99,999.99, quantity ≤ 9,999,999.999, line count ≤ 200) so the failure is a clear validation error. Then migrate totals and line amounts to `bigint({ mode: 'number' })` (safe to 2^53 paise) with `ALTER COLUMN … TYPE bigint` during low traffic; update `sql<number>` aggregations to cast `::bigint`. `sendPaymentReminder` already casts `::int` — change to `::bigint` (`send-payment-reminder.ts:47,53`). **Dependencies:** After DB-001 (CHECKs reference these columns). Pairs with API-006. **Verification:** Create an invoice with grand total ₹5 crore → saves, prints, exports to GSTR-1.

### DB-004 — Free-text state columns

**Severity:** Medium **Location:** `payments.status`, `credit_notes.status`, `businesses.subscription_plan/subscription_status`, `subscription_requests.plan_name/billing_cycle/payment_method/status`, `invoices.invoice_template` **Description:** Status/plan/template values are `text`, validated only by zod at some call sites (`updateBusinessSubscription` accepts any `subscription_plan` string). **Root Cause:** Convenience; enums exist only for older columns. **Impact:** Typos or injected values (e.g. plan `"enterprise"`) silently mis-resolve entitlements (`resolveBusinessPlan` treats unknown plans as `essentials`). **Recommended Fix:** Add CHECK constraints (cheaper than enum migrations): `CHECK (status IN ('active','voided'))`, `CHECK (subscription_status IN ('trial','active','expired','suspended'))`, `CHECK (subscription_plan IN ('trial','free','essentials','professional'))`, `CHECK (invoice_template IN ('template_1','template_2','template_3','template_4'))`, `CHECK (billing_cycle IN ('monthly','yearly','manual_override'))`, etc. Export the same literal tuples from one constants file used by zod and drizzle. **Dependencies:** After DB-001; before API-009/API-010. **Verification:** Inserting an unknown plan fails at DB; admin override UI still works for valid plans.

### DB-005 — Indexes

**Severity:** Medium **Location:** `lib/db/schema/*.ts` index blocks **Description:** (a) Redundant low-cardinality single-column indexes: `invoices_lifecycle_status_idx`, `invoices_payment_status_idx`, `invoices_business_id_idx` (covered by composites), `credit_notes_status_idx`, `credit_notes_lifecycle_status_idx`, `payments_status_idx` — they add write cost and are rarely chosen. (b) Missing: partial index for the cron; `customers (business_id, name)`; `products (business_id, is_active)`; `invoice_line_items (product_id)` (top-products report); `audit_log (business_id, created_at desc)`; `subscription_requests (user_id)`; `invoices (business_id, customer_id)`. (c) No uniqueness guard for "one pending claim per business" — `submitPaymentClaim` does check-then-insert. **Root Cause:** Indexes added reactively (migration 0013 "Issue #06"). **Impact:** Slower writes; cron and reports scan; two concurrent claims can both pass the pending check. **Recommended Fix:**

```sql
CREATE UNIQUE INDEX CONCURRENTLY subscription_requests_one_pending_per_biz ON subscription_requests (business_id) WHERE status='pending';
CREATE INDEX CONCURRENTLY invoices_archival_retry_idx ON invoices (finalized_at) WHERE archival_status IN ('pending','failed') AND archival_attempts < 5;
CREATE INDEX CONCURRENTLY customers_biz_name_idx ON customers (business_id, name);
CREATE INDEX CONCURRENTLY invoice_line_items_product_idx ON invoice_line_items (product_id);
DROP INDEX IF EXISTS invoices_lifecycle_status_idx, invoices_payment_status_idx, credit_notes_status_idx, credit_notes_lifecycle_status_idx, payments_status_idx;
```

(`CONCURRENTLY` cannot run inside drizzle's transaction wrapper — run via a separate migration file with `--> statement-breakpoint` per statement or apply manually, then reflect in schema.) Catch error code `23505` in `submitPaymentClaim` for the pending index (see API-009). **Dependencies:** After ARCH-004. Pairs with API-009, PERF-001. **Verification:** `EXPLAIN` the cron query and the invoice list with realistic data volumes; confirm index use; two parallel claim submissions → one fails cleanly.

### DB-006 — Connection pool configuration

**Severity:** Medium **Location:** `lib/db/client.ts:15` **Description:** `new Pool({ connectionString })` with no `max`, timeouts, or `pool.on('error')`. The Neon serverless Pool emits `error` events from idle clients; with no listener Node treats it as an uncaught exception. **Root Cause:** Template usage. **Impact:** Sporadic function crashes on idle-connection errors; unbounded connections under burst. **Recommended Fix:**

```ts
const pool = new Pool({ connectionString: env().DATABASE_URL, max: 5, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 5_000 });
pool.on('error', (err) => logError('db-pool', err));
```

Use the **pooled** URL (already) and keep `DATABASE_URL_UNPOOLED` for migrations only. **Dependencies:** After ARCH-002. **Verification:** Kill a connection from the Neon console during traffic; no process crash, error logged.

### DB-007 — Audit log integrity and coverage

**Severity:** Medium **Location:** `lib/db/schema/audit_log.ts`; writers only in `void-payment.ts:70`, `void-credit-note.ts`, `update-business-subscription.ts:52` **Description:** `audit_log` is writable/deletable by the app role; invoice finalize, payment record, credit-note finalize, profile/GSTIN/bank changes, plan approvals, logins are **not** logged. `user_id` FK has no `ON DELETE` policy. **Root Cause:** Audit added only where "void" was introduced. **Impact:** MCA audit-trail (Rule 3) and fraud investigation gaps; tamper-able trail. **Recommended Fix:** (1) Trigger `BEFORE UPDATE OR DELETE ON audit_log RAISE EXCEPTION`. (2) Add `lib/audit/log.ts` `writeAudit(tx, {...})` and call it inside the existing transactions of: finalize-invoice, finalize-credit-note, record-payment, save-business-profile (store diff of changed fields; mask bank account), process-request, upload/remove-logo. (3) Add `ip`/`user_agent` columns (nullable). **Dependencies:** After DB-001; the action edits must follow API-002/API-003 so audit writes sit inside the locked transactions. **Verification:** Perform each action; `SELECT action FROM audit_log ORDER BY created_at DESC` shows entries; `DELETE FROM audit_log` fails.

### DB-008 — Financial-year `is_current` flapping and date writes

**Severity:** Medium **Location:** `lib/invoices/financial-year-rollover.ts:51-63`; `lib/actions/business/save-business-profile.ts:56-66` (`start_date: currentFY.startDate.toISOString()`); readers `app/(app)/settings/page.tsx:68`, `get-sales-by-financial-year.ts:41,64`, `dashboard-chart.tsx:110` **Description:** `getOrCreateCurrentFinancialYear` flips `is_current` to **whichever FY the reference date falls into** — finalizing a back-dated invoice in the previous FY marks the old year current and un-marks the real current year; two concurrent transactions flip rows in opposite orders (deadlock risk). First-time setup writes full ISO timestamps into `date` columns while rollover uses `formatIstDateAsIso`. **Root Cause:** `is_current` stored although it is a pure function of today's IST date. **Impact:** Dashboard/Settings show the wrong "current" FY after back-dating; rare deadlocks. **Recommended Fix:** Stop writing `is_current` from rollover; compute it at read time (`start_date <= today_ist <= end_date`) in the three readers, or update the flag only from a single place using today's date (not the invoice date). Use `formatIstDateAsIso(currentFY.startDate)` in `save-business-profile.ts:61-62`. **Dependencies:** After API-002 (same file region). Before FE changes that display FY. **Verification:** Finalize an invoice dated in the previous FY → Settings/dashboard still show the current FY as current.

---

# SECTION 3 — Backend Core Logic & API

### API-001 — Cross-tenant IDOR via `customer_id` / `product_id`

**Severity:** Critical **Location (writes):** `lib/actions/invoices/save-invoice-draft.ts:124` (`customer_id: input.customer_id || null`) and `:169` (`product_id: li.product_id || null`); `lib/actions/credit-notes/save-credit-note-draft.ts:211` (`product_id`). **Location (unscoped reads):** `finalize-invoice.ts:82`, `get-invoice.ts:21`, `email-invoice.ts:62-65`, `send-payment-reminder.ts:110-113` (all `eq(customers.id, invoice.customer_id)` with no `business_id`). Joins that expose names: `list-invoices.ts:26`, `get-top-customers.ts:34`, `get-recent-invoices.ts:44`, `get-top-products.ts:36`. **Description:** The draft schema accepts any UUID for `customer_id`/`product_id`; the action never checks it belongs to the caller's business. At finalize, the customer row is loaded **by id only** and its name, GSTIN, address and state are copied into the caller's invoice snapshot (`finalize-invoice.ts:144-153`). `getInvoice` returns the full customer row; `emailInvoice` sends the PDF to that customer's e-mail address. **Root Cause:** Ownership verified for the invoice but not for referenced entities; no composite FK (DB-002). **Impact:** An authenticated user who learns/guesses another tenant's customer UUID can read that customer's PII (name, GSTIN, address, phone, email), cause the victim's customer to receive e-mail from the attacker's business, and corrupt GSTR-1 data. UUIDs are unguessable but leak through logs, Sentry, shared screenshots and URLs (`/customers/[id]/edit`). **Cross-tenant data exposure in a financial SaaS = launch blocker.** **Recommended Fix:**

1. Add a helper `lib/actions/_shared/ownership.ts`:

```ts
export async function assertOwnedCustomer(tx: DbTransaction | typeof db, businessId: string, id: string) {
  const [row] = await tx.select().from(customers).where(and(eq(customers.id, id), eq(customers.business_id, businessId))).limit(1);
  if (!row) throw new ActionError('Customer not found.', { code: 'NOT_FOUND' });
  return row;
}
// same for assertOwnedProducts(tx, businessId, ids[]) using inArray + count check
```

2. In `save-invoice-draft.ts` after the business lookup: `if (input.customer_id) await assertOwnedCustomer(tx, businessId, input.customer_id);` and `await assertOwnedProducts(tx, businessId, input.line_items.map(l=>l.product_id).filter(Boolean))`. Same for credit-note draft (product ids).
3. Replace every unscoped read listed above with `and(eq(customers.id, …), eq(customers.business_id, businessId))`; in joins add `eq(customers.business_id, invoices.business_id)` to the ON clause (`leftJoin(customers, and(eq(invoices.customer_id, customers.id), eq(customers.business_id, invoices.business_id)))`).
4. Run the audit SQL from DB-002 on production to detect existing cross-tenant links; handle as an incident if any exist. **Dependencies:** After DB-002 (constraint added NOT VALID). Then run DB-002's VALIDATE step. **Verification:** Unit/integration test (TEST-002): tenant A saves a draft with tenant B's customer UUID → `NOT_FOUND`. Sweep for any other unscoped query: `grep -rn "eq(\(customers\|products\|invoices\|payments\|creditNotes\)\.id" lib app | grep -v business_id` and review every hit.

### API-002 — Finalize race: duplicate/gapped statutory sequence numbers

**Severity:** Critical **Location:** `lib/actions/invoices/finalize-invoice.ts:30-36` (status read without lock) and `:159-180` (UPDATE `WHERE id=?` only); `lib/invoices/numbering.ts:21-24`; `lib/actions/credit-notes/finalize-credit-note.ts:27-37, 86-97`; `lib/invoices/credit-note-numbering.ts:28-32` **Description:** Finalization reads `lifecycle_status='draft'`, then increments `financial_years.invoice_sequence_counter` and the display counter, then updates the invoice `WHERE id=?`. Under READ COMMITTED, two concurrent requests (double-click, retry, two tabs) both see `draft`, each increments the counters (consuming two numbers), and the second UPDATE overwrites the first. **Root Cause:** Check-then-act without a row lock or a guarded UPDATE. **Impact:** A **gap** in the invoice series (one number consumed but never used) — violates CGST Rule 46 (consecutive serial numbers) and shows up in GSTR-1 Table 13 (documents issued); duplicate archival jobs; for credit notes the same. Free-tier rate limit (20/min) does not prevent this. **Recommended Fix:** Lock first, then guard the write.

```ts
// finalize-invoice.ts — first statement inside the transaction
const locked = await tx.execute(sql`select id, lifecycle_status from invoices where id = ${id} and business_id = ${businessId} for update`);
if (locked.rows.length === 0) throw new ActionError('Invoice not found.', { code: 'NOT_FOUND' });
if (locked.rows[0].lifecycle_status !== 'draft') throw new ActionError('This invoice has already been finalized.', { code: 'ALREADY_FINALIZED' });
// ...and make the final update self-guarding:
const updated = await tx.update(invoices).set({...}).where(and(eq(invoices.id, id), eq(invoices.lifecycle_status, 'draft'))).returning({ id: invoices.id });
if (updated.length !== 1) throw new ActionError('This invoice has already been finalized.', { code: 'ALREADY_FINALIZED' });
```

Throwing inside the transaction rolls back the counter increments, so no gap. Apply the identical pattern to `finalizeCreditNote` (note its current check is `=== 'finalized'`; it should require `=== 'draft'` and `status='active'`). Also move `getNextInvoiceNumber`'s two statements after the lock (already inside the tx). Wrap the whole flow in a transaction with `isolationLevel: 'serializable'` only if you prefer retry semantics; `FOR UPDATE` is sufficient here. **Dependencies:** After DB-001 (CHECK + trigger accept this UPDATE). Before COMP-001 (same code region), DB-007. **Verification:** Test: fire 10 parallel `finalizeInvoice` calls for one draft → exactly one succeeds, the rest return `ALREADY_FINALIZED`, `invoice_sequence_counter` increments by exactly 1. Query for gaps: `SELECT s FROM generate_series(1,(select max(invoice_sequence) from invoices where financial_year_id=...)) s LEFT JOIN invoices i ON i.invoice_sequence=s AND i.financial_year_id=... WHERE i.id IS NULL;` → zero rows.

### API-003 — Payment / void concurrency and weak payment validation

**Severity:** High **Location:** `lib/actions/payments/record-payment.ts:22-73`; `void-payment.ts:27-135`; `lib/validations/payment.ts:5-6`; `lib/actions/credit-notes/void-credit-note.ts` (same pattern) **Description:** Overpayment check reads the sum of payments then inserts — no invoice lock — so two simultaneous requests can both pass and overpay. Validation: `amount` has no max and `rupeesToPaise(0.004)` = 0 paise passes `positive()`; `payment_date` is `z.string().min(1)` (invalid dates reach Postgres and fail with a generic error; future dates and dates before the invoice date are allowed). Error text interpolates raw floats (`₹${remainingRupees}`). **Root Cause:** Same check-then-act pattern; permissive schema. **Impact:** Wrong receivable balances, invoices wrongly shown `paid`, corrupted books; support load. **Recommended Fix:**

1. Lock the invoice row (`select … from invoices where id=$1 and business_id=$2 for update`) at the top of record/void payment and void credit note transactions.
2. Schema:

```ts
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => !Number.isNaN(Date.parse(s)), 'Invalid date');
amount: z.coerce.number().min(0.01).max(99_999_999.99),
payment_date: isoDate,
```

3. In the action: reject `payment_date` > today (IST, `formatIstDateAsIso(new Date())`) and < `invoice.invoice_date`; compute paise with the decimal-safe helper from API-006; format messages with `formatPaiseAsInr`.
4. Extract `recomputePaymentStatus(tx, invoiceId)` (see DEBT-002) and use it in all five call sites. **Dependencies:** After API-002; DB-001 (CHECK `amount_paise>0`) and API-006 helpers. **Verification:** Parallel test: invoice ₹1,000 balance, two simultaneous ₹800 payments → one `OVERPAYMENT`. `amount: 0.004` → validation error.

### API-004 — Credit-note amounts are not bound to the original invoice

**Severity:** High **Location:** `lib/actions/credit-notes/save-credit-note-draft.ts:62-132` (quantity-only check keyed by `description::hsn`), `:134-165` (client-supplied `unit_price`, `discount`, `tax_rate_id`; PoS from invoice), `:184`; `finalize-credit-note.ts` (no re-validation) **Description:** Only the *quantity* per `description::hsn` key is validated against the original invoice. Unit price, discount and tax rate come from the client, so a credit note can credit **more money or more tax than was invoiced**. Cumulative credited value vs invoice value is never enforced; finalize does not re-check. Quantities are rounded to 2 decimals while stored with 3 (`Math.round(x*100)/100`), and the free-text key breaks when the same item appears twice with different prices. **Root Cause:** Credit notes modelled as free-form invoices instead of derivations of original line items. **Impact:** Fraudulent/erroneous reduction of tax liability (GSTR-1 CDNR/Table 9B), refund mismatches; statutory exposure under s.34 CGST. **Recommended Fix:** Add `original_line_item_id uuid references invoice_line_items(id)` to `credit_note_line_items` (migration + backfill best-effort by description/HSN). In the action, accept `{original_line_item_id, quantity, discount?}` only; derive `unit_price_paise`, `tax_rate_percentage`, HSN, description, UoM from the original line; compute credited qty per original line (sum over non-voided notes incl. drafts, excluding the current draft) with 3-decimal precision; enforce `qty ≤ remaining`, and total credited grand total ≤ invoice grand total. Re-run the same validation at finalize under the invoice row lock (API-003 lock). Remove the `as TaxCalculationInput & {supplierStateCode}` cast and the unused `supplierStateCode` property. **Dependencies:** After DB-001, API-002/003 (locking). UI: `credit-note-form.tsx` and `get-credit-note-form-data.ts:161` (`product_id: null`) must pass `original_line_item_id` (check these when implementing). **Verification:** Attempt a credit note with price 10× original → rejected; two drafts that together exceed the original qty → second rejected; finalize after editing original qty in another tab → rejected.

### COMP-001 — Finalized invoices are not immutable

**Severity:** High **Location:** `lib/db/schema/invoices.ts:11,26-29` (only `seller_gstin_snapshot` + billing snapshots); `app/api/invoices/[id]/archival-render/route.ts:85-101` (uses **current** `business` row for name, address, phone, bank, terms, logo); `finalize-invoice.ts:166` (`finalized_at: invoiceDate`); `:128` and `save-invoice-draft.ts:22` (`invoice_date` unbounded) **Description:** The schema comment promises frozen seller/buyer details, but seller legal name, address, state, phone, bank details and terms are read live from `businesses` when rendering the print view **and the archived PDF**. Editing the business profile therefore changes how historic invoices print, and a retried archival days later produces a different legal document. Also `finalized_at` is set to the (midnight UTC) invoice date rather than the real timestamp, and `invoice_date` can be any date (future or years back, also into a closed FY). **Root Cause:** Snapshot model implemented for buyer only. **Impact:** Legal-document integrity (Rule 46 content, 8-year retention), audit disputes, incorrect `finalized_at` for audit trails. **Recommended Fix:**

1. Migration: add to `invoices` (and `credit_notes`) nullable text columns `seller_name_snapshot, seller_trade_name_snapshot, seller_address_snapshot, seller_state_code_snapshot, seller_phone_snapshot, seller_email_snapshot, seller_bank_snapshot (jsonb), terms_snapshot, logo_storage_key_snapshot`. Backfill finalized rows from the current business (accept imperfection; document it).
2. Populate them in `finalize-invoice.ts` / `finalize-credit-note.ts` inside the same UPDATE; make print views/`archival-render` read snapshots for finalized documents, falling back to live business only for drafts. Never delete a logo object referenced by a snapshot (see API-012).
3. Set `finalized_at: new Date()`; keep `invoice_date` as the legal date.
4. Validate `invoice_date`: not in the future (IST), not before the latest finalized invoice date in the same series minus an allowed back-date window (suggest: same financial year, ≤ N days — make N a documented constant), and not in a different FY than the series being numbered unless the user confirms.
5. DB-001's trigger must list the new snapshot columns as immutable. **Dependencies:** After API-002 and DB-001. Before FE-001. **Verification:** Finalize an invoice, change the business address and logo, open the invoice and regenerate the PDF → unchanged. Try `invoice_date` tomorrow → validation error.

### COMP-002 — GSTR-1 B2CL threshold outdated (₹2.5 lakh → ₹1 lakh)

**Severity:** High **Location:** `lib/actions/reports/get-gstr1-data.ts:280`: `const isLargeInvoice = inv.grand_total_paise > 25000000; // > ₹2,50,000` (and any B2C credit-note logic derived from it, \~`:541-576`) **Description:** Per Notification No. 12/2024-Central Tax (GSTN advisory, 3 Sep 2024) the threshold for invoice-wise reporting of inter-state B2C supplies (GSTR-1 Table 5, B2CL) was reduced from ₹2.5 lakh to **₹1 lakh, effective 1 Aug 2024**. **Root Cause:** Rule hard-coded from older law; no effective-date handling. **Impact:** Inter-state B2C invoices between ₹1 L and ₹2.5 L are exported as B2C-Small (Table 7) instead of B2CL → incorrect GSTR-1 for every affected taxpayer; filing errors/penalty exposure. This is the product's headline feature. **Recommended Fix:**

```ts
// lib/gst/thresholds.ts
export const B2CL_THRESHOLD_PAISE_FROM = [
  { from: '2000-01-01', paise: 25_000_000 },
  { from: '2024-08-01', paise: 10_000_000 },
];
export function b2clThresholdPaise(invoiceDateIso: string) {
  return [...B2CL_THRESHOLD_PAISE_FROM].reverse().find(t => invoiceDateIso >= t.from)!.paise;
}
// get-gstr1-data.ts:280
const isLargeInvoice = isInterState && !isRegistered && inv.grand_total_paise > b2clThresholdPaise(inv.invoice_date);
```

Apply the same threshold to credit/debit notes against B2CL originals. Add a unit test table (TEST-001) around the boundary (₹99,999.99, ₹1,00,000.00, ₹1,00,000.01; dates 31-Jul-2024 vs 1-Aug-2024). Ask a CA to confirm remaining GSTR-1 table mappings (HSN summary rules, Table 12 digit requirements by turnover). **Dependencies:** None technical; do early. Pair with TEST-001. **Verification:** Seed an inter-state B2C invoice of ₹1.5 L dated after 1-Aug-2024 → appears in the B2CL sheet, not in B2CS.

### API-007 — Business-profile action bypasses plan gating and silently resets settings

**Severity:** High **Location:** `lib/actions/business/save-business-profile.ts:78-83`; `lib/validations/business.ts:40,42` **Description:** (1) `saveInvoiceSettings` enforces paid-feature gates (custom number format, premium templates) but `saveBusinessProfile` writes `invoice_number_format`, `credit_note_number_prefix`, `default_invoice_template`, `payment_due_days` with **no entitlement check**. (2) The schema declares `default_invoice_template: ….optional().default('template_1')` and `default_gst_rate_type: ….optional().default('exclusive')`; zod fills the default, so `!== undefined` is always true and **every profile edit resets those two settings** unless the form re-sends them. **Root Cause:** Two actions write the same columns; zod `.default()` defeats the "only if supplied" logic. **Impact:** Free users obtain paid features; paying users silently lose their template/GST-mode preferences. **Recommended Fix:** Remove `.default(...)` from both fields (keep `.optional()`). In `saveBusinessProfile`, drop invoice-setting writes from the update path entirely (settings page uses `saveInvoiceSettings`); for first-time setup apply defaults after the entitlement check (`canUseTemplate`, `canCustomizeInvoiceNumberFormat`). Add a regression test that a profile edit leaves `default_invoice_template` untouched. **Dependencies:** After DB-004 (CHECK on template values). Interacts with CLEAN-002. **Verification:** Free account: call `saveBusinessProfile` with `default_invoice_template:'template_3'` → ignored/blocked. Paid account sets template\_2, edits address → template stays template\_2.

### API-009 — Subscription approval race and unvalidated manual override

**Severity:** High **Location:** `lib/actions/subscriptions/process-request.ts:35-50,83-90`; `update-business-subscription.ts:12-17,35,68-79`; `submit-payment-claim.ts:55-84` **Description:** `processSubscriptionClaim` reads `status` outside the transaction and updates `WHERE id=?` without `status='pending'`: two admins (or a double-click) both approve → the subscription is extended twice. `updateBusinessSubscription` accepts any `subscription_plan` string and `subscription_ends_at` string; `new Date('garbage')` becomes Invalid Date → DB error; its ledger row uses `MANUAL-${Date.now()}` as the unique reference (collision on same ms) and stores the admin's own `user_id` against the target business. `submitPaymentClaim` does check-then-insert for the pending claim (race) and a global-unique UTR lets a user pre-claim someone else's UTR string. **Root Cause:** Non-atomic state transitions; free-form admin inputs. **Impact:** Revenue/entitlement errors, support disputes, broken admin override. **Recommended Fix:** Do the status check inside the transaction with a guarded update: `update(subscriptionRequests).set({status:'approved',…}).where(and(eq(id), eq(status,'pending'))).returning()`; if 0 rows → `ALREADY_PROCESSED` and skip the business update. Override schema: `subscription_plan: z.enum(['free','trial','essentials','professional'])`, `subscription_ends_at: z.string().datetime().nullable()`; reference `MANUAL-${crypto.randomUUID()}`. Scope UTR uniqueness to `(business_id, payment_reference)` or keep global but show a neutral message; the partial unique index from DB-005 makes the pending check atomic (catch `23505`). Cap `reject_reason` length (`max(500)`). **Dependencies:** After DB-004, DB-005, AUTH-001. **Verification:** Two parallel approve calls → one extends, other `ALREADY_PROCESSED`; end date advanced by exactly one cycle.

### API-005 — Raw DB errors leaked; failures not logged

**Severity:** High **Location:** `finalize-credit-note.ts:166-170` and `save-credit-note-draft.ts:236-240` (`throw new ActionError(error.message, ...)` for **any** error); swallow-and-replace patterns in `save-invoice-draft.ts:193-197`, `finalize-invoice.ts:198-202`, `record-payment.ts:109-113`, `void-payment.ts:148-152`, `save-business-profile.ts:90-93`, `create-customer.ts:50-52` (bare `catch {}`), `email-invoice.ts:127-133` (ActionError caught by its own catch) **Description:** `ActionError.message` is shown verbatim (documented in ARCHITECTURE.md), but the credit-note actions pass arbitrary `error.message` (Postgres text such as constraint and table names) to the browser. Elsewhere unexpected errors are converted to ActionError after only `console.error`, so they bypass `logError` and **never reach Sentry** (the wrapper logs ActionErrors as `expected:true`). **Root Cause:** Ad-hoc try/catch around the wrapper that already handles unknown errors. **Impact:** Information disclosure (schema names); production failures invisible to alerting. **Recommended Fix:** In these actions rethrow non-ActionErrors (`throw error`) — the wrapper logs to Sentry and returns the generic message. Where a specific message is wanted, map known codes: `if ((error as {code?:string}).code === '23505') throw new ActionError('…already exists…', {code:'DUPLICATE'})`. Delete bare `catch {}`. Pass `fieldErrors` for unique violations (GSTIN, UTR). **Dependencies:** After ARCH-005 (Sentry) is useful but not required. **Verification:** Force a DB error in staging → user sees generic message, Sentry shows the event tagged with the action scope.

### API-006 — Input validation gaps and float money

**Severity:** High **Location:** `lib/validations/invoice.ts:9,11,16-28`; `lib/validations/payment.ts:5-6`; `credit-note.ts`; `app/api/reports/export/route.ts:71-80`; `lib/money.ts:15-17`; paise math in `save-invoice-draft.ts:98-104` and `save-credit-note-draft.ts:146-152` **Description:** No upper bounds on `quantity`, `unit_price`, `line_items` count; `invoice_date`/`payment_date`/`issue_date` only regex-checked (e.g. `2026-99-99` passes); `invoice_template` is a free string; `place_of_supply_state_code` is only `length(2)` so an invalid code throws `GstCalculationError` (a plain Error → generic 500-style message + Sentry noise); `billing_gstin` has format but no checksum; tax rates are not checked for `is_active`/effective dates; export route takes `startDate/endDate/label/type` from the query string without validation. Rupee→paise uses `Math.round(x*100)` (1.005×100 = 100.49999… → 100). **Root Cause:** Schemas written for happy-path forms. **Impact:** Opaque failures, DoS via huge payloads, rare off-by-one-paisa tax differences, invalid GSTR-1 rows. **Recommended Fix:** Create `lib/validations/common.ts` with `isoDate`, `moneyRupees` (`.max(99_999_999.99)`, `multipleOf(0.01)`), `quantity` (`.max(9_999_999.999)`, `multipleOf(0.001)`), `stateCode` (`z.enum(INDIAN_GST_STATES codes)`), `templateId` (`z.enum`), `gstin` (regex + mod-36 checksum). Limit `line_items` `.max(200)`. Replace `Math.round(x*100)` with a decimal-string conversion: `const [i,f=''] = x.toFixed(2).split('.'); return Number(i)*100 + Number(f.padEnd(2,'0')) * Math.sign(x||1)` (or `decimal.js`), and use it in `lib/money.ts` + both draft actions. Filter tax rates by `is_active` and `effective_from <= invoice_date <= coalesce(effective_to, 'infinity')`. Parse export query params with zod (date range ≤ 366 days, `type` enum, `label` max 40 chars `[A-Za-z0-9 _/-]`). **Dependencies:** Before API-003/004 final wiring; pairs with DB-003. **Verification:** Unit tests (TEST-001) for each helper; submit `quantity: 1e12` → field error; invalid state code → field error.

### API-008 — Archival pipeline is unreliable on serverless

**Severity:** High **Location:** `finalize-invoice.ts:191-195`, `finalize-credit-note.ts:151` (fire-and-forget promises; invoice version has no `.catch`); `app/api/invoices/[id]/archival-render/route.ts:7,13-31,103-133` (+ credit-note equivalent); `lib/pdf/html-to-pdf-provider.ts:17-30`; `app/api/cron/retry-invoice-archival/route.ts:30-53`; `lib/storage/archive-invoice.ts:8,46-60` **Description:** (1) After the Server Action returns, Vercel may freeze the function, silently dropping the un-awaited archival — and a rejection in `archiveInvoicePdf(id).then(...)` is unhandled. (2) The render route reads compiled CSS from `.next/static` with `fs` at runtime; on Vercel those files are not in the function bundle, so the PDF can render unstyled **\[verify\]**. It also uses `require('react-dom/server')` to dodge a build restriction (lint error). (3) The PDF vendor `fetch` has no timeout. (4) The cron processes up to 20 invoices sequentially (each external render) with no `maxDuration`; no claim/lock so cron and finalize-triggered runs can overlap; invoices that hit 5 attempts are never alerted. (5) Render URL token travels via a third party (SEC-004). **Root Cause:** Best-effort archival designed around a long-lived server. **Impact:** Missing/unstyled statutory PDFs, emails blocked (`PDF_NOT_READY`), silent permanent failures. **Recommended Fix:** Use Next's `after()` (`import { after } from 'next/server'`) in both finalize actions so work is scheduled after the response and kept alive: `after(async () => { try { … } catch (e) { logError(…) } })`. Render **without reading `.next`**: build the HTML from a static stylesheet you import (`import css from '@/app/print.css?raw'`) or, simpler, render with a dedicated print route using `<link rel="stylesheet">` pointing at the deployed `/_next/static/…` URLs (the vendor fetches the page anyway). Replace `require` with a top-level `import { renderToStaticMarkup } from 'react-dom/server'` inside a file marked `export const runtime = 'nodejs'` (verify the build accepts it; otherwise render with `react-dom/server.edge` or move to a `.tsx` helper in `lib/`). Add `AbortSignal.timeout(25_000)` to the vendor fetch. Cron: `export const maxDuration = 300;`, claim rows atomically (`update invoices set archival_attempts = archival_attempts+1 where id in (select id … for update skip locked limit 5) returning id`), process with concurrency 2, and send a Sentry message when `archival_attempts >= 5`. Update `archival_attempts` on every attempt (currently only on failure). **Dependencies:** After ARCH-001, ARCH-002, COMP-001 (render from snapshots), DB-005 (partial index). **Verification:** Deploy to a Vercel preview; finalize an invoice and confirm `archived` within \~30 s with styled PDF; kill the vendor URL → attempts increment, alert fires at 5.

### API-010 — Quota and entitlement logic inconsistent and bypassable

**Severity:** Medium **Location:** `lib/actions/invoices/save-invoice-draft.ts:56-77`; `finalize-invoice.ts:55-74`; `lib/subscriptions/entitlements.ts:189-195`; `create-customer.ts:23-33`; `create-product.ts:24-34` **Description:** Draft creation counts **all** invoices created this month (including drafts) while finalize counts finalized invoices by `invoice_date`; there is no "delete invoice draft" action (credit notes have one), so abandoned drafts consume the free quota (30). A business in `trial` **with `trial_ends_at` NULL** is treated as a permanent 14-day trial (`daysRemaining: 14`, never expires). Suspended accounts can still record payments, create customers, finalize credit notes, export. Customer/product quota counts include deactivated records and are check-then-insert. **Root Cause:** Quota rules duplicated per action; defensive default in the resolver. **Impact:** Revenue leakage (unlimited trial), confusing limits, free-tier users blocked by their own drafts. **Recommended Fix:** Define one rule: quota counts **finalized** invoices in the IST month by `invoice_date`; drafts are free. Remove the draft-time count (keep the finalize-time check inside the locked transaction). Add `deleteInvoiceDraft` (mirror `delete-credit-note-draft.ts`, only for `lifecycle_status='draft'`, business-scoped). In `resolveBusinessPlan`, treat trial with missing `trial_ends_at` as **expired** (and backfill `trial_ends_at = created_at + 14d`). Add `assertNotSuspended(business)` to all mutating actions via a shared option on `createAuthenticatedAction` (`requireActiveSubscription: true`). Count only `is_active` customers/products if that is the intended policy. **Dependencies:** After API-002; CLEAN-002 decides which flags to enforce. **Verification:** Free account with 30 abandoned drafts can still finalize; trial with NULL end date → `expired`; suspended account cannot record payments.

### COMP-003 — Place of supply silently overridden at finalize

**Severity:** Medium **Location:** `finalize-invoice.ts:86` (`placeOfSupplyStateCode = customer ? customer.state_code : invoice.place_of_supply_state_code`) **Description:** The user's explicit place of supply on the draft is discarded when a saved customer is attached; tax (CGST+SGST vs IGST) is recomputed with the customer's registered state. Under GST the PoS for goods is the delivery location, which may differ from the buyer's registered state. **Root Cause:** Convenience default treated as authoritative. **Impact:** Totals change between the preview the user approved and the finalized invoice; wrong tax head. **Recommended Fix:** Use `invoice.place_of_supply_state_code` (validated as a real state code at draft time); default it from the customer's state in the UI only. If totals differ from the draft totals at finalize, abort with a clear message rather than silently changing them. **Dependencies:** After API-001/API-002. **Verification:** Draft with customer in Karnataka and PoS Maharashtra → finalized invoice keeps Maharashtra and IGST.

### API-011 — Email actions: spam vector, counters, shared limiter

**Severity:** Medium **Location:** `lib/actions/invoices/send-payment-reminder.ts:183` (`keyPrefix:'email-invoice'`, shared with `email-invoice.ts:150`), `:169-176`; `email-invoice.ts:136-143`, `:127-133` **Description:** Any account (including a 14-day trial) can send up to 20 e-mails/min **from your domain** to any customer e-mail it types in, with attacker-chosen business/customer names; no cooldown per invoice. `email_send_count` is read-modify-write (lost updates) and `emailed_at` conflates invoice sends and reminders. Reminder and invoice e-mails share a rate-limit key. **Root Cause:** Rate limit scoped per user only. **Impact:** Domain-reputation damage/phishing relay, harassment of customers. **Recommended Fix:** Per-invoice cooldown (e.g. reminder at most once per 24 h; store `last_reminder_at`, add column) and a daily per-business cap (e.g. 50) via Upstash; separate key prefixes; require the trial to be verified (AUTH-001) before outbound e-mail; use `sql\`${invoices.email\_send\_count} + 1\`` ; add  `reminder\_count`/`last\_reminder\_at` . Add  `List-Unsubscribe` /footer identifying the sender business. Remove double logging. **Dependencies:** After DB-005 migration for new columns; AUTH-001. **Verification:** Second reminder within 24 h →  `COOLDOWN\` error; counters correct under parallel sends.

### API-012 — Logo upload ordering

**Severity:** Low **Location:** `lib/actions/business/upload-logo.ts:68-112` **Description:** The old logo is deleted from storage **before** the new upload and DB update; failure leaves `logo_storage_key` pointing at a deleted object, and orphaned new objects if the DB update fails. With COMP-001 snapshots, old logos referenced by finalized documents must be kept. **Root Cause:** Cleanup ordered before success. **Impact:** Broken logos; archival renders without logo. **Recommended Fix:** Upload new object → update DB → (best-effort) delete the old object **only if** no snapshot references it. Add a rate limit (`sensitiveActionLimiter`) and magic-byte validation (SEC-002). **Dependencies:** After COMP-001, SEC-002. **Verification:** Simulate DB failure after upload → old logo remains valid.

---

# SECTION 4 — Authentication & Authorization

### AUTH-001 — Platform-admin is an unverified e-mail string, copy-pasted 9 times

**Severity:** High **Location:** `app/(admin)/layout.tsx:16-29`, `app/(app)/layout.tsx:19-23`, `lib/actions/subscriptions/{get-admin-dashboard-stats,get-pending-requests,get-all-users,get-all-businesses,process-request,update-business-subscription}.ts` (each re-parses `PLATFORM_ADMIN_EMAILS` and calls `auth.getSession()`), `submit-payment-claim.ts:141` **Description:** Admin rights are granted to whoever's session e-mail matches an entry in `PLATFORM_ADMIN_EMAILS`. The signup action (`app/(auth)/signup/actions.ts`) signs the user in immediately and never requires e-mail verification, so the check proves nothing unless the real admin registered first. The same 8-line block is duplicated in nine files (one place forgetting it = privilege escalation). The admin actions also use `createAuthenticatedAction`, which requires an app user row, then run a second `getSession()`. **Root Cause:** Authorization implemented ad hoc per file; no email-verified requirement. **Impact:** If an admin address is not yet registered (new admin, rotated address), anyone can sign up with it and obtain full platform-admin power: approve payments, suspend/grant subscriptions, read all tenants' business and user data and signed payment-evidence URLs. **Recommended Fix:**

1. Enable e-mail verification in Neon Auth (require verification before session creation) and block login for unverified users.
2. Create `lib/auth/admin.ts`:

```ts
export async function requirePlatformAdmin() {
  const s = (await auth.getSession()).data;
  const u = s?.user;
  if (!u?.email || !u.emailVerified) throw new ActionError('Unauthorized', { code: 'UNAUTHORIZED_ACCESS' });
  const allow = env().PLATFORM_ADMIN_EMAILS.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  if (!allow.includes(u.email.toLowerCase())) throw new ActionError('Unauthorized', { code: 'UNAUTHORIZED_ACCESS' });
  return u;
}
export const isPlatformAdmin = async () => { try { await requirePlatformAdmin(); return true; } catch { return false; } };
```

3. Add `options.requirePlatformAdmin: true` to `createAuthenticatedAction` (runs it before the handler) and delete the duplicated blocks; layouts call `isPlatformAdmin()`.
4. Prefer an allow-list of **auth user IDs** over e-mails (`PLATFORM_ADMIN_USER_IDS`), keep e-mail as fallback only when verified.
5. Do not pass `adminEmailAllowlist` (the full admin e-mail list) to the client (`admin/page.tsx:85,95`) — drop that prop. **Dependencies:** After ARCH-002. Before API-009, API-011, SEC-003. **Verification:** Sign up (unverified) with an admin e-mail → `/admin` and all admin actions denied; verified admin works; `grep -rn PLATFORM_ADMIN_EMAILS app lib` shows only `lib/env.ts` and `lib/auth/admin.ts`.

### AUTH-002 — Public auth catch-all bypasses rate limiting; app-user row not self-healing

**Severity:** High **Location:** `app/api/auth/[...path]/route.ts:4`; `app/(auth)/login/actions.ts:10-43`; `signup/actions.ts:9-50`; `lib/auth/ensure-app-user.ts:10-38`; `lib/auth/session.ts:16-27`; `lib/rate-limit/upstash.ts:24-28,64-72` **Description:** (1) Sign-in/sign-up/session endpoints are exposed through `auth.handler()` on `/api/auth/*`; the Upstash `authLimiter` is applied only inside the two Server Actions, so a script posting directly to the handler is **not rate-limited** by the app. (2) `ensureAppUser` is only called from those actions. A user created through the handler (or whose insert failed — the function swallows errors and returns `null`) has a Neon Auth identity but **no `users` row**; `getCurrentAppUser()` returns `null` and every action fails with "We could not find your account details" forever. (3) `ensureAppUser` is select-then-insert: concurrent calls hit the `auth_user_id` UNIQUE constraint and return `null` although the row exists. (4) The limiter keys by IP only (login and signup share `auth:${ip}`; 5/min punishes shared NATs and does not stop distributed credential stuffing); if Upstash is down `checkRateLimit` throws **outside** the `try` → unhandled error page. (5) No password-strength rule in `signupAction`. **Root Cause:** Rate limit and provisioning attached to UI actions, not to the identity boundary. **Impact:** Brute-force/credential-stuffing and signup spam bypass; dead-end accounts; poor availability under Redis outage. **Recommended Fix:**

1. Provisioning: make `getCurrentAppUser()` self-healing — after `requireSession()`, `insert(...).onConflictDoNothing({target: users.auth_user_id}).returning()` then re-select. Rewrite `ensureAppUser` the same way and let real DB errors propagate (log + rethrow).
2. Rate limit at the boundary: wrap the handler:

```ts
const h = auth.handler();
export const GET = h.GET;
export const POST = async (req: NextRequest, ctx: any) => {
  if (/\/(sign-in|sign-up|forget-password|reset-password|send-verification)/.test(req.nextUrl.pathname)) {
    const ip = getClientIp(req.headers);
    const r = await checkRateLimit(authLimiter, `authapi:${ip}`).catch(() => ({ allowed: true, retryAfterSeconds: 0 }));
    if (!r.allowed) return new Response('Too many requests', { status: 429, headers: { 'Retry-After': String(r.retryAfterSeconds) } });
  }
  return h.POST(req, ctx);
};
```

3. Separate limiters for login (per IP **and** per normalized e-mail, e.g. 10/15 min) and signup (3/hour/IP); define the Redis-outage policy explicitly (fail-open with a Sentry alert for login; fail-closed for signup).
4. Server-side password policy in `signupAction` (≥ 10 chars, not in a small deny-list) in addition to Neon Auth's.
5. Put the `checkRateLimit` call inside the `try` or catch it. **Dependencies:** After ARCH-002 and AUTH-001 (verification flow). **Verification:** 20 rapid POSTs to `/api/auth/sign-in/email` → 429 after the limit; delete a `users` row for a logged-in user → next request recreates it; kill Redis → login still renders an error message, not a crash.

### AUTH-003 — RBAC absent

**Severity:** Medium **Location:** `lib/db/schema/enums.ts:4` (`owner|staff`); no role check in any of `lib/actions/**`; `entitlements.ts` advertises `teamUserLimit` (never read) **Description:** Every action authorizes only "has a business". Role is displayed in the sidebar only. Today a business has exactly one user (nothing creates a second), so the risk is latent — but plans sell "Owner + 2 Staff". **Root Cause:** Team feature planned, not built; roles added to schema first. **Impact:** The moment team invites ship, staff could void payments/credit notes, edit GSTIN/bank details or submit subscription claims. **Recommended Fix:** Add `options.roles: ['owner']` to `createAuthenticatedAction`; apply `owner` to: save-business-profile, upload/remove-logo, save-invoice-settings, void-payment, void-credit-note, submit-payment-claim, subscription actions; `staff` allowed: invoices (draft/finalize), customers, products, record-payment, reports read. Document the matrix in ARCHITECTURE.md. Until team invites exist, either hide "staff" in the admin UI filter or implement invites (`team_invites` table, token hash, expiry, accept flow, per-plan seat check). **Dependencies:** After AUTH-001 (wrapper options). **Verification:** Integration test creates a staff user and asserts forbidden on owner-only actions.

### AUTH-004 — GSTIN squatting / unverified business claim

**Severity:** Medium **Location:** `lib/db/schema/businesses.ts:17` (`gstin ... unique`); `save-business-profile.ts:34-93` **Description:** Any signed-up user can register any syntactically valid GSTIN (first come first served). The real owner then cannot onboard: the unique violation is reported as the generic "could not save your business profile". Also two concurrent first-time submissions create two businesses (no lock), and GSTIN can be edited at any time even after invoices exist. **Root Cause:** No ownership proof; no unique-violation handling; no guard on identity fields. **Impact:** Onboarding denial for real taxpayers, fraudulent invoices in someone else's GSTIN name, support burden. **Recommended Fix:** (1) Catch `23505` on `businesses_gstin_unique` → `ActionError('This GSTIN is already registered on Bill Matrix. If you own it, contact support with proof.', {fieldErrors:{gstin:[...]}})`. (2) Make first-time setup idempotent: lock the user row (`select … for update`) and re-check `business_id` inside the transaction. (3) Block GSTIN/state change once any finalized invoice exists (allow via support/admin flow with audit log entry). (4) Longer-term: verify GSTIN ownership (OTP to the e-mail registered on the GST portal, or a GSP verification API) before enabling finalize; add an admin tool to release a squatted GSTIN. **Dependencies:** After DB-001, DB-007. **Verification:** Two accounts register the same GSTIN → second gets the specific message; parallel first-time saves → one business.

### AUTH-005 — Proxy skip on `next-action` header and stale matcher

**Severity:** Low **Location:** `proxy.ts:19-21,26-36` **Description:** Any request carrying a `next-action` header skips `auth.middleware` (a client controls that header), so a GET to `/dashboard` with it reaches the page without the middleware redirect — protection then relies on `(app)/layout.tsx`/page-level session checks. The matcher lists `/payments/:path*` (no such route) and `/dev-sentry-test`. **Root Cause:** Workaround for a cookie-rewrite issue; allow-list matcher requires manual upkeep. **Impact:** Defense-in-depth gap only (layout and actions still enforce auth). **Recommended Fix:** Restrict the skip to `request.method === 'POST'` **and** `content-type` starting with `text/plain` or `multipart/form-data` **and** the header present; keep layout/page `requireSession()` calls as the primary guard (and add `requireSession()` to each page that loads data directly). Remove `/payments` and `/dev-sentry-test` from the matcher once CLEAN-001 deletes that route. **Dependencies:** After CLEAN-001 for the matcher; otherwise independent. **Verification:** `curl -H 'next-action: x' /dashboard` without cookies → redirect to `/login`.

---

# SECTION 5 — Frontend, UI/UX & Cross-Device

> Scope note: 54 client components were reviewed by lint output, targeted greps and sampled reading (invoice form, checkout, templates, layouts). Items below are those with evidence; run a manual pass (device lab) for the remainder. The ERP-density "Strict Freeze" tokens are **respected and excluded**.

### FE-001 — Invoice display preferences live in `localStorage`

**Severity:** High **Location:** `components/app/invoices/templates/template-{1,2,3,4}.tsx` (e.g. `template-1.tsx:76`), `components/app/invoices/invoice-form.tsx:89`, `components/app/settings/invoice-settings-form.tsx:105-117,217-232` (`bm_invoice_settings`) **Description:** Toggles that change what an invoice shows (display preferences saved from Settings) are stored per browser. Templates read them in an effect after mount (11 `set-state-in-effect` lint errors), so the first paint is the default layout then flips (layout shift, hydration flicker). The server-rendered archival PDF cannot see `localStorage`, so **the on-screen/printed invoice and the archived PDF can differ**; a second device or browser shows a different invoice. **Root Cause:** UI-only preference store used for content-affecting options. **Impact:** Inconsistent legal documents between print and archive; support confusion; flicker. **Recommended Fix:** Add `businesses.invoice_display_prefs jsonb not null default '{}'` (DB-004 CHECK: object), validate with zod, save it in `saveInvoiceSettings`, load it in the invoice page/server print routes and pass as a prop to templates (no effect, no localStorage). Snapshot the prefs into the finalized invoice (COMP-001 column `display_prefs_snapshot`). One-time migration: on first load, if localStorage has prefs and DB is empty, offer "Save to account", then remove the key. **Dependencies:** After COMP-001 and API-007. **Verification:** Change a preference on device A; open the invoice on device B and the archived PDF → identical.

### FE-002 — React-hooks lint errors (purity / set-state-in-effect)

**Severity:** Medium **Location:** `purity`: `components/app/settings/billing-tab.tsx:203,214`, `logo-upload-card.tsx:51`, `components/landing/live-dashboard.tsx:68`; `preserve-manual-memoization`: `billing-tab.tsx:211`; `set-state-in-effect`: `app/(admin)/admin/admin-console.tsx:179,239,243`, `components/app/app-sidebar.tsx:239,249`, templates 1-4, `components/app/subscription/upgrade-prompt-modal.tsx:62,67` **Description:** `Date.now()`/`Math.random()` during render and synchronous `setState` in effects cause hydration mismatches and extra renders; `react/no-unescaped-entities` (6) and `prefer-const` (2) are trivial. **Root Cause:** Patterns forbidden by the React 19 compiler rules shipped in `eslint-config-next` 16. **Impact:** Flicker, hydration warnings (masked by `suppressHydrationWarning` on `<html>`/`<body>`), possible stale UI. **Recommended Fix:** Compute time-dependent values in server components or `useState(() => Date.now())`/`useSyncExternalStore`; derive state instead of syncing it in effects; initialise persisted UI state (sidebar collapsed is already a cookie — read it on the server, `app/(app)/layout.tsx:26`, and pass it down). Fix each reported line; then remove `suppressHydrationWarning` from `<body>` and verify no hydration errors in the console. **Dependencies:** With DEBT-001; after FE-001 (template effects disappear). **Verification:** `pnpm lint` shows 0 `react-hooks/*` errors; browser console clean on `/`, `/dashboard`, `/invoices/new`.

### FE-003 — No route-level error, loading or not-found UI

**Severity:** Medium **Location:** only `app/global-error.tsx` exists **Description:** A failing server component takes the whole layout down to the global boundary; there are no `loading.tsx` skeletons for data pages (dashboard, invoices, reports) and no branded 404. **Root Cause:** Not implemented. **Impact:** Poor perceived performance and resilience; users lose context on any error. **Recommended Fix:** Add `app/(app)/error.tsx` (client component with `reset()` + `Sentry.captureException`), `app/(app)/loading.tsx`, `app/(admin)/error.tsx`, `app/not-found.tsx`, and per-route `loading.tsx` for dashboard/invoices/reports/customers/products. Ensure server actions' `ActionResult` errors render inline (already the convention). **Dependencies:** After ARCH-005 (Sentry). **Verification:** Throw in a page in dev → inline boundary with retry, sidebar still visible; navigating shows skeletons.

### FE-004 — Accessibility gaps

**Severity:** Medium **Location:** `invoice-form.tsx:784` (native `confirm()` for the irreversible finalize), `:1115-1130` (drag-and-drop reorder only), `app/layout.tsx` (`colorScheme:'light'`, `suppressHydrationWarning`); modals (`auth-modal`, `upgrade-prompt-modal`, void dialogs); icon-only buttons across tables **Description:** Finalizing (an irreversible statutory action) uses `window.confirm`; line-item reordering has no keyboard/screen-reader alternative; modals need verified focus trap/return and `aria-live` for async results; icon-only controls need accessible names (several already have `aria-label`, audit the rest). *Touch-target sizes of the frozen ERP tokens are intentionally not flagged.* **Root Cause:** Feature-first UI. **Impact:** WCAG 2.2 AA failures (2.1.1, 4.1.2, 2.4.3); legal exposure for B2B buyers with accessibility procurement rules. **Recommended Fix:** Replace `confirm()` with the existing dialog primitive (`@base-ui/react`) that states invoice number format, date, total, and requires an explicit "Finalize" action; add "Move up/down" buttons (`aria-label="Move line item N up"`) beside the drag handle; run `axe` (Playwright `@axe-core/playwright`) on login, dashboard, invoice form, checkout; fix focus-visible styles and contrast. **Dependencies:** After FE-002. **Verification:** Keyboard-only walkthrough of create→reorder→finalize; axe reports 0 serious/critical.

### FE-005 — UPI QR generated by a third-party website

**Severity:** Medium **Location:** `app/(app)/checkout/checkout-form.tsx:289` (`https://api.qrserver.com/v1/create-qr-code/?...data=${encodeURIComponent(upiUrl)}`) **Description:** The payee VPA, amount and note are sent to a third party to render the QR; the QR host can log them, goes down, or (if compromised) return a QR for a different payee. **Root Cause:** Convenience. **Impact:** Privacy leak and a payment-redirect attack surface on the revenue path; also breaks under a CSP (SEC-001). **Recommended Fix:** Generate locally with the `qrcode` package (`QRCode.toDataURL(upiUrl)`) in the client or a server component; keep the QR image `src` as a `data:` URL. **Dependencies:** After ARCH-006. **Verification:** Network tab shows no request to `qrserver.com`; QR scans to the correct UPI intent.

### FE-006 — Metadata, SEO and marketing hygiene

**Severity:** Low **Location:** `app/layout.tsx:25` (`generator: 'v0.app'`), absent `robots.ts`, `sitemap.ts`, `manifest`, OG/Twitter metadata; `components/landing/testimonials-section.tsx`, `social-proof.tsx`, `live-dashboard.tsx:408` (`dangerouslySetInnerHTML` with static strings) **Description:** Generator tag leaks tooling; no crawl/preview metadata; testimonials/social-proof/"live" figures appear to be static marketing content — if they are illustrative, label them so (consumer-protection/ASCI rules); `dangerouslySetInnerHTML` is currently safe (static) but should be replaced by JSX. **Root Cause:** v0 scaffolding. **Impact:** SEO/credibility; minor compliance risk. **Recommended Fix:** Remove `generator`; add `app/robots.ts` (disallow `/admin`, `/api`, app routes), `app/sitemap.ts` (marketing, privacy, terms), `openGraph`/`twitter` metadata, canonical URLs; replace the HTML-string with JSX; confirm every testimonial/metric is real or labelled "sample". **Dependencies:** None. **Verification:** Lighthouse SEO ≥ 95; view-source shows no `generator`.

---

# SECTION 6 — Performance & Scalability

### PERF-001 — No pagination on any list

**Severity:** High **Location:** `lib/actions/invoices/list-invoices.ts:13-28` (no `limit`); same pattern in `lib/actions/{customers/list-customers,products/list-products,credit-notes/list-credit-notes,payments/list-payments}.ts` (no `limit/offset` anywhere in `lib/actions/*/list-*.ts`); client filtering in `app/(app)/invoices/client.tsx` **Description:** Every list loads **all** rows for the business into the RSC payload, and filters client-side. **Root Cause:** MVP assumptions. **Impact:** Page weight and DB time grow linearly; a 10k-invoice business degrades dashboards and invoice screens; Neon compute cost. **Recommended Fix:** Keyset pagination: `where business_id=$1 and (created_at,id) < ($cursor_ts,$cursor_id) order by created_at desc, id desc limit 50`; add server-side search/status filters (use indexes from DB-005, `pg_trgm` GIN on `customers.name`/`invoice_number` for search); URL search params (`?q=&status=&cursor=`) read in the server page; client table becomes presentational with "Next/Previous". Add `max page size 100` in zod. **Dependencies:** After DB-005 and API-001. **Verification:** Seed 50k invoices; list loads < 300 ms server time; EXPLAIN uses the composite index.

### PERF-002 — Report and export memory/time

**Severity:** Medium **Location:** `app/api/reports/export/route.ts:82-152` (workbook built fully in memory with `writeBuffer()`), `lib/actions/reports/get-gstr1-data.ts` (678 lines), `get-itr-data.ts`, `get-sales-by-period.ts` (362), `get-dashboard-stats.ts:126-154` (correlated subqueries per invoice) **Description:** No `maxDuration`; exports for a full FY materialise all rows plus the workbook in memory; dashboard stat queries use per-row subselects against payments and credit notes. **Root Cause:** Straight-line implementation. **Impact:** Timeouts/OOM on large FYs; slow dashboard. **Recommended Fix:** `export const maxDuration = 60` (or higher plan limit); cap range (API-006); stream with `new ExcelJS.stream.xlsx.WorkbookWriter({stream})` or paginate by month; precompute settled amounts with a single grouped join (`left join (select invoice_id, sum(amount_paise) ...) p`) instead of correlated subqueries; consider a materialised monthly summary refreshed after finalize/payment. **Dependencies:** After API-006. **Verification:** Export a 100k-line FY within the time limit and < 512 MB; dashboard query plan has no SubPlan per row.

### PERF-003 — Logo proxied through a function on every request

**Severity:** Medium **Location:** `app/api/business/[id]/logo/route.ts:19-48`, `app/(app)/layout.tsx:62-64` **Description:** Each page view fetches the whole object from S3 through a serverless function (no ETag, no rate limit, public). Cache-Control is `public, max-age=3600` but the URL is stable per business, so changes can take up to an hour (the upload action appends `?t=` only in its own response; `layout.tsx:63` does not). **Root Cause:** Convenience proxy. **Impact:** Function/egress cost and latency; abuse amplification; stale logo. **Recommended Fix:** Serve through a content-addressed URL: `/api/business/${id}/logo?v=${hash(logo_storage_key)}` with `Cache-Control: public, max-age=31536000, immutable`; or redirect (302) to a short-lived signed S3 URL; add `Content-Length`/`ETag` and `X-Content-Type-Options: nosniff`; rate-limit by IP. Remove the dead `.svg` branch (SVG uploads are not allowed). **Dependencies:** After SEC-001/SEC-002. **Verification:** Second view returns 304/disk cache; replacing the logo updates immediately.

### PERF-004 — Duplicate session and DB lookups per request

**Severity:** Medium **Location:** `app/(app)/layout.tsx:18-19,42-53` (`getCurrentAppUser()` → `auth.getSession()` + users query, then `auth.getSession()` again, then a businesses query); `lib/auth/session.ts:7-27`; each action repeats `getCurrentAppUser()` **Description:** A page render performs 2 session lookups + 2-3 queries in the layout before page-level queries; actions again repeat them; `getCurrentAppUser` can also issue an UPDATE (`:23-26`). **Root Cause:** No request-scoped memoization. **Impact:** Added latency (Neon round-trips) on every navigation. **Recommended Fix:** Wrap `requireSession`, `getCurrentAppUser`, and a new `getCurrentBusiness()` in React's `cache()` (request-scoped); fetch user + business in one query (`users` join `businesses`); drop the layout's second `getSession()` (use the first result for the admin check). **Dependencies:** After AUTH-001/AUTH-002 (same functions). **Verification:** Count queries per request with `DEBUG=drizzle` → ≤ 2 for the layout.

### PERF-005 — Oversized client components

**Severity:** Low **Location:** `app/(admin)/admin/admin-console.tsx` (2,063 lines), `components/app/invoices/invoice-form.tsx` (1,634), `app/(app)/checkout/checkout-form.tsx` (1,079), `components/app/app-sidebar.tsx` (840) **Description:** Large `'use client'` files ship all logic to the browser, including admin-only code to non-admin bundles only if imported by shared layouts (admin is a separate route group — good). **Root Cause:** Feature growth in single files. **Impact:** Larger JS payloads, slow hydration on low-end Android devices. **Recommended Fix:** Split by tab/section; `next/dynamic` for heavy panels (charts via `recharts`, admin tabs, invoice template picker); keep tables/read-only parts as server components. Track with `@next/bundle-analyzer`. **Dependencies:** After DEBT-003. **Verification:** First-load JS for `/invoices/new` and `/dashboard` reduced by ≥ 20% in the build output.

---

# SECTION 7 — Security Hardening & Vulnerabilities

### SEC-001 — No security headers / CSP

**Severity:** High **Location:** `next.config.mjs` (no `headers()`), `proxy.ts` **Description:** No HSTS, `X-Content-Type-Options`, clickjacking protection, `Referrer-Policy`, `Permissions-Policy` or CSP. The app renders user-supplied text (descriptions, notes, names) and sends financial data. **Root Cause:** Not configured. **Impact:** Clickjacking of finalize/payment actions, MIME sniffing of uploaded objects, no defense-in-depth against XSS (OWASP A05). **Recommended Fix:** In `next.config.mjs`:

```js
async headers() { return [{ source: '/:path*', headers: [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Content-Security-Policy-Report-Only', value: "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' https://va.vercel-scripts.com; connect-src 'self' https://*.sentry.io https://vitals.vercel-insights.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" },
]}]; }
```

Start CSP in Report-Only, collect violations in Sentry, then enforce (nonce-based `script-src` via `proxy.ts` is the stricter end state). Use `frame-ancestors 'none'` (and `X-Frame-Options: DENY`) everywhere except `/api/*/archival-render`, which is fetched server-side by the PDF vendor (not framed). **Dependencies:** After FE-005 (no third-party QR host). **Verification:** securityheaders.com grade A; app flows work under enforced CSP.

### SEC-002 — Upload validation trusts the client (3 paths)

**Severity:** High **Location:** payment screenshot `lib/actions/subscriptions/submit-payment-claim.ts:88-107` (`screenshot_mime` is any string; extension = `mimeType.split('/')[1]`; no size check on the decoded buffer; `lib/validations/subscription.ts:17-18`); logo `lib/actions/business/upload-logo.ts:13-66` (MIME checked from client value, size checked after decode); feedback `lib/validations/feedback.ts:21-29` + `send-feedback.ts:61-64` (`sizeBytes`/`mimeType` self-reported, filename unsanitised, attached to outbound e-mail) **Description:** A user can upload `text/html` or `image/svg+xml` as a "screenshot" (stored under an attacker-chosen extension), which an admin later opens through a 7-day signed URL (stored XSS/phishing in the admin's browser on the storage origin). Declared size/type are never compared with the bytes. Feedback attachments are relayed to your support inbox with arbitrary content and file names. **Root Cause:** Client metadata treated as truth. **Impact:** Malware/phishing relay to staff, stored XSS, storage abuse (OWASP A04/A08). **Recommended Fix:** Create `lib/security/upload.ts`: `validateImageUpload(base64, {maxBytes, allowed:['image/png','image/jpeg','image/webp']})` that (1) rejects if `base64.length > maxBytes*1.37`, (2) decodes, (3) checks the **magic bytes** (PNG `89 50 4E 47`, JPEG `FF D8 FF`, WEBP `RIFF....WEBP`, PDF `%PDF-` where allowed), (4) returns the server-derived `mime` and `ext`; never use client MIME/extension. Upload with `ContentDisposition: 'attachment'` and `CacheControl`; keys use server-generated UUIDs (not the user-supplied reference). Apply to all three paths; sanitise feedback `filename` to `[A-Za-z0-9._-]{1,80}` with a forced extension. Add a rate limit to logo/screenshot uploads (SEC-005). **Dependencies:** After ARCH-002; before API-012, SEC-003. **Verification:** Upload an HTML file renamed `.png` with `image/png` → rejected; a valid PNG labelled `image/jpeg` is stored as `.png`.

### SEC-003 — Seven-day signed URLs for payment evidence

**Severity:** Medium **Location:** `submit-payment-claim.ts:150-151` (URL e-mailed), `app/(admin)/admin/page.tsx:50` (`getSignedDownloadUrl(key, 604800)`) **Description:** Payment screenshots (PII, bank/UPI details) are reachable by anyone holding the URL for 7 days; the URL is e-mailed and embedded in the page props. **Root Cause:** Long expiry for convenience. **Impact:** Leak window for financial evidence. **Recommended Fix:** Do not e-mail the URL; e-mail only the admin link. Create an admin-only action `getClaimScreenshotUrl({requestId})` (guarded by `requirePlatformAdmin`) returning a 5-minute URL on demand; render images lazily in the console. **Dependencies:** After AUTH-001, SEC-002. **Verification:** Admin page source contains no S3 URL; on-demand URL expires in minutes.

### SEC-004 — Archival token in the URL, replayable

**Severity:** Medium **Location:** `lib/security/archival-token.ts:12-22`; `archive-invoice.ts:26-29`; render routes **Description:** A 10-minute HMAC token in a query string is sent to a third-party renderer (and thus appears in its/your logs). It is replayable until expiry and grants the full HTML of the invoice including bank details. The `SECRET` is read at import (ARCH-002). **Root Cause:** Simple stateless design. **Impact:** Short-lived document disclosure if logs leak. **Recommended Fix:** Reduce TTL to 120 s; embed a random `jti` and enforce single use with `redis.set('archival:'+jti,1,{nx:true,ex:180})` in the render route (reject on conflict). Mark the route `Cache-Control: no-store`, `X-Robots-Tag: noindex`, and `Referrer-Policy: no-referrer`. Add the credit-note route to the same helper (verify it uses the same verifier). **Dependencies:** After API-008. **Verification:** Second request with the same token → 401.

### SEC-005 — Rate-limit coverage and IP trust

**Severity:** Medium **Location:** `lib/rate-limit/upstash.ts:64-72`; actions without `rateLimit` option: `save-invoice-draft`, `create-customer`, `create-product`, `upload-logo`, `remove-logo`, `save-business-profile`, `save-invoice-settings`, `process-request`; route `app/api/business/[id]/logo/route.ts` **Description:** Only finalize/payment/email/feedback/claim are limited. `getClientIp` trusts the first `x-forwarded-for` entry (safe on Vercel, spoofable on other hosts). No fail-open/closed policy. **Root Cause:** Opt-in limiter applied incrementally (ARCHITECTURE.md Phase 17). **Impact:** Storage/DB abuse, cost amplification. **Recommended Fix:** Default a generous limiter (e.g. 120/min/user) inside `createAuthenticatedAction` and let sensitive ones override; use `x-vercel-forwarded-for` / `request.ip` when available; wrap `checkRateLimit` in try/catch implementing the explicit policy; limit the logo route by IP. **Dependencies:** After AUTH-002. **Verification:** Burst 200 draft saves → 429s after the cap; Redis down → policy applies, no crash.

### SEC-006 — Logging without PII scrubbing

**Severity:** Low **Location:** `lib/actions/_shared/logger.ts:3-21` (stack + `meta` to console and Sentry); 45 `console.*` calls across `app/components/lib` **Description:** Unstructured console errors may include customer data; Sentry `extra` is unfiltered. **Root Cause:** No logging standard. **Impact:** PII/financial identifiers in third-party systems (DPDP Act 2023 data-minimisation). **Recommended Fix:** Route all server logging through `logError`/a pino logger with a redaction list (`gstin, email, phone, account, ifsc, utr, token, authorization`); replace `console.error` in actions with `logError`; add the Sentry `beforeSend` from ARCH-005. **Dependencies:** After ARCH-005. **Verification:** Trigger an error containing an e-mail in meta → appears as `[redacted]`.

### SEC-007 — Beta auth dependency with a patched `dist`

**Severity:** Low **Location:** `package.json` (`@neondatabase/auth: 0.4.2-beta`), `patches/@neondatabase__auth.patch`, `pnpm-workspace.yaml` **Description:** Authentication relies on a pre-release library patched in `dist` (wraps `cookieStore.set` in try/catch so `getSession()` works in Server Components; session refresh cookies are therefore not persisted there). `.npmrc` sets `ignore-scripts=false` explicitly; `shadcn` (a CLI) is in `dependencies`. **Root Cause:** Workaround for a library limitation. **Impact:** Upgrade fragility; subtle session-refresh behaviour. **Recommended Fix:** Track the upstream fix and remove the patch; pin exact versions of auth/payment-path libs; move `shadcn` to `devDependencies`; add Dependabot/Renovate and `pnpm audit` in CI; document the patch in README. **Dependencies:** After ARCH-003. **Verification:** `pnpm install --frozen-lockfile` clean; session refresh tested after an idle hour.

---

# SECTION 8 — Dead Code, Wiring & Unused File Cleanup

### CLEAN-001 — Dead code and orphan files

**Severity:** Low **Location / findings (heuristic import scan + greps):**

- `components/app/app-brand-logo.tsx` — not imported anywhere.
- `app/(app)/dev-sentry-test/{page.tsx,actions.ts}` — dev-only route that ships in production builds (guards return 404); `actions.ts:17` duplicate alias `triggerServerActionSentryError`; listed in `proxy.ts` matcher.
- `proxy.ts` matcher `/payments/:path*` — no such route.
- `lib/subscriptions/entitlements.ts`: alias `resolveSubscriptionPlan`; `PLAN_PRICING`/helpers fine; unused flags (see CLEAN-002).
- `app/api/business/[id]/logo/route.ts:38` and archival routes: dead `.svg` branches (SVG uploads are blocked).
- 49 unused imports/variables reported by eslint (e.g. `finalize-invoice.ts:8,11`, `save-invoice-draft.ts:7`, `numbering.ts:4`, `period.ts:1`, `get-all-businesses.ts:8`).
- `tsconfig.tsbuildinfo` committed; `.vscode/settings.json`; `.gitignore` mentions v0 sandbox files.
- `lib/db/seed.ts` is a script (keep; ensure it is excluded from the app bundle — it is referenced only by `db:seed`). **Fix:** Delete the files/aliases above; `pnpm eslint --fix` for unused imports then review; add `tsconfig.tsbuildinfo` to `.gitignore` and `git rm --cached`; remove `/dev-sentry-test` entirely (or gate with `notFound()` in a server `page.tsx` and exclude from matcher). Run `npx knip` to catch what the heuristic missed. **Dependencies:** After DEBT-001 for lint-driven removals; AUTH-005 consumes the matcher cleanup. **Verification:** `pnpm build && pnpm lint` green; `knip` reports no unused files.

### CLEAN-002 — Advertised plan features never enforced

**Severity:** Medium **Location:** `lib/subscriptions/entitlements.ts:60-87,222-253` — `canFinalizeCreditNotes`, `canDirectWhatsApp`, `canBulkImportCsv`, `canAccessCaPortal`, `hasPermanentPdfStorage`, `teamUserLimit` have **zero consumers** outside this file; `components/landing/pricing-section.tsx` and `components/app/settings/billing-tab.tsx` market plan tiers (verify which of these are listed). **Description:** Paying customers may be promised features (team seats, CA portal, bulk CSV import, permanent PDF storage) that do not exist or are not gated, and `canFinalizeCreditNotes` allows free-tier credit-note finalization despite the flag. **Root Cause:** Entitlement model written ahead of features. **Impact:** Misleading-advertising and refund risk; revenue leakage. **Recommended Fix:** Decide per flag: implement-and-enforce, or remove from the pricing copy/billing tab and from the model. Minimum before launch: enforce `canFinalizeCreditNotes` in `finalizeCreditNote` (or delete the flag) and remove unsupported features from marketing. Add a test that every flag has at least one enforcement site (`grep`-based CI check). **Dependencies:** After API-010. **Verification:** Pricing page lists only shipped features; free tier cannot finalize credit notes (if that is the policy).

### CLEAN-003 — Documentation drift

**Severity:** Low **Location:** `ARCHITECTURE.md` (references `lib/actions/_shared/ping.ts`, `lib/db/scripts/`, `BillMatrix_Backend_Roadmap_v1.md` — none exist); `README.md` (clone dir `BM_TS_v2.0.1C`, same missing roadmap, no env/DB/migration/deploy section); `docs/SUBSCRIPTION_MANUAL_VERIFICATION_SCRATCHPAD.md` (scratch notes); `.env.example` has `EMAIL_FROM_ADDRESS/EMAIL_FROM_NAME` that no code reads. **Root Cause:** Docs written phase-by-phase. **Impact:** Misleads future agents/engineers. **Recommended Fix:** Update README (env table, `db:migrate` flow, cron, deploy checklist, how to run tests), remove nonexistent references, move the scratchpad to a wiki/ADR, delete unused env vars. **Dependencies:** After the code issues it describes. **Verification:** A new developer sets up from README alone.

---

# SECTION 9 — Refactoring & Technical Debt

### DEBT-001 — Lint errors and `any`

**Severity:** Medium **Location:** 65 errors: 40× `no-explicit-any` (worst: `admin-console.tsx` 9, `invoice-form.tsx` 7, `app/api/reports/export/route.ts` 4 (`buffer as any`), `billing-tab.tsx` 4, `lib/excel/build-itr-report.ts` 4, login/signup actions `prevState: any`/`err: any`, subscription actions `catch (err: any)`, `archive-invoice.ts:46`) **Description/Impact:** Type holes on money/report paths and catch blocks. **Recommended Fix:** `catch (err: unknown)` + narrowing helpers; type `useActionState` state as `{error?: string} | undefined`; type ExcelJS rows; use `new Response(new Uint8Array(buffer))` instead of `as any`; fix the remaining rules with FE-002. Then make `pnpm lint` a CI gate (ARCH-003) and set `no-explicit-any: error`. **Dependencies:** After ARCH-003; before CLEAN-001 auto-fixes. **Verification:** `pnpm lint` exits 0.

### DEBT-002 — Duplicated settlement, ownership and admin logic

**Severity:** Medium **Location:** net-bill/paid-status computation repeated in `record-payment.ts`, `void-payment.ts`, `finalize-credit-note.ts`, `void-credit-note.ts`, `send-payment-reminder.ts`, `get-dashboard-stats.ts`; paise conversion in 3 draft actions; `select business subset` for entitlements in \~8 actions; admin check ×9 (AUTH-001); `Math.round(grand/100)*100` rounding in `save-invoice-draft.ts:133`, `finalize-invoice.ts:177`, `save-credit-note-draft.ts:184` and client `invoice-form.tsx:501`. **Fix:** Create `lib/invoices/settlement.ts` (`getSettlement(tx, invoiceId) -> {netBillPaise, paidPaise, creditedPaise, status}` and `recomputePaymentStatus`), `lib/gst/rounding.ts` (`roundToRupeePaise`, used by server and client), `lib/actions/_shared/ownership.ts` (API-001), `lib/subscriptions/load.ts` (`getBusinessEntitlements(tx, businessId)`). Replace call sites one file at a time with tests (TEST-001/002) green. **Dependencies:** After API-001/002/003/004; TEST-001. **Verification:** Duplicated blocks gone (`grep`); behaviour tests unchanged.

### DEBT-003 — Mega-components

**Severity:** Low **Location:** see PERF-005. **Fix:** Extract hooks (`useInvoiceTotals`, `useLineItems`), subcomponents (LineItemRow, TotalsPanel, ClaimsTable, UsersTable) and colocated actions; keep ERP-density tokens unchanged. **Dependencies:** After FE-001/FE-002, TEST-003 (E2E protects the refactor). **Verification:** Visual regression (Playwright screenshots) unchanged.

### TEST-001 — Unit tests for money, GST and numbering

**Severity:** High **Location:** `lib/gst/calculate.ts`, `lib/money.ts`, `lib/invoices/{number-format,ist-date,financial-year,status}.ts`, `lib/subscriptions/entitlements.ts`, `lib/pdf/number-to-words.ts`, `lib/gst/thresholds.ts` (new) **Description:** Zero tests on the code that decides legal tax amounts. **Recommended Fix:** Add Vitest. Minimum cases: exclusive/inclusive rounding at 0.5 paise boundaries; intra vs inter-state; discount 100%; 0% / 0.25% / 3% / 28% rates; sum of line taxes = invoice totals; `roundToRupeePaise`; number formats (`{DD}/{MM}/{YY}`, 16-char limit, invalid tokens, FY boundary 31-Mar/1-Apr in IST at 23:59 and 00:00 UTC+5:30); B2CL threshold dates (COMP-002); entitlements for trial-with-null-end, expired, suspended; amount-in-words (lakh/crore, paise). **Dependencies:** After ARCH-003; API-006 helpers. **Verification:** `pnpm test` green in CI; coverage ≥ 90% on `lib/gst`.

### TEST-002 — Integration tests for tenancy, concurrency, flows

**Severity:** High **Location:** `lib/actions/**` **Description:** None of the critical invariants are tested. **Recommended Fix:** Vitest + a real Postgres (Neon branch per CI run or `testcontainers`), calling the action functions with a stubbed `getCurrentAppUser`. Must-have cases: IDOR (API-001), parallel finalize (API-002), parallel payments (API-003), credit-note over-credit (API-004), profile edit keeps settings (API-007), double approval (API-009), quota/trial (API-010), immutability trigger (DB-001), unique GSTIN handling (AUTH-004), no sequence gaps after failure injection. **Dependencies:** After the corresponding fixes (each test is the verification step for its issue). **Verification:** All pass in CI; mutation-check by reverting one fix and seeing a test fail.

### TEST-003 — End-to-end tests

**Severity:** Medium **Location:** new `e2e/` (Playwright) **Recommended Fix:** Flows: signup→verify→business setup→customer→product→draft invoice→finalize (number format)→record payment→credit note→GSTR-1 export (paid plan)→admin approves claim; mobile viewport (375×667) smoke of invoice form, checkout, dashboard; axe checks (FE-004); print layout assertion. **Dependencies:** After FE-001, FE-003; staging env with test mail sink. **Verification:** Green on every PR against a preview deployment.

---

# SECTION 10 — Final Optimization Tasks

### OPT-001 — Health checks, structured logs, alerting

**Severity:** Medium **Location:** new `app/api/health/route.ts`; cron route; Sentry **Description:** No health endpoint, no uptime/cron monitoring, no alert when invoices stay un-archived. **Recommended Fix:** `/api/health` (DB `select 1`, Redis ping; no secrets) for uptime checks; request-id header in `proxy.ts` propagated to logs; Sentry alert rules: new issue, archival `attempts>=5`, cron failure (Sentry Crons monitor wrapping the cron handler), rate-limit outage; a daily job counting `pending` archives > 1 h old. **Dependencies:** After ARCH-005, API-008. **Verification:** Stop Redis in staging → `/api/health` 503 and alert fires.

### OPT-002 — Backup/DR and statutory retention

**Severity:** Medium **Location:** infra (Neon, iDrive e2), `docs/STATUTORY_ARCHIVAL_BLUEPRINT.md` **Description:** Statutory records must be retained for years; there is no documented backup, restore drill, or object immutability. **Recommended Fix:** Enable Neon PITR (≥ 7-30 days) and a weekly logical dump to a separate account; enable bucket **versioning + Object Lock (compliance mode, retention per the blueprint)** on iDrive e2 for `invoices/` and `credit-notes/` prefixes; quarterly restore drill; add "account closure / data export" flow (DPDP Act) that respects retention; publish retention in the privacy page. **Dependencies:** After COMP-001. **Verification:** Restore a PITR branch and a deleted PDF from a prior version.

### OPT-003 — Build and dependency hygiene

**Severity:** Low **Location:** `tsconfig.json` (`target: ES6`), `package.json`, `next.config.mjs` (`images.unoptimized`, `allowedDevOrigins`) **Recommended Fix:** `target: ES2022`; Renovate; `output: 'standalone'` not needed on Vercel; enable `images` optimisation or keep unoptimised only for data URLs; `experimental.serverActions.allowedOrigins` if a proxy/custom domain is used; Node pin consistent (`.nvmrc` 24.18.0 vs `engines >=22`). **Dependencies:** After ARCH-003. **Verification:** `pnpm build` output reviewed; CI green.

---

# PHASE 3 DELIVERABLES

## A. Executive Scores (1–100)

| Metric | Score | Rationale |
| --- | --- | --- |
| Overall Code Health | **62** | Strict TS compiles clean; conventions are documented and mostly followed (action wrapper, zod, paise integers, IST utilities). Dragged down by 65 lint errors, no tests, duplicated logic, mega-components. |
| Production Readiness | **38** | Storage config bug, fake payee fallbacks, missing CI/tests/headers, unreliable archival, race conditions on statutory numbering, migration drift. |
| Security Posture | **42** | Good: session checks in actions, HMAC token with constant-time compare, cron secret fail-closed, server-side pricing for claims, rate limiting on key actions. Bad: cross-tenant IDOR, unverified admin identity, upload trust, no headers, auth API unthrottled. |
| Scalability & Performance | **50** | Serverless Postgres + indexes exist, but no pagination, per-request duplicate lookups, in-memory exports, logo proxy. |
| Maintainability & Cleanliness | **60** | Clear folder rules and small action files; lowered by duplication, doc drift, giant client components, `any`. |

## B. Cleanup Inventory

| Category | Items |
| --- | --- |
| Orphaned files | `components/app/app-brand-logo.tsx`; `tsconfig.tsbuildinfo` (untrack); `docs/SUBSCRIPTION_MANUAL_VERIFICATION_SCRATCHPAD.md` (move out) |
| Dev-only routes | `app/(app)/dev-sentry-test/**` + matcher entry |
| Stale wiring | `proxy.ts` matcher `/payments/:path*`; unused env `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME`; dead `.svg` content-type branches |
| Duplicate code | admin e-mail check ×9; net-bill/payment-status ×6; paise conversion ×3; rounding ×4; entitlement-business select ×8; `export const triggerServerActionSentryError` alias; `resolveSubscriptionPlan` alias |
| Unused vars/imports | 49 eslint warnings (see ARCH `eslint -f json`) |
| Unenforced model | entitlement flags with 0 consumers (CLEAN-002) |
| Docs | ARCHITECTURE/README references to nonexistent files |

## C. Production Readiness Checklist

| Area | Item | Status |
| --- | --- | --- |
| Infrastructure | Object storage config valid with documented env | \[Critical Blocker\] (ARCH-001) |
| Infrastructure | Payee/payment config fails closed | \[Critical Blocker\] (ARCH-006) |
| Infrastructure | Central env validation | \[Needs Attention\] (ARCH-002) |
| Infrastructure | Migrations reproducible / drift-free | \[Needs Attention\] (ARCH-004) |
| Infrastructure | CI/CD, tests, branch protection | \[Needs Attention\] (ARCH-003, TEST-xxx) |
| Infrastructure | Archival reliable on serverless, cron alerts | \[Needs Attention\] (API-008, OPT-001) |
| Infrastructure | Health check, uptime, backups, restore drill | \[Needs Attention\] (OPT-001/002) |
| Data integrity | Tenant isolation | \[Critical Blocker\] (API-001, DB-002) |
| Data integrity | Gapless sequences / no double finalize | \[Critical Blocker\] (API-002) |
| Data integrity | Finalized docs immutable | \[Needs Attention\] (COMP-001, DB-001) |
| Data integrity | Audit trail complete & append-only | \[Needs Attention\] (DB-007) |
| Compliance | GSTR-1 B2CL threshold correct | \[Critical Blocker\] (COMP-002) |
| Compliance | CGST Rule 46/53 number format ≤16 chars, FY reset | \[Done\] |
| Compliance | Credit notes bound to original invoice | \[Needs Attention\] (API-004) |
| Compliance | Retention / Object Lock | \[Needs Attention\] (OPT-002) |
| Compliance | DPDP data-subject flows | \[Needs Attention\] (OPT-002) |
| Security | AuthN session checks in actions | \[Done\] |
| Security | Admin identity verified | \[Critical Blocker\] (AUTH-001) |
| Security | Auth endpoint rate limiting | \[Needs Attention\] (AUTH-002) |
| Security | Headers / CSP | \[Needs Attention\] (SEC-001) |
| Security | Upload validation | \[Needs Attention\] (SEC-002) |
| Security | Cron endpoint auth | \[Done\] (constant-time, fail-closed) |
| Security | Server-side pricing for subscription claims | \[Done\] |
| Monitoring | Sentry client+server | \[Done\] (improve: ARCH-005) |
| Monitoring | PII-scrubbed structured logging | \[Needs Attention\] (SEC-006) |
| Quality | Strict TypeScript compile | \[Done\] |
| Quality | Lint clean | \[Needs Attention\] (DEBT-001) |
| Quality | Accessibility, error/loading states | \[Needs Attention\] (FE-003/004) |
| Quality | Cross-device (mobile) layout | \[Needs Attention\] (sampled only; run TEST-003 mobile pass) |

## D. Prioritized Phased Action Plan

**Phase 1 — Critical Blockers (before launch)** Execution Chain: `ARCH-001 -> ARCH-006 -> ARCH-002 -> ARCH-004 -> ARCH-003 -> DB-001 -> DB-002 -> API-001 -> API-002 -> API-003 -> API-004 -> COMP-001 -> COMP-002 -> API-007 -> API-009 -> AUTH-001 -> AUTH-002 -> SEC-002 -> SEC-001` (Note: run DB-002's `VALIDATE CONSTRAINT` step after API-001 is deployed; API-009 needs DB-004/DB-005 migrations from Phase 2 for the CHECK/partial-index parts — do the code guard first and add those constraints in Phase 2.)

**Phase 2 — High Priority (first sprint after launch)** Execution Chain: `ARCH-005 -> DB-003 -> DB-004 -> DB-005 -> DB-006 -> DB-007 -> API-005 -> API-006 -> API-008 -> API-010 -> COMP-003 -> API-011 -> AUTH-003 -> AUTH-004 -> FE-001 -> FE-003 -> PERF-001 -> SEC-003 -> SEC-004 -> SEC-005 -> TEST-001 -> TEST-002 -> TEST-003`

**Phase 3 — Important Improvements (technical-debt reduction)** Execution Chain: `DB-008 -> API-012 -> AUTH-005 -> FE-002 -> FE-004 -> FE-005 -> PERF-002 -> PERF-003 -> PERF-004 -> SEC-006 -> SEC-007 -> CLEAN-002 -> DEBT-001 -> DEBT-002 -> DEBT-003`

**Phase 4 — Optimization & Cleanup** Execution Chain: `CLEAN-001 -> CLEAN-003 -> FE-006 -> PERF-005 -> OPT-001 -> OPT-002 -> OPT-003`

**Sequencing notes:** (1) API-005/API-006 are listed in Phase 2 but their helper modules (`common.ts`, money helper) are prerequisites for API-003 — create only the helper functions during API-003 and finish the remaining validation work in API-006. (2) TEST-002 cases are written alongside each Phase-1 fix (each issue's Verification section); the Phase-2 item completes the suite and wires it to CI. (3) After every phase run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
