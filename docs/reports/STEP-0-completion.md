# STEP-0 Completion Report: Phase 1–2 Leftovers & Statutory Integrity Hardening

## 1. Summary
STEP-0 hardens the statutory lifecycle of business logos and document snapshots according to COMP-001 and API-005. Business logo upload and removal now serialize under row locks (`FOR UPDATE`), preserve historical document logo snapshots via `deleteLogoObjectIfUnreferenced` after transaction commit, and orphan-cleanup uncommitted uploads. Credit note finalization now acquires a shared lock (`FOR SHARE`) on the business row, Tailwind CSS generation excludes non-UI directories, admin actions conform to API-005, and the ESLint ratchet baseline was lowered from 45 to 42 errors.

Per §10 Stop-and-Report conditions, work was paused due to an existing unit test (`tests/unit/upload-guard.test.ts`) that asserts on obsolete pre-STEP-0 code structure (`deleteFileFromStorage(previousKey`) in `upload-logo.ts`.

## 2. Files Changed
- `lib/actions/business/upload-logo.ts`: Implemented upload-first, locked DB swap (`withTransactionRetry` + `setLocalLockTimeout`), orphan cleanup on rollback, post-commit `deleteLogoObjectIfUnreferenced`, and API-005 error mapping with zero `console.*`.
- `lib/actions/business/remove-logo.ts`: Eliminated pre-transaction storage deletion; locked DB clear and audit inside transaction; post-commit `deleteLogoObjectIfUnreferenced` when previous key exists; zero `console.*`.
- `lib/invoices/finalize-credit-note-tx.ts`: Added `.for('share')` and architectural rationale comment to business profile fetch in step 6.
- `lib/actions/subscriptions/get-all-users.ts`: Removed `try/catch` wrapper and `any` error masking; removed unused `ActionError`.
- `lib/actions/subscriptions/get-all-businesses.ts`: Removed `try/catch` wrapper and `any` error masking; removed unused `ActionError`.
- `lib/actions/subscriptions/get-admin-dashboard-stats.ts`: Removed `try/catch` wrapper and `any` error masking; removed unused `ActionError`.
- `app/globals.css`: Added `@source not` rules for `docs`, `tests`, `e2e`, `scripts`, `drizzle`, and `**/*.md`.
- `lib/pdf/print-stylesheet.generated.ts`: Recompiled via `pnpm print-css:build` with exclusions applied.
- `.gitignore`: Removed ignores for `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.npmrc`, `.nvmrc` and their headers.
- `next-env.d.ts`: Reverted accidental dev mode routes import back to HEAD.
- `tests/unit/finalize-lock-order.test.ts`: Added lock order assertions verifying `.for('share')` on the credit note finalization query.
- `tests/integration/logo-lifecycle.test.ts`: New PGlite integration suite verifying all 8 logo lifecycle scenarios under COMP-001 and API-005.
- `ARCHITECTURE.md`: Documented credit note `FOR SHARE` lock order, logo retention lifecycle order, and Tailwind `@source not` exclusions.
- `scripts/ci/lint-baseline.json`: Lowered error baseline from 45 to 42 via `pnpm lint:ratchet --update`.
- `docs/reports/STEP-0-completion.md`: This completion report.

## 3. Full `git diff --stat` Output
```
 .gitignore                                         |  14 +-
 ARCHITECTURE.md                                    |   6 +-
 app/globals.css                                    |   9 ++
 lib/actions/business/remove-logo.ts                |  67 +++++----
 lib/actions/business/upload-logo.ts                |  85 ++++++------
 .../subscriptions/get-admin-dashboard-stats.ts     | 154 ++++++++++-----------
 lib/actions/subscriptions/get-all-businesses.ts    |  48 +++----
 lib/actions/subscriptions/get-all-users.ts         |  36 ++---
 lib/invoices/finalize-credit-note-tx.ts            |   4 +-
 lib/pdf/print-stylesheet.generated.ts              |   2 +-
 scripts/ci/lint-baseline.json                      |   2 +-
 tests/unit/finalize-lock-order.test.ts             |   5 +
 12 files changed, 213 insertions(+), 219 deletions(-)
```

