# ARCH-PDF: Statutory PDF Archival Migration & In-Process Static HTML Rendering

## Executive Summary
Statutory PDF archival previously failed in production because the PDF generation vendor was directed to fetch ephemeral, token-gated render routes (`/api/invoices/[id]/archival-render` and `/api/credit-notes/[id]/archival-render`). These routes depended on complex single-use v2 signing tokens (`ARCHIVAL_SIGNING_SECRET`), Redis replay guards, and custom CSP relaxations.

Under **ARCH-PDF**, statutory document rendering is migrated entirely **in-process**:
1. Server actions and background cron workers invoke `buildArchivalHtml(kind, id)`, which statically renders the document using `react-dom/server.edge`'s `renderToStaticMarkup` with snapshot-backed seller/buyer details and an embedded compiled print stylesheet (`lib/pdf/print-stylesheet.generated.ts`).
2. Self-contained HTML is sent directly in the POST body to the PDF generation vendor (`https://e.customjs.io/html2pdf`) via `renderHtmlToPdfBuffer(html, options)`.
3. Obsolete render routes, signing tokens, Redis replay locks, and header workarounds have been completely removed, simplifying architecture and eliminating token exposure risk in external vendor access logs.

---

## Changes Made

### Part A: Server-Safe Print Components
Removed `'use client'` from all five print components:
- `components/app/invoices/templates/template-1.tsx`
- `components/app/invoices/templates/template-2.tsx`
- `components/app/invoices/templates/template-3.tsx`
- `components/app/invoices/templates/template-4.tsx`
- `components/app/credit-notes/credit-note-print-view.tsx`

Verified that none of these components use client-only hooks (`useState`, `useEffect`, etc.), browser globals (`window`, `document`), or event handlers (`onClick`). They are now safe for both RSC rendering and server-side static markup generation.

### Part B: `lib/pdf/archival-document.ts`
Created `lib/pdf/archival-document.ts` exporting:
- `ArchivalDocumentError` (with `reason` and `failure: ArchivalDocumentFailure` properties: `'not_found' | 'not_finalized' | 'original_invoice_not_found' | 'seller_snapshot_unavailable'`)
- `buildArchivalHtml(kind: ArchivalKind, id: string): Promise<{ html: string; title: string }>`:
  - Fetches the invoice or credit note from Drizzle ORM.
  - Validates `lifecycle_status === 'finalized'`.
  - Resolves frozen seller snapshot details via `resolveSellerDetails`.
  - Injects logo base64 data URI via `loadLogoDataUri`.
  - Resolves finalized display preferences via `resolveFinalizedDisplayPrefs`.
  - Injects the compiled static print stylesheet via `buildArchivalHtmlDocument`.

### Part C: `lib/pdf/html-to-pdf-provider.ts`
Replaced `renderUrlToPdfBuffer` with `renderHtmlToPdfBuffer(html: string, options: RenderOptions = {}): Promise<Buffer>`:
- Enforces `MAX_HTML_BYTES = 8 * 1024 * 1024` (8 MB) cap before calling `getPdfEnv()`, throwing `PdfRenderError('invalid_input', ...)`.
- Sends POST request with `Content-Type: application/json`, `Accept: application/pdf`, `x-api-key: HTML_TO_PDF_API_KEY`.
- Payload format: `{ input: { html, config: { pdfWidthMm: 210, pdfHeightMm: 297 } } }`.
- Error redaction: scrubs response error text with `scrubString()` to prevent leaking PII or credentials.
- Validates PDF output `%PDF-` header and 20 MB size ceiling.

### Part D: `lib/storage/archival-core.ts`
Updated archival worker pipeline:
- Calls `buildArchivalHtml(kind, id)` to generate HTML in-process.
- Passes HTML directly to `renderHtmlToPdfBuffer(html, { timeoutMs: PDF_RENDER_TIMEOUT_MS })`.
- Uploads resulting PDF buffer to iDrive E2 storage (`s3Key`).
- Records structured error logs via `logError('archival-failed', error, { kind, documentId: id, attempts })`.

