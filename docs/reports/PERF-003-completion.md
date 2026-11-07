# Phase 3 Completion Report: PERF-003 — Business Logo Caching & Versioned URLs

**Issue**: PERF-003 — Business logo served through a function with weak caching (stale logo, no ETag/304, no CDN caching)  
**Audit Reference**: `docs/BM_FinApp_v1.1_Production-Readiness Audit.md`, section "PERF-003 — Business logo served through a function with weak caching"  
**Branch**: `fix/perf-003-logo-caching`  
**State**: All changes uncommitted, working directory clean except for scoped task changes.

---

## 1. Executive Summary

Prior to this fix, business logos were served via `app/api/business/[id]/logo/route.ts` with weak caching:
- Unversioned URLs served the current logo with `public, max-age=3600, stale-while-revalidate=86400`, meaning logo updates could take up to 24 hours to propagate to clients.
- The route lacked `ETag` generation, RFC 9110 conditional request validation, and `304 Not Modified` responses, requiring a full storage buffer fetch and network transfer on every repeated request.
- The route lacked edge caching headers (`Vercel-CDN-Cache-Control`).
- Callers constructed ad-hoc unversioned URLs (e.g. `app/(app)/layout.tsx`, print views) or cache-busting timestamp parameters (`?t=${Date.now()}` in `upload-logo.ts`), bypassing immutable caching.
- `logoMimeFromKey` in `lib/storage/logo-url.ts` contained a dead `.svg` branch and defaulted to `image/png`.

### Solution Implemented
1. **Client-Safe MIME & URL Utilities (`lib/storage/logo-url.ts`)**:
   - Added `export type LogoMime = 'image/png' | 'image/jpeg' | 'image/webp'`.
   - Added `export const MAX_LOGO_KEY_LENGTH = 300`.
   - Updated `logoMimeFromKey` to return `LogoMime | null` for `.png`, `.jpg`/`.jpeg`, and `.webp` (case-insensitive), returning `null` for any other extension or missing extension.
   - Maintained `buildLogoUrl(businessId, key)` output format (`/api/business/${businessId}/logo?k=${encodeURIComponent(key)}`). Zero imports to remain strictly client-safe.
2. **Safe Data URI Handling (`lib/storage/logo.ts`)**:
   - In `loadLogoDataUri`, verified `logoMimeFromKey(key)`. If `null`, logs error with `Unsupported logo key extension` and returns `null` immediately without invoking `getFileBuffer`.