## 4. Exact Terminal Output of Every Command in §9

### 9.1 `pnpm typecheck`
```
$ tsc --noEmit
(exit code 0)
```

### 9.2 Targeted Vitest Suites (5 test files)
`pnpm exec vitest run tests/integration/logo-lifecycle.test.ts tests/unit/finalize-lock-order.test.ts tests/unit/print-stylesheet.test.ts tests/integration/comp001-document-integrity.test.ts tests/integration/auth003-rbac-actions.test.ts`
```
 RUN  v4.1.12 E:/BM_Edits_Cld1.1/BM_FixApp_v1.1

 ✓ tests/unit/finalize-lock-order.test.ts (4 tests) 13ms
 ✓ tests/unit/print-stylesheet.test.ts (4 tests) 531ms
     ✓ is up to date with app/globals.css and tailwind config (stale: run pnpm print-css:build)  527ms
 ✓ tests/integration/logo-lifecycle.test.ts (8 tests) 3308ms
 ✓ tests/integration/auth003-rbac-actions.test.ts (5 tests) 3231ms
 ✓ tests/integration/comp001-document-integrity.test.ts (6 tests) 4257ms
     ✓ 1. Migration backfill: applies cleanly, populates backfilled_from_profile, and leaves guards enabled  2332ms

 Test Files  5 passed (5)
      Tests  27 passed (27)
   Start at  13:36:17
   Duration  9.33s (transform 2.83s, setup 0ms, import 10.91s, tests 11.34s, environment 1ms)
```

### 9.3 `pnpm test`
Full vitest suite run: 135 passed, 1 failed, 4 skipped.
```
 FAIL  tests/unit/upload-guard.test.ts > Upload Security Architectural Guards (SEC-002) > verifies upload-logo.ts adheres to upload security, rate limiting, and transaction order
AssertionError: expected -1 to be greater than -1
 ❯ tests/unit/upload-guard.test.ts:41:25
     39|     const deleteIndex = logoSource.indexOf('deleteFileFromStorage(previousKey');
     40|     expect(txIndex).toBeGreaterThan(-1);
     41|     expect(deleteIndex).toBeGreaterThan(-1);
       |                         ^
     42|     expect(deleteIndex).toBeGreaterThan(txIndex);
     43|   });

 Test Files  1 failed | 135 passed | 4 skipped (140)
      Tests  1 failed | 1219 passed | 12 skipped | 7 todo (1239)
   Start at  13:36:38
   Duration  80.26s (transform 32.94s, setup 0ms, import 340.87s, tests 563.91s, environment 50ms)
```

Rerun alone (`pnpm exec vitest run tests/unit/upload-guard.test.ts`):
```
 RUN  v4.1.12 E:/BM_Edits_Cld1.1/BM_FixApp_v1.1

 ❯ tests/unit/upload-guard.test.ts (7 tests | 1 failed) 9ms
     ✓ verifies submit-payment-claim.ts adheres to upload security rules 2ms
     × verifies upload-logo.ts adheres to upload security, rate limiting, and transaction order 4ms
     ✓ verifies send-feedback.ts adheres to upload security rules 0ms
     ✓ verifies storage helper defines ContentDisposition and ResponseContentDisposition 0ms
     ✓ verifies logo route contains nosniff and does NOT contain svg 0ms
     ✓ verifies claim screenshot URL action enables forced download for user-uploaded screenshots 0ms
     ✓ verifies archive modules and invoice/credit-note PDF signed URLs do NOT contain forceDownload 0ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/unit/upload-guard.test.ts > Upload Security Architectural Guards (SEC-002) > verifies upload-logo.ts adheres to upload security, rate limiting, and transaction order
AssertionError: expected -1 to be greater than -1
 ❯ tests/unit/upload-guard.test.ts:41:25
     39|     const deleteIndex = logoSource.indexOf('deleteFileFromStorage(previousKey');
     40|     expect(txIndex).toBeGreaterThan(-1);
     41|     expect(deleteIndex).toBeGreaterThan(-1);
       |                         ^
     42|     expect(deleteIndex).toBeGreaterThan(txIndex);
     43|   });

 Test Files  1 failed (1)
      Tests  1 failed | 6 passed (7)
   Duration  397ms
```

