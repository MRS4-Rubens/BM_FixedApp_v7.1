# Bill Matrix — Testing Architecture & Strategy (TEST-002)

This document defines the testing strategy, suites, harness rules, safety guards, and mutation testing procedures for Bill Matrix (`BM_FixApp v1.1`).

---

## 1. Test Suite Architecture

Bill Matrix runs three distinct test layers to guarantee both rapid developer feedback and exhaustive multi-tenant concurrency safety:

| Layer | Command | Database Engine | Concurrency / Locking Mode | Purpose |
|---|---|---|---|---|
| **Unit & Pure Logic** | `pnpm test` (or `pnpm exec vitest run`) | None / Pure In-Memory | Single-process | Money math, GST state matrix, number formats, date policies, status transitions, URL guard. |
| **PGlite Integration** | `pnpm test:integration` | `@electric-sql/pglite` (WASM Postgres) | Single-connection in-memory | Statutory business rules, IDOR tenancy boundaries, profile isolation, credit note derivations, DB constraints/triggers. |
| **Real-Postgres Integration** | `pnpm test:realdb` | Real PostgreSQL 17 (Container or Neon branch) | Multi-connection TCP pool | Lock contention, `FOR UPDATE` isolation, concurrent invoice finalization, void races, double-approval races, quota enforcement, failure injection. |

---

## 2. Why Two Kinds of Integration Tests?

1. **PGlite (`tests/integration/**`)**:
   - Executes full PostgreSQL SQL dialect and triggers inside WebAssembly.
   - Extremely fast (sub-second setup, runs in-memory per suite).
   - **Limitation**: PGlite operates as a single connection. It cannot verify row-level lock contention (`SELECT ... FOR UPDATE`), transaction isolation serialization conflicts, or race conditions between simultaneous requests.

2. **Real PostgreSQL (`tests/realdb/**`)**:
   - Runs against an authentic PostgreSQL 17 server (matching production Neon major version).
   - Utilizes `node-postgres` (`pg` driver) pool with plain TCP connections.
   - Tests execute with `fileParallelism: false` and `maxWorkers: 1` so global business sequences do not collide across files.
   - Verifies that parallel finalizations serialize deterministically, sequence counters advance with zero gaps, and double-claim/quota races fail gracefully without corrupting state.

---

## 3. Running Real-DB Tests Locally

### Option A: Local Docker (Recommended)

A lightweight test container is configured in `docker-compose.test.yml`. It uses `postgres:17` with tmpfs storage on port `54329` to avoid conflicting with any local Postgres server:

```bash
# 1. Start the test database
docker compose -f docker-compose.test.yml up -d

# 2. Export test database connection
export TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:54329/bm_test
# On Windows PowerShell:
# $env:TEST_DATABASE_URL = "postgresql://postgres:postgres@localhost:54329/bm_test"

# 3. Run real-DB suites
pnpm test:realdb

# 4. Stop and wipe throwaway data
docker compose -f docker-compose.test.yml down
```

### Option B: Disposable Neon Branch

To run against a remote Neon branch:

```bash
export TEST_DATABASE_URL="postgresql://user:pass@ep-branch-name.region.aws.neon.tech/neondb?sslmode=require"
export TEST_DATABASE_IS_DISPOSABLE=1
pnpm test:realdb
```

---

## 4. Production Database Safety Guard (`url-guard.ts`)

Destructive concurrency tests clear and mutate tenant rows. To prevent catastrophic data loss or accidental test execution against production or staging environments, `validateTestDatabaseUrl` runs before any network connection or migration:

1. **Missing URL Hard Failure**: If `TEST_DATABASE_URL` is empty or undefined, tests fail immediately with a descriptive error. They **never silently skip**.
2. **Production URL Matching**: Rejects any test URL targeting the same host and database as `DATABASE_URL` or `DATABASE_URL_UNPOOLED`.
3. **Neon Host Normalization**: Normalizes `-pooler` connection strings (`ep-xyz-pooler...`) to direct endpoint hosts so pooler vs direct URL variations are caught.
4. **Remote Host Guard**: Any non-localhost target (`not in localhost, 127.0.0.1, ::1`) requires `TEST_DATABASE_IS_DISPOSABLE=1`. Without this explicit flag, execution is refused immediately.

---

