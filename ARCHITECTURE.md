# Bill Matrix — Architecture & Folder Conventions

This document defines where code lives in this project. Every future feature should fit one of the categories below without needing a new top-level folder. If you're an AI coding agent working on a future phase, follow this document — don't invent a new convention.

## Core principle: Server Actions first, Route Handlers only for true external HTTP

This app uses Next.js Server Actions as the default way pages talk to the backend (form submissions, button clicks, data mutations). A Route Handler (`app/api/.../route.ts`) is only created when something outside a browser session needs to hit an HTTP endpoint directly — for example, a webhook from Resend or a future payment provider. If you're unsure which to use: if a logged-in user triggers it from the UI, it's a Server Action in `lib/actions/`. If an external service calls it, it's a Route Handler in `app/api/`.

## Folder reference

| Folder | Purpose | Introduced in |
|---|---|---|
| `app/(marketing)`, `app/(auth)`, `app/(app)`, `app/(admin)` | Page routes, grouped by access level. Not modified by backend phases except to wire in real data. | Existing (v0) |
| `app/api/` | Route Handlers for true external HTTP endpoints only (webhooks, health checks). Rare — most things are Server Actions instead. | Phase 1 (empty), used starting Phase 16+ |
| `lib/db/` | Drizzle ORM schema (`lib/db/schema/`) and the database client. The single source of truth for the data model. | Phase 2 |
| `lib/db/scripts/` | One-off diagnostic or migration scripts (e.g. data correction scripts). These MUST be idempotent, safe to re-run, have clear console output, and be deleted once their one-time job is fully confirmed in production. They should not accumulate. | Phase 8 |
| `lib/auth/` | Neon Auth / Better Auth setup and session helpers. | Phase 3 |
| `lib/actions/` | Server Actions, grouped into one subfolder per business domain (`customers/`, `products/`, `invoices/`, `credit-notes/`, `payments/`, `reports/`, `business/`). Each domain folder contains the create/read/update actions for that domain. `_shared/` holds the common wrapper every action uses for validation and error handling — see Phase 4. | Phase 4 (`_shared`), then per domain in later phases |
| `lib/validations/` | Zod schemas that validate input before it reaches a Server Action. One file per domain, matching `lib/actions/`. | Phase 5 onward |
| `lib/gst/` | The GST tax calculation engine — pure functions only, no database or UI code. This is the most important folder in the app for correctness; keep it isolated and testable. | Phase 8 |
| `lib/gst/units.ts` | The official, government-fixed list of GST Unit Quantity Codes (UQC), used for product unit-of-measurement selection and (in later phases) invoice line items. This is a closed list — do not add codes that aren't officially recognized by CBIC. | Phase 7 |
| `lib/invoices/` | Invoice-numbering logic (financial-year-aware sequencing). Kept separate from `lib/actions/invoices/` because numbering is a pure rule, not a database action. | Phase 9 |
| `lib/invoices/status.ts` | PURE, live-computed invoice status. The 'overdue' state is intentionally never written to the database to avoid relying on cron jobs; it is computed fresh on every read by comparing the locked due_date against the current date. | Phase 13 |
| `lib/actions/payments/` | Contains payment recording actions. Overpayment checks and 'fully paid' status determination directly factor in finalized credit notes reducing the actual amount owed. | Phase 13 (updated Phase 12) |
| `lib/actions/credit-notes/` | Server Actions for Credit Notes (create draft, finalize, list, get, delete draft). Numbering strictly adheres to CGST Rule 53 (<= 16 chars, FY-aware, sequential). | Phase 12 |
| `lib/actions/reports/` | Reporting and dashboard stat Server Actions. Figures factor in finalized credit notes. | Phase 14 & Phase 12 |
| `lib/reports/period.ts` | Centralized logic for computing date ranges (This Month, Financial Year). Shared groundwork to ensure Phase 15's Excel export logic reuses exact same bounds. | Phase 14 |
| `lib/pdf/` | Currently contains `number-to-words.ts` and `html-to-pdf-provider.ts` (swappable CustomJS API for external PDF rendering). | Phase 10 & 11 |
| `lib/storage/` | iDrive e2 (S3-compatible) client for archiving finalized invoice and credit note PDFs, and orchestration logic. | Phase 11 & Phase 12 |
| `lib/security/` | Token and signature generation (e.g. HMAC-SHA256 tokens for external route access). | Phase 11 |
| `lib/excel/` | ExcelJS-based export logic for the monthly ITR/GST export. Populates Sales Register and GSTR-1 CDNR sheets with finalized credit notes. | Phase 15 & Phase 12 |
| `lib/email/` | Resend client (`lib/email/`) and email templates (`lib/email/templates/`). Note that email attachments always come from Phase 11's archived PDF (never generated fresh). This makes the archival step in Phase 11 a hard dependency for emailing invoices. | Phase 16 |
| `lib/rate-limit/` | Upstash Redis-based rate limiting, applied to sensitive Server Actions. | Phase 17 |
| `lib/money.ts` | Shared money utilities: paise↔rupee conversion (rupeesToPaise, paiseToRupees) and Indian currency formatting (formatPaiseAsInr). All monetary amounts in this app are stored as integer paise — this file is the single source of truth for converting between storage and display. Used by product pricing (Phase 7) and will be used by the GST tax engine and invoice line items (Phase 8+). | Phase 7 |
| `types/` | Shared TypeScript types used across more than one domain (e.g., a shared `Money` or `TaxBreakdown` type). Domain-specific types that are only used within one folder can stay local to that folder instead. | Phase 2 onward |
| `components/` | UI components (existing, from v0). Not restructured by backend phases. | Existing (v0) |