3. **Hardened Route Handler (`app/api/business/[id]/logo/route.ts`)**:
   - Key pre-validation: rejects `k !== null && (k.length === 0 || k.length > MAX_LOGO_KEY_LENGTH)` with HTTP 400 `'Invalid logo key'` and `Cache-Control: no-store` prior to rate limiter and database lookup.
   - Legacy URL redirection: when `k` is omitted, if the business has a `logo_storage_key`, returns HTTP 307 redirect to the versioned `buildLogoUrl(id, currentKey)` with `Cache-Control: no-store` without touching storage. If no logo is set, returns 404 with `Cache-Control: no-store`.
   - Deterministic ETag: generated via `logoEtag(key)` as a 32-character SHA-256 hex digest (`/^"[0-9a-f]{32}"$/`).
   - RFC 9110 Weak Conditional Validation: implemented `ifNoneMatchHits` supporting `*`, leading `W/` weak indicators, and comma-separated header lists. Returns HTTP 304 without calling `getFileBuffer`.
   - Immutable & Edge Caching: versioned assets return `Cache-Control: public, max-age=31536000, immutable` and `Vercel-CDN-Cache-Control: public, max-age=86400`.
   - Security headers: maintained `nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, and zero occurrences of the word "svg".
4. **Callers Switched to Canonical `buildLogoUrl`**:
   - `app/(app)/layout.tsx`: uses `buildLogoUrl(user.business_id, biz[0].logoStorageKey)`.
   - `components/app/invoices/invoice-print-view.tsx`: fallback uses `buildLogoUrl(invoice.business_id, invoice.logo_storage_key)`.
   - `components/app/credit-notes/credit-note-print-view.tsx`: fallback uses `buildLogoUrl(biz.id, biz.logo_storage_key)`.
   - `components/app/settings/logo-upload-card.tsx`: renamed `logoVersion` state to `savedLogoKey` and generates `currentLogoUrl` via `buildLogoUrl(business.id, savedLogoKey)`.
   - `lib/actions/business/upload-logo.ts`: returns `logoUrl: buildLogoUrl(businessId, storageKey)` without `Date.now()`.
5. **Architectural Guard & Full Test Suite**:
   - Verified that `lib/storage/logo-url.ts` is the single file across `app/`, `components/`, and `lib/` containing the text `/api/business/`.
   - Added architectural guards, MIME unit tests, data URI tests, and comprehensive route tests covering ETag, 304, 307, 400, and 404 branches.

---

## 2. File Change Inventory

- `app/(app)/layout.tsx`: Uses `buildLogoUrl` for `businessLogoUrl` when `biz[0].logoStorageKey` is set.
- `app/api/business/[id]/logo/route.ts`: Rewritten route handler implementing key length pre-validation, 307 legacy redirect, SHA-256 ETag, RFC 9110 304 conditional responses, immutable caching, and edge CDN cache headers.
- `components/app/credit-notes/credit-note-print-view.tsx`: Switched fallback logo URL construction to `buildLogoUrl(biz.id, biz.logo_storage_key)`.
- `components/app/invoices/invoice-print-view.tsx`: Switched fallback logo URL construction to `buildLogoUrl(invoice.business_id, invoice.logo_storage_key)`.
- `components/app/settings/logo-upload-card.tsx`: Renamed `logoVersion` state to `savedLogoKey`, rendering `currentLogoUrl` via `buildLogoUrl(business.id, savedLogoKey)`.
- `eslint.config.mjs`: Added `'.claude/**'` to `globalIgnores` so local worktrees created by reviewer tools are not scanned.
- `lib/actions/business/upload-logo.ts`: Switched return value to `logoUrl: buildLogoUrl(businessId, storageKey)` removing `Date.now()`.
- `lib/storage/logo-url.ts`: Added `LogoMime` union, `MAX_LOGO_KEY_LENGTH = 300`, and updated `logoMimeFromKey` to return `LogoMime | null` without `.svg` or default fallback.
- `lib/storage/logo.ts`: Updated `loadLogoDataUri` to validate `logoMimeFromKey(key)` and log error without storage fetch if null.
- `tests/unit/logo-route.test.ts`: Updated existing unit tests to expect immutable cache headers and added 10 new test scenarios.
- `tests/unit/logo-url.test.ts`: New unit tests for MIME resolution, URL generation, key length limit, and client-safe importlessness.
- `tests/unit/perf003-logo-url-guard.test.ts`: New guard tests enforcing single `/api/business/` location and caller compliance.
- `tests/unit/logo-data-uri.test.ts`: New unit tests for `loadLogoDataUri` covering valid data URIs, unsupported extensions without storage fetch, and error handling.

---

## 3. Repo Search Result for `/api/business/`

Search command:
```powershell
Get-ChildItem -Path app, components, lib -Include *.ts, *.tsx -Recurse | Select-String -Pattern "/api/business/"
```

Output:
```
lib\storage\logo-url.ts:25:  return `/api/business/${businessId}/logo?k=${encodeURIComponent(key)}`;
```
**Result**: `lib/storage/logo-url.ts` is the single remaining occurrence across `app/`, `components/`, and `lib/`.

---

## 4. Test List & Assertion Changes

### Changed Assertions in `tests/unit/logo-route.test.ts`
- **Default Mock Key**: Updated to `'logos/11111111-2222-3333-4444-555555555555/0b6f1c1e-1111-4222-8333-444455556666.png'`.
- **Under Limit Test**:
  - Request URL updated to include `?k=${encodeURIComponent(CURRENT_KEY)}`.
  - Changed `Cache-Control` expectation from `'public, max-age=3600, stale-while-revalidate=86400'` to `'public, max-age=31536000, immutable'` because versioned URLs are immutable.
  - Added assertion for `Vercel-CDN-Cache-Control` = `'public, max-age=86400'`.
  - Added assertion for `ETag` matching `/^"[0-9a-f]{32}"$/`.
  - Added assertion for `Content-Length` matching the buffer length.
- **Other Existing Scenarios** ("Redis outage", "unknown IP", "thrown storage error", "rate limited"):
  - Updated request URLs to include `?k=${encodeURIComponent(CURRENT_KEY)}` to target the versioned 200 code path.

### New Test Cases in `tests/unit/logo-route.test.ts`
1. `no k + current key exists`: asserts HTTP 307 redirect to `buildLogoUrl(VALID_ID, CURRENT_KEY)`, `Cache-Control: no-store`, and `getFileBuffer` is NOT called.
2. `no k + current key null`: asserts HTTP 404 with `Cache-Control: no-store` and `getFileBuffer` NOT called.
3. `matching If-None-Match`: asserts HTTP 304, empty response body, ETag and immutable Cache-Control headers present, and `getFileBuffer` NOT called.
4. `If-None-Match with W/ prefix and inside a comma list ('"aaa", W/<etag>')`: asserts HTTP 304 and `getFileBuffer` NOT called.
5. `If-None-Match '*'`: asserts HTTP 304 and `getFileBuffer` NOT called.
6. `non-matching If-None-Match`: asserts HTTP 200 and `getFileBuffer` is called.
7. `ETag stability`: asserts identical ETag for duplicate requests with the same key, and different ETags for different keys.
8. `historical/snapshot key authorization`: asserts HTTP 404 with `no-store` when unreferenced, and HTTP 200 with immutable caching when referenced by a finalized snapshot.
9. `disallowed extension for current key`: asserts HTTP 404 with `no-store` and `getFileBuffer` NOT called for `.gif` or `.svg`.
10. `key length validation`: asserts `k.length > 300` (length 301) and `k=''` (`?k=`) return HTTP 400 `'Invalid logo key'` with `no-store`, bypassing both rate limiter and database lookup.

### New Test Suites
- `tests/unit/logo-url.test.ts`:
  - `logoMimeFromKey` for `.png`, `.PNG`, `.jpg`, `.JPG`, `.jpeg`, `.JPEG`, `.webp`, `.WEBP`.
  - `logoMimeFromKey` returns `null` for `.gif`, `.svg`, `.pdf`, missing extensions, and empty strings.
  - `buildLogoUrl` percent-encodes slashes (`logos/123.png` -> `logos%2F123.png`).
  - `MAX_LOGO_KEY_LENGTH` is 300.
  - `lib/storage/logo-url.ts` source contains zero `import ` statements (client-safe).
- `tests/unit/perf003-logo-url-guard.test.ts`:
  - Scans all `.ts`/`.tsx` files under `app/`, `components/`, `lib/` and asserts zero `/api/business/${` occurrences except `lib/storage/logo-url.ts`.
  - Asserts `app/(app)/layout.tsx` calls `buildLogoUrl`.
  - Asserts `lib/actions/business/upload-logo.ts` calls `buildLogoUrl` and does NOT contain `Date.now()`.
- `tests/unit/logo-data-uri.test.ts`:
  - Loads valid PNG logo and returns base64 data URI.
  - Returns `null` and logs error without calling `getFileBuffer` for unsupported extensions (`.gif`, `.svg`).
  - Gracefully catches storage error, logs error, and returns `null`.

---

## 5. Verification Outputs (§4)

### 1. `pnpm typecheck`
```
$ tsc --noEmit
Exit code: 0
```

### 2. `pnpm lint:ratchet`
```
$ tsx scripts/ci/lint-ratchet.ts
ESLint now:      18 errors, 38 warnings
Baseline allows: 18 errors, 38 warnings

PASS (at baseline).
```

### 3. `pnpm exec vitest run`
```
Test Files  157 passed | 4 skipped (161)
     Tests  1331 passed | 12 skipped | 7 todo (1350)
  Start at  01:48:17
  Duration  92.33s (transform 38.74s, setup 0ms, import 419.11s, tests 635.39s, environment 60ms)
Exit code: 0
```

### 4. `pnpm build`
```
$ next build
▲ Next.js 16.4.5 (Turbopack)
- Environments: .env.local
✓ Running next.config.mjs took 1320ms
- Experiments (use with caution):
  · clientTraceMetadata
  · serverActions

  Creating an optimized production build ...
✓ Compiled successfully in 8.6s
  Running next.config.js provided runAfterProductionCompile ...
✓ Completed runAfterProductionCompile in 468ms
  Running TypeScript ...
  Finished TypeScript in 16.0s ...
  Collecting page data using 15 workers ...
  Generating static pages using 15 workers (7/7) in 788ms
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

Exit code: 0
```

### 5. `pnpm print-css:build ; git diff --stat lib/pdf/`
```
$ tsx scripts/build-print-css.ts
Successfully generated lib/pdf/print-stylesheet.generated.ts (225718 bytes).

$ git diff --stat lib/pdf/
(0 diff lines)
```

### 6. `git status ; git diff --stat`
```
$ git status --short
 M app/(app)/layout.tsx
 M app/api/business/[id]/logo/route.ts
 M components/app/credit-notes/credit-note-print-view.tsx
 M components/app/invoices/invoice-print-view.tsx
 M components/app/settings/logo-upload-card.tsx
 M eslint.config.mjs
 M lib/actions/business/upload-logo.ts
 M lib/storage/logo-url.ts
 M lib/storage/logo.ts
 M tests/unit/logo-route.test.ts
?? docs/reports/PERF-003-completion.md
?? tests/unit/logo-data-uri.test.ts
?? tests/unit/logo-url.test.ts
?? tests/unit/perf003-logo-url-guard.test.ts

$ git diff --stat
 app/(app)/layout.tsx                               |   3 +-
 app/api/business/[id]/logo/route.ts                | 115 ++++++++----
 components/app/credit-notes/credit-note-print-view.tsx |   3 +-
 components/app/invoices/invoice-print-view.tsx     |   3 +-
 components/app/settings/logo-upload-card.tsx       |  14 +-
 eslint.config.mjs                                  |   1 +
 lib/actions/business/upload-logo.ts                |   3 +-
 lib/storage/logo-url.ts                            |  16 +-
 lib/storage/logo.ts                                |   6 +-
 tests/unit/logo-route.test.ts                      | 201 ++++++++++++++++++++-
 10 files changed, 300 insertions(+), 65 deletions(-)
```

---

## 6. Observations & Decisions

1. **Reviewer Worktrees & ESLint Configuration**:
   - The directory `.claude/worktrees/` was created by external reviewer tools prior to this task. Because `eslint .` recursively checks non-ignored folders, ESLint attempted to validate files inside the external worktree, producing ~41,000 false-positive warnings.
   - Added `'.claude/**'` to `globalIgnores` in `eslint.config.mjs`. This restored ESLint to the exact project baseline (18 errors, 38 warnings) without editing anything inside `.claude/`.
2. **Deterministic ETag Hash Length**:
   - Using `createHash('sha256').update(key).digest('hex').slice(0, 32)` generates a 32-character hex string enclosed in double quotes (e.g. `"abcdef0123456789abcdef0123456789"`), perfectly matching standard HTTP entity tag formatting and the `/^"[0-9a-f]{32}"$/` test assertion.

---

## 7. Suggested Commit Message

```
fix(perf): PERF-003 versioned immutable logo URLs, ETag/304, edge caching, redirect legacy URL
```
*(All changes remain uncommitted per ground rules).*


---

## Reviewer verification (Claude Code, 2026-11-08)

Verified on branch `fix/perf-003-logo-caching` against `main` `acb7378`; the report above is a hint, the real diff was read line by line.

- **Scope:** all five ad-hoc logo URL builders now use `buildLogoUrl` (?k=<storage key>); `/api/business/${` appears only in `lib/storage/logo-url.ts` (guard test enforces it). The dead SVG branch is gone from `logoMimeFromKey`; unknown extensions return null (route 404, data URI null without a storage read).
- **Before vs after re-run myself:** the new `tests/unit/logo-route.test.ts` run against the OLD route (`git show HEAD:...`) gives **10 failed / 6 passed**; against the new route all pass. So the tests really exercise the fix.
- **Reviewer fix:** the 400 (invalid id), 404 (business not found) and 500 responses had no `Cache-Control`; they now send `no-store` like every other error branch. Added assertions plus a new "unknown business -> 404, no storage read" test.
- **Out-of-spec change accepted:** `eslint.config.mjs` ignores `.claude/**` (git-ignored local reviewer worktrees were being linted locally; CI never sees that folder, so the baseline is unaffected).
- **Design notes:** browser cache 1 year `immutable` (safe: every upload gets a new random key); Vercel edge cache 1 day via `Vercel-CDN-Cache-Control` (bounded so a removed logo leaves the edge within a day; every deploy purges it too); the legacy unversioned URL 307-redirects with `no-store`, so it can never show a stale logo.
- **Checks (local):** `pnpm typecheck` clean; `pnpm lint:ratchet` 18 errors / 38 warnings = baseline; `pnpm exec vitest run` 157 files passed, 4 skipped (1331 tests passed before the reviewer tests were added; logo route + upload guard 24/24 after); `pnpm build` OK; `pnpm print-css:build` -> no `lib/pdf/` diff.
- **Preview checks:** see "Preview verification" below.

### Preview verification (Vercel preview of PR #15, 2026-11-08)

- **CI:** all 6 checks green on `0199e3b` and again on `ccf9c26` (empty commit to redeploy after the Preview storage variables were added).
- **Local E2E against the preview:** 22 passed, 1 skipped (mailbox). One earlier run hit a single `page.goto` timeout at journey step 6 (CI passed the same step on the same preview); the immediate re-run was fully green.
- **Hydration probe:** 0 errors on all 8 pages; sidebar 68 / 220 / 68 px at 800 px.
- **Real logo probe** (E2E owner uploads logo A, then logo B, via Settings -> General):
  | Check | Result |
  |---|---|
  | Sidebar `src` | `?k=<storage key>` versioned URL |
  | GET logo | 200 `image/png`, `public, max-age=31536000, immutable`, strong ETag, `nosniff` |
  | Repeat GETs | `x-vercel-cache: HIT` (served by the edge, no function run) |
  | `If-None-Match: <etag>` | 304 |
  | Legacy `/api/business/<id>/logo` | 307 `no-store` -> current versioned URL |
  | Over-long key / unknown key | 400 / 404, both `no-store` |
  | Replace with logo B | sidebar `src` changed on the very next page load; legacy URL now redirects to B |
  | Old URL A after replace | still 200 from the edge cache (expected, bounded to 1 day by `Vercel-CDN-Cache-Control`; no page links to it any more) |
- Notes: Vercel consumes `Vercel-CDN-Cache-Control` at the edge and does not forward it, and the edge serves the body without `Content-Length` (both set by the origin and covered by unit tests).
- **Found while verifying (not caused by PERF-003):** the Vercel Preview environment had no `IDRIVE_E2_*` storage variables, so every upload on previews failed ("Failed to upload image to cloud storage"); the E2E suite never uploads a file, so this had gone unnoticed. The owner added the five variables to Preview on 2026-11-08 (temporary accounts; fresh storage accounts and values at launch).
- **CI flake fixed (test-only):** CI E2E on the docs commit `bb9b4ac` failed at journey step 7 (`getBalancePaise` waited 10 s for the "Balance:" line after the final payment, while the page was switching to the "Zero balance remaining" card). Same app code had passed twice before. `e2e/pages/InvoiceDetailPage.ts` now waits for either state (`settled.or(balance)`) before reading — commit `4886555`.
