# SEC-006 Completion Report: Logging without PII Scrubbing (DPDP Act 2023)

## 1. Summary
Implemented comprehensive PII and credential scrubbing for server logs and Sentry events in compliance with the Digital Personal Data Protection Act (DPDP Act 2023) data minimisation principles.

Key deliverables:
- Extended `lib/observability/sentry-redaction.ts` with new key rules (personal names, Drizzle query params, Postgres details, OTP, Aadhaar) and regex scrubbing rules for Drizzle parameters, Postgres key details, UPI VPAs, Indian mobile numbers, Aadhaar numbers, and bank account digit runs.
- Enhanced `lib/actions/_shared/logger.ts` with a safe, single-line, PII-scrubbed serialiser (`buildLogLine`), scrubbed Sentry event metadata, and added `logWarn` for non-error warnings that emits breadcrumbs without generating Sentry issues.
- Migrated server-side unmanaged `console.error` calls in `app/(admin)/admin/page.tsx` and `app/(app)/checkout/page.tsx` to `logWarn`.
- Created structural console guard test `tests/unit/sec006-console-guard.test.ts` ensuring no server-side files in `app/`, `lib/`, or `components/` bypass the centralised logger.
- Extended existing unit test suites `tests/unit/sentry-redaction.test.ts` and `tests/unit/logger-sentry.test.ts` with 100% pass rate.
- All 161 test suites (1,355 tests) pass cleanly; typecheck, lint ratchet, and production build pass with exit code 0.

---

## 2. Files Changed (One Line Each)
- `app/(admin)/admin/page.tsx` — Replaced direct `console.error` for payee configuration problems with `logWarn('admin:payee-config', ...)`.
- `app/(app)/checkout/page.tsx` — Replaced direct `console.error` for payee configuration problems with `logWarn('checkout:payee-config', ...)`.
- `lib/actions/_shared/logger.ts` — Implemented `buildLogLine` single-line scrubbed serialiser, scrubbed Sentry metadata, and added `logWarn`.
- `lib/observability/sentry-redaction.ts` — Extended sensitive key patterns and added ordered scrubbing regexes for Drizzle params, Postgres keys, UPI, mobile, Aadhaar, and bank account numbers.
- `tests/unit/logger-sentry.test.ts` — Added test cases for single-line scrubbed output, DrizzleQueryError scrubbing, Sentry extra sanitisation, and `logWarn`.
- `tests/unit/sentry-redaction.test.ts` — Added test cases for Drizzle params, Postgres key details, mobile phones, UPI VPAs, Aadhaar, bank accounts, and non-PII preservation.
- `tests/unit/sec006-console-guard.test.ts` — NEW architectural guard test enforcing zero unmanaged server-side `console.*` calls.

---

## 3. New and Extended Regular Expressions

### Key Matching
1. **`SENSITIVE_SUBSTRING_PATTERN` extension**:
   `display_name|full_name|first_name|last_name|contact_name|owner_name|aadhaar`
   - *Catches*: Object keys carrying personal contact or identity names and Aadhaar references.
   - *Deliberately spares*: Safe operational keys (`amount_paise`, `status`, `event_id`, `scope`).
2. **`SENSITIVE_TOKEN_PATTERN` extension**:
   `params|detail|otp`
   - *Catches*: Delimited keys like `params` (SQL bind parameter values), `detail` (DB constraint detail values), and `otp`.
   - *Deliberately spares*: Compound non-sensitive words without token boundaries.

### String Scrubbing (Applied in Strict Order a -> i)
3. **`DRIZZLE_PARAMS_PATTERN`**: `/(\bparams:\s*)[^\n]*/gi`
   - *Catches*: The bind parameter dump in Drizzle query error messages (`params: <values>`).
   - *Deliberately spares*: The preceding SQL query text (`Failed query: select ...`), preserving structural debugging context.
4. **`POSTGRES_KEY_DETAIL_PATTERN`**: `/(Key \([^)]*\)=\()[^)]*(\))/g`
   - *Catches*: The sensitive key values inside Postgres uniqueness/FK violation details (`Key (gstin)=(27AAAAA0000A1Z5) already exists` -> `Key (gstin)=([redacted]) already exists`).
   - *Deliberately spares*: The column name and relational constraint identifier.
5. **`UPI_VPA_PATTERN`**: `/(?<![\w.@-])[A-Za-z0-9._-]{2,256}@[A-Za-z][A-Za-z0-9]{1,63}(?![\w.@-])/g`
   - *Catches*: Indian UPI Virtual Payment Addresses (e.g., `user@okaxis`, `ravi.kumar@upi`).
   - *Deliberately spares*: Standard email addresses (scrubbed by preceding `EMAIL_PATTERN`), package versions (`next@16.4.5`), and scoped npm imports.
