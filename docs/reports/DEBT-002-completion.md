# DEBT-002: Duplicated Settlement, Rounding, and Plan-Field Logic Consolidation

## Executive Summary
This refactor consolidates three categories of duplicated business and presentation logic across the Bill Matrix codebase without altering any runtime numbers, displayed values, or database schema:
1. **Client-Safe Settlement & Payment Calculations**: Extracted pure, dependency-free settlement logic (`computeNetBillPaise`, `computePaymentStatus`, `sumActiveCreditedPaise`, `sumActivePaidPaise`, `summarizeSettlement`) into a new client-safe module (`lib/invoices/settlement.ts`). Replaced manual inline implementations across invoice details, payment recording, credit note views, and reports.
2. **Whole Rupee Rounding**: Centralized `roundToRupeePaise` in `lib/money.ts` and re-exported it from `lib/credit-notes/derivation.ts` for backward compatibility. Replaced hand-rolled `Math.round(paise / 100) * 100` calculations in `invoice-form.tsx` and unified server action imports.
3. **Plan Source Column Selection**: Created `lib/subscriptions/load.ts` exporting `PLAN_SOURCE_COLUMNS`, ensuring queries selecting business records to feed `getPlanEntitlements` / `checkAccountNotSuspended` consistently include all four required columns (`subscription_plan`, `subscription_status`, `trial_ends_at`, `subscription_ends_at`).

---

## Audit Duplication State

### Previously Consolidated (Prior Milestones)
- **Server-Side Transactional Settlement**: `loadInvoiceBalance` and `recomputePaymentStatus` were already consolidated in `lib/invoices/payment-status.ts` for server actions (`email-claim-tx.ts`, `finalize-credit-note-tx.ts`, `payment-tx.ts`, `void-credit-note-tx.ts`).
- **Platform Admin Checks**: Consolidated via `createAuthenticatedAction` and platform admin guards in `AUTH-001` / `AUTH-003`.
- **Tenant & Customer Ownership Guards**: Consolidated in `lib/actions/_shared/ownership.ts` under `API-001`.

### Consolidated in DEBT-002
- Client-side credit note filtering and payment summing across UI components.
- Unclamped `balanceDue` and `settlementPercentage` calculations.
- Net bill calculation in `credit-note-detail.tsx`, `credit-note-form.tsx`, and `get-itr-data.ts`.
- Rupee rounding in `components/app/invoices/invoice-form.tsx`.
- Subscription plan columns in `app/api/reports/export/route.ts`, `subscription-guard.ts`, `upload-logo.ts`, and `send-guards.ts`.

---

## Call Sites: Before vs. After

### 1. `components/app/invoices/invoice-detail.tsx`
- **Before**: Hand-rolled `.filter` for finalized/active credit notes, manual `.reduce` sum, manual `Math.max(0, grand_total - credited)`, manual `.filter` and `.reduce` on payments, manual `balanceDue` and `settlementPercentage`.
- **After**:
  ```ts
  const totalCreditedPaise = sumActiveCreditedPaise(creditNotes)
  const settlement = summarizeSettlement({
    grandTotalPaise: invoice.grand_total_paise,
    totalCreditedPaise,
    activePaidPaise: sumActivePaidPaise(payments),
  })
  const netBillPaise = settlement.netBillPaise
  const activePayments = payments.filter(p => (p.status || 'active') === 'active')
  const existingSum = settlement.activePaidPaise
  const balanceDue = settlement.balanceDuePaise
  const settlementPercentage = settlement.settledPercent
  ```

### 2. `components/app/invoices/payment-section.tsx`
- **Before**: Hand-rolled credited amount casting, manual `Math.max(0, grand_total - credited)`, manual `.reduce` on payments, manual `balanceDue` calculation.
- **After**:
  ```ts
  const settlement = summarizeSettlement({
    grandTotalPaise: invoice.grand_total_paise,
    totalCreditedPaise: Number(totalCreditedPaise || 0),
    activePaidPaise: sumActivePaidPaise(payments),
  });
  const creditedPaise = settlement.totalCreditedPaise;
  const existingSum = settlement.activePaidPaise;
  const balanceDue = settlement.balanceDuePaise;
  const balanceDueRupees = paiseToRupees(balanceDue > 0 ? balanceDue : 0);
  ```

### 3. `components/app/credit-notes/credit-note-detail.tsx`
- **Before**: `const netAdjustedBillPaise = Math.max(0, originalBillPaise - totalCreditedForInvoicePaise);`
- **After**: `const netAdjustedBillPaise = computeNetBillPaise(originalBillPaise, totalCreditedForInvoicePaise);`

