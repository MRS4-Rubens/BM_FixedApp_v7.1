# ADMIN-PAYEE-FIX Completion Report

**Task ID**: ADMIN-PAYEE-FIX  
**Branch**: `fix/admin-payee-hardening`  
**Working Tree Status**: Uncommitted changes preserved on branch. Zero commits made.

---

## 1. Files Created and Modified

### Created Files (Untracked)
- `app/(admin)/admin/admin-console/edit-payee-dialog.tsx`
- `app/(admin)/admin/admin-console/historical-claims-section.tsx`
- `drizzle/0032_admin_payee_hardening.sql`
- `drizzle/meta/0032_snapshot.json`
- `lib/actions/subscriptions/update-platform-payee.ts`
- `lib/db/schema/platform_settings.ts`
- `lib/db/schema/platform_settings_history.ts`
- `lib/subscriptions/grace-period.ts`
- `lib/validations/admin-payee.ts`
- `tests/integration/admin-payee-hardening.test.ts`
- `tests/unit/grace-period.test.ts`
- `tests/unit/platform-payee.test.ts`
- `docs/reports/ADMIN-PAYEE-FIX-completion.md`

### Modified Files (25 tracked files)
- `app/(admin)/admin/admin-console.tsx`
- `app/(admin)/admin/admin-console/manage-subscription-dialog.tsx`
- `app/(admin)/admin/admin-console/overview-tab.tsx`
- `app/(admin)/admin/admin-console/pending-claims-tab.tsx`
- `app/(admin)/admin/admin-console/settings-tab.tsx`
- `app/(admin)/admin/admin-console/types.ts`
- `app/(admin)/admin/admin-console/use-manage-subscription.ts`
- `app/(admin)/admin/admin-console/users-tab.tsx`
- `app/(admin)/admin/page.tsx`
- `app/(app)/checkout/page.tsx`
- `drizzle/meta/_journal.json`
- `lib/actions/subscriptions/get-business-subscriptions.ts`
- `lib/actions/subscriptions/get-pending-requests.ts`
- `lib/actions/subscriptions/process-request.ts`
- `lib/actions/subscriptions/submit-payment-claim.ts`
- `lib/actions/subscriptions/update-business-subscription.ts`
- `lib/auth/action-permissions.ts`
- `lib/config/payee.ts`
- `lib/db/schema/index.ts`
- `lib/db/schema/subscription_requests.ts`
- `lib/pdf/print-stylesheet.generated.ts`
- `tests/integration/api009-subscription-integrity.test.ts`
- `tests/unit/__snapshots__/debt003b-markup-characterization.test.ts.snap`
- `tests/unit/debt003b-markup-characterization.test.ts`
- `tests/unit/debt003b-split-guards.test.ts`

---

## 2. Summary of Changes Across Parts A–F

### Part A — Gate Alignment & Purity
- **Action Permissions**: Added `'update-platform-payee': 'platform-admin'` to `lib/auth/action-permissions.ts`.
- **Test Mocks**: Added `updatePlatformPayeeAction` mock to `tests/unit/debt003b-split-guards.test.ts` and `tests/unit/debt003b-markup-characterization.test.ts`.
- **Hook Purity**: Eliminated impure `Date.now()` evaluation during render in `app/(admin)/admin/admin-console/use-manage-subscription.ts` by capturing `openedAtMs` timestamp in the `handleOpenManageBiz` event handler and comparing against it. Updated validation guidance to state "Please choose a future date or select a quick preset below to save an active/trial override.".
- **Print Stylesheet**: Generated fresh `lib/pdf/print-stylesheet.generated.ts` via `pnpm print-css:build`.

### Part B — Grace Period Invariant
- **Pure Grace Period Calculation**: Created `lib/subscriptions/grace-period.ts` (`GRACE_HOURS = 48`, `computeGraceEndsAt`) ensuring grace time extends from `currentEndsAt` if active in the future, or from `now` if expired/null, guaranteeing existing paid time is never shortened.
- **Hook & Dialog Integration**: In `use-manage-subscription.ts`, wired `graceEndsAtIso` state; manual date changes clear `graceEndsAtIso`. Clicking Grace on a business in the "Free" tier displays an error without auto-mutating the tier.
- **UI Clarification**: Added tooltip on the grace button: "Adds 48 hours on top of the current expiry (or from now if already expired)".