6. **`INDIAN_MOBILE_PATTERN`**: `/(?<![\w-])(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}(?![\w-])/g`
   - *Catches*: 10-digit Indian mobile numbers beginning with 6-9, with optional `+91` or `91` prefixes and space or hyphen separators.
   - *Deliberately spares*: Invoice sequences (`INV/26-27/0001`), UUID blocks, line numbers (`line 12:345`), paise amounts (`39900 paise`), and timestamps.
7. **`AADHAAR_PATTERN`**: `/(?<![\w-])\d{4}\s\d{4}\s\d{4}(?![\w-])/g`
   - *Catches*: 12-digit Indian Aadhaar identity numbers formatted in three groups of 4 digits.
   - *Deliberately spares*: Unformatted numbers and standard date formats.
8. **`LONG_DIGIT_RUN_PATTERN`**: `/(?<![\w.-])\d{9,18}(?![\w.-])/g`
   - *Catches*: 9 to 18 consecutive digits representing Indian bank account numbers and payment transaction IDs inside free text.
   - *Deliberately spares*: UUID segments (excluded by `\w` and `-` lookarounds), dotted semantic versions (excluded by `\.`), shorter numeric amounts, and timestamps.

---

## 4. Test List
- **`tests/unit/sentry-redaction.test.ts`** (17 tests, all passing):
  - 10 existing baseline tests covering sensitive keys, payload scrubbing, email/GSTIN/IFSC/PAN redaction, query secrets, Bearer tokens, circular structures, depth limits, and Error extras.
  - `SEC-006: scrubs Drizzle query params while preserving SQL text`
  - `SEC-006: scrubs Postgres unique/foreign key constraint details`
  - `SEC-006: redacts Indian mobile numbers formatted in various styles`
  - `SEC-006: redacts UPI VPAs and email addresses`
  - `SEC-006: redacts Aadhaar numbers and bank account digit runs`
  - `SEC-006: preserves safe non-PII values and technical identifiers`
  - `SEC-006: extends isSensitiveKey for personal names, params, details, otp, and aadhaar`
- **`tests/unit/logger-sentry.test.ts`** (9 tests, all passing):
  - 4 existing baseline tests covering expected `ActionError`, unexpected `Error`, non-Error values, and JSON output structure.
  - `SEC-006: logError scrubs PII in meta and outputs single-line JSON without unescaped newlines`
  - `SEC-006: logError scrubs DrizzleQueryError params from message and stack while preserving Sentry captureException error instance`
  - `SEC-006: logError extra passed to Sentry is scrubbed for sensitive keys`
  - `SEC-006: non-Error value scrubs PII before Sentry captureMessage`
  - `SEC-006: logWarn prints via console.warn with warn level, adds breadcrumb, and avoids Sentry issue creation`
- **`tests/unit/sec006-console-guard.test.ts`** (1 test, passing):
  - `ensures no server-side files in app/, lib/, components/ bypass the central logger`: Scans all `.ts` and `.tsx` files in `app/`, `lib/`, `components/`, filtering out client components (`'use client'`) and allowlisted sinks (`logger.ts`, `env-boot.ts`, `seed.ts`). Confirms zero offending files.

---

## 5. Pasted Verify Outputs

### A. `pnpm typecheck`
```
$ tsc --noEmit
(exited with code 0)
```

### B. `pnpm lint:ratchet`
```
$ tsx scripts/ci/lint-ratchet.ts
ESLint now:      18 errors, 38 warnings
Baseline allows: 18 errors, 38 warnings

PASS (at baseline).
(exited with code 0)
```

### C. `pnpm exec vitest run`
```
$ pnpm exec vitest run --maxWorkers 4

 Test Files  161 passed | 4 skipped (165)
      Tests  1355 passed | 12 skipped | 7 todo (1374)
   Start at  16:44:45
   Duration  110.82s (transform 8.58s, setup 0ms, import 145.26s, tests 212.16s, environment 24ms)
(exited with code 0)
```

### D. `pnpm build`
```
$ next build
▲ Next.js 16.4.5 (Turbopack)
- Environments: .env.local
✓ Running next.config.mjs took 1316ms
- Experiments (use with caution):
  · clientTraceMetadata
  · serverActions

  Creating an optimized production build ...
✓ Compiled successfully in 19.3s
  Running next.config.js provided runAfterProductionCompile ...
✓ Completed runAfterProductionCompile in 774ms
  Running TypeScript ...
  Finished TypeScript in 22.5s ...
  Collecting page data using 15 workers ...
  Generating static pages using 15 workers (0/7) ...
  Generating static pages using 15 workers (1/7) 
  Generating static pages using 15 workers (3/7) 
  Generating static pages using 15 workers (5/7) 
✓ Generating static pages using 15 workers (7/7) in 807ms
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

ƒ Proxy (Middleware)
○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand
(exited with code 0)
```