### Part E: Deletions & Reference Cleanup
Deleted 10 obsolete files:
- `app/api/invoices/[id]/archival-render/route.ts`
- `app/api/credit-notes/[id]/archival-render/route.ts`
- `lib/security/archival-token.ts`
- `lib/security/archival-route-guard.ts`
- `lib/security/archival-replay-guard.ts`
- `tests/unit/archival-token.test.ts`
- `tests/unit/archival-token-redaction.test.ts`
- `tests/unit/archival-route-guard.test.ts`
- `tests/unit/archival-replay-guard.test.ts`
- `tests/unit/archival-render-routes.test.ts`

Cleaned up references across:
- `lib/env.ts`: removed `ArchivalEnv`, `archivalEnv`, `getArchivalEnv`, and removed from `CORE_GROUPS`.
- `README.md` & `.env.example`: removed `ARCHIVAL_SIGNING_SECRET`.
- `.github/workflows/ci.yml`: removed `ARCHIVAL_SIGNING_SECRET`.
- `docs/e2e-staging-setup.md`: removed `ARCHIVAL_SIGNING_SECRET`.
- `config/security-headers.mjs` & `config/security-headers.d.mts`: removed `ARCHIVAL_RENDER_PATH_PATTERN` and `buildArchivalCspPolicy`. Simplified global rule to `source: '/:path*'` returning a single uniform rule.
- `tests/unit/security-headers.test.ts`: updated for 1 rule matching `/:path*`, deleted tests 4 and 5, renumbered remaining tests.
- `lib/rate-limit/upstash.ts`: updated comment on line 66.
- `ARCHITECTURE.md`: updated Archival Strategy and marked SEC-004 as retired.
- Integration tests: removed obsolete `getArchivalEnv` mocks.

### Part F: E2E Proof of Archival Wiring
- Added `E2E_EXPECT_ARCHIVAL` to `e2e/support/env.ts` (defaults to `false`).
- Wired `E2E_EXPECT_ARCHIVAL: ${{ vars.E2E_EXPECT_ARCHIVAL || 'false' }}` in `.github/workflows/e2e.yml`.
- Added database polling in `e2e/specs/01-journey.spec.ts` under Step 5 when `env.E2E_EXPECT_ARCHIVAL` is enabled.

---

## Verification Results

1. **Architecture Guards (`tests/unit/arch-pdf-guards.test.ts`)**:
   - Guard 1: The 10 obsolete files do not exist on disk — **PASS**
   - Guard 2: No obsolete modules or secret symbols referenced — **PASS**
   - Guard 3: `buildSecurityHeaderRules` returns 1 uniform rule for `/:path*` — **PASS**
   - Guard 4: All 5 print components do not contain `'use client'` — **PASS**

2. **Unit Tests**:
   - `tests/unit/pdf-provider.test.ts` (8 tests) — **PASS**
   - `tests/unit/archival-document.test.ts` (6 tests) — **PASS**
   - `tests/unit/security-headers.test.ts` (7 tests) — **PASS**
   - `tests/unit/admin-env.test.ts` (10 tests) — **PASS**

3. **Full Vitest Suite**:
   - **1,372 tests passed** (12 skipped, 4 todo).

4. **TypeScript**:
   - `pnpm typecheck` (`tsc --noEmit`) — **PASS (0 errors)**.

5. **Linting**:
   - `pnpm lint:ratchet` — **PASS (at baseline: 0 errors, 1 warning)**.

6. **Stylesheets**:
   - `pnpm print-css:build` succeeded; `lib/pdf/print-stylesheet.generated.ts` verified with 0 diff.

7. **Dependency Audit Gate**:
   - `node scripts/ci/audit-gate.mjs` — **PASS (exit 0)**.

8. **Production Build**:
   - `pnpm build` (`next build`) — **PASS (Compiled in 18.5s, 0 errors)**.
   - Verified route manifest has no `/archival-render` routes.


---

## Reviewer verification (Claude Code, 2026-11-09)

Verified on branch `fix/arch-pdf-archival` against `main` `92ce554`; every changed file was read.