### 9.4 `pnpm lint:ratchet` & `pnpm lint:ratchet --update`
```
$ tsx scripts/ci/lint-ratchet.ts
ESLint now:      42 errors, 39 warnings
Baseline allows: 45 errors, 39 warnings

PASS (improved). Run `pnpm lint:ratchet --update` and commit the lowered baseline.
```

```
$ tsx scripts/ci/lint-ratchet.ts "--update"
ESLint now:      42 errors, 39 warnings
Baseline allows: 45 errors, 39 warnings

Baseline lowered. Commit scripts/ci/lint-baseline.json.
```

### 9.5 `grep -rn "console\." lib/actions/business ...`
Command executed: `git grep -rn "console\." lib/actions/business lib/actions/subscriptions/get-all-users.ts lib/actions/subscriptions/get-all-businesses.ts lib/actions/subscriptions/get-admin-dashboard-stats.ts`
Output: None (exit code 1, 0 matches).

### 9.6 `grep -n "pnpm-lock\|pnpm-workspace\|npmrc" .gitignore`
Command executed: `git grep -n "pnpm-lock\|pnpm-workspace\|npmrc" .gitignore`
Output: None (exit code 1, 0 matches).

### 9.7 `git status --short`
```
 M .gitignore
 M ARCHITECTURE.md
 M app/globals.css
 M lib/actions/business/remove-logo.ts
 M lib/actions/business/upload-logo.ts
 M lib/actions/subscriptions/get-admin-dashboard-stats.ts
 M lib/actions/subscriptions/get-all-businesses.ts
 M lib/actions/subscriptions/get-all-users.ts
 M lib/invoices/finalize-credit-note-tx.ts
 M lib/pdf/print-stylesheet.generated.ts
 M scripts/ci/lint-baseline.json
 M tests/unit/finalize-lock-order.test.ts
?? "docs/BM_FinApp_v1.1_Production-Readiness Audit.md"
?? docs/reports/STEP-0-completion.md
?? tests/integration/logo-lifecycle.test.ts
```

### 9.8 `pnpm build`
Executed with `.env.local` present:
```
$ next build
▲ Next.js 16.2.6 (Turbopack)
- Environments: .env.local
- Experiments (use with caution):
  · clientTraceMetadata
  · serverActions

  Creating an optimized production build ...
✓ Compiled successfully in 16.5s
  Running next.config.js provided runAfterProductionCompile ...
✓ Completed runAfterProductionCompile in 889ms
  Running TypeScript ...
  Finished TypeScript in 25.5s ...
  Collecting page data using 15 workers ...
  Generating static pages using 15 workers (7/7) in 540ms
  Finalizing page optimization ...

Route (app)
┌ ƒ /
├ ○ /_not-found
├ ƒ /admin
├ ƒ /admin/dev-boundary-test
├ ƒ /api/auth/[...path]
├ ƒ /api/business/[id]/logo
├ ƒ /api/credit-notes/[id]/archival-render
├ ƒ /api/cron/retry-invoice-archival
├ ƒ /api/invoices/[id]/archival-render
├ ƒ /api/reports/export
├ ƒ /checkout
├ ƒ /credit-notes
├ ƒ /credit-notes/[id]
├ ƒ /customers
├ ƒ /customers/[id]/edit
├ ƒ /customers/new
├ ƒ /dashboard
├ ƒ /dev-boundary-test
├ ƒ /dev-sentry-test
├ ƒ /invoices
├ ƒ /invoices/[id]
├ ƒ /invoices/[id]/credit-note/new
├ ƒ /invoices/new
├ ○ /login
├ ○ /privacy
├ ƒ /products
├ ƒ /products/[id]/edit
├ ƒ /products/new
├ ƒ /reports
├ ƒ /settings
├ ○ /signup
└ ○ /terms

✓ Generating static pages using 15 workers (7/7) in 540ms
(exit code 0)
```

