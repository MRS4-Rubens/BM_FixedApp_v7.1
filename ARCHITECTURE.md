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

## Monitoring & Logging (established Phase 18)

Sentry is the live implementation behind `lib/actions/_shared/logger.ts`'s `logError()` function.
- Client Initialization: Due to a Turbopack auto-import issue in Next.js 16, a `SentryInit` client component (`components/sentry-init.tsx`) is injected near the root of `app/layout.tsx` to dynamically import `instrumentation-client.ts` and force initialization on mount.
- Server Initialization: Uses the standard Next.js 15+ `instrumentation.ts` pattern to conditionally call `Sentry.init` based on the runtime (`nodejs` or `edge`).
- Global Error Boundary: `app/global-error.tsx` captures top-level React rendering errors and reports them via `Sentry.captureException`.
- Alerting: Basic alerting (e.g., email on any new issue) is configured directly in the Sentry dashboard, not in code.

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
