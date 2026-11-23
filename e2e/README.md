# Playwright E2E Suite (TEST-003)

End-to-end tests for Invoice BizFolio. They run real user journeys in a browser against the app built from the pull request and started on the GitHub runner (`next start`, `http://localhost:3000`), connected to the **test** Neon project only.

## Overview

The E2E suite verifies:
- **Core Multi-Tenant Journey** (`01-journey.spec.ts`): Signup, email verification, business onboarding, customer & product creation, draft invoice creation with line-item GST calculations, statutory numbering, finalization preview verification, credit note issuance with remaining unit decrement, subscription checkout & UPI evidence submission, admin claim approval with role escalation, and multi-sheet GSTR-1 Excel export.
- **Security & Multi-Tenant Isolation** (`02-security-isolation.spec.ts`): Cross-tenant invoice detail access denied, invoice PDF/print route isolation, archival token signing & replay protection, unauthenticated route redirection, and admin-only privilege gates.
- **Not Found & Route Boundaries** (`03-not-found-and-boundaries.spec.ts`): Branded 404 views for nonexistent routes, nonexistent entity IDs handled gracefully inside authenticated shell without crashing, and dev-only boundary harnesses blocked in preview/production.
- **Mobile Smoke** (`04-mobile-smoke.spec.ts`): Viewport verification (375x667) ensuring zero horizontal scroll overflow (`scrollWidth <= clientWidth + 1`), visible primary actions, and clean console logs.
- **Accessibility Ratchet** (`05-a11y.spec.ts`): WCAG 2.1 AA audits across 11 key views using `@axe-core/playwright`. Ratchet prevents new violations while tracking improvements.
- **Print Layout & PDF** (`06-print-layout.spec.ts`): Media print emulation verifying navigation chrome hiding, A4 width boundaries (≤ 794px), and valid `%PDF-` generation.
- **Team members** (`08-team.spec.ts`): the owner invites a new person, who signs up through the invite link, joins as staff, sees the staff view, and loses access when removed.
- **Read-only accountant / CA** (`09-ca.spec.ts`): the plan gate for the Accountant role, then a CA who can view but not change business data.
- **Bulk import** (`10-bulk-import.spec.ts`): the Professional plan gate, then importing customers and products from an Excel file.
- **Notifications** (`11-notifications.spec.ts`): the bell panel, its settings link and notification preferences.
- **Professional checkout** (`12-professional-checkout.spec.ts`): the Professional plan checkout screens (no payment claim is submitted; `01-journey` covers claims and approval).
- **Where it runs (LAUNCH-L5):** in CI (`.github/workflows/e2e.yml`) the pull request is built and started on the runner against the test database. Sign-up confirmation is done by marking the test address verified in the database (`E2E_VERIFY_MODE=db`, the only mode). Rate limits use a **local Redis** on the runner (Redis + an Upstash-compatible REST proxy), fresh for every run. Cloudflare (PDF) and Brevo (e-mail) get obviously fake keys, so no real PDF or e-mail is ever sent.

## Playwright projects (`playwright.config.ts`)

One worker, run in this order: `journey` (specs 01–03) first; then `mobile` (04), `quality` (05–06), `team` (08), `import` (10), `notifications` (11) and `checkout` (12), which depend on `journey`; `ca` (09) depends on `team`.

## Safety Model

Before any browser starts, `assertSafeTarget` (`e2e/support/env.ts`) refuses to run unless all of these hold:
- **Confirmation phrase**: `E2E_CONFIRM_STAGING="yes-this-is-not-production"`.
- **App address**: the host of `E2E_BASE_URL` is not in `E2E_FORBIDDEN_HOSTS` (the production address).
- **Database hosts**: the pooled and the direct test database hosts are in `E2E_DB_HOST_ALLOWLIST` and not in `E2E_FORBIDDEN_DB_HOSTS` (the production Neon hosts).
- **Rate-limit reset**: keys are deleted only when `E2E_UPSTASH_ALLOW_FLUSH` is on and the Redis host is in `E2E_UPSTASH_HOST_ALLOWLIST` (CI: `localhost`), and only the auth rate-limit keys.

Secrets, variables and the full list are in [`docs/e2e-staging-setup.md`](../docs/e2e-staging-setup.md).

## Directory Structure

```
e2e/
├── fixtures/
│   └── test.ts              # Custom typed Playwright test fixtures & journey state store
├── pages/                   # Page Object Models with resilient semantic locators
│   ├── AdminPage.ts
│   ├── AuthModal.ts
│   ├── CheckoutPage.ts
│   ├── CreditNotePage.ts
│   ├── CustomersPage.ts
│   ├── InvoiceDetailPage.ts
│   ├── InvoiceFormPage.ts
│   ├── ProductsPage.ts
│   ├── ReportsPage.ts
│   └── SettingsPage.ts
├── setup/
│   └── global-setup.ts      # Target safety assertion, rate-limit reset, admin setup
├── specs/                   # Executable test specifications
│   ├── 01-journey.spec.ts
│   ├── 02-security-isolation.spec.ts
│   ├── 03-not-found-and-boundaries.spec.ts
│   ├── 04-mobile-smoke.spec.ts
│   ├── 05-a11y.spec.ts
│   └── 06-print-layout.spec.ts …   (plus 08-team … 12-professional-checkout)
├── support/                 # Pure helper modules with unit test coverage
│   ├── a11y-baseline.ts     # Baseline comparison and ratchet enforcement
│   ├── db.ts                # Isolated staging database client
│   ├── env.ts               # Zod env schema and target safety assertions
│   ├── financial-year.ts    # Indian Financial Year (Apr 1 - Mar 31) date math
│   ├── gstin.ts             # GSTIN format generation and checksum algorithm
│   ├── http-headers.ts      # Shared extra request headers for every browser context
│   ├── identity.ts          # Test data generators (run ID, UTR, passwords)
│   ├── money.ts             # Integer-paise independent GST calculation oracle
│   ├── navigation.ts        # Navigation that does not wait for the browser "load" event
│   ├── rate-limits.ts       # Auth rate-limit key cleaner (local Redis in CI)
│   └── xlsx.ts              # Multi-sheet Excel workbook parser
└── a11y-baseline.json       # Ratchet baseline violation snapshot
```

## Running the Tests

### Running locally
Start the app on your PC against the **test** database and a local Redis, and set the `E2E_*` variables first: the exact steps are in [`docs/e2e-staging-setup.md`](../docs/e2e-staging-setup.md) section 4. Then:

```bash
# Run full E2E suite headlessly
pnpm e2e

# Run with interactive Playwright UI
pnpm e2e:ui

# Run headed in Chromium
pnpm e2e:headed

# List all discovered tests
pnpm e2e:list

# Open the HTML test report
pnpm e2e:report

# Apply migrations to the test database (CI does this before every run)
pnpm e2e:migrate-staging
```

### Updating Accessibility Baseline
When accessibility fixes are merged or verified:
```bash
UPDATE_A11Y_BASELINE=1 pnpm e2e --project=quality
```