## 5. Acceptance Checklist
- [x] upload never deletes a referenced previous logo — PASS (`STEP-0: upload keeps the previous logo when a finalized invoice snapshot references it` in `tests/integration/logo-lifecycle.test.ts`).
- [x] upload deletes an unreferenced previous logo only after commit — PASS (`STEP-0: upload deletes the previous logo when no document references it` asserts `state.keyAtDelete === uploadData.storageKey`).
- [x] failed swap deletes only the new object and returns INTERNAL_ERROR — PASS (`STEP-0: DB failure after upload rolls back and cleans only the new object` asserts code `INTERNAL_ERROR`, only `delete:<newKey>` triggered, previous key intact).
- [x] remove clears DB before any storage delete; referenced logo kept — PASS (`STEP-0: remove clears the DB first and keeps a referenced logo` asserts `logo_storage_key` is null and no delete event fired for referenced key; `STEP-0: remove deletes an unreferenced logo only after the DB is cleared` asserts `state.keyAtDelete === null`).
- [x] credit-note finalize takes FOR SHARE on business (lock-order test) — PASS (`tests/unit/finalize-lock-order.test.ts` asserts `shareIdx > -1`, `lockCnIdx < shareIdx < getNextCnNumIdx`).
- [x] print-stylesheet freshness test passes with the audit doc present — PASS (`tests/unit/print-stylesheet.test.ts` passes; generated CSS has 0 instances of `.invisible{` and `.grow{`).
- [x] admin actions no longer mask errors; 3 `any` errors gone — PASS (`get-all-users.ts`, `get-all-businesses.ts`, `get-admin-dashboard-stats.ts` direct handler execution).
- [x] .gitignore no longer ignores lockfile/workspace/npmrc; next-env.d.ts reverted — PASS (verified via git grep and git diff).
- [x] zero console.* in lib/actions/business and the 3 admin actions — PASS (`git grep` yields 0 matches).
- [x] lint baseline lowered (show old → new) — PASS (old: 45 errors, 39 warnings; new: 42 errors, 39 warnings in `scripts/ci/lint-baseline.json`).

## 6. Anything You Could Not Do or Were Unsure About
Work was stopped per §10 condition 4:
> "Stop immediately and write the report (without guessing a workaround) if:
> - an existing test outside the new file breaks because of your change and the fix would require editing that test"

In `tests/unit/upload-guard.test.ts` (lines 38–43), the test specifically asserts:
```typescript
const deleteIndex = logoSource.indexOf('deleteFileFromStorage(previousKey');
expect(deleteIndex).toBeGreaterThan(-1);
```
Under STEP-0 Task A, `upload-logo.ts` was deliberately updated to call `deleteLogoObjectIfUnreferenced(businessId, previousKey)` post-commit to satisfy the COMP-001 Logo Retention Rule. As a result, the string `'deleteFileFromStorage(previousKey'` is no longer in `upload-logo.ts`. Because `tests/unit/upload-guard.test.ts` is not among the files permitted for modification in §2, and modifying it would weaken or alter an existing test outside §2 without reviewer authorization, no workaround was guessed or applied. The reviewer can update `tests/unit/upload-guard.test.ts` to assert `logoSource.indexOf('deleteLogoObjectIfUnreferenced(businessId, previousKey')` instead.

