# Phase 4, Issue OPT-001 Completion Report: Production Observability & Health

## Executive Summary
This report documents the completion of **OPT-001** (Production Observability, Health Monitoring, Request ID Tracking, Sentry Crons, and Backlog Alerting).
All changes maintain strict backwards compatibility, zero visual change, zero auth/proxy changes, zero database schema alterations, zero dependencies added, zero `@ts-ignore` / `eslint-disable` annotations, and preserved the ESLint ratchet at 0/0. All changes remain **uncommitted** on branch `fix/opt-001-observability`.

---

## 1. Inventory of Changed & Created Files

### Created Files
- `lib/observability/request-context.ts`: Server-only module using `AsyncLocalStorage` and `node:crypto.randomUUID` for asynchronous request ID propagation. Includes `requestIdFromHeaders` sanitization guard (`/^[A-Za-z0-9:_-]{1,128}$/`), preferring `x-vercel-id`, then `x-request-id`, then fallback UUID.
- `app/api/health/route.ts`: Unauthenticated public health check endpoint (`runtime: 'nodejs'`, `dynamic: 'force-dynamic'`). Queries Neon DB (`select 1`) and Upstash Redis (`ping`) in parallel with 3000ms timeouts and 10s module-scoped memoization.
- `lib/storage/archival-monitor.ts`: Declares Sentry Crons monitor slug `retry-invoice-archival` and config matching `vercel.json` crons schedule (`0 20 * * *`).
- `tests/unit/opt001-request-context.test.ts`: Unit tests verifying request ID header sanitization, context isolation across concurrent async runs, log output inclusion, and Sentry tag propagation.
- `tests/unit/opt001-health.test.ts`: Unit tests validating 200 OK, 503 error handling, secret redaction, 3000ms timeouts with fake timers, 10s memoization, and `Cache-Control: no-store`.
- `tests/unit/opt001-cron-monitor.test.ts`: Unit tests verifying monitor schedule equality with `vercel.json`, `Sentry.withMonitor` wrapping on authorized requests, non-execution on 401/misconfigured secret, and rejection observation.
- `tests/unit/opt001-archival-sweep.test.ts`: Unit tests verifying stale backlog checks (threshold 60 minutes) and Sentry warning emission.

### Modified Files
- `lib/actions/_shared/create-action.ts`: `runValidatedHandler` extracts request ID via `headers()` or fallback UUID and wraps handler execution in `runWithRequestId`.
- `lib/actions/_shared/logger.ts`: Injects `requestId` into JSON log lines (omitted when undefined), adds `request_id` tag to Sentry `captureException`/`captureMessage`, and adds `data.requestId` to `logWarn` breadcrumbs.
- `app/api/cron/retry-invoice-archival/route.ts`: Extracts request ID, attaches `x-request-id` header to all responses, and wraps sweep execution with `Sentry.withMonitor`.
- `app/api/reports/export/route.ts`: Extracts request ID, wraps handler in `runWithRequestId`, and returns `x-request-id` on all responses.
- `app/api/business/[id]/logo/route.ts`: Extracts request ID, wraps handler in `runWithRequestId`, and returns `x-request-id` on all responses.
- `lib/storage/archival-config.ts`: Exports `ARCHIVAL_STALE_PENDING_MINUTES = 60`.
- `lib/storage/archival-claims.ts`: Added `countStalePending(db, kind, olderThanMinutes)` counting finalized documents with status `pending`/`failed`, attempts < 5, and `finalized_at < now() - interval`.
- `lib/storage/archival-sweep.ts`: Integrates stale checks for invoices and credit notes, triggers Sentry warning (`scope: 'archival-stale-pending'`) when either > 0, and returns `staleInvoices` and `staleCreditNotes` in `ArchivalSweepSummary`.
- `tests/integration/api008-archival-claims.test.ts`: Added test 13 validating `countStalePending` with real Postgres (PGlite) across finalized vs draft, pending/failed vs archived, under-max vs exhausted attempts, and threshold boundaries.
- `docs/DEPLOYMENT.md`: Added runbook section `## Monitoring & alerting (OPT-001)` detailing uptime monitoring, request correlation, and 6 production Sentry alert rules.