### 4. `components/app/credit-notes/credit-note-form.tsx`
- **Before**: `const netAdjustedBalancePaise = Math.max(0, originalInvoice.grand_total_paise - totalCumulativeCreditedPaise);`
- **After**: `const netAdjustedBalancePaise = computeNetBillPaise(originalInvoice.grand_total_paise, totalCumulativeCreditedPaise);`

### 5. `lib/actions/reports/get-itr-data.ts`
- **Before**:
  - Line ~313: `const netGrandTotal = Math.max(0, inv.grand_total_paise - (cnForInv?.grandTotalPaise || 0));`
  - Line ~402: `entry.grand_total_paise = Math.max(0, entry.grand_total_paise - cn.grand_total_paise);`
- **After**:
  - Line 314: `const netGrandTotal = computeNetBillPaise(inv.grand_total_paise, cnForInv?.grandTotalPaise || 0);`
  - Line 403: `entry.grand_total_paise = computeNetBillPaise(entry.grand_total_paise, cn.grand_total_paise);`

### 6. `components/app/invoices/invoice-form.tsx`
- **Before**:
  - Line ~527: `const roundedGrandTotalPaise = Math.round(rawTotalAmountPaise / 100) * 100`
  - Line ~773: `grand_total_paise: Math.round(previewTaxResult.grandTotalPaise / 100) * 100,`
- **After**:
  - Line 528: `const roundedGrandTotalPaise = roundToRupeePaise(rawTotalAmountPaise)`
  - Line 774: `grand_total_paise: roundToRupeePaise(previewTaxResult.grandTotalPaise),`

### 7. Plan Source Select Queries
In `app/api/reports/export/route.ts`, `lib/actions/_shared/subscription-guard.ts`, `lib/actions/business/upload-logo.ts`, and `lib/email/send-guards.ts`:
- **Before**: Explicitly listing `subscription_plan: businesses.subscription_plan, subscription_status: ..., trial_ends_at: ..., subscription_ends_at: ...`
- **After**: `...PLAN_SOURCE_COLUMNS` from `@/lib/subscriptions/load`.

---

## New Modules

1. **`lib/invoices/settlement.ts`**: Pure, client-safe module containing:
   - `PaymentStatus` type
   - `computeNetBillPaise`
   - `computePaymentStatus`
   - `CreditNoteLike`, `PaymentLike` interfaces
   - `sumActiveCreditedPaise`
   - `sumActivePaidPaise`
   - `SettlementSummary` interface
   - `summarizeSettlement`
2. **`lib/subscriptions/load.ts`**: Server-only helper exporting `PLAN_SOURCE_COLUMNS`.

---

## Tests and Verification

### New Tests
- **`tests/unit/settlement.test.ts`**:
  - 500-iteration equivalence property test with seeded LCG verifying exact parity between legacy inline formulas and `summarizeSettlement` / `sumActiveCreditedPaise` / `sumActivePaidPaise` across randomized grand totals, credit note amounts/lifecycle/status, and payment amounts/status.
  - Edge cases: 0 net bill, overpayments, credit notes > invoice total, voided/draft exclusion.
  - Architectural check: `lib/invoices/settlement.ts` contains no Drizzle or DB imports; `lib/invoices/payment-status.ts` re-exports the exact functions.
- **`tests/unit/money.test.ts`**: Extended with boundary checks (0, 49, 50, 149, 150, 12345, 99999950) for `roundToRupeePaise` and verified identity with `derivation.ts` re-export.
- **`tests/unit/debt002-guards.test.ts`**:
  - Guard 1: No `.ts`/`.tsx` under `app/`, `components/`, `lib/` except `lib/money.ts` contains `Math.round(... / 100) * 100`.
  - Guard 2: No target file contains hand-rolled `Math.max(0, ...grand_total_paise)` or `Math.max(0, original...)`.
  - Guard 3: The 4 plan-source files import `PLAN_SOURCE_COLUMNS` and no longer list `subscription_plan: businesses.subscription_plan`.

---

## Real Verify Output Tails

### `pnpm typecheck`
```
$ tsc --noEmit
(clean exit 0)
```

### `pnpm lint:ratchet`
```
$ tsx scripts/ci/lint-ratchet.ts
ESLint now:      0 errors, 1 warnings
Baseline allows: 0 errors, 1 warnings

PASS (at baseline).
```

### `pnpm exec vitest run`
```
 Test Files  169 passed | 4 skipped (173)
      Tests  1389 passed | 12 skipped | 4 todo (1405)
   Duration  91.29s
```

### `pnpm build`
```
▲ Next.js 16.4.5 (Turbopack)
- Environments: .env.local
✓ Running next.config.mjs took 1011ms
✓ Compiled successfully in 10.1s
✓ Completed runAfterProductionCompile in 756ms
  Running TypeScript ...
  Finished TypeScript in 27.0s ...
✓ Generating static pages using 15 workers (7/7) in 947ms
  Finalizing page optimization ...
(clean exit 0)
```