## 5. Must-Have Concurrency & Tenancy Test Matrix

| Audit Issue | Invariant Under Test | Test Suite File | Engine |
|---|---|---|---|
| **API-001** | IDOR & Tenant Isolation | `tests/integration/api001-tenant-isolation.test.ts` | PGlite |
| **API-002** | Parallel Finalize & Gapless Sequences | `tests/realdb/finalize-concurrency.test.ts` | Real Postgres |
| **API-002** | Failure Injection (Post-allocation rollback) | `tests/realdb/api002-failure-injection.test.ts` | Real Postgres |
| **API-003** | Parallel Payments & Overpayment Prevention | `tests/realdb/payment-concurrency.test.ts` | Real Postgres |
| **API-004** | Credit-Note Over-Credit & Invariant Binding | `tests/realdb/payment-concurrency.test.ts` (Test 5) | Real Postgres |
| **API-007** | Profile Edit Settings Isolation | `tests/integration/api007-profile-settings-isolation.test.ts` | PGlite |
| **API-009** | Double Approval & Claim Concurrency | `tests/realdb/api009-double-approval.test.ts` | Real Postgres |
| **API-010** | Monthly Quota & Trial Expiration Race | `tests/realdb/api010-quota-trial.test.ts` | Real Postgres |
| **AUTH-004**| GSTIN Uniqueness & Identity Locks | `tests/realdb/auth004-gstin-uniqueness.test.ts` | Real Postgres |
| **DB-001**  | Immutability Trigger Protection | `tests/integration/db001-immutability.test.ts` | PGlite |

---

## 6. Determinism & Test Writing Rules

1. **Assert Invariants, Not Timings**: Never assert which concurrent branch wins; assert that exactly one wins and that all losers fail with typed domain errors.
2. **Barrier Synchronization**: Use `runConcurrently` (`tests/realdb/helpers/concurrency.ts`) backed by `createGate()` so requests hit Postgres as simultaneously as the runtime event loop allows.
3. **No Sleeps**: Avoid `setTimeout` sleeps to coordinate races.
4. **Zero Skips**: No `describe.skipIf`, `it.skip`, `.only`, or `retry > 0` allowed in `tests/realdb/**`. Guarded by `tests/unit/realdb-suite-integrity.test.ts`.
5. **Integer Money**: All financial quantities must be expressed in integer paise.

---

## 7. Mutation Verification Table (TEST-002)

| # | Invariant Under Test | Mutation Introduced | Test Suite Expected to Fail | Result |
|---|---|---|---|---|
| **M1** | API-002 | Remove `.for('update')` from `lockDraftInvoice` | `tests/realdb/finalize-concurrency.test.ts` | KILLED |
| **M2** | API-003 | Remove `.for('update')` from invoice lock in `recordPaymentInTransaction` | `tests/realdb/payment-concurrency.test.ts` | KILLED |
| **M3** | API-003 | Delete remaining balance overpayment check | `tests/realdb/payment-concurrency.test.ts` | KILLED |
| **M4** | API-004 | Delete over-credit check in `finalize-credit-note-tx.ts` | `tests/realdb/payment-concurrency.test.ts` | KILLED |
| **M5** | API-009 | Remove `status = 'pending'` predicate in approval UPDATE | `tests/realdb/api009-double-approval.test.ts` | KILLED |
| **M6** | DB-001 | Comment out invoice immutability trigger in migration | `tests/integration/db001-immutability.test.ts` | KILLED |
| **M7** | API-001 | Remove `business_id` predicate from ownership helper | `tests/integration/api001-tenant-isolation.test.ts` | KILLED |
| **M8** | API-010 | Remove finalize-time quota check | `tests/realdb/api010-quota-trial.test.ts` | KILLED |
| **M9** | AUTH-004| Remove duplicate-GSTIN (23505) mapping | `tests/realdb/auth004-gstin-uniqueness.test.ts` | KILLED |
| **M10**| DB-007 | Comment out audit log trigger in migration | `tests/integration/db007-audit-log.test.ts` | KILLED |

---

## 8. Run tests with the CI environment

