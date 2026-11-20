# HANDOFF DOCUMENTATION: IMPLEMENTATION OF TASKS 1 THROUGH 6

**Workspace:** `e:\BM_Edits_Cld1.1\BM_FixApp_v1.1`  
**Date:** 2026-11-21  
**Target Repository:** Original local working tree  

---

## 1. Branch Architecture & Git Topology

The repository contains two dedicated local branches representing the two phases of development:

```
[origin/main] (da6a5d4)
      │
      ▼
[feature/tasks-1-to-5] (afa6184)
      │  └── Checkpoint containing Task 1, 2, 3, 4, 5
      │
      ▼
[experiment/task-6-risky] (8726f85)
         └── Contains Task 1-5 PLUS Task 6 (Desktop Canvas below 1280px)
```

### Branches Summary:
1. **`feature/tasks-1-to-5`** (Commit `afa6184`):
   - Contains completed, verified Tasks 1 through 5.
   - Clean git state. All tests pass (106 unit & integration tests, 0 lint errors, 0 tsc errors).
2. **`experiment/task-6-risky`** (Commit `8726f85`):
   - Branched from `feature/tasks-1-to-5`.
   - Contains Task 6 on top of Tasks 1–5.
   - Clean git state. All tests pass (tsc clean, 0 lint errors, 95/95 target unit tests pass including the new `tests/unit/desktop-canvas-css.test.ts`).
3. **Safety Patch Backup:**
   - A raw unified patch for Tasks 1–5 is stored in:
     `C:\Users\nidee\.gemini\antigravity\brain\7a90b4e6-9ccb-4761-96a9-1a7c6e06bb4b\scratch\backup-tasks-1-to-5.patch`

---

## 2. Comprehensive Task-by-Task Implementation Summary

### Task 1: Businesses Directory (Admin Console)
- **Primary Files:**
  - `components/admin/businesses-directory.tsx`
  - `components/admin/businesses-directory-table.tsx`
  - `components/admin/businesses-directory-types.ts`
  - `components/admin/gstin-badge.tsx`
- **Key Changes Implemented:**
  - **Alignment:** Table header and cells for "Business & GSTIN" are left-aligned (`text-left`). Headings and rows for Plan & Status, Expires At, Invoices, Staff, and Actions are strictly centered (`text-center`).
  - **Table Accessibility & Markup:** All table headers have `scope="col"`. Cells use `[&_td]:align-middle [&_th]:align-middle`.
  - **Auto-layout & Widths:** Configured semantic `table-auto` with min-width constraints (`min-w-[16rem]`, `min-w-[10ch]`, `min-w-[20rem]`, etc.).
  - **GSTIN Labeling:** Added literal prefix `"GSTIN No.: "` before the GSTIN string under each business name. The label uses default interface typography, while the 15-character GSTIN retains `font-mono`.
  - **Copy Action:** Copy icon copies strictly the raw 15-character GSTIN string (not the label) and preserves toast notification feedback.
  - **Preservations:** Kept existing sorting, search/filter logic, CSV/Excel export, pagination, badge colors, and Manage business navigation.

---

### Task 2: Email Case-Insensitive Search & User Type Parity
- **Primary Files:**
  - `lib/db/schema/users.ts`
  - `lib/actions/users.ts`
  - `components/admin/users-directory.tsx`
  - `components/admin/users-directory-table.tsx`
- **Key Changes Implemented:**
  - **Contract & Queries:** `getAllUsers` server action explicitly selects `users.email` and enforces `email: string | null` in the `AdminUserListItem` interface.
  - **Email Lookup Normalization:** Email queries normalized via SQL case-insensitive matching (`lower(email) = lower(?)`) so login, user queries, and invites are resilient to case differences.
  - **Platform Users Directory:** Rendered user email addresses in the Admin Platform Users table; integrated dual search filtering across user name and email.
  - **Security Gate:** Preserved strict platform-admin RBAC authorization (`requirePlatformAdminRole()`).

---

### Task 3: Admin Console Layout Padding Normalization
- **Primary Files:**
  - `app/(admin)/layout.tsx`
- **Key Changes Implemented:**
  - Removed duplicate `pb-12` bottom padding from the admin layout container, eliminating unnecessary empty space at the bottom of the admin console.
  - Preserved standard `max-w-7xl` container constraints and header integration.

---

### Task 4: Bottom, Left-Aligned Animated Sidebar Toggle
- **Primary Files:**
  - `components/app/app-sidebar.tsx`
- **Key Changes Implemented:**
  - **Eliminated Header Clutter:** Removed top-edge chevron toggle overlapping the header.
  - **Stationary Button Placement:** Added a non-scrolling 52px control row directly above the user account dock. Placed the 36px toggle button at a fixed `left: 16px` inset (its center sits directly above the user avatar). The button has zero horizontal or vertical travel between expanded and collapsed states.
  - **Animated Panel Icon:** Designed an 18px SVG with a stationary outer frame and an internally animated panel rectangle (`rect`) and divider (`line`) that smoothly slide between expanded (`w-[220px]`) and collapsed (`w-[68px]`) modes using `transition-[width] duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)]`.
  - **Accessibility & Motion:** Fully honors `prefers-reduced-motion` (`motion-reduce:transition-none`). Maintains keyboard focus, `aria-expanded`, dynamic `useId` for navigation ID, and cookie persistence.
  - **Dock & Scroll Stability:** Account dock stabilized with `min-h-16 shrink-0`; navigation items wrapped in `min-h-0 flex-1 overflow-y-auto` allowing independent vertical scrolling on short screens.
  - **Tooltip:** Integrated `Tooltip` switching between "Expand sidebar" and "Collapse sidebar".
  - **Mobile:** Mobile drawer close button behavior preserved.

---