### `pnpm print-css:build ; git diff --stat lib/pdf/print-stylesheet.generated.ts`
```
$ tsx scripts/build-print-css.ts
Successfully generated lib/pdf/print-stylesheet.generated.ts (223120 bytes).
(0 diff)
```

### `git status ; git diff --stat`
```
On branch fix/debt-002-shared-helpers
Changes not staged for commit:
	modified:   app/api/reports/export/route.ts
	modified:   components/app/credit-notes/credit-note-detail.tsx
	modified:   components/app/credit-notes/credit-note-form.tsx
	modified:   components/app/invoices/invoice-detail.tsx
	modified:   components/app/invoices/invoice-form.tsx
	modified:   components/app/invoices/payment-section.tsx
	modified:   lib/actions/_shared/subscription-guard.ts
	modified:   lib/actions/business/upload-logo.ts
	modified:   lib/actions/invoices/save-invoice-draft.ts
	modified:   lib/actions/reports/get-itr-data.ts
	modified:   lib/credit-notes/derivation.ts
	modified:   lib/email/send-guards.ts
	modified:   lib/invoices/finalize-invoice-tx.ts
	modified:   lib/invoices/payment-status.ts
	modified:   lib/invoices/place-of-supply.ts
	modified:   lib/money.ts
	modified:   tests/unit/money.test.ts

Untracked files:
	docs/reports/DEBT-002-completion.md
	lib/invoices/settlement.ts
	lib/subscriptions/load.ts
	tests/unit/debt002-guards.test.ts
	tests/unit/settlement.test.ts

 17 files changed, 59 insertions(+), 54 deletions(-)
```

---

## Open Questions & Notes
- None. All calculations are strictly invariant with previous production behavior.
- Suggested commit message: `refactor(money): DEBT-002 shared client-safe settlement helpers, single rupee rounding, shared plan-source columns`


---

## Reviewer verification (Claude Code, 2026-11-09)

Verified on branch `fix/debt-002-shared-helpers` against `main` `71badf9`; every changed file was read. **No reviewer code changes were needed.**

- **Helpers match the spec exactly:** `lib/invoices/settlement.ts` is import-free; `computeNetBillPaise` / `computePaymentStatus` moved verbatim and are re-exported by `payment-status.ts` (server importers unchanged); `sumActiveCreditedPaise` (finalized AND active) and `sumActivePaidPaise` (active) keep the screens' `(status || 'active')` defaults; `summarizeSettlement` keeps `balanceDuePaise` unclamped and the same `settledPercent` formula. `roundToRupeePaise` now lives in `lib/money.ts` and is re-exported from `lib/credit-notes/derivation.ts`. `PLAN_SOURCE_COLUMNS` (`lib/subscriptions/load.ts`) is spread into the 4 entitlement queries with their extra fields / where / limit / locks unchanged.
- **Call sites:** invoice-detail, payment-section, credit-note-detail, credit-note-form, get-itr-data and invoice-form (both roundings) are straight substitutions with the same inputs.
- **Equivalence test is real (mutation check):** changing `settledPercent` from `Math.round` to `Math.floor` makes the 500-case property test fail immediately. Changing the credit-note rule from `=== 'active'` to `!== 'voided'` is (correctly) not detected because `credit_notes.status` is CHECK-constrained to `active | voided` (DB-004), so the two rules are identical in practice.
- **Checks (local):** `pnpm typecheck` clean; `pnpm lint:ratchet` = baseline 0/1; `pnpm exec vitest run` 169 files passed, 4 skipped (1389 tests); `pnpm build` OK; print stylesheet unchanged.

### Preview verification (Vercel preview of PR #25, 2026-11-09)

- **CI:** all 7 checks green on `819ee27` (CI E2E now also runs the archival check).
- **Local E2E with `E2E_EXPECT_ARCHIVAL=true`:**
  - Run 1: Step 4's **on-screen oracle totals (taxable, CGST, SGST, grand total) all matched**; the run then timed out in `saveDraft()` because `page.waitForURL(...)` waits for the `load` event by default. The trace shows the save POST took 0.93 s and the client-side navigation to the new invoice finished by ~1.5 s — the same local-only browser `load` stall seen in earlier local runs, not an app delay.
  - Run 2: **22 passed, 1 skipped (mailbox)** — oracle totals, partial payment, credit note, settle-to-zero balance and GSTR-1 export all green, plus the archival wait.
- **Hydration probe:** 0 errors on all 8 pages; sidebar 68 / 220 / 68 px at 800 px.
- **Follow-up (test-only, separate task):** E2E page objects should not wait for the browser `load` event (`page.goto` / `waitForURL` default) — wait for `commit`/`domcontentloaded` plus a visible UI assertion instead, to remove the recurring local flake.