## Naming conventions

- Files: kebab-case (`invoice-numbering.ts`, not `invoiceNumbering.ts`)
- Functions and variables: camelCase
- Types and React components: PascalCase
- Each domain's Server Actions file is named after the action it performs where possible (e.g., `lib/actions/customers/create-customer.ts`) rather than one giant `actions.ts` file per domain — this keeps files small and easy for an AI agent to open and edit without pulling in unrelated code.
- Settings profile completion sets the initial `business_id` required for all other operations.
- The active UI mirrors the current navigation state using `usePathname()`.

## Domain Modules Implemented

Customer Management (Phase 6) and Product/HSN Catalog (Phase 7) follow the Server Action and Form Conventions established in Phases 4-5 exactly — see `lib/actions/customers/*.ts` and `lib/actions/products/*.ts` as additional reference examples alongside `ping.ts`.

## Server Action Convention (established Phase 4)

All Server Actions in this app share a consistent envelope and error-handling pattern using wrappers defined in `lib/actions/_shared/create-action.ts`.

- **ActionResult<T> Envelope**: Every action returns a unified `{ success: true, data: T } | { success: false, error: ... }` shape. This ensures UI code can always safely check `.success` first without needing custom `try/catch` blocks for expected failures, and prevents raw server errors from ever leaking to the client.
- **ActionError vs. System Errors**: If an action throws an `ActionError` (from `lib/actions/_shared/errors.ts`), it is treated as a safe, expected business error (e.g. "This invoice is already finalized"). Its `.message` will be shown to the user VERBATIM. Any other error (a database crash, a null pointer, a plain `Error`) is treated as an unexpected system fault. It will be replaced with a generic fallback message for the user, but the real error and stack trace will be fully logged server-side for debugging.
- **Strict Wrapper Requirement**: All new Server Actions from Phase 5 onward MUST use `createAction` or `createAuthenticatedAction` from `lib/actions/_shared/create-action.ts`. Do not write a new `try/catch`-based action from scratch — if the existing wrapper doesn't fit a new situation, extend the wrapper itself rather than bypassing it.
- **Business Logic Scope**: This wrapper handles input validation (via Zod), authentication (via `getCurrentAppUser`), and error safety generically. It deliberately does NOT enforce business-specific rules like "the current user's business_id must be set" — each domain action is responsible for its own such checks (e.g., via `ActionError`) since not every action necessarily requires one.
- **Revalidation**: `revalidatePath()`/`revalidateTag()` calls after a mutation are the responsibility of each individual action, not this shared wrapper, since different actions affect different pages.

**Example Usage**: (See `lib/actions/_shared/ping.ts` for the complete canonical live example)

```typescript
import { z } from 'zod';
import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { ActionError } from '@/lib/actions/_shared/errors';

const myActionSchema = z.object({
  name: z.string().min(1, 'Name is required'),
});

export const myDomainAction = createAuthenticatedAction(myActionSchema, async (input, context) => {
  if (input.name === 'forbidden') {
    throw new ActionError('This name is not allowed for business reasons.', { code: 'FORBIDDEN_NAME' });
  }
  // context.appUser is guaranteed to be populated here
  return { id: 123, savedName: input.name, byUser: context.appUser.id };
}, 'my-domain-action');
```

## Form Convention (established Phase 5)

Data-entry forms in this app use React Hook Form combined with the same Zod schemas used server-side, so validation logic is written once and shared between client and server.

- Each domain gets one Zod schema in lib/validations/{domain}.ts (e.g., businessProfileSchema), used BOTH as the RHF resolver (via @hookform/resolvers/zod) on the client for instant feedback, AND inside the matching Server Action on the server for real enforcement — never trust client-side validation alone.
- The client form component calls useForm({ resolver: zodResolver(schema), defaultValues: ... }).
- On submit, the form calls the Server Action directly with the validated data, then checks the returned ActionResult: on success, show a simple inline success message and let revalidatePath (called inside the action) refresh the underlying data; on failure with fieldErrors present, map each field's first error message into RHF's setError(fieldName, { message }) so it displays inline under that exact field; on failure without fieldErrors (a general ActionError), show the message in a general error banner at the top of the form.
- Pages that display a form are split into an async Server Component (e.g., app/(app)/settings/page.tsx) that fetches the current real data, and a 'use client' component that receives that data as defaultValues props and handles the interactive form — this keeps data-fetching on the server and interactivity on the client, matching the pattern already established in Phase 3's auth pages.
- No toast/notification library has been introduced for this — use simple inline success/error banners with existing UI primitives, since introducing new UI dependencies is out of scope for backend-focused phases.

## Decision guide — "where does my code go?"

- Is it something the user sees or clicks? → `app/` or `components/`
- Is it triggered by a user action and touches the database? → `lib/actions/{domain}/`
- Is it validating the shape of input data? → `lib/validations/`
- Is it a pure calculation with no side effects (tax math, numbering rules)? → `lib/gst/` or `lib/invoices/`
- Is it talking to an external service (storage, email, rate limiting)? → its own `lib/{service}/` folder
- Is it a type used in more than one place? → `types/`

