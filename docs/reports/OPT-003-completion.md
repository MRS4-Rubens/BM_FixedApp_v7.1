# OPT-003 Completion Report: Build & Dependency Hygiene

**Author/Agent:** Antigravity  
**Branch:** `fix/opt-003-build-hygiene`  
**Base Commit:** `a89a931` (main)  
**Status:** Completed (changes uncommitted)  
**Date:** 2026-11-09  

---

## 1. Executive Summary

Issue OPT-003 implements build and dependency hygiene improvements across TypeScript configuration, Node.js runtime alignment, and Next.js configuration. All changes are config-only; zero runtime or visual behavior was altered.

Key changes:
1. **TypeScript Target Upgrade:** Modernized `tsconfig.json` compiler target from legacy `ES6` to `ES2022`. Zero typecheck fallout or compilation errors resulted.
2. **Unified Node.js Specification:** Aligned `package.json` `engines.node` to `24.x` (matching `.nvmrc`'s `24.18.0` and Vercel's production Node 24 runtime), and updated `README.md` documentation.
3. **Dead Settings Pruned from `next.config.mjs`:**
   - Removed obsolete `images: { unoptimized: true }` block. Verified that no module in the repository imports `next/image`; all images use plain `<img>` for data URLs, client blob previews, short-lived signed URLs, or static print/PDF templates.
   - Simplified `allowedDevOrigins` from `['127.0.0.1', 'localhost', 'localhost:3000', '127.0.0.1:3000']` to `['127.0.0.1', 'localhost']` (Next.js matches hostnames only; port notations were dead).
4. **Architecture Documentation:** Added a dedicated section "Build configuration decisions (OPT-003)" to `docs/DEPLOYMENT.md`.
5. **Guard Test Suite:** Created `tests/unit/opt003-build-hygiene.test.ts` to permanently enforce all OPT-003 invariants.

---

## 2. Every Changed File (Before vs. After)

### 2.1 `tsconfig.json`
```diff
--- a/tsconfig.json
+++ b/tsconfig.json
@@ -6,7 +6,7 @@
     ],
     "allowJs": true,
-    "target": "ES6",
+    "target": "ES2022",
     "skipLibCheck": true,
```

### 2.2 `package.json`
```diff
--- a/package.json
+++ b/package.json
@@ -4,7 +4,7 @@
   "packageManager": "pnpm@11.9.0",
   "engines": {
-    "node": ">=22.0.0"
+    "node": "24.x"
   },
   "scripts": {
```

### 2.3 `README.md`
```diff
--- a/README.md
+++ b/README.md
@@ -4,7 +4,7 @@ A GST billing and invoicing web application for Indian small businesses.
 
 ## Prerequisites
 
-- **Node.js** — Node 22+ (pinned in `.nvmrc`). If you have [nvm](https://github.com/nvm-sh/nvm) installed, run `nvm use` to switch to the correct version automatically.
+- **Node.js** — Node 24 (exact version pinned in `.nvmrc`; `package.json` engines is `24.x`, which is also what Vercel uses). If you have [nvm](https://github.com/nvm-sh/nvm) installed, run `nvm use` to switch to the correct version automatically.
 - **pnpm** — pnpm 11. Run `corepack enable` to ensure the correct package manager is active. Do not use npm or yarn.
```

### 2.4 `next.config.mjs`
```diff
--- a/next.config.mjs
+++ b/next.config.mjs
@@ -3,10 +3,7 @@ import { buildSecurityHeaderRules } from "./config/security-headers.mjs";
 
 /** @type {import('next').NextConfig} */
 const nextConfig = {
-  allowedDevOrigins: ['127.0.0.1', 'localhost', 'localhost:3000', '127.0.0.1:3000'],
-  images: {
-    unoptimized: true,
-  },
+  allowedDevOrigins: ['127.0.0.1', 'localhost'],
   experimental: {
     serverActions: {
       bodySizeLimit: '6mb',
```

### 2.5 `docs/DEPLOYMENT.md`
Appended:
```markdown
## Build configuration decisions (OPT-003)
- TypeScript target ES2022 affects type-checking only; browser output is controlled by Next.js/SWC and its browserslist.
- Node: .nvmrc is the exact version (local + CI); package.json engines "24.x" is what Vercel uses; a unit test keeps the majors equal. Upgrading Node = change both in one PR.
- Images: plain <img> is deliberate (data/blob URLs, expiring signed URLs, print templates); no next/image, so no images config. If next/image is ever added for remote images, configure images.remotePatterns at that time.
- Not used, on purpose: output: 'standalone' (only for self-hosting; we deploy on Vercel); Renovate (Dependabot already configured in .github/dependabot.yml); experimental.serverActions.allowedOrigins (only needed if a proxy/CDN in front of Vercel changes the Host header — re-check on launch day).
```