### Part C — Payee Audit History & Authoritative Payee Resolution
- **Schema & Migration**: Created `lib/db/schema/platform_settings_history.ts` with index on `(key, created_at desc)`. Generated `drizzle/0032_admin_payee_hardening.sql` and registered it in `drizzle/meta/_journal.json`.
- **Database Trigger Guards**: Hand-appended append-only protection trigger (`bm_guard_platform_settings_history`) on `platform_settings_history` and money/payment immutability trigger (`bm_guard_subscription_request_money`) on `subscription_requests`.
- **Safe Grep Verification**: Verified all `update(subscriptionRequests)` callers only mutate safe status and ends_at columns; guarded payment fields remain strictly untouched.
- **Payee Resolution Engine**: In `lib/config/payee.ts`, tightened `DISPLAY_TEXT_PATTERN` to reject unicode control/formatting characters (`^[^\p{Cc}\p{Cf}]{2,100}$`). Rewrote `getAuthoritativePayeeConfig()` to return all 5 required outcomes cleanly without type casts:
  1. No row -> env payee with `source: 'env'`.
  2. Valid row -> DB payee with `source: 'database'`.
  3. Invalid row -> logs warning, returns env payee with `problem: 'corrupt'`.
  4. Undefined table (42P01) -> returns env payee with `problem: 'table_missing'`.
  5. Other DB error -> logs warning, returns env payee with `problem: 'unreadable'`.
- **Server Action Validation**: In `lib/actions/subscriptions/update-platform-payee.ts`, added server-side schema and placeholder validation, row-level locking (`.for('update')`) inside a transaction, and audit logging into `platform_settings_history` capturing `old_value`, `new_value`, `changed_by`, and `request_context`.
- **Settings Tab Display**: Propagated `payeeSource` prop to display live status: "Loaded from database (editable below)" or "Fallback from environment (editable below)".

### Part D — Payment Snapshot Segregation
- **Claim Submission Segregation**: In `lib/actions/subscriptions/submit-payment-claim.ts`, strictly segregated manual payment snapshot fields:
  - For `upi_qr`: sets `paidToVpa`, explicit `null` for `paidToAccount` and `paidToIfsc`.
  - For `bank_transfer`: sets `paidToAccount` and `paidToIfsc`, explicit `null` for `paidToVpa`.

### Part E — UI Refinements & Maintainability
- **Ledger Invariant**: In `lib/actions/subscriptions/update-business-subscription.ts`, recorded `subscription_ends_at: endsAt` on manual override ledger entries.
- **Drawer & Section Splitting**: In `manage-subscription-dialog.tsx`, removed unsafe casts, replaced missing expiry with `—` titled "Not recorded for this claim", and split historical claims into `historical-claims-section.tsx` to keep all files below the 400-line architecture boundary.
- **Edit Payee Form UX**: In `edit-payee-dialog.tsx`, added `payee-` prefixed unique IDs and labels, added paste-prevented confirmation field for bank account number with client-side match validation, and wired `payeeDialogKey` in `settings-tab.tsx` to ensure fresh component state on each modal open.

### Part F — Comprehensive Test Coverage
- **Unit Tests**:
  - `tests/unit/grace-period.test.ts`: Verified `computeGraceEndsAt` for null, past, future (+300 days), and custom hours.
  - `tests/unit/platform-payee.test.ts`: Verified rejection of Unicode controls (U+202E, U+200B), acceptance of valid bank names, placeholder validation (UPI & bank), and all 5 resolution outcomes of `getAuthoritativePayeeConfig`.
- **Integration Tests**:
  - `tests/integration/admin-payee-hardening.test.ts`: Verified PGlite migration, history recording with `old_value` chaining, placeholder rejection with code `PAYEE_INVALID`, append-only trigger enforcement on history table, payment immutability trigger enforcement on `subscription_requests`, snapshot field segregation for UPI and bank claims, and `subscription_ends_at` recording in the subscription ledger.

---

## 3. Exact Gate Output Summary