## Archival Strategy (Phase 11)

Archival of finalized invoices happens automatically upon finalization using a best-effort approach (non-blocking). 
- If the external PDF provider or storage provider is slow/down, the invoice is still finalized to ensure business continuity.
- A daily cron job serves as a safety net to retry pending or failed archival jobs.
- **Out of scope for MVP:** Formal "cold tier" data migration and reviewed deletion are deliberately scoped OUT of this MVP phase. For the complete legal protocol, statutory cutoff dates (Year 8+), and implementation guide for when financial years are ready to be closed and purged, see `docs/STATUTORY_ARCHIVAL_BLUEPRINT.md`.

## Why this structure

Every folder above maps to exactly one future phase in `BillMatrix_Backend_Roadmap_v1.md`. Nothing here is speculative — each folder exists because a specific, already-planned phase needs it. This means the project never needs a restructuring pass later: as each phase is implemented, its code goes into a folder that was already waiting for it.

## Security Conventions (established Phase 17)

Rate limiting uses Upstash Redis and provides three core limiters:
- **`authLimiter`**: 5 req/min, per IP (for login/signup endpoints without a session yet).
- **`sensitiveActionLimiter`**: 20 req/min, per user ID (for critical actions like finalizing, sending email, or recording payments).
- **`exportLimiter`**: 10 req/5min, per user ID or IP (for expensive PDF renders or Excel exports).

**Applying rate limits:**
- **Server Actions**: Opt-in incrementally via the `options.rateLimit` property in `createAction` and `createAuthenticatedAction` without requiring changes to the bulk of generic database wrappers.
  ```typescript
  export const myAction = createAuthenticatedAction(schema, async (input, context) => {
    // ...
  }, 'my-action', { rateLimit: { limiter: sensitiveActionLimiter, keyPrefix: 'my-action' } });
  ```
- **Route Handlers**: New Route Handlers added in the future need their own direct rate-limit checks (since the `createAction` wrapper does not govern Route Handlers). Check it using `checkRateLimit` alongside token verification or session extraction.

## Monitoring & Logging (established Phase 18, hardened ARCH-005)

Sentry is the live observability implementation behind `lib/actions/_shared/logger.ts`'s `logError()` function and application request monitoring.
- **Request Error Capture (`onRequestError`)**: `instrumentation.ts` exports `onRequestError = Sentry.captureRequestError`, automatically capturing unhandled errors from React Server Components (RSC) rendering, Route Handlers, and proxy routing into Sentry.
- **Per-Runtime Initialization**: Sentry configuration is resolved via `lib/observability/sentry-config.ts` separately for each runtime (`nodejs`, `edge`, and `client`). Server runtimes prefer `SENTRY_DSN` with a fallback to `NEXT_PUBLIC_SENTRY_DSN`; the client uses `NEXT_PUBLIC_SENTRY_DSN` exclusively. Each runtime attaches a runtime tag (`initialScope: { tags: { runtime } }`). `environment` and `release` are resolved from Vercel metadata (`VERCEL_ENV`, `VERCEL_GIT_COMMIT_SHA`) or fallback to `NODE_ENV`.
- **Sensitive Data Scrubber (Edge-Safe)**: All events pass through `beforeSend` and `beforeSendTransaction` using `scrubSentryEvent` from `lib/observability/sentry-redaction.ts`. It performs case-insensitive key-based redaction for PII/secrets (GSTIN, email, phone, account numbers, IFSC, UTR, PAN, UPI, passwords, tokens, auth headers) and ordered value-based pattern replacement on free text (emails, GSTIN, IFSC, PAN, Bearer tokens, query param secrets). It features ancestor-based cycle detection, depth capping (12), and fails closed (drops the event on scrubber failure rather than throwing into the request path). Structural Sentry fields and numeric business fields (e.g. `*_paise`) survive unscrubbed.
- **Expected Error Breadcrumbs**: Expected business errors (`ActionError`s where `meta.expected === true`) represent normal, user-recoverable domain conditions. `lib/actions/_shared/logger.ts` records them as info breadcrumbs (`category: 'expected-error'`) rather than capturing Sentry exception issues, preventing issues and alerts from being flooded.
- **Client Initialization & Idempotency**: Due to a Next.js 16 + Turbopack auto-import issue, `<SentryInit />` (`components/sentry-init.tsx`) is mounted in `app/layout.tsx` to dynamically import `instrumentation-client.ts`. To prevent double initialization when loaded both by Next's loader and `<SentryInit />`, client initialization is guarded with `Sentry.getClient() === undefined`.
- **Direct `process.env` Exception (ARCH-002 / ARCH-005)**: Direct reads of `process.env` are restricted across the codebase to `lib/env.ts` (validated at boot). As an explicit exception, configuration entry points that execute during framework bootstrap before standard modules load are permitted to read `process.env` directly: `next.config.mjs`, `instrumentation.ts`, and `instrumentation-client.ts`. The helper modules under `lib/observability/*` remain pure functions and never access `process.env`.
- **Build-Time Source Map Uploads**: `next.config.mjs` configures `withSentryConfig` using environment variables (`SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`, `VERCEL_GIT_COMMIT_SHA`). If required variables are absent in production, a build-time warning is logged while preserving the build.
- **Global Error Boundary**: `app/global-error.tsx` captures top-level React rendering errors and reports them via `Sentry.captureException`.
- **Alerting**: Alerting rules are configured directly in the Sentry dashboard, not in code.

