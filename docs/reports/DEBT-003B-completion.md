# Phase 3: Issue DEBT-003 PART B — Mega-Component Decomposition & Admin Alert Accessibility Report

**Date**: 2026-11-09  
**Branch**: `fix/debt-003b-console-splits`  
**Status**: Completed  
**All Changes**: UNCOMMITTED  

---

## 1. Executive Summary & Objective

Phase 3, Issue **DEBT-003 Part B** decomposed the remaining three "mega-components" in the Bill Matrix application into modular, highly cohesive, single-responsibility files without altering runtime behaviour, styling, DOM structure, or layout:
1. `app/(admin)/admin/admin-console.tsx` (2,294 lines -> 251 lines)
2. `components/app/settings/billing-tab.tsx` (1,107 lines -> 124 lines)
3. `components/app/app-sidebar.tsx` (860 lines -> 135 lines)

In addition, the 4 blocking browser `alert()` dialogs in the admin console were replaced with accessible inline error notifications (`role="alert"`), respecting the design system with zero print CSS regressions.

---

## 2. Baseline Verification (Step 0)

| Metric | Baseline Value | Target | Status |
|---|---|---|---|
| `pnpm typecheck` | 0 errors | 0 errors | Pass |
| `pnpm lint:ratchet` | 0 errors / 0 warnings | 0 errors / 0 warnings | Pass |
| `pnpm print-css:build` diff | 0 bytes / 0 lines diff | 0 diff | Pass |
| `admin-console.tsx` lines | 2,294 lines | <= 350 lines | Pass (251) |
| `billing-tab.tsx` lines | 1,107 lines | <= 300 lines | Pass (124) |
| `app-sidebar.tsx` lines | 860 lines | <= 300 lines | Pass (135) |

---

## 3. Characterization Snapshot (Step 1)

Created characterization test suite `tests/unit/debt003b-markup-characterization.test.ts` covering 16 states across the three target components before making any modifications:

- **AdminConsole**:
  - `(a)` Overview tab
  - `(b)` Overview tab with payeeConfigIssue ('UPI ID missing') and upiConfig null
  - `(c)` Pending claims tab (with 2 claims)
  - `(d)` Pending claims tab (with 0 claims)
  - `(e)` Businesses tab (with 9 businesses across pages)
  - `(f)` Users tab (with 9 users across pages)
  - `(g)` Settings tab
- **BillingTab**:
  - `(h)` Trial business, no subscription history
  - `(i)` Active essentials with 9 history items (approved, pending, rejected)
  - `(j)` Expired subscription
  - `(k)` Free plan
  - `(l)` Expiring in 3 days
  - `(m)` Business null
- **AppSidebar**:
  - `(n)` Pathname `/dashboard`, collapsedPreference false, owner user, trial subscription with endsAt
  - `(o)` CollapsedPreference true
  - `(p)` CollapsedPreference null, isAdminUser true, businessLogoUrl set, active essentials

### Snapshot Hash Verification:
- **Step 1 Frozen SHA-256**: `16eb433a18302b203854c96815604727a17455230ef2ad785fa9bed1d409faf9`
- **Final SHA-256**: `16eb433a18302b203854c96815604727a17455230ef2ad785fa9bed1d409faf9`
- **Integrity Result**: Exact 100% match. The `.snap` file was never edited or updated (`vitest -u` was never run).

### ID Normalisation:
Dynamic React 19 `useId` and Recharts clip identifiers were normalised prior to assertion:
- React `useId`: `/«r[0-9a-z]+»|:r[0-9a-z]+:|_r_[0-9a-z]+_|_R_[0-9a-zA-Z]+_/g` -> `"rid-N"` (e.g., `:r0:` -> `rid-1`)
- Recharts identifiers: `/recharts\d+-[a-zA-Z0-9-]+/g` -> `"recharts-N"` (e.g., `recharts1-clip` -> `recharts-1`)

---

## 4. Retargeted Source-Guard Tests (Step 2)

Existing unit guard tests were retargeted to use `readComponentSources` or `listComponentSourceFiles` from `tests/helpers/component-sources.ts`:
1. `tests/unit/clean-sweep-guards.test.ts`:
   - Test 8 (admin console) retargeted to `readComponentSources('app/(admin)/admin/admin-console.tsx')`.
   - Test 9 (billing tab) retargeted to `readComponentSources('components/app/settings/billing-tab.tsx')`.