In CI (`.github/workflows/ci.yml`, "Quality gates" job) the tests run with obviously fake placeholder values (e.g. `NEXT_PUBLIC_APP_URL=https://ci.example.invalid`, `NEXT_PUBLIC_SUPPORT_EMAIL=support@ci.example.invalid`) so no secrets are needed. Before pushing, run the suite once with that same `env:` block exported (without `CI=true`): a test that passes locally can fail in CI when it depends on a default value.

**Contact Email Mocking Note**:
Tests that assert on support or feedback contact emails (such as `NEXT_PUBLIC_SUPPORT_EMAIL` or `FEEDBACK_RECIPIENT_EMAIL`) must mock `@/lib/config/contact` directly:
```typescript
vi.mock('@/lib/config/contact', () => ({
  SUPPORT_EMAIL: 'support@billmatrix.in',
  FEEDBACK_RECIPIENT_EMAIL: 'support@billmatrix.in',
}));
```
Relying on raw `process.env` values in tests causes failures across different local and CI environments.

---

## 9. Guard Tests (Trip-Prone Invariants)

Bill Matrix maintains automated static AST and import-chain guard tests to prevent architectural erosion. When modifying code, be aware of the following tests that developers are most likely to trip:

| Guard Test | Invariant Enforced | What Breaks It |
|---|---|---|
| `tests/unit/perf005-client-bundle-guards.test.ts` | Client bundle isolation | Importing `drizzle-orm`, `lib/db/schema`, `node:*`, or `lib/security/upload.ts` (directly or transitively) into a `'use client'` module. |
| `tests/unit/debt003-split-guards.test.ts`, `tests/unit/debt003b-split-guards.test.ts` | Line limits for the DEBT-003 splits | Letting a split entry file (invoice form, checkout form, admin console, billing tab, sidebar) or any file in their split folders grow past its limit (300–400 lines; the exact limits are in the two tests). |
| `tests/unit/use-server-exports.test.ts` | Next.js `'use server'` exports | Exporting anything other than functions (constants, Zod schemas, objects, types-as-values) from a `'use server'` file. |
| `tests/unit/action-permissions.test.ts` | Action authorization coverage | Adding a Server Action in `lib/actions/` without registering its access category in `lib/auth/action-permissions.ts`. |
| `tests/unit/fe005-guards.test.ts` | External UPI QR domain ban | Referencing external QR generation domains (e.g. `api.qrserver.com`) in `app/`, `components/`, or `lib/`. |
| `tests/unit/p3-wrapup-guards.test.ts` | Native browser dialog ban | Using `window.alert()`, `window.confirm()`, or `window.prompt()` instead of `ConfirmDialog`. |
| `tests/unit/opt002a-guards.test.ts` | DPDP retention policy | Altering statutory 8-year retention language in `app/(marketing)/privacy/page.tsx`. |
| `tests/unit/clean003-docs-guards.test.ts` | Living documentation accuracy | Referencing non-existent repo paths, broken relative markdown links, or invalid pnpm commands in living docs. |
| `pnpm knip` | Dead code & dependency audit | Leaving unused files, unreferenced exports/types, or unused dependencies in the codebase. |

---

## knip exceptions

The repo enforces `knip` in CI (Quality gates) to detect dead code and unused files, dependencies, and exports. The following intentional exceptions are configured in `knip.json`:

1. **Ignored Files (`ignore`)**:
   - `config/security-headers.d.mts`: TypeScript declaration companion typing `config/security-headers.mjs` (imported by `next.config.mjs`, `lib/observability/sentry-config.ts`, and unit tests).
   - `scripts/ci/audit-gate-core.d.mts`: TypeScript declaration companion typing `scripts/ci/audit-gate-core.mjs` (imported by audit scripts and unit tests).

2. **Ignored Dependencies (`ignoreDependencies`)**:
   - `@tanstack/react-query`: Required peer dependency of `@daveyplate/better-auth-*` via Neon Auth client packages (see `docs/security/dependencies.md`).
   - `postcss-load-config`: Used exclusively as a JSDoc type import in `postcss.config.mjs`.

3. **Rules (`rules`)**:
   - `types: off` / `nsTypes: off`: Exporting Props, Result, and schema types across domain and UI modules is our established project convention. All other Knip rules remain strictly enabled.

(No `ignoreBinaries` entry: knip 6 recognises `npx only-allow pnpm` in the `preinstall` script on its own.)

Run `pnpm knip` locally before pushing; CI fails on any finding.