### 2.6 `tests/unit/opt003-build-hygiene.test.ts` (New File)
Permanent guard asserting:
- `tsconfig.json` `compilerOptions.target === 'ES2022'`
- `package.json` `engines.node === '24.x'` and matches `.nvmrc` major version
- `next.config.mjs` has no `unoptimized` image setting and `allowedDevOrigins` has no ports
- No file under `app/`, `components/`, or `lib/` imports `next/image`
- `docs/DEPLOYMENT.md` contains the `## Build configuration decisions (OPT-003)` section

---

## 3. The 12 `<img>` Files and Their Source Kinds

A repository-wide search (`git grep -n "next/image" -- app components lib`) confirmed that `next/image` is never imported. Plain HTML `<img>` tags exist across exactly 12 files:

| # | File Path | Line | `src` Attribute Kind & Description |
|---|---|---|---|
| 1 | `app/(admin)/admin/admin-console/proof-lightbox.tsx` | 112 | **Short-lived signed S3/R2 URL** (`signedUrl` from payment claim verification) |
| 2 | `app/(app)/checkout/checkout-form/claim-submit-card.tsx` | 128 | **Client-side Blob preview URL** (`URL.createObjectURL(file)` of user's payment screenshot) |
| 3 | `app/(app)/checkout/checkout-form/payment-method-card.tsx` | 94 | **Server-generated Data URL** (`qrDataUrl` containing inline base64/SVG UPI QR code) |
| 4 | `components/app/app-sidebar/mobile-drawer.tsx` | 165 | **Dynamic tenant logo endpoint** (`businessLogoUrl` via `/api/business/[id]/logo` or S3 key) |
| 5 | `components/app/app-sidebar/user-menu-popover.tsx` | 58, 102 | **Dynamic tenant logo endpoint** (`businessLogoUrl` in active tenant selector and profile menu) |
| 6 | `components/app/credit-notes/credit-note-print-view.tsx` | 121 | **Print / PDF template view** (`businessLogoUrl` rendered during statutory document generation) |
| 7 | `components/app/invoices/templates/template-1.tsx` | 106 | **Print / PDF template view** (`seller.logo_url` in "Classic Clean" invoice template) |
| 8 | `components/app/invoices/templates/template-2.tsx` | 121 | **Print / PDF template view** (`seller.logo_url` in "Modern Minimal" invoice template) |
| 9 | `components/app/invoices/templates/template-3.tsx` | 138 | **Print / PDF template view** (`seller.logo_url` in "Executive Navy" invoice template) |
| 10 | `components/app/invoices/templates/template-4.tsx` | 118 | **Print / PDF template view** (`seller.logo_url` in "Compact Table" invoice template) |
| 11 | `components/app/settings/logo-upload-card.tsx` | 355 | **Client Blob preview / Logo URL** (`previewUrl \|\| currentLogoUrl` during tenant logo selection) |
| 12 | `components/app/settings/user-feedback-form.tsx` | 652 | **Client-side Blob preview URL** (`URL.createObjectURL(file)` for feedback screenshot attachment) |

---

## 4. TypeScript Target Fallout

- Upgrading `"target": "ES6"` to `"target": "ES2022"` produced **zero** new TypeScript diagnostics.
- `pnpm typecheck` passed cleanly on the first run with exit code 0.

---

## 5. Production Build Route Table Comparison (Before vs. After)

Both builds were executed with a clean `.next` directory (`rm -rf .next`) and CI placeholder environment variables matching `.github/workflows/ci.yml`.

### Route Table (Both Before and After are 100% Identical)

```
Route (app)
┌ ƒ /
├ ○ /_not-found
├ ƒ /admin
├ ƒ /admin/dev-boundary-test
├ ƒ /api/auth/[...path]
├ ƒ /api/business/[id]/logo
├ ƒ /api/cron/retry-invoice-archival
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
├ ○ /manifest.webmanifest
├ ○ /opengraph-image
├ ○ /privacy
├ ƒ /products
├ ƒ /products/[id]/edit
├ ƒ /products/new
├ ƒ /reports
├ ○ /robots.txt
├ ƒ /settings
├ ○ /signup
├ ○ /sitemap.xml
├ ○ /terms
└ ○ /twitter-image

ƒ Proxy (Middleware)

○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand
```

- **Route Count:** 34 total application routes (10 static prerendered, 24 dynamic server-rendered) plus Proxy Middleware.
- **Route Diff:** Exactly 0 route differences.
- **Size Difference:** None (Turbopack in Next.js 16 outputs route markers and dynamic server-rendered endpoints without bundle size shifts).

---

## 6. Build Warnings

The warnings printed during the production build in `build-after.log` were:
1. `⚠ No build cache found. Please configure build caching for faster rebuilds. Read more: https://nextjs.org/docs/messages/no-cache`  
   *(Expected following `rm -rf .next` clean build)*
2. `[@sentry/nextjs - After Production Compile] Warning: No organization slug provided. Will not create release. Please set the 'org' option to your Sentry organization slug.`  
   *(Expected in local/CI environments where Sentry release creation is omitted)*
3. `[@sentry/nextjs - After Production Compile] Warning: No org provided. Will not upload source maps. Please set the 'org' option to your Sentry organization slug.`  
   *(Expected in local/CI environments without active Sentry upload tokens)*

---

## 7. Verification & Command Results

| Command | Stage | Exit Code | Result |
|---|---|---|---|
| `git checkout main ; git pull ; git checkout -b fix/opt-003-build-hygiene` | Branching | 0 | Branched from main (`a89a931`) |
| `pnpm typecheck` | Baseline | 0 | Clean (zero errors) |
| `pnpm lint:ratchet` | Baseline | 0 | 0 problems (0 errors, 0 warnings; baseline 0/0) |
| `pnpm knip` | Baseline | 0 | Clean (0 findings) |
| `pnpm exec vitest run` | Baseline | 0 | 183 passed, 4 skipped (187 files); 1492 passed, 12 skipped, 1 todo |
| `pnpm build > build-before.log` | Baseline Build | 0 | Built cleanly with Turbopack |
| `pnpm typecheck` | Post-Fix | 0 | **Pass (zero errors under ES2022)** |
| `pnpm lint:ratchet` | Post-Fix | 0 | **Pass (0 errors, 0 warnings; stays 0/0)** |
| `pnpm knip` | Post-Fix | 0 | **Pass (0 findings)** |
| `pnpm exec vitest run tests/unit/opt003-build-hygiene.test.ts` | Guard Test | 0 | 5/5 passed |
| `pnpm exec vitest run` | Post-Fix | 0 | **184 passed, 4 skipped (188 files); 1498 passed, 12 skipped, 1 todo (+5 new tests)** |
| `pnpm build > build-after.log` | Post-Fix Build | 0 | **Pass (34/34 routes match build-before.log)** |
| `pnpm print-css:build` | Verification | 0 | `lib/pdf/print-stylesheet.generated.ts` verified identical (0 diff) |

---

## 8. Observations & Edge Cases
- All modifications are strictly configuration and documentation; no application code or runtime behavior changed.
- `print-stylesheet.generated.ts` was regenerated and confirmed completely unchanged.
- Both temporary build logs (`build-before.log` and `build-after.log`) were deleted prior to report completion.


---

## Reviewer verification (Claude Code, 2026-11-09)

Reviewed the full diff against `main` (`a89a931`) and re-ran everything independently. The diff matches the plan exactly; no code changes were needed.

### Browser output is unchanged (proof)
- Built `main` and this branch in the same folder (CI placeholder env, clean `.next` each time) and compared every file in `.next/static`.
- Raw hashes differ, but **two builds of the same branch code also differ** (21 files), so the build is not byte-reproducible. Every difference is a per-build random value: Sentry `_debugIds`, Server Action reference IDs, and the numeric module IDs derived from them.
- After blanking out only those random values: **all 60 client JS/CSS files are identical** between `main` and the branch, and all CSS is byte-identical. The image setting never appeared in client code in either build.
- The build route tables are identical.
- Conclusion: the ES2022 target and the removed `images.unoptimized` change nothing that users download. `images.unoptimized` only affected `next/image`, which is not used; the `/_next/image` endpoint now exists but, with no `remotePatterns`, it can only serve files from `public/`.

### Checks (reviewer re-run)
| Command | Result |
|---|---|
| `pnpm typecheck` (ES2022) | pass, no new errors |
| `pnpm lint:ratchet` | 0 / 0 (at baseline) |
| `pnpm knip` | no findings |
| `pnpm exec vitest run` | 184 files passed / 4 skipped; 1498 tests passed, 12 skipped, 1 todo |
| `pnpm build` (CI env), main and branch | both pass, same route table, no warnings |
| `pnpm print-css:build` | generated stylesheet unchanged |
| Mutation: engines `25.x` | guard test fails as intended (restored) |

### Small reviewer edit
- `docs/DEPLOYMENT.md`: added the blank line after the new heading (Markdown formatting only).

### Notes
- `engines: "24.x"` is what Vercel uses for the Node version; `.nvmrc` (24.18.0) stays the exact version for local work and CI.
- Launch day: if a proxy/CDN is put in front of Vercel, re-check `serverActions.allowedOrigins` (already on the launch-day list).