- **Real vendor proof (the point of this issue):** with the user's new `HTML_TO_PDF_API_KEY`, a temporary script (deleted) built archival HTML with the new `buildArchivalHtml` for the newest finalized **invoice `BMA/26-27/0004`** and **credit note `CN/26-27/001`** on the staging DB (read-only) and sent it through the new `renderHtmlToPdfBuffer`:
  - invoice: HTML 237 KB, no `<script`, invoice number present → **valid PDF 262 KB (`%PDF-`) in 5.4 s**
  - credit note: HTML 227 KB → **valid PDF 82 KB in 4.5 s**
  - no vendor branding/watermark text found in either PDF's content streams.
  - Screenshots of the exact HTML sent show the **complete layouts** (seller + GSTIN, buyer, place of supply, line items, CGST/SGST, grand total, amount in words, terms; credit note with Section 34 reference, original invoice and reason) — confirming the print components now render server-side after removing `'use client'`.
- **Correct as delivered:** archival HTML logic moved verbatim into `lib/pdf/archival-document.ts` (typed `ArchivalDocumentError`); provider sends `{ input: { html, config: { pdfWidthMm: 210, pdfHeightMm: 297 } } }` with `Accept: application/pdf`, 8 MB HTML guard, scrubbed errors; `archival-core` builds HTML in-process and logs failures; render routes, archival token, route guard, replay guard, `ARCHIVAL_SIGNING_SECRET` (env group, `.env.example`, CI, docs, README env table) and the archival-only security-header rules removed; `'use client'` removed from the 5 display-only print components. The `as unknown as CreditNotePrintViewProps['creditNote']` cast in the credit-note builder was carried over verbatim from the deleted route (not new).
- **Reviewer fix:** the new gated E2E archival check (`E2E_EXPECT_ARCHIVAL`) queried a column `archival_s3_key` that **does not exist** (the key is `pdf_storage_key`) — it would have failed the moment the check was enabled. Fixed the column, cast `archival_status::text`, and used the specified 60 s wait (render alone may take 25 s).
- **Checks (local):** `pnpm typecheck` clean; `pnpm lint:ratchet` = baseline 0/1; `pnpm exec vitest run` 167 files passed, 4 skipped (1382 tests); `pnpm build` OK (proves `react-dom/server.edge` + the server-safe templates bundle into the finalize action path); audit gate exit 0; print stylesheet unchanged.
- **User follow-up after merge:** delete `ARCHIVAL_SIGNING_SECRET` from `.env.local`, `.env.vercel-preview.local` and Vercel Preview (no code reads it any more). Production gets its own valid CustomJS key at launch.

### Preview verification (Vercel preview of PR #24, 2026-11-09)

- **CI:** all 7 checks green on `6438e3b`.
- **Local E2E with the archival check ON (`E2E_EXPECT_ARCHIVAL=true`):**
  - Run 1: Step 5 (finalize → wait for `archived`) **passed**; the run later failed at Step 8 with `page.goto('/reports')` not reaching the `load` event in 30 s. The Playwright trace shows the document served in 0.49 s and every sub-resource done by ~0.6 s, then ~20 s of browser inactivity — a client-side stall seen only in local runs (video + trace recording on this PC), never in CI. Not related to archival.
  - Run 2: **22 passed, 1 skipped (mailbox)**, including the archival wait.
- **Database (read-only) after run 2:** journey invoice `BMA/26-27/0001` → `archived`, attempt 1, PDF key stored, archived **6 s** after finalize; journey credit note `CN/26-27/001` → `archived`, attempt 1, PDF key stored; all 3 invoices finalized on staging in the previous 30 min are `archived`.
- **Download PDF (first time ever visible):** on the archived invoice the **Email** and **Download PDF** buttons appear; Download PDF returns a short-lived iDrive e2 URL (`s3.ap-northeast-1.idrivee2.com`) serving a **266 KB `application/pdf`** starting with `%PDF-`. (Email was not clicked to avoid sending a real e-mail; its server gate only required `archived`, which is now true.)
- **Hydration probe:** 0 errors on all 8 pages; sidebar 68 / 220 / 68 px at 800 px.
- **Noted, not in scope:** invoice templates 1–4 load the Lora font from Google Fonts via `@import` (already listed as tracked debt in ARCHITECTURE.md: self-host Lora); the browser logs cross-origin font errors for it on invoice pages.