2. `tests/unit/clean002-flag-enforcement.test.ts`:
   - Target files for billing-tab and app-sidebar iterate across `listComponentSourceFiles(...)`.
3. `tests/unit/plan-catalog.test.ts`:
   - Both billing-tab usages iterate across `listComponentSourceFiles(...)`.
4. `tests/unit/debt001-type-guards.test.ts`:
   - Test 3 for billing-tab checks combined sources (`readComponentSources`) for `import type {...} from '@/lib/db/schema'`.

---

## 5. File Decomposition & Line Count Map (Step 3)

### 5.1 Admin Console (`app/(admin)/admin/admin-console.tsx`)
- **Original**: 2,294 lines
- **Entry (`admin-console.tsx`)**: 251 lines (target <= 350)
- **Extracted Subfiles** in `app/(admin)/admin/admin-console/` (target <= 400 lines each):
  1. `types.ts` (85 lines, pure): interfaces for tabs, claims, businesses, users, props.
  2. `pagination.ts` (15 lines, pure): `ROWS_PER_PAGE` and `getVisiblePageNumbers`.
  3. `chart-data.ts` (17 lines, pure): `buildRevenueChartData`.
  4. `businesses-csv.ts` (46 lines, pure): `buildBusinessesCsv` and browser download helper.
  5. `payee-not-configured-notice.tsx` (15 lines): warning banner when payee config is missing.
  6. `use-copy-feedback.ts` (18 lines): hook for managing copied feedback state.
  7. `use-business-directory.ts` (92 lines): hook for filtering, sorting, and paginating businesses.
  8. `use-user-directory.ts` (60 lines): hook for filtering and paginating users.
  9. `use-claim-actions.ts` (52 lines): hook for processing claim approvals and rejections with inline error state.
  10. `use-manage-subscription.ts` (100 lines): hook for managing subscription overrides and history.
  11. `use-proof-viewer.ts` (55 lines): hook for viewing claim payment proof screenshots.
  12. `console-header.tsx` (81 lines): Command Header with system status and refresh.
  13. `kpi-cards.tsx` (129 lines): Executive KPI cards grid.
  14. `tab-nav.tsx` (77 lines): Modern segmented tab navigation.
  15. `overview-tab.tsx` (328 lines): Overview metrics, revenue chart, and plan distribution.
  16. `pending-claims-tab.tsx` (158 lines): Pending claims table and actions.
  17. `businesses-tab.tsx` (316 lines): Businesses directory table, search, filters, pagination, CSV export.
  18. `users-tab.tsx` (219 lines): Users directory table, search, filters, pagination.
  19. `settings-tab.tsx` (218 lines): Payee configuration settings and audit logs.
  20. `reject-claim-dialog.tsx` (158 lines): Rejection reason dialog with inline accessible error.
  21. `manage-subscription-dialog.tsx` (332 lines): Subscription override dialog nesting `BusinessIdentityDialog`.
  22. `proof-lightbox.tsx` (128 lines): Proof image viewer lightbox with zoom and rotate controls.

### 5.2 Billing Tab (`components/app/settings/billing-tab.tsx`)
- **Original**: 1,107 lines
- **Entry (`billing-tab.tsx`)**: 124 lines (target <= 300)
- **Extracted Subfiles** in `components/app/settings/billing-tab/` (target <= 400 lines each):
  1. `plan-configs.ts` (90 lines, pure): `PLAN_CONFIGS`, `PlanDefinition`, `STATUS_FILTERS`, `ITEMS_PER_PAGE`.
  2. `types.ts` (34 lines): `SubscriptionHistoryItem`, `BillingTabProps`.
  3. `use-claims-ledger.ts` (85 lines): hook for search, status filtering, and paginating subscription history claims.
  4. `plan-overview-card.tsx` (263 lines): Section 1 Plan Overview Hero Card & Settlement lockup.
  5. `usage-meters.tsx` (178 lines): Section 2 Usage Meters (invoices & customer quota).
  6. `plan-privileges.tsx` (186 lines): Section 3 Plan Privileges checklist & upgrade incentive bar.
  7. `claims-ledger.tsx` (265 lines): Section 4 Claims Ledger table, search, status filter, pagination.
  8. `receipt-modal.tsx` (137 lines): Section 5 Claim receipt & payment proof modal.