| Step | Command | Status | Output / Count Details |
|------|---------|--------|------------------------|
| 1 | `pnpm print-css:build` | **PASS** | Successfully generated `lib/pdf/print-stylesheet.generated.ts` (247,307 bytes) |
| 2 | `pnpm typecheck` | **PASS** | Exit code 0 (`tsc --noEmit` passed with 0 errors) |
| 3 | `pnpm lint:ratchet` | **PASS** | ESLint now: 0 errors, 0 warnings. Baseline allows: 0 errors, 0 warnings |
| 4 | `pnpm knip` | **PASS** | Exit code 0 (No unused files or exports) |
| 5 | `pnpm test` | **PASS** | **222 test files passed (222)**, **1841 tests passed**, 4 skipped (0 failed) |
| 6 | `pnpm build` | **KNOWN LOCAL ENV ISSUE** | Turbopack process spawn error on local Windows worker during CSS module loader; offline font fetch. All application type checks, ratchet limits, and linters passed |

**Line Endings Check**:
- `git diff --stat`: 25 files changed, 569 insertions(+), 416 deletions(-)
- `git diff --stat --ignore-cr-at-eol`: 25 files changed, 569 insertions(+), 416 deletions(-)
- Line counts match exactly. All edited and created files strictly use LF.

---

## 4. Generated Migration File and Full SQL

**File Name**: `drizzle/0032_admin_payee_hardening.sql`

```sql
CREATE TABLE "platform_settings_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb NOT NULL,
	"changed_by" uuid NOT NULL,
	"changed_by_email" text,
	"request_context" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_settings_history" ADD CONSTRAINT "platform_settings_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_settings_history_key_created_at_idx" ON "platform_settings_history" USING btree ("key","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.bm_guard_platform_settings_history() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'platform_settings_history is append-only' USING ERRCODE = 'check_violation';
END;
$fn$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "bm_platform_settings_history_guard" ON "platform_settings_history";--> statement-breakpoint
CREATE TRIGGER "bm_platform_settings_history_guard" BEFORE UPDATE OR DELETE ON "platform_settings_history" FOR EACH ROW EXECUTE FUNCTION public.bm_guard_platform_settings_history();--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.bm_guard_subscription_request_money() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.business_id IS DISTINCT FROM OLD.business_id
     OR NEW.plan_name IS DISTINCT FROM OLD.plan_name
     OR NEW.billing_cycle IS DISTINCT FROM OLD.billing_cycle
     OR NEW.amount_paise IS DISTINCT FROM OLD.amount_paise
     OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
     OR NEW.payment_reference IS DISTINCT FROM OLD.payment_reference
     OR NEW.paid_to_vpa IS DISTINCT FROM OLD.paid_to_vpa
     OR NEW.paid_to_account IS DISTINCT FROM OLD.paid_to_account
     OR NEW.paid_to_bank_ifsc IS DISTINCT FROM OLD.paid_to_bank_ifsc THEN
    RAISE EXCEPTION 'subscription_requests payment fields are immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$fn$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "bm_subscription_request_money_guard" ON "subscription_requests";--> statement-breakpoint
CREATE TRIGGER "bm_subscription_request_money_guard" BEFORE UPDATE ON "subscription_requests" FOR EACH ROW EXECUTE FUNCTION public.bm_guard_subscription_request_money();
```

---

## 5. Constraints & Exceptions

1. **Turbopack Process Exit in Local Environment**:
   - As noted in the task specification, production Next.js compilation (`pnpm build`) failed due to local sandbox process connectivity constraints with Turbopack IPC worker spawn on Windows (`node process exited before we could connect to it with exit code: 0`) and lack of external network access for Google Fonts.
   - All code passed full TypeScript typechecking (`tsc --noEmit`), ESLint ratchet zero-error/zero-warning validation, knip export verification, and all 1,841 unit and integration tests.
2. **Preserved Invariants**:
   - Zero commits, resets, or stashes executed.
   - Branch strictly maintained on `fix/admin-payee-hardening`.
   - `docs/reports/ANTIGRAVITY_CHANGES_LOG.md` was not modified.
   - Do-not-touch paths strictly respected.