## High-Density ERP UI Specifications (Strict Freeze)

To maximize data visibility and prevent table horizontal blowout on financial records, the platform follows high-density ERP standards (analogous to QuickBooks, Zoho Books, and Tally). These tokens are intentional design decisions and must NOT be altered by automated touch-target audits:
- **Table Row Action Buttons:** Explicitly locked to `size-7.5` (30×30px) with `gap-1` and `size-3.5` icons (`app/(app)/invoices/client.tsx`). Compliant with WCAG 2.5.8 Exception for tabular and inline controls.
- **Sidebar Collapse Toggle:** Explicitly locked to `size-6` (24×24px) at `-right-3` with `size-3.5` chevron icon (`components/app/app-sidebar.tsx`).
- **Invoice Line-Item Actions:** Delete button locked to `size-7` (28×28px) with `size-3.5` icon; drag handle locked to `20×24px` with universal touch-drag gesture (`components/app/invoices/invoice-form.tsx`).


## Concurrency and lock order (established Phase 1 / API-002, extended API-003)

To prevent duplicate or gapped statutory sequence numbers (CGST Rule 46/53), race conditions leading to overpayment or double voiding, and stale payment status updates under concurrent operations:

1. **Global Lock-Order Contract:**
   All transactional modifications must acquire locks in the strict hierarchical sequence:
   `invoice row -> credit-note row -> payment row -> financial_years row -> invoice_number_counters row`
   Never acquire an earlier lock after a later one in the same transaction. Draft-save actions lock only the specific document they edit (`FOR UPDATE`).

2. **Pure Transactional Modules (`lib/invoices/*-tx.ts`):**
   Transaction bodies are extracted into pure, side-effect-free library modules (`finalizeDraftInvoiceInTransaction`, `finalizeDraftCreditNoteInTransaction`, `recordPaymentInTransaction`, `voidPaymentInTransaction`, and `voidCreditNoteInTransaction`).
   - Server Actions (`finalize-invoice.ts`, `finalize-credit-note.ts`, `record-payment.ts`, `void-payment.ts`, `void-credit-note.ts`) act as thin wrappers handling authorization, rate limiting, retry execution, post-commit revalidations, and non-blocking background tasks.
   - The invoice row is locked `FOR UPDATE` as the first data statement of every document-altering transaction. Waiters block until earlier transactions commit, then re-evaluate committed state before mutating counters or balances.
   - For void transactions (`void-payment-tx.ts`, `void-credit-note-tx.ts`), the document is peeked without locking to find the associated `invoice_id`, the invoice row is locked first, and then the child record (`payments` or `credit_notes`) is locked `FOR UPDATE`. This strictly maintains the `invoice -> credit-note -> payment` lock hierarchy and avoids deadlocks.
   - All state updates are self-guarding (e.g., `WHERE ... AND lifecycle_status = 'draft'` or `status = 'active'` with `.returning()` and an exactly-one-row check). Concurrent duplicate attempts fail fast without corrupting state or polluting statutory audit logs.

3. **Unified Payment Status Calculation (`lib/invoices/payment-status.ts`):**
   All four status writers (`recordPaymentInTransaction`, `voidPaymentInTransaction`, `voidCreditNoteInTransaction`, `finalizeDraftCreditNoteInTransaction`) invoke `recomputePaymentStatus(tx, lockedInvoice)`.
   - Ad-hoc inline SQL sums and scattered status updates are forbidden.
   - `netBill = max(0, grand_total - active_credit_notes)`
   - Status rules: `netBill === 0` -> `'paid'` (fully credited); `active_paid === 0` -> `'unpaid'`; `active_paid >= netBill` -> `'paid'`; otherwise `'partially_paid'`.
   - Under row lock, payments exceeding remaining balance (`netBill - active_paid`) are rejected with clear INR formatting.

4. **Strict Monetary and Calendar Validation:**
   - Rupee amounts are validated via exact decimal regex (`RUPEE_AMOUNT_PATTERN`) and converted to integer paise (`parseRupeesToPaise`) without float multiplication, rejecting values with >2 decimals (e.g. `0.004`), values < ₹0.01, or values exceeding schema bounds.
   - Calendar dates are verified with strict Gregorian day-count checking (`isValidIsoDate`), preventing JavaScript Date roll-over bugs (e.g. `2026-02-31`). Payment dates are bounded to `invoice_date <= payment_date <= today_IST`.

5. **Transaction Resilience & Fail-Fast Timing:**
   - Transactions begin with `await setLocalLockTimeout(tx)` (`SET LOCAL lock_timeout = '8000ms'`) so waiters fail fast rather than hanging serverless invocations.
   - Transactions are wrapped in `withTransactionRetry` to automatically retry transient deadlocks (`40P01`) and serialization failures (`40001`) with exponential backoff and jitter. Lock timeouts (`55P03`) and exhausted retries map to safe, user-friendly `BUSY` ActionErrors.

