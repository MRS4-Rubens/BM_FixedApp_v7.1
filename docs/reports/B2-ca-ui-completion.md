# B2-CA-UI Completion Report

**Task ID**: B2-CA-UI  
**Branch**: `feat/ca-ui` (uncommitted)  
**Date**: 2026-11-16  

---

## 1. Executive Summary

Task `B2-CA-UI` delivers the complete client-side interface and end-to-end verification for the read-only accountant (CA) role on top of the merged `B1-CA-ROLE` backend:
1. **Can-Edit Signal (`useCanEdit`)**: Added `useCanEdit(): boolean` to `components/app/current-user-role.tsx` backed by `canEditBusinessData(role)` (`true` for owner/staff, `false` for accountant).
2. **Comprehensive Read-Only Boundary**:
   - Gated write and mutation triggers across Dashboard, Invoices, Customers, Products, Credit Notes, and Settings.
   - Created `components/app/invoices/draft-read-only-notice.tsx` so accountants viewing draft invoices see an informative notice with IST date, customer name, and formatted total instead of an editable form.
   - Added `'accountant'` to the admin console user directory filters and role badges.
3. **Users & Roles Tab Enhancements**:
   - Added role selection in `InviteForm` ("Team member" vs "Accountant (read-only)"), disabled with "Professional plan" badge when `!canInviteAccountant`.
   - Updated `MembersList` to render role badges, a change-role `<select>` calling `changeTeamMemberRole`, and a confirmation dialog.
   - Added role badge on pending invitations in `PendingInvites`.
   - Tailored WhatsApp invite message in `InviteLinkPanel` for accountant invitations.
   - Updated `RoleGuide` to 3 columns, detailing Owner, Team Member, and Accountant (read-only).
4. **Plan Catalog Update**:
   - Updated `Read-only access for your CA` in `lib/subscriptions/plan-catalog.ts` to `status: 'included'`.
5. **Quality Gates & Tests**:
   - Added `tests/unit/accountant-view.test.tsx` (9 tests) and `tests/unit/draft-read-only-notice.test.tsx` (6 tests).
   - Extended `tests/unit/team-tab.test.tsx` (15 tests total).
   - Created Playwright E2E spec `e2e/specs/09-ca.spec.ts` with project `ca` registered in `playwright.config.ts`.
   - All quality gates passed (print stylesheet, typecheck, lint ratchet, knip, 1926 unit/integration tests, and production build).

---

## 2. Changes by Component

### Part A — Can Edit Signal
- `components/app/current-user-role.tsx`:
  - Added export `useCanEdit(): boolean` invoking `canEditBusinessData(useCurrentUserRole())`.
  - Backwards-compatible; preserves `roleLabel`, `useIsOwner`, and `CurrentUserRoleProvider`.

### Part B — Accountant Read-Only View Across App
- `app/(app)/dashboard/page.tsx`:
  - Evaluates `canEdit = canEditBusinessData(appUser.role)`.
  - Hides "Add Customer" and "New Invoice" header buttons when `!canEdit`.
  - Hides Quick Actions creation cards (`/invoices/new`, `/customers/new`, `/products/new`) when `!canEdit`.
- `app/(app)/invoices/client.tsx`:
  - Hides "New Invoice" button in toolbar and empty state when `!canEdit`.
  - Hides draft edit and delete buttons in table row and mobile card actions when `!canEdit`.
- `components/app/invoices/invoice-detail.tsx`:
  - Hides WhatsApp share, Email invoice, and Send payment reminder buttons when `!canEdit`.
  - Hides all three "Issue Credit Note" links when `!canEdit`.
- `components/app/invoices/payment-section.tsx`:
  - Hides "Record Payment / Refund" collapsible form card and instruction text when `!canEdit`.
- `components/app/invoices/draft-read-only-notice.tsx` (new):
  - Server/client presentation component rendered in `app/(app)/invoices/[id]/page.tsx` for draft invoices when viewed by an accountant.
  - Displays "Draft invoice — not finalized yet", explanatory note, IST formatted date, customer name (or "Walk-in customer"), and INR grand total.
- `components/app/credit-notes/credit-note-detail.tsx` & `credit-note-form.tsx`:
  - Hides finalize and delete draft action buttons when `!canEdit`; renders `"Read-only access."` notice.
- `components/app/customers/customers-client.tsx` & `components/app/customers/customer-actions.tsx`:
  - Hides "Add Customer" button and row "Edit" links when `!canEdit`.
  - `CustomerActions` returns `null` when `!canEdit`.