---

## 2. Sample `/api/health` Responses

### Healthy (HTTP 200 OK)
```http
HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store
x-request-id: 20261110-iad1::prod-req-abc123

{
  "status": "ok",
  "checks": {
    "database": "ok",
    "redis": "ok"
  }
}
```

### Degraded (HTTP 503 Service Unavailable)
*Note: No internal error messages, stack traces, hostnames, passwords, versions, or env names are exposed.*
```http
HTTP/1.1 503 Service Unavailable
Content-Type: application/json
Cache-Control: no-store
x-request-id: 20261110-iad1::prod-req-err456

{
  "status": "error",
  "checks": {
    "database": "error",
    "redis": "ok"
  }
}
```

---

## 3. Sample Error Log Line Showing `requestId`

When logged via `logError('health-check', error, { check: 'database' })` inside a request context:
```json
{
  "timestamp": "2026-11-10T01:27:15.123Z",
  "level": "error",
  "scope": "health-check",
  "requestId": "20261110-iad1::prod-req-err456",
  "message": "connection to server at neon.tech:5432 failed: password auth failed for user [redacted]",
  "stack": "Error: connection to server at neon.tech:5432 failed...\n    at ...",
  "meta": {
    "check": "database"
  }
}
```
*(When outside a request context, `requestId` is strictly omitted from the JSON output).*

---

## 4. Cron Monitor Config & `vercel.json` Schedule Equality

### `vercel.json`:
```json
{
  "crons": [
    {
      "path": "/api/cron/retry-invoice-archival",
      "schedule": "0 20 * * *"
    }
  ]
}
```

### `lib/storage/archival-monitor.ts`:
```typescript
import type * as Sentry from '@sentry/nextjs';

export type MonitorConfig = NonNullable<Parameters<typeof Sentry.withMonitor>[2]>;

export const ARCHIVAL_CRON_MONITOR_SLUG = 'retry-invoice-archival';

export const ARCHIVAL_CRON_MONITOR_CONFIG: MonitorConfig = {
  schedule: { type: 'crontab', value: '0 20 * * *' },
  checkinMargin: 30,
  maxRuntime: 10,
  timezone: 'UTC',
};
```
Unit test `tests/unit/opt001-cron-monitor.test.ts` programmatically parses `vercel.json` and asserts:
- `ARCHIVAL_CRON_MONITOR_CONFIG.schedule.value === vercelConfig.crons.find(...).schedule` (both evaluate to `"0 20 * * *"`).

---

## 5. Stale-Pending Query (`countStalePending`)

In `lib/storage/archival-claims.ts`:
```typescript
export async function countStalePending(
  db: SqlExecutor,
  kind: ArchivalKind,
  olderThanMinutes: number,
): Promise<number> {
  const result = await db.execute(sql`SELECT count(*)::int AS n FROM ${table(kind)}
    WHERE lifecycle_status = 'finalized'
      AND archival_status IN ('pending', 'failed')
      AND archival_attempts < ${ARCHIVAL_MAX_ATTEMPTS}
      AND finalized_at < now() - make_interval(mins => ${olderThanMinutes}::int)`);
  const row = result.rows[0];
  if (typeof row === 'object' && row !== null && 'n' in row) {
    if (typeof row.n === 'number') return row.n;
    if (typeof row.n === 'string') return parseInt(row.n, 10) || 0;
  }
  return 0;
}
```
Indexes utilized:
- DB-005 partial index: `WHERE archival_status IN ('pending', 'failed') AND archival_attempts < 5` (covers `ARCHIVAL_MAX_ATTEMPTS`).

---

## 6. Verification Commands and Results