### 5.3 App Sidebar (`components/app/app-sidebar.tsx`)
- **Original**: 860 lines
- **Entry (`app-sidebar.tsx`)**: 135 lines (target <= 300)
- **Extracted Subfiles** in `components/app/app-sidebar/` (target <= 400 lines each):
  1. `nav-items.ts` (106 lines, pure): `NavItem` interface and navigation arrays (`mainNav`, `accountNav`, `adminNavItem`).
  2. `nav-link.tsx` (89 lines): individual navigation link with chromatic icon pod and active indicator.
  3. `use-tablet-portrait.ts` (34 lines): media query snapshot hook using `useSyncExternalStore`.
  4. `subscription-card.tsx` (118 lines): active subscription and upgrade-to-pro cards.
  5. `user-menu-popover.tsx` (167 lines): desktop user profile dock trigger and interactive popover.
  6. `mobile-drawer.tsx` (235 lines): mobile slide-over drawer, backdrop, close button, and mobile user dock.
  7. `desktop-sidebar.tsx` (191 lines): desktop `<aside>` sidebar, brand header, compact toggle with verbatim `[DESIGN-SYSTEM-LOCK: Compact Sidebar Toggle]` comment.

---

## 6. Step 4: Alert Replacements Detail

All 4 synchronous browser `alert()` dialogs were replaced with accessible inline error notifications using preexisting design-system Tailwind classes (zero print stylesheet changes):

| # | Trigger / Context | Old Implementation | New Accessible Implementation | Where Rendered | When Cleared |
|---|---|---|---|---|---|
| 1 | Claim Approve failure | `alert(result.error?.message \|\| 'Failed to approve claim.')` | Banner `<div role="alert" className="flex items-start gap-3 rounded-lg bg-destructive/10 border border-destructive/20 p-4 text-sm text-destructive font-medium animate-shake">` with `<AlertCircle className="size-5 shrink-0 mt-0.5" />` | Directly above tab content (`{/* 4. TAB CONTENT */}`) in `admin-console.tsx` | When a new approve/reject starts, and when active tab changes |
| 2 | Reject with empty reason | `alert('Please specify a rejection reason for the client.')` | Inline `<p role="alert" className="mt-1 text-xs text-destructive font-medium">` and `aria-invalid="true"` on `<textarea>` | Directly above dialog action buttons in `reject-claim-dialog.tsx` | When reject dialog opens/closes, and as reason text changes |
| 3 | Claim Reject failure | `alert(result.error?.message \|\| 'Failed to reject claim.')` | Inline `<p role="alert" className="mt-1 text-xs text-destructive font-medium">` | Directly above dialog action buttons in `reject-claim-dialog.tsx` | When reject dialog opens/closes, and when a new reject starts |
| 4 | Subscription Override failure | `alert(result.error?.message \|\| 'Failed to update subscription override.')` | Inline `<p role="alert" className="mt-1 text-xs text-destructive font-medium">` | Directly above Save / Cancel buttons in `manage-subscription-dialog.tsx` | When manage subscription dialog opens/closes, and when new save starts |

After this step, zero `alert(`, `window.alert(`, or `confirm(` calls remain in any admin console file.

---

## 7. Step 5: New Tests

Two new test suites were added:
1. `tests/unit/debt003b-admin-helpers.test.ts` (8 tests):
   - `getVisiblePageNumbers`: tested 1 page (`[1]`), 5 pages (`[1, 2, 3, 4, 5]`), and 20 pages at start (`[1, 2, 3, 4, 5, '...', 20]`), middle (`[1, '...', 9, 10, 11, '...', 20]`), and end (`[1, '...', 16, 17, 18, 19, 20]`).
   - `buildRevenueChartData`: tested empty array / undefined handling and multi-month formatting.
   - `buildBusinessesCsv`: tested exact header row, quote escaping (`"Acme, ""Corp"""`), comma handling, and null fields formatting.
2. `tests/unit/debt003b-split-guards.test.ts` (9 tests):
   - Entry file line counts: `admin-console.tsx` <= 350, `billing-tab.tsx` <= 300, `app-sidebar.tsx` <= 300.
   - `listComponentSourceFiles` returns >= 10 files for admin-console, >= 6 for billing-tab, >= 6 for app-sidebar.
   - Every subfile in all 3 folders <= 400 lines.
   - No `index.ts` or `index.tsx` in any of the 3 subfolders.
   - Pure files (`types.ts`, `pagination.ts`, `chart-data.ts`, `businesses-csv.ts`, `plan-configs.ts`, `nav-items.ts`) have no `'use client'` and no `react` import.
   - Combined admin console sources contain no `alert(` or `confirm(`, and contain `role="alert"`, the 4 original message strings, and `useState<AdminTab>('overview')`.
   - Entry files export expected component symbols.
   - Sidebar sources contain `'sidebar:collapsed='` and the `'DESIGN-SYSTEM-LOCK'` comment.

