# Playwright E2E Suite (TEST-003)

Comprehensive end-to-end testing suite for Bill Matrix, executing real user journeys against an isolated staging deployment.

## Overview

The E2E suite verifies:
- **Core Multi-Tenant Journey** (`01-journey.spec.ts`): Signup, email verification, business onboarding, customer & product creation, draft invoice creation with line-item GST calculations, statutory numbering, finalization preview verification, credit note issuance with remaining unit decrement, subscription checkout & UPI evidence submission, admin claim approval with role escalation, and multi-sheet GSTR-1 Excel export.
- **Security & Multi-Tenant Isolation** (`02-security-isolation.spec.ts`): Cross-tenant invoice detail access denied, invoice PDF/print route isolation, archival token signing & replay protection, unauthenticated route redirection, and admin-only privilege gates.
- **Not Found & Route Boundaries** (`03-not-found-and-boundaries.spec.ts`): Branded 404 views for nonexistent routes, nonexistent entity IDs handled gracefully inside authenticated shell without crashing, and dev-only boundary harnesses blocked in preview/production.
- **Mobile Smoke** (`04-mobile-smoke.spec.ts`): Viewport verification (375x667) ensuring zero horizontal scroll overflow (`scrollWidth <= clientWidth + 1`), visible primary actions, and clean console logs.
- **Accessibility Ratchet** (`05-a11y.spec.ts`): WCAG 2.1 AA audits across 11 key views using `@axe-core/playwright`. Ratchet prevents new violations while tracking improvements.
- **Print Layout & PDF** (`06-print-layout.spec.ts`): Media print emulation verifying navigation chrome hiding, A4 width boundaries (≤ 794px), and valid `%PDF-` generation.
- **Real Mailbox Verification** (`07-mailbox-verification.spec.ts`): Live email delivery and link confirmation using Mailosaur when configured.

## Safety Model

The test runner enforces strict safeguards to prevent catastrophic execution against production databases or domains:
- **Hard Target Deny List**: Aborts immediately if target matches `app.billmatrix.in`, `*.neon.tech` production branch, `main`, or production database URIs.
- **Affirmative Confirmation**: Requires `E2E_CONFIRM_STAGING="yes-this-is-not-production"`.
- **Target Mode Check**: Requires `E2E_TARGET="staging"`.

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
│   ├── 06-print-layout.spec.ts
│   └── 07-mailbox-verification.spec.ts
├── support/                 # Pure helper modules with unit test coverage
│   ├── a11y-baseline.ts     # Baseline comparison and ratchet enforcement
│   ├── db.ts                # Isolated staging database client
│   ├── env.ts               # Zod env schema and target safety assertions
│   ├── financial-year.ts    # Indian Financial Year (Apr 1 - Mar 31) date math
│   ├── gstin.ts             # GSTIN format generation and checksum algorithm
│   ├── identity.ts          # Test data generators (run ID, UTR, passwords)
│   ├── mail-sink.ts         # Mailosaur and direct DB verification adapters
│   ├── money.ts             # Integer-paise independent GST calculation oracle
│   ├── rate-limits.ts       # Upstash Redis test key cleaner
│   └── xlsx.ts              # Multi-sheet Excel workbook parser
└── a11y-baseline.json       # Ratchet baseline violation snapshot
```

## Running the Tests

### Local Execution against Staging Preview
Ensure `.env.e2e.local` or environment variables are configured:

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

# Run staging database migrations
pnpm e2e:migrate-staging
```

### Updating Accessibility Baseline
When accessibility fixes are merged or verified:
```bash
UPDATE_A11Y_BASELINE=1 pnpm e2e --project=quality
```