6. **Post-Commit Side Effects:**
   `revalidatePath`, PDF archival, email dispatch, and user notifications occur strictly **after** transaction commit, ensuring external side-effects only run for the winner and never cache stale uncommitted state.

7. **Document Immutability & Seller Snapshots (COMP-001):**
   - **Snapshot Model**: Upon finalization, legal documents (`invoices` and `credit_notes`) freeze the complete seller profile into immutable snapshot columns (`seller_name_snapshot`, `seller_trade_name_snapshot`, `seller_address_snapshot` (jsonb), `seller_state_code_snapshot`, `seller_phone_snapshot`, `seller_alternate_phone_snapshot`, `seller_email_snapshot`, `seller_nature_of_business_snapshot`, `seller_pan_snapshot`, `seller_bank_snapshot` (jsonb), `terms_snapshot`, `logo_storage_key_snapshot`, `seller_gstin_snapshot`, and `seller_snapshot_source`).
   - **Resolution Rule**: Pure function `resolveSellerDetails(doc, liveBusiness)` strictly governs presentation. If snapshot is present, the document renders exclusively from snapshot data (never live data). If the document is a draft and snapshot is absent, it renders from live business data. If the document is finalized but snapshot is absent or corrupt, it throws `SellerSnapshotError` (`SELLER_SNAPSHOT_MISSING` / `SELLER_SNAPSHOT_CORRUPT`) rather than silently falling back to live business data.
   - **Seller Snapshot Source & Backfill**: The `seller_snapshot_source` column tracks provenance (`'captured_at_finalization'` vs `'backfilled_from_profile'`). Legacy finalized rows backfilled in migration `0018` are flagged `'backfilled_from_profile'`, documenting the known imperfection that they reflect profile state at migration time rather than original finalization time.
   - **Invoice Date Policy (`INVOICE_BACKDATE_WINDOW_DAYS = 30`)**: Invoices cannot be dated in the future in IST. Backdating is restricted to a 30-day window from the latest finalized invoice within the same financial year series. Backdating across financial years requires explicit user confirmation (`confirm_cross_financial_year: true`); without confirmation, `INVOICE_DATE_CROSS_FY` is returned and no changes are committed.
   - **Logo Retention Rule**: S3/storage objects referenced by `logo_storage_key_snapshot` in any finalized invoice or credit note are retained permanently. `deleteLogoObjectIfUnreferenced` verifies whether an old logo key is referenced in document snapshots before deleting from storage. The logo route `/api/business/[id]/logo?k=` serves historical snapshot logo keys only if referenced by a document of that business, returning immutable cache headers.

## Platform admin authorization (AUTH-001)

- **Policy Model (`lib/auth/admin-policy.ts`)**: Pure evaluation function `evaluatePlatformAdmin(user, allowlist)`. A session matches platform admin rights if either:
  1. The user's server-generated `user.id` is present in `PLATFORM_ADMIN_USER_IDS` (`via: 'user_id'`). Server-generated IDs cannot be squatted or pre-registered.
  2. The user's email is present in `PLATFORM_ADMIN_EMAILS` (case-insensitive) AND `user.emailVerified === true` (`via: 'verified_email'`). Unverified sessions claiming an allowlisted email are strictly denied (`reason: 'email_unverified'`).
- **Single Gate (`lib/auth/admin.ts`)**: Centralizes `getPlatformAdminDecision()`, `requirePlatformAdmin()` (throws typed `ActionError('Unauthorized: Access denied.', { code: 'UNAUTHORIZED_ACCESS' })` and logs the reason server-side without leaking emails or verification states to users), and `isPlatformAdmin()`.
- **Action Guard (`requirePlatformAdmin: true`)**: `createAuthenticatedAction` accepts `{ requirePlatformAdmin?: boolean }`. When enabled, authorization runs immediately after session identity lookup, before rate limiting and before handler invocation.
- **Client Leakage Prevention**: Platform admin allow-lists are never exposed to the client or embedded in page payloads. The admin console settings panel displays static configuration guidance rather than environment strings.
- **Neon Auth E-mail Verification Configuration**: In Neon Console (Settings -> Auth -> "Sign-up with Email" and "Verify at Sign-up"), enable email verification. The verification link method requires a custom SMTP/email provider configured in Neon Auth. When verification is active, signup returns `{ notice: 'Account created. Please check your e-mail to verify your address, then log in.' }` rather than an immediate active session.

## Security headers & CSP rollout (SEC-001)

### 1. HTTP Security Headers Table

| Header | Value | Scope | Purpose |
|---|---|---|---|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | Production only (all routes) | Forces HTTPS for 2 years across domain and subdomains. |
| `X-Content-Type-Options` | `nosniff` | Global (all routes) | Prevents MIME-type sniffing of uploaded images/documents. |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Global (all routes) | Protects user privacy while retaining origin on cross-site requests. |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | Global (all routes) | Disables unused browser sensor/device APIs. |
| `X-Frame-Options` | `DENY` | Non-archival routes | Prevents clickjacking across the app. |
| `Content-Security-Policy` | `frame-ancestors 'none'; base-uri 'self'; object-src 'none'` | Non-archival routes | Enforced baseline for framing, base URI, and plugin restrictions. |
| `Content-Security-Policy-Report-Only` | Full application policy | Non-archival routes | Collects CSP violation reports in Sentry without breaking user flows. |
| `Content-Security-Policy-Report-Only` | Archival-specific policy (`default-src 'none'; script-src 'none'`) | Archival-render routes | Enforces script-free static document rendering for external PDF vendor. |