### E. `git status`
```
On branch fix/sec-006-log-redaction
Changes not staged for commit:
  (use "git add <file>..." to update what will be committed)
  (use "git restore <file>..." to discard changes in working directory)
	modified:   app/(admin)/admin/page.tsx
	modified:   app/(app)/checkout/page.tsx
	modified:   lib/actions/_shared/logger.ts
	modified:   lib/observability/sentry-redaction.ts
	modified:   tests/unit/logger-sentry.test.ts
	modified:   tests/unit/sentry-redaction.test.ts

Untracked files:
  (use "git add <file>..." to include in what will be committed)
	docs/reports/SEC-006-completion.md
	tests/unit/sec006-console-guard.test.ts

no changes added to commit (use "git add" and/or "git commit -a")
```

### F. `git diff --stat`
```
 app/(admin)/admin/page.tsx            |   3 +-
 app/(app)/checkout/page.tsx           |   4 +-
 lib/actions/_shared/logger.ts         |  46 +++++++++++++--
 lib/observability/sentry-redaction.ts |  58 +++++++++++++++---
 tests/unit/logger-sentry.test.ts      | 107 +++++++++++++++++++++++++++++++++-
 tests/unit/sentry-redaction.test.ts   |  61 +++++++++++++++++++
 6 files changed, 263 insertions(+), 16 deletions(-)
```

---

## 6. Guard Test Result
The console guard test `tests/unit/sec006-console-guard.test.ts` passed:
- Scanned all `.ts` and `.tsx` files in `app/`, `lib/`, and `components/`.
- Client components (`'use client'`) properly exempted.
- Sinks in allowlist (`lib/actions/_shared/logger.ts`, `lib/env-boot.ts`, `lib/db/seed.ts`) properly exempted.
- Result: **0 offending server-side files**.

---

## 7. Open Questions
- None. All requirements were strictly implemented within scope.

---

## 8. Suggested Commit Message (Uncommitted)
```
fix(security): SEC-006 scrub PII from server logs and Sentry; redact Drizzle params, phones, UPI and account numbers
```


---

## Reviewer verification (Claude Code, 2026-11-08)

Verified on branch `fix/sec-006-log-redaction` against `main` `722b035`; every changed line was read.

- **Scope matches the spec:** `logError` now scrubs message, stack and meta before printing (single-line JSON) and scrubs `extra` before Sentry; new `logWarn` (console.warn + breadcrumb, never an issue); the two server `console.error` calls use `logWarn`; console guard passes with only the allowlisted files.
- **Before vs after, re-run myself:** with `sentry-redaction.ts` and `logger.ts` restored from `main`, **10 of the new SEC-006 tests fail** (Drizzle params, phones, UPI, Aadhaar/account numbers, new sensitive keys, logger console/Sentry scrubbing, logWarn); all pass on this branch.
- **Reviewer fixes (2 real leaks in the new patterns):**
  1. Drizzle `params:` was redacted only to the end of the line, so a parameter containing a newline (addresses, notes) leaked its later lines. Now redacted up to the first stack-frame line (`\n    at …`) or the end of the string; stack frames stay readable.
  2. Postgres `Key (…)=(…)` stopped at the first `)`, so a value like `ABC (India) Pvt Ltd` leaked ` Pvt Ltd`. Now greedy to the last `)` on the line.
  Added 2 tests; both fail on the pre-fix patterns and pass now.
- **Not in scope / noted:** the Neon Auth library prints its own `console.warn` diagnostics (third-party code, not our logger); browser `console.error` in 4 client components stays on the user's device.
- **Checks (local):** `pnpm typecheck` clean; `pnpm lint:ratchet` = baseline; `pnpm exec vitest run` 161 files passed, 4 skipped (1357 tests); `pnpm build` OK.

### Preview verification (Vercel preview of PR #17, 2026-11-08)

- **CI:** all 6 checks green on `09ea309` (quality gates, real-Postgres, Playwright E2E, dependency audit, Vercel).
- **Local E2E against the preview** (run after CI's E2E finished): 22 passed, 1 skipped (mailbox).
- **Hydration probe:** 0 errors on all 8 pages, including /checkout and /admin (the two pages now using `logWarn`); sidebar 68 / 220 / 68 px at 800 px.