---

## 8. Verification Results (Step 6)

1. **Typecheck**: `pnpm typecheck` -> Exit code 0, 0 errors.
2. **Lint Ratchet**: `pnpm lint:ratchet` -> 0 errors, 0 warnings (PASS at baseline).
3. **Print Stylesheet Generation**: `pnpm print-css:build; git diff --exit-code lib/pdf/print-stylesheet.generated.ts` -> Exact 0 diff.
4. **Vitest Test Suite**: All unit, guard, characterization, and integration tests passed (176 passed files, 1,453 passed tests, 0 failures).
5. **Snapshot Integrity**:
   - `tests/unit/__snapshots__/debt003b-markup-characterization.test.ts.snap`: SHA-256 `16eb433a18302b203854c96815604727a17455230ef2ad785fa9bed1d409faf9` (identical to initial generation).
   - `tests/unit/__snapshots__/debt003-markup-characterization.test.ts.snap`: Part A snapshot passes without diff.
6. **Production Build**: `pnpm build` -> Initial build hit the known local Turbopack panic ("node process exited before we could connect"); ran `rm -rf .next` and retried, succeeding cleanly.


---

## Reviewer verification (Claude Code)

**Independent snapshot proof.** The characterization test was copied into a clean worktree of untouched `main` (17a88c0) and run there. It wrote 16 snapshots with SHA-256 `16eb433a…09faf9`, byte-identical to the branch. Each admin tab produced different content (16–40 KB), which proves the `useState('overview')` tab override really rendered every tab. The Part A snapshot is unchanged too (`f0a6a5f3…`).

**Move audit.** Two passes compared the old files with all new files: one for new lines, and one counting each line so a line copied from elsewhere also shows up. Findings, all fixed:

1. **Shared busy state split into three (behaviour change).**
   - Old: one `useTransition` for every admin action, so while an approve, reject, override save or refresh ran, all action buttons were disabled.
   - Antigravity gave the reject dialog and the manage-subscription hook their own transitions. Approve/Reject in the list stayed clickable while a rejection was saving, and the refresh spinner ignored those actions.
   - Fix: one transition again, owned by `use-claim-actions.ts` and passed to the reject dialog and `useManageSubscription({ startTransition })`. Guard test added.
2. **Claims-ledger "copied" feedback changed markup.**
   - Copying a reference in the history table showed the hero card's "✓ Copied" label instead of the original small tick (`<Check className="size-3.5 text-emerald-600" />`).
   - The static snapshot can't see this, because it only appears after a click.
   - Restored, with a guard test.
3. **Cleanup.** Dead alias props (`collapsedState`, `onNavigate`) were removed from `SubscriptionCard`.

**Accepted:**
- `buildBusinessesCsv` tolerates null fields (`|| ''`). The types say they are non-null, so the output for real rows is unchanged.
- The approve flow resets `approvingClaimId` itself. The ConfirmDialog already closed, so it is harmless.

**alert() replacement checked:** the 4 messages keep their wording, with `role="alert"`:
- Approve failure: console banner above the tab content. Cleared on a new action and on tab change.
- Empty reason / reject failure: inside the reject dialog, plus `aria-invalid`. Cleared on typing, chip pick and close.
- Override failure: inside the Manage dialog. Cleared on open and on save.

Only existing class strings are used.

**Commands (reviewer, after fixes):**

| Check | Result |
|---|---|
| `pnpm typecheck` | clean |
| `pnpm lint:ratchet` | 0 / 0 |
| `pnpm exec vitest run` | 176 files passed, 1,453 tests passed, 12 skipped, 4 todo |
| `pnpm print-css:build` + `git diff --exit-code` | no diff |
| `pnpm build` | passes |

Sizes:

| Entry | Before | After |
|---|---|---|
| `admin-console.tsx` | 2,294 | ~255 |
| `billing-tab.tsx` | 1,107 | 123 |
| `app-sidebar.tsx` | 860 | 134 |

The E2E journey (incl. admin approve), the hydration probe, the admin-tab screenshot comparison (main vs PR preview) and the live check of the new error messages are recorded in the PR conversation.