### 2. Two CSP Layers

1. **Enforced Baseline**: `frame-ancestors 'none'; base-uri 'self'; object-src 'none'`. Safe to enforce immediately across all application pages as no legitimate page is framed or uses `<base>`/plugins. Combined with `X-Frame-Options: DENY`, this reliably prevents clickjacking even in legacy browsers that ignore `frame-ancestors` in report-only mode.
2. **Full Policy as Report-Only (`Content-Security-Policy-Report-Only`)**: Covers scripts, styles, fonts, images, and network connections. Violations are dispatched to Sentry's security reporting endpoint derived dynamically from `NEXT_PUBLIC_SENTRY_DSN`. Controlled by a single constant `CSP_MODE = 'report-only' | 'enforce'` in `config/security-headers.mjs`.

### 3. Dedicated Archival-Render Header Rules

Archival-render routes (`/api/invoices/[id]/archival-render` and `/api/credit-notes/[id]/archival-render`) are fetched server-to-server and rendered headless by the external PDF generation vendor (CustomJS).
- They MUST NOT include `X-Frame-Options: DENY` or `frame-ancestors 'none'` to avoid interfering with headless browser capture pipelines.
- They enforce strict script-free execution (`script-src 'none'`, `default-src 'none'`) while permitting inline CSS and Google Fonts (`fonts.googleapis.com` / `fonts.gstatic.com`) for invoice template rendering.
- The global rule uses a negative-lookahead pattern (`/((?!api/(?:invoices|credit-notes)/[^/]+/archival-render).*)`) ensuring the global rules and archival rules never conflict or overwrite each other in Next.js.

### 4. Allow-List Debt

The current policy contains documented debt that should be retired before full enforcement:
1. `https://api.qrserver.com`: Used in `app/(app)/checkout/checkout-form.tsx` for UPI QR code generation. Tracked under **FE-005** to be replaced with a client-side SVG QR generator.
2. `https://fonts.googleapis.com` and `https://fonts.gstatic.com`: Loaded via `@import` in invoice templates 1–4. To be replaced with self-hosted Lora webfonts matching `app/layout.tsx`.
3. `'unsafe-inline'`: Required for inline styles and Next.js bootstrap scripts. Retained until the nonce phase.

### 5. Rollout Plan

1. **Step 1 (Current)**: Ship Report-Only (`CSP_MODE = 'report-only'`) with Sentry CSP report endpoint.
2. **Step 2**: Monitor Sentry CSP/Security Headers issue stream for at least 7 days across production traffic.
3. **Step 3**: Resolve allow-list debts (retire `api.qrserver.com` in FE-005, self-host print template fonts).
4. **Step 4**: Flip `CSP_MODE` to `'enforce'` in a single dedicated pull request once the report log is clean.
5. **Step 5**: Introduce per-request cryptographically secure nonces in `proxy.ts` to retire `'unsafe-inline'` for scripts.

### 6. HSTS Notes