| Command | Status | Output / Details |
|---|---|---|
| `pnpm typecheck` | PASS (exit code 0) | Clean run of `tsc --noEmit`. Zero TypeScript errors. |
| `pnpm lint:ratchet` | PASS (exit code 0) | `ESLint now: 0 errors, 0 warnings. Baseline allows: 0/0. PASS (at baseline)`. |
| `pnpm knip` | PASS (exit code 0) | Clean run of `knip`. Zero unused files, exports, or dependencies. |
| `pnpm exec vitest run` | PASS (exit code 0) | **189 passed, 4 skipped (193 test files total)**.<br>**1529 passed, 12 skipped, 1 todo (1542 tests total)**. |
| `pnpm print-css:build` | PASS (exit code 0) | Successfully regenerated `lib/pdf/print-stylesheet.generated.ts`. `git diff --stat` is empty (0 changes). |
| `pnpm build` (with CI placeholder env) | PASS (exit code 0) | Production build succeeded with Turbopack.<br>`├ ƒ /api/health` confirmed as a **dynamic route** (`ƒ`). |
| `pnpm exec vitest run tests/integration/api008-archival-claims.test.ts` | PASS (exit code 0) | 13/13 passed (including new Test 13 for `countStalePending` with PGlite in-memory Postgres). |
| `pnpm exec vitest run tests/unit/perf005-client-bundle-guards.test.ts` | PASS (exit code 0) | 6/6 passed. Confirms `node:async_hooks` is never reachable from any `'use client'` component. |

---

## 7. Items Not Verifiable Locally

1. **Real Sentry Cloud Check-Ins**:
   - `Sentry.withMonitor` was fully tested with Vitest mocks and verified to pass the monitor slug, schedule config, and observe execution/rejections.
   - Actual check-in ping transmission requires production Sentry DSN and auth tokens, which are configured on deployment.
2. **Real Vercel Edge Header Injection**:
   - `x-vercel-id` extraction was verified via unit tests with realistic Vercel edge ID formats (`iad1:iad1::abc123_xyz-89`).
   - Production behavior will seamlessly populate from Vercel's edge routing infrastructure.


---

## Reviewer verification (Claude Code, 2026-11-10)

Reviewed the full diff against `main` (`eba33c0`) and re-ran everything.

### Findings fixed by the reviewer
1. **`app/api/health/route.ts` exported a non-route function (`resetHealthCacheForTests`).** Next.js route files are meant to export only HTTP handlers and route config. This Next version builds anyway, but a later one may reject it. The checks, timeouts, 10 s cache and in-flight de-duplication moved unchanged to `lib/observability/health.ts`; the route now only builds the response.
2. **The logo route stamped `x-request-id` on a response cached publicly for a year** (`public, max-age=31536000, immutable`). Every cached copy would carry the first request's ID. Its logs are still inside the request context, but the response header is no longer set (commented in the route).
3. **The runbook overstated coverage:**
   - It said *all* API endpoints return `x-request-id`. Now it lists exactly which routes are wrapped, notes the library-owned `/api/auth/**` routes are not, and explains the logo exception.
   - It now states the stale-archive warning is evaluated once a day at the end of the nightly sweep, not in real time.
4. Removed the stray blank lines at the end of `lib/storage/archival-claims.ts`.

### Checked and fine
- **Reading `headers()` in `runValidatedHandler` changed no page's rendering mode.** The production route table is identical to `main` except for the new `ƒ /api/health`.
- **Client bundle guard (PERF-005) passes.** `node:async_hooks` is not reachable from any `'use client'` file.
- **Mutation check:** removing `archival_attempts < max` from `countStalePending` makes integration test 13 fail (3 counted instead of 2). Restored.
- **Cron:** the monitor only checks in after the secret check passes. A thrown sweep still returns 500 (unit-tested).

### Commands (reviewer re-run)
| Command | Result |
|---|---|
| `pnpm typecheck` | pass |
| `pnpm lint:ratchet` | 0 / 0 (at baseline) |
| `pnpm knip` | no findings |
| `pnpm exec vitest run` | 189 files passed / 4 skipped; 1529 tests passed, 12 skipped, 1 todo |
| `vitest run tests/integration/api008-archival-claims.test.ts` (PGlite) | 13 / 13 |
| `pnpm build` (CI env) | pass; `ƒ /api/health` dynamic; no other route changed |
| `pnpm print-css:build` | unchanged |

### Not verifiable before launch
- Real Sentry cron check-ins, alert rules and the uptime monitor are created on launch day with the final accounts (on the launch-day list).
- Vercel does not run crons on preview deployments. On the preview, the reviewer calls `/api/health` and checks the `x-request-id` header.