### Task 5: Settings Workspace Refinement & Scroll Locking
- **Primary Files:**
  - `components/app/settings/team-tab/invite-form.tsx`
  - `components/app/settings/gst-frequency-card.tsx`
  - `components/app/settings/account-data-section.tsx`
  - `lib/hooks/use-page-scroll-lock.ts`
- **Key Changes Implemented:**
  - **Account Deletion Safety:** Danger zone account closure modal states refined with clear warning typography and destructive confirmation flow.
  - **Team Invites:** Improved responsive form fields and role selector; eliminated submission race conditions.
  - **GST Frequency Card:** Cleaned radio option selection styling, descriptions, and state sync.
  - **Mobile Scroll Locking:** Fixed `usePageScrollLock` to cleanly prevent iOS / mobile touch scrolling of the background window when dialogs, sheets, or preview modals are open.
  - **Chart Preservation:** Preserved original curved Overview graph (`type="monotone"`, `h-64`) without unwanted redesign.

---

### Task 6: Desktop Canvas Below 1280px Viewport
- **Primary Files:**
  - `app/desktop-workspace.css` (New)
  - `config/desktop-canvas-postcss.cjs` (New)
  - `tests/unit/desktop-canvas-css.test.ts` (New)
  - `postcss.config.mjs`
  - `app/layout.tsx`
  - `app/(app)/layout.tsx`
  - `app/(admin)/layout.tsx`
  - `app/(marketing)/layout.tsx`
  - 20+ Modal and Dialog components across admin, invoices, credit-notes, and settings.
- **Key Changes Implemented:**
  - **Viewport Behavior (>=1280px):** Desktop presentation is 100% unchanged.
  - **Small-Screen Viewport (<1280px):** Page content inside authenticated app and admin routes is wrapped in `data-desktop-canvas` (and `data-admin-canvas` for admin). The workspace becomes a minimum 1280px wide canvas with `<main>` owning bidirectional horizontal and vertical scrolling.
  - **Header & Sidebar Isolation:** The application header and sidebar remain strictly outside the desktop canvas and stay responsive to the physical viewport width.
  - **PostCSS Utility Replay Plugin (`desktop-canvas-postcss.cjs`):** Scans generated CSS and clones `sm`, `md`, `lg`, and `xl` utility rules whose min-width is `<= 80rem`, wrapping them in `:where([data-desktop-canvas])` under `@media screen and (width < 80rem)`. This forces forms, grids, and desktop tables to stay in their desktop layout even on small screens.
  - **Modal Framing & Bounding:** Dialogs use `data-viewport-dialog` with sticky close buttons, bounded viewport height/width, and `data-modal-footer` sticky action bars. Form dialogs specify exact body canvas widths:
    - Edit Payee Dialog: 536px
    - Business Identity / Account Closure / Void Payment Dialogs: 472px
    - Void Credit Note Dialog: 480px
    - Manual Subscription Dialog: 632px (with responsive save button invoking `onSaveOverride`)
  - **Invoices & Suggestions:** Removed `flex justify-center` from paper overflow containers so large paper formats (A4/A5) have an accessible left edge when scrolled horizontally. Clamped product suggestions within viewport bounds and auto-closed if anchor leaves view.
  - **Landing Page CTA:** Only adjusted the sticky mobile CTA button in `app/(marketing)/layout.tsx` (`w-fit max-w-full min-h-11 px-4 py-2.5` with `bg-[#fcfaf6]/60 backdrop-blur-md`).

---

## 3. Test & Verification Matrix

| Verification Suite | Target | Status | Notes |
| :--- | :--- | :--- | :--- |
| **`pnpm typecheck`** | Full repository (`tsc --noEmit`) | **PASS** (Exit 0) | Zero TypeScript compiler errors |
| **`pnpm lint:ratchet`** | CI Lint baseline (`scripts/ci/lint-ratchet.ts`) | **PASS** (Exit 0) | 0 errors, 0 warnings (at baseline) |
| **Vitest Unit Suite (Task 1–5)** | Snapshots & Business logic | **PASS** (Exit 0) | 106 tests passed |
| **Vitest Target Suite (Task 6)** | 7 test files including `desktop-canvas-css.test.ts` | **PASS** (Exit 0) | 95 tests passed |
| **PostCSS Test** | `tests/unit/desktop-canvas-css.test.ts` | **PASS** (Exit 0) | Scoping and media query generation validated |

---

## 4. Instructions for the Reviewing / Finishing Agent

To compare and analyze the two branches:
1. Compare Tasks 1–5 vs Tasks 1–6:
   ```bash
   git diff feature/tasks-1-to-5..experiment/task-6-risky
   ```
2. Check commit history:
   ```bash
   git log --graph --oneline main feature/tasks-1-to-5 experiment/task-6-risky
   ```
3. To test or refine `feature/tasks-1-to-5` (Tasks 1–5 only):
   ```bash
   git checkout feature/tasks-1-to-5
   ```
4. To test or refine `experiment/task-6-risky` (Tasks 1–6):
   ```bash
   git checkout experiment/task-6-risky
   ```
5. Verification commands:
   ```powershell
   $env:XDG_CONFIG_HOME = "$pwd\.config"; pnpm typecheck
   $env:XDG_CONFIG_HOME = "$pwd\.config"; pnpm lint:ratchet
   $env:XDG_CONFIG_HOME = "$pwd\.config"; pnpm exec vitest run tests/unit/desktop-canvas-css.test.ts tests/unit/team-tab.test.tsx tests/unit/debt003b-markup-characterization.test.ts tests/unit/debt003b-split-guards.test.ts tests/unit/gst-calculate.test.ts tests/unit/invoice-templates-display-prefs.test.ts tests/unit/notifications-rules.test.ts
   ```