- `includeSubDomains`: Enforces HTTPS across all subdomains. Ensure no subdomains of the apex domain rely exclusively on plain HTTP before deploying to production.
- `preload`: Indicates consent for inclusion in the Chrome/browser HSTS preload list. The token remains inert until the domain is manually submitted to [hstspreload.org](https://hstspreload.org). Do not submit without an explicit platform governance decision, as preload inclusion cannot be quickly reversed.


## Upload Validation & Storage Security (SEC-002)

All file uploads (payment screenshots, business logos, user feedback attachments) are strictly validated through the centralized pure security helper `lib/security/upload.ts`:

- **Decoupled Client Trust**: Client-declared MIME types, extensions, and file sizes are treated as unverified hints and are never used for storage keys, Content-Type headers, or validation decisions.
- **Magic Byte Inspection**: The true MIME type and canonical extension (`png`, `jpg`, `webp`, `pdf`) are derived solely by inspecting file magic bytes (`readUInt8`).
- **Pre-Decode Size Guards**: Base64 strings are bounded by character length prior to memory allocation (`maxBase64Chars`), and decoded buffer sizes are strictly enforced.
- **Server-Generated UUID Keys**: Storage object keys are constructed as `<prefix>/<uuid>.<ext>` using cryptographically random UUIDs (`buildUploadKey`), completely removing user input (such as payment reference numbers or transaction IDs) from storage paths.
- **Content-Disposition & Forced Download**: User-supplied uploads are stored with `Content-Disposition: attachment`. Signed URLs generated for evidence inspection (e.g. platform admin reviewing payment receipts) explicitly enable `forceDownload: true` (`ResponseContentDisposition: attachment`), preventing user-uploaded files from rendering directly as active HTML/SVG documents in administrator browsers.
- **Invoice & Credit Note PDFs**: System-generated invoice and credit note PDF downloads intentionally omit `forceDownload` to preserve inline browser PDF viewing.


## Money storage & limits (DB-003)

- **Canonical unit**: integer paise (₹1 = 100 paise).
- **Database representation**: Postgres `bigint` (int8) with Drizzle `{ mode: 'number' }` on all document money columns (27 total across `invoices`, `credit_notes`, `payments`, `invoice_line_items`, `credit_note_line_items`).
- **Catalog prices**: `products.default_sale_price_paise` remains `integer` (int4) because it is bounded by Zod at ₹99,99,999.99 (999,999,999 paise < 2^31). Subscription request amounts remain `integer` for the same reason.
- **JavaScript safety**: bounded by `Number.MAX_SAFE_INTEGER` (9,007,199,254,740,991 paise ≈ ₹90,071 crore). Enforced by database CHECK constraints (`*_paise_js_safe`).
- **Business limits**: defined centrally in `lib/money-limits.ts`. Invoices are capped at ₹99,99,99,999.99 (9,999,999,999 paise, ~₹100 crore) grand total, ₹99,99,999.99 unit price, 9,999,999.999 quantity, and 200 line items.
- **Defense-in-depth**: enforced at (1) Zod schema on input, (2) `lib/gst/calculate.ts` pure math engine (throws `MoneyLimitError`), (3) `calculateInvoiceTaxOrActionError` mapping to user-visible `ActionError` (`AMOUNT_LIMIT_EXCEEDED`), (4) database CHECK constraints.

## State-column domains (DB-004)

- **Single Source of Truth**: All closed-set domain strings (subscription plans, subscription statuses, invoice templates, record lifecycle statuses, subscription request statuses, billing cycles, and payment methods) are defined as `as const` tuples and type guards in `lib/db/domain-values.ts`.
- **Derivation Hierarchy**: 
  1. `lib/db/domain-values.ts`: Pure constants and TypeScript string unions.
  2. `lib/db/schema/*`: Schema columns narrowed with `text(...).$type<DomainType>()` and bound to database `CHECK (col IN (...))` constraints using `inList()` from `lib/db/schema/_check-helpers.ts`.
  3. `lib/validations/*`: Zod enums constructed directly via `z.enum(TUPLE)`.
  4. Domain logic: Pure type guards (e.g. `isOneOf`) and derived application types.
- **Enforced Constraints (10 total across 5 tables)**:
  - `payments`: `payments_status_valid` (`status IN ('active', 'void')`).
  - `credit_notes`: `credit_notes_status_valid` (`status IN ('draft', 'finalized', 'void')`).
  - `businesses`:
    - `businesses_subscription_plan_valid` (`subscription_plan IN ('trial', 'free', 'essentials', 'professional')`).
    - `businesses_subscription_status_valid` (`subscription_status IN ('trial', 'active', 'past_due', 'grace_period', 'expired')`).
    - `businesses_default_invoice_template_valid` (`default_invoice_template IN ('classic', 'modern', 'minimal', 'thermal')`).
  - `invoices`: `invoices_invoice_template_valid` (`invoice_template IN ('classic', 'modern', 'minimal', 'thermal')`).
  - `subscription_requests`:
    - `subscription_requests_plan_name_valid` (`plan_name IN ('trial', 'free', 'essentials', 'professional')`).
    - `subscription_requests_billing_cycle_valid` (`billing_cycle IN ('monthly', 'yearly', 'manual_override')`).
    - `subscription_requests_payment_method_valid` (`payment_method IN ('upi_qr', 'bank_transfer', 'manual_override')`).
    - `subscription_requests_status_valid` (`status IN ('pending', 'approved', 'rejected')`).
- **Purpose**:
  1. **Prevent Entitlement Mis-Resolution**: Prevents arbitrary or corrupt plan values from being stored, which could otherwise silently fall back or grant unearned tiers in `resolveBusinessPlan`.
  2. **Audit Integrity & Invariant Preservation**: Prevents invalid status transitions or unsupported lifecycle values in statutory accounting records (`invoices`, `credit_notes`, `payments`).
  3. **UI Consistency**: Guarantees templates and subscription claims stay within supported design systems and workflows.
- **Migration & Rollback**: Added via migration `0020_db004_state_check_constraints.sql` using idempotent `DROP CONSTRAINT IF EXISTS` followed by `ADD CONSTRAINT ... NOT VALID` and `VALIDATE CONSTRAINT` in a single transaction. Legacy bad rows abort the entire migration cleanly without leaving partial or invalid state.

## Index conventions (DB-005)

1. **No Standalone Low-Cardinality Indexes**:
   Do not create standalone single-column indexes on low-cardinality columns (e.g. status, lifecycle_status, flags). Postgres planner ignores them in favor of sequential scans, but maintenance overhead slows write paths. Always lead composite indexes with `business_id` (e.g. `(business_id, lifecycle_status, invoice_date)` or `(business_id, is_active)`).
2. **Partial Index Predicate Alignment**:
   Partial indexes must replicate the query predicate literally so the query planner matches them. Specifically, `invoices_archival_retry_idx` (`WHERE archival_status IN ('pending', 'failed') AND archival_attempts < 5`) is coupled directly to the archival retry cron query predicate in `app/api/cron/retry-invoice-archival/route.ts`. API-008 must update the index definition and the cron query together if the predicate changes.
3. **Migration Locking & Index Creation Policy**:
   Indexes are created using plain `CREATE INDEX` in migrations (not `CONCURRENTLY`) because Drizzle migrator runs within transaction blocks where `CONCURRENTLY` is illegal. Current tables are compact and index builds complete in milliseconds. If a production table ever grows large, operators should create the index manually using `CREATE INDEX CONCURRENTLY` in advance, then ship an idempotent `CREATE INDEX IF NOT EXISTS` migration.
4. **Name Coupling with Application Error Handling**:
   The partial unique index `subscription_requests_one_pending_per_biz` (`UNIQUE (business_id) WHERE status = 'pending'`) enforces at most one pending claim per business at the database level. It is name-coupled to `lib/subscriptions/claim-errors.ts` via the exported constant `PENDING_CLAIM_INDEX_NAME` so constraint violation `23505` is deterministically classified as `PENDING_CLAIM_EXISTS` and mapped to user-friendly messaging.

## Database connection pool & singleton (DB-006)

- **Pure Pool Configuration (`lib/db/pool-config.ts`)**: Bounded connection parameters (`max: 5`, `idleTimeoutMillis: 10_000`, `connectionTimeoutMillis: 5_000`) and the non-throwing idle error handler `attachPoolErrorHandler` live in a pure module decoupled from driver imports and I/O.
- **Process-wide `globalThis` Singleton**: `lib/db/client.ts` stores the database instance on `globalThis.__billMatrixDb`. In Next.js dev mode, HMR re-evaluates modules on file edits; anchoring the singleton to `globalThis` prevents leaking a new Pool (and accumulating dead connections) on every code reload. Production behavior is identical to a module singleton.
- **Transaction Concurrency & Non-Starvation Rule**: The pool is bounded to 5 connections. Inside `db.transaction(async (tx) => { ... })` callbacks, **never use the global `db` or `getDb()`** — always use the scoped `tx`. Using the global `db` inside an open transaction attempts to acquire a second connection, which under concurrent load will deadlock and exhaust the pool. All 13 transaction sites in `lib/actions/` strictly follow this rule.

## Audit trail (DB-007)

- **Append-Only Database Enforcement**:
  The `audit_log` table is append-only at the PostgreSQL engine level. Two triggers (`bm_audit_log_guard` row-level trigger on UPDATE/DELETE, and `bm_audit_log_guard_truncate` statement-level trigger on TRUNCATE) execute `bm_guard_audit_log()`, raising SQLSTATE `55000` (`BM_AUDIT_APPEND_ONLY`). Both triggers are configured with `ENABLE ALWAYS` so they cannot be bypassed even if `session_replication_role` is set to `replica`.
- **Centralized Event Registry & Single Writer (`lib/audit/log.ts`)**:
  All audit log entries are defined in the pure `AUDIT_EVENTS` registry. The `writeAudit(tx, params)` function is the single sanctioned writer in the application; no ad-hoc `insert(auditLog)` calls exist anywhere in the codebase. Metadata is validated against strict schema limits (no nested arrays/objects, bounds on strings/numbers/booleans).
- **Atomic "No Audit, No Action" Contract**:
  Every audit record is written inside the same database transaction as the underlying business mutation, directly following the guarded change. If the audit insert fails (e.g. invalid foreign keys or schema violations), the entire transaction aborts and rolls back. Audit errors are never caught or swallowed. Because `withTransactionRetry` re-runs the entire transaction upon transient deadlocks or serialization errors, rolled-back audit records are automatically discarded with the failed transaction attempt, preventing duplicate entries.
- **Pure Transaction Modules & Request Context Capture (`lib/audit/request-context.ts`)**:
  Transaction functions (`lib/invoices/*-tx.ts`) remain completely pure and free of Next.js runtime dependencies (`next/headers`, `next/navigation`). Client network context (`ip`, `user_agent`) is resolved upstream in Server Actions using `getAuditRequestContext()` and passed down into transaction parameters.
- **Sensitive Data & Profile Diff Policy (`lib/audit/profile-diff.ts`)**:
  Audit records must never persist full bank accounts, passwords, tokens, or unredacted personal details. For profile updates, `buildProfileAuditChanges()` records field value changes only for non-sensitive business fields (`legal_name`, `trade_name`, `gstin`, `state_code`), records bank accounts as masked `bank_account_last4`, and captures personal contact info (addresses, email, phone) strictly as boolean presence flags in `changed_fields`.
- **Foreign Key Retention Policy (`NO ACTION`)**:
  `audit_log.business_id` and `audit_log.user_id` maintain standard foreign keys without cascading deletes (`ON DELETE NO ACTION`). A business or user with recorded audit history cannot be hard-deleted from the database (violating FK `23503`), guaranteeing an immutable evidentiary audit trail for statutory compliance under Indian GST and IT rules.
- **Known Limitations & Operational Context**:
  1. *Database Superuser/Owner Override*: While `ENABLE ALWAYS` prevents application sessions from disabling triggers, a Postgres superuser or Neon database owner can drop triggers. Enforcing true write-once-read-many (WORM) storage or dedicated audit sinks is tracked as an infrastructure ops item.
  2. *Authentication / Login Events*: The `audit_log` table requires `business_id NOT NULL`, meaning pre-tenant authentication events (logins, failed passwords) are logged via application logging/Sentry rather than `audit_log`.
  3. *Client IP Forensics*: `x-forwarded-for` and `x-real-ip` headers provide best-effort client IP attribution behind reverse proxies/CDNs, subject to edge network trust boundaries (SEC-005).