- `components/app/products/products-client.tsx` & `components/app/products/product-actions.tsx`:
  - Hides "Add Product" button and row "Edit" links when `!canEdit`.
  - `ProductActions` returns `null` when `!canEdit`.
- `app/(admin)/admin/admin-console/use-user-directory.ts` & `users-tab.tsx`:
  - Added `'accountant'` to `UserRoleFilter` and `roleFilterOptions`.
  - Formatted neutral slate badge for accountant users.

### Part C — Settings "Users & Roles" Tab
- `components/app/settings/team-tab/invite-form.tsx`:
  - Added role radio fieldset for "Team member" (`staff`, default) vs "Accountant (read-only)" (`accountant`).
  - Disabled accountant radio with "Professional plan" badge when `!canInviteAccountant`.
- `components/app/settings/team-tab/members-list.tsx`:
  - Renders role badge for each member using `roleLabel(member.role)`.
  - Renders change-role `<select>` for non-owner members, with disabled `accountant` option when `!canInviteAccountant`.
  - Triggers `ConfirmDialog` before invoking `changeTeamMemberRole`.
- `components/app/settings/team-tab/pending-invites.tsx`:
  - Renders role badge for pending invitations.
- `components/app/settings/team-tab/invite-link-panel.tsx`:
  - Formats WhatsApp invite copy specifically for accountants: `Join <business> on Invoice BizFolio as our accountant (read-only access): <url>`.
- `components/app/settings/team-tab/role-guide.tsx`:
  - Expanded to 3 columns, detailing Owner, Team Member, and Accountant (read-only).
- `components/app/settings/team-tab/team-tab.tsx`:
  - Connected `canInviteAccountant`, `activeInviteRole`, and role update callbacks.

### Part D — Plan Catalog Label
- `lib/subscriptions/plan-catalog.ts`:
  - Changed `Read-only access for your CA` feature status to `'included'`.
- `tests/unit/plan-catalog.test.ts`:
  - Verified inclusion assertion passes.
- `tests/unit/__snapshots__/debt003-markup-characterization.test.ts.snap`:
  - Updated snapshot representations.
- `lib/pdf/print-stylesheet.generated.ts`:
  - Regenerated via `pnpm print-css:build`.

### Part E — Playwright E2E & Tests
- `e2e/pages/AdminPage.ts`:
  - Implemented `setBusinessPlan(businessName, plan)` supporting `'professional'` and `'essentials'`.
- `e2e/pages/TeamSettingsPage.ts`:
  - Added `accountantRoleRadio`, role selection in `sendInvite(email, role)`, and `changeMemberRole(email, newRole)`.
- `e2e/specs/09-ca.spec.ts`:
  - Created serial E2E journey verifying:
    1. Owner on Essentials sees Accountant radio disabled.
    2. Admin overrides plan to Professional.
    3. Owner invites CA.
    4. CA signs up, joins, and verifies read-only access across the app.
    5. Direct route guards redirect away from `/new` pages.
    6. `finally` block safely restores business plan to Essentials and cleans up member.
- `playwright.config.ts`:
  - Added project `ca` with dependency on `team`.

---

## 3. Verification & Quality Gates

All verification commands executed cleanly in required order:

| Gate | Command | Result |
|---|---|---|
| Print CSS Build | `pnpm print-css:build` | Success (250,935 bytes generated) |
| Print Stylesheet Guard | `pnpm exec vitest run tests/unit/print-stylesheet.test.ts` | 4 / 4 passed |
| TypeScript Check | `pnpm typecheck` | 0 errors |
| ESLint Ratchet | `pnpm lint:ratchet` | 0 errors, 0 warnings (PASS at baseline) |
| Knip Dead Code Audit | `pnpm knip` | 0 unused files/exports |
| Full Vitest Test Suite | `pnpm test` | 230 test files passed, 1926 passed (0 failures) |
| Next.js Production Build | `pnpm exec next build --webpack` | 0 errors, all 37 routes generated successfully |
| Playwright Test Registry | `pnpm exec playwright test --list` | 25 tests in 9 files registered (including `[ca] › 09-ca.spec.ts`) |
| LF Line Ending Check | `git diff --stat` vs `git diff --stat --ignore-cr-at-eol` | Strictly identical (`True`) |

---

## 4. File Inventory

All modified and newly created files have LF line endings and are strictly under 400 lines:

| File | Status | Line Count |
|---|---|---|
| `components/app/current-user-role.tsx` | Modified | 42 |
| `components/app/invoices/draft-read-only-notice.tsx` | New | 86 |
| `components/app/settings/team-tab/role-guide.tsx` | Modified | 46 |
| `components/app/settings/team-tab/invite-link-panel.tsx` | Modified | 126 |
| `components/app/settings/team-tab/pending-invites.tsx` | Modified | 170 |
| `components/app/settings/team-tab/team-tab.tsx` | Modified | 178 |
| `components/app/settings/team-tab/invite-form.tsx` | Modified | 206 |
| `components/app/settings/team-tab/members-list.tsx` | Modified | 289 |
| `app/(admin)/admin/admin-console/use-user-directory.ts` | Modified | 68 |
| `app/(admin)/admin/admin-console/users-tab.tsx` | Modified | 241 |
| `app/(app)/dashboard/page.tsx` | Modified | 382 |
| `components/app/customers/customer-actions.tsx` | Modified | 86 |
| `components/app/customers/customers-client.tsx` | Modified | 259 |
| `components/app/products/product-actions.tsx` | Modified | 52 |
| `components/app/products/products-client.tsx` | Modified | 290 |
| `lib/subscriptions/plan-catalog.ts` | Modified | 134 |
| `lib/pdf/print-stylesheet.generated.ts` | Regenerated | 2 |
| `e2e/pages/AdminPage.ts` | Modified | 106 |
| `e2e/pages/TeamSettingsPage.ts` | Modified | 78 |
| `e2e/specs/09-ca.spec.ts` | New | 197 |
| `playwright.config.ts` | Modified | 111 |
| `tests/unit/accountant-view.test.tsx` | New | 395 |
| `tests/unit/draft-read-only-notice.test.tsx` | New | 92 |
| `tests/unit/plan-catalog.test.ts` | Modified | 167 |
| `tests/unit/staff-view.test.tsx` | Modified | 299 |
| `tests/unit/team-tab.test.tsx` | Modified | 354 |

---

## Claude Code verification and fixes (2026-11-16)

Forbidden areas were confirmed untouched: server actions, team libs, DB/migrations, invite pages, rbac/permissions/page guards, entitlements, and the social sign-in buttons. The snapshot diff contains only the CA pill flip (coming soon → included).

**Fixed during verification**
1. **E2E `09-ca.spec.ts`:**
   - Absence checks used button names that do not exist ("Share over WhatsApp", "Email invoice", "Send reminder", "Record Payment"), so they always passed. They now use the real labels ("WhatsApp", "Email", "Reminder", the "Record Payment/Refund" heading), plus a positive control (the Print button must be visible).
   - Added the missing change-role step: Accountant → Team member (can open `/invoices/new`) → Accountant (bounced again).
   - Member removal is now an asserted step, no longer only best-effort cleanup. The plan restore stays in `finally`.
2. **`AdminPage.setBusinessPlan`:** it scoped controls to `div.filter({has: heading}).last()`, which is the innermost div and may not contain the selects. It now uses the dialog role.
3. **Unit tests:** the invoice-detail, payment and credit-note checks were accountant-only. One could never fail: SSR renders "Record <!-- -->Payment". Added owner/staff positive controls on the same fixtures, with SSR comment normalisation.
4. **Casts:** removed two `e.target.value as 'staff' | 'accountant'` casts (now `isOneOf(INVITABLE_ROLES, …)`) and an `as readonly UserRoleFilter[]` upcast.
5. **Dashboard:** for the accountant, the single remaining Quick Action ("View Reports") was squeezed into one column of a 2-column grid. It now spans the full width.
6. `next-env.d.ts` (a build artifact) was restored.

**Browser checks (dev server, bm_dev; the dev account was set to accountant temporarily, then restored to owner)**
- **Accountant:**
  - Dashboard: no create buttons; Quick Actions shows only View Reports (full width).
  - Customers, Products and Invoices: zero `/new` or `/edit` links.
  - The menu shows "Accountant (read-only)".
- **Owner (trial plan):** the invite form shows a Role fieldset; "Team member" is selected, and "Accountant (read-only)" is disabled with a "Professional plan" badge. The role guide includes the accountant column.

**Gate after fixes:**
- `pnpm typecheck`, `pnpm lint:ratchet` (0/0), `pnpm knip`, `pnpm build` (Turbopack): all pass.
- `pnpm test`: 1929 pass.
- `playwright test --list`: includes `[ca] 09-ca.spec.ts`.

**Not runnable locally:** the 09 E2E itself; it runs on the PR.
