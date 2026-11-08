# SEC-007 Completion Report: Dependency Security & CI Audit Gate

## 1. Summary

Issue **SEC-007** resolves vulnerable transitive dependencies through safe same-major overrides, turns the CI dependency audit from report-only into a blocking quality gate with an expiring allowlist for accepted server-side `better-auth` advisories, configures Dependabot for ongoing maintenance, and thoroughly documents the pinned beta authentication dependency and its patch.

All changes remain **uncommitted** on branch `fix/sec-007-dependency-audit`.

---

## 2. Audit Before / After Comparison

| Scope | Severity | Before (main baseline) | After (SEC-007) | Difference |
| :--- | :--- | :--- | :--- | :--- |
| **Production (`--prod`)** | **Critical** | 2 | 2 | 0 (both allowlisted server-side better-auth) |
| | **High** | 39 | 8 | **-31** (all 8 remaining are allowlisted better-auth) |
| | **Moderate** | 13 | 5 | **-8** |
| | **Low** | 4 | 2 | **-2** |
| | **Total Prod** | **58** | **17** | **-41 (-70.7%)** |
| **All Dependencies (incl. Dev)** | **Critical** | 2 | 2 | 0 |
| | **High** | 42 | 9 | **-33** |
| | **Moderate** | 24 | 5 | **-19** |
| | **Low** | 5 | 2 | **-3** |
| | **Total All** | **73** | **18** | **-55 (-75.3%)** |

All remaining 10 high/critical production advisories (2 critical, 8 high) are exclusively transitive `better-auth` server-side vulnerabilities introduced via `@neondatabase/auth@0.4.2-beta`, where Neon hosts the authentication server and the application only consumes client-side plugins and cookie parsing utilities.

---

## 3. Transitive Overrides Applied (`pnpm-workspace.yaml`)

All overrides enforce **same-major security floors** without crossing major versions:

| Package Pattern | Installed Before | Floor / Target | Installed After | Rationale |
| :--- | :--- | :--- | :--- | :--- |
| `'brace-expansion@^1'` | `1.1.15` | `^1.1.21` | `1.1.21` | ReDoS vulnerability in brace expansion parsing |
| `'brace-expansion@^2'` | `2.1.1` | `^2.1.7` | `2.1.7` | ReDoS vulnerability in brace expansion parsing |
| `'brace-expansion@^5'` | `5.0.6` | `^5.0.12` | `5.0.12` | ReDoS vulnerability in brace expansion parsing |
| `browserslist` | `4.28.1` | `^4.29.5` | `4.29.5` | Regular expression denial of service / query parsing flaw |
| `baseline-browser-mapping` | `2.9.19` | `^2.11.35` | `2.11.35` | Compatibility & security updates for baseline mappings |
| `'fast-uri@^3'` | `3.1.2` | `^3.1.9` | `3.1.9` | URL parsing bypass and prototype security fixes |
| `'js-yaml@^4'` | `4.2.0` | `^4.3.2` | `4.3.2` | Resource exhaustion and prototype security fixes in YAML parser |
| `'nanoid@^3'` | `3.3.11` | `^3.3.20` | `3.3.20` | Predictability and generator performance improvements |
| `'postcss@^8'` | `8.5.6`, `8.5.23`, `8.5.31` | `^8.5.32` | `8.5.32` | Line return parsing vulnerabilities / CSS injection risks |
| `source-map-js` | `1.2.1` | `^1.2.2` | `1.2.2` | Source map parsing fixes |
| `'zod@^4'` | `4.3.6` | `^4.6.7` | `4.6.7` | ReDoS vulnerabilities in schema string validators |
| `hono` | `4.12.25` | `^4.13.17` | `4.13.17` | Replaces vulnerable `4.12.25` override with safe `^4.13.17` floor |

---

## 4. Production Audit Allowlist (`security/audit-allowlist.json`)

All entries are strictly scoped to `better-auth` with expiry set to `2027-02-28`:

| GHSA ID | Severity | Affected Server Flow / Plugin | Reason |
| :--- | :--- | :--- | :--- |
| `GHSA-pw9m-5jxm-xr6h` | Critical | `oidc-provider` refresh-token replay | Server-side oidc-provider refresh-token replay flaw; Neon hosts the auth server; app only uses client plugins and cookie helpers via @neondatabase/auth 0.4.2-beta (decision D5). |
| `GHSA-965c-763c-88jm` | Critical | OAuth state magic-link token | Server-side OAuth state usable as magic-link token; Neon hosts the auth server; app only uses client plugins and cookie helpers via @neondatabase/auth 0.4.2-beta (decision D5). |
| `GHSA-9h47-pqcx-hjr4` | High | `oidcProvider` insecure defaults | Server-side oidcProvider plugin insecure defaults; Neon hosts the auth server; app only uses client plugins and cookie helpers via @neondatabase/auth 0.4.2-beta (decision D5). |
| `GHSA-86j7-9j95-vpqj` | High | Stored XSS via `redirect_uri` | Server-side stored XSS via javascript: redirect_uri in oidc-provider/mcp; Neon hosts the auth server; app only uses client plugins and cookie helpers via @neondatabase/auth 0.4.2-beta (decision D5). |
| `GHSA-7w99-5wm4-3g79` | High | `oauth-provider` concurrent code redemption | Server-side oauth-provider concurrent authorization code redemption flaw; Neon hosts the auth server; app only uses client plugins and cookie helpers via @neondatabase/auth 0.4.2-beta (decision D5). |
| `GHSA-392p-2q2v-4372` | High | Refresh-token rotation fork | Server-side refresh-token rotation fork race condition; Neon hosts the auth server; app only uses client plugins and cookie helpers via @neondatabase/auth 0.4.2-beta (decision D5). |
| `GHSA-g38m-r43w-p2q7` | High | OAuth auto-link account takeover | Server-side OAuth auto-link account takeover vulnerability; Neon hosts the auth server; app only uses client plugins and cookie helpers via @neondatabase/auth 0.4.2-beta (decision D5). |
| `GHSA-fmh4-wcc4-5jm3` | High | Organization invitation acceptance | Server-side organization invitation acceptance flow vulnerability; Neon hosts the auth server; app only uses client plugins and cookie helpers via @neondatabase/auth 0.4.2-beta (decision D5). |
| `GHSA-qq9h-g4jm-xgf3` | High | Magic-link / email-OTP hijacking | Server-side pre-account hijacking on magic-link and email-OTP flows; Neon hosts the auth server; app only uses client plugins and cookie helpers via @neondatabase/auth 0.4.2-beta (decision D5). |
| `GHSA-q84f-53jg-9ppm` | High | Device login approval UI | Server-side device login approval UI spoofing vulnerability; Neon hosts the auth server; app only uses client plugins and cookie helpers via @neondatabase/auth 0.4.2-beta (decision D5). |

---

## 5. Audit Gate Execution Output

Running `node scripts/ci/audit-gate.mjs ; echo "exit=$LASTEXITCODE"`:

```text
================ Dependency Audit Summary ================
Counts by severity: critical=2, high=8, moderate=5, low=2 (total=17)
7 moderate/low advisories (not blocking)

ALLOWED advisories (10):
  - [HIGH] better-auth GHSA-9h47-pqcx-hjr4 (expires: 2027-02-28)
    Reason: Server-side oidcProvider plugin insecure defaults; Neon hosts the auth server; app only uses client plugins and cookie helpers via @neondatabase/auth 0.4.2-beta (decision D5).
  - [HIGH] better-auth GHSA-86j7-9j95-vpqj (expires: 2027-02-28)
    Reason: Server-side stored XSS via javascript: redirect_uri in oidc-provider/mcp; Neon hosts the auth server; app only uses client plugins and cookie helpers via @neondatabase/auth 0.4.2-beta (decision D5).
  - [HIGH] better-auth GHSA-7w99-5wm4-3g79 (expires: 2027-02-28)
    Reason: Server-side oauth-provider concurrent authorization code redemption flaw; Neon hosts the auth server; app only uses client plugins and cookie helpers via @neondatabase/auth 0.4.2-beta (decision D5).
  - [HIGH] better-auth GHSA-392p-2q2v-4372 (expires: 2027-02-28)
    Reason: Server-side refresh-token rotation fork race condition; Neon hosts the auth server; app only uses client plugins and cookie helpers via @neondatabase/auth 0.4.2-beta (decision D5).
  - [HIGH] better-auth GHSA-g38m-r43w-p2q7 (expires: 2027-02-28)
    Reason: Server-side OAuth auto-link account takeover vulnerability; Neon hosts the auth server; app only uses client plugins and cookie helpers via @neondatabase/auth 0.4.2-beta (decision D5).
  - [HIGH] better-auth GHSA-fmh4-wcc4-5jm3 (expires: 2027-02-28)
    Reason: Server-side organization invitation acceptance flow vulnerability; Neon hosts the auth server; app only uses client plugins and cookie helpers via @neondatabase/auth 0.4.2-beta (decision D5).
  - [CRITICAL] better-auth GHSA-pw9m-5jxm-xr6h (expires: 2027-02-28)
    Reason: Server-side oidc-provider refresh-token replay flaw; Neon hosts the auth server; app only uses client plugins and cookie helpers via @neondatabase/auth 0.4.2-beta (decision D5).
  - [HIGH] better-auth GHSA-qq9h-g4jm-xgf3 (expires: 2027-02-28)
    Reason: Server-side pre-account hijacking on magic-link and email-OTP flows; Neon hosts the auth server; app only uses client plugins and cookie helpers via @neondatabase/auth 0.4.2-beta (decision D5).
  - [HIGH] better-auth GHSA-q84f-53jg-9ppm (expires: 2027-02-28)
    Reason: Server-side device login approval UI spoofing vulnerability; Neon hosts the auth server; app only uses client plugins and cookie helpers via @neondatabase/auth 0.4.2-beta (decision D5).
  - [CRITICAL] better-auth GHSA-965c-763c-88jm (expires: 2027-02-28)
    Reason: Server-side OAuth state usable as magic-link token; Neon hosts the auth server; app only uses client plugins and cookie helpers via @neondatabase/auth 0.4.2-beta (decision D5).

==========================================================
Result: PASSED (all high/critical advisories allowlisted and active)
exit=0
```

---

## 6. Files Changed and Created

### Modified Existing Files
- `.github/workflows/ci.yml`: Renamed job to `Dependency audit`, replaced report-only warning with blocking command `node scripts/ci/audit-gate.mjs`, updated comments.
- `pnpm-workspace.yaml`: Replaced vulnerable `hono: 4.12.25` with 12 same-major transitive security overrides, with documentation comment.
- `pnpm-lock.yaml`: Regenerated via `pnpm install`, verified with `pnpm install --frozen-lockfile`.
- `README.md`: Added "Dependencies & Security" section pointing to `docs/security/dependencies.md`.

### New Files Created
- `security/audit-allowlist.json`: Production allowlist for the 10 accepted `better-auth` high/critical server vulnerabilities with reasons and `2027-02-28` expiry.
- `scripts/ci/audit-gate-core.mjs`: Zero-dependency ES module exporting `evaluateAudit` and `validateAllowlist`.
- `scripts/ci/audit-gate-core.d.mts`: TypeScript type declarations for audit gate evaluation and allowlist types.
- `scripts/ci/audit-gate.mjs`: CLI executable runner with `--input`, `--allowlist`, and `--today` support.
- `.github/dependabot.yml`: Monthly dependency update schedule ignoring major updates, `@neondatabase/auth`, and `better-auth`.
- `docs/security/dependencies.md`: Comprehensive documentation covering D5 auth pin, Server Component cookie patch, overrides table, audit gate policy, unfixable moderate/low advisories, and Dependabot rules.
- `tests/unit/sec007-audit-gate.test.ts`: Vitest unit tests covering all audit evaluation states and allowlist schema checks.
- `tests/unit/sec007-dependency-policy.test.ts`: Vitest policy checks asserting exact auth version pin, workspace patch existence, absence of vulnerable overrides, shadcn placement, CI blocking config, allowlist validation, and Dependabot ignore rules.
- `docs/reports/SEC-007-completion.md`: This completion report.

---

## 7. Tests List & Results

Running `pnpm exec vitest run "tests/unit/sec007" --maxWorkers 4`:

```text
 ✓ tests/unit/sec007-audit-gate.test.ts (10 tests)
   ✓ correctly categorises blocking, allowed, and counts from fixture audit JSON
   ✓ marks an advisory as blocking and expired when today is past the expiry date
   ✓ does not allow an advisory when GHSA matches but package differs
   ✓ detects stale allowlist entries without blocking
   ✓ leaves blocking empty when only moderate and low advisories are present
   ✓ validateAllowlist schema verification > accepts a valid allowlist
   ✓ validateAllowlist schema verification > rejects bad GHSA format
   ✓ validateAllowlist schema verification > rejects missing expiry
   ✓ validateAllowlist schema verification > rejects bad date format or invalid calendar date
   ✓ validateAllowlist schema verification > rejects reason shorter than 20 characters
 ✓ tests/unit/sec007-dependency-policy.test.ts (7 tests)
   ✓ keeps @neondatabase/auth pinned strictly to 0.4.2-beta in package.json
   ✓ defines patchedDependencies for @neondatabase/auth pointing to existing patch file
   ✓ does not contain vulnerable hono 4.12.25 in pnpm-workspace.yaml overrides
   ✓ ensures shadcn is only in devDependencies and not in dependencies
   ✓ runs node scripts/ci/audit-gate.mjs in CI and does not contain report-only
   ✓ validates security/audit-allowlist.json schema, packages, and expiry dates
   ✓ configures .github/dependabot.yml and ignores @neondatabase/auth and better-auth

 Test Files  2 passed (2)
      Tests  17 passed (17)
```

---

## 8. Verification Outputs (Pasted Verbatim)

### A. Frozen Lockfile Verification
```bash
$ pnpm install --frozen-lockfile
Already up to date
Done in 475ms using pnpm v11.9.0
```

### B. Production Audit Summary
```bash
$ pnpm audit --prod 2>&1 | Select-Object -Last 3
└─────────────────────┴────────────────────────────────────────────────────────┘
17 vulnerabilities found
Severity: 2 low | 5 moderate | 8 high | 2 critical
```

### C. Blocking CI Audit Gate
```bash
$ node scripts/ci/audit-gate.mjs ; echo "exit=$LASTEXITCODE"
...
Result: PASSED (all high/critical advisories allowlisted and active)
exit=0
```

### D. TypeScript Typecheck
```bash
$ pnpm typecheck
$ tsc --noEmit
# Exit code 0
```

### E. Lint Ratchet Gate
```bash
$ pnpm lint:ratchet
$ tsx scripts/ci/lint-ratchet.ts
ESLint now:      18 errors, 38 warnings
Baseline allows: 18 errors, 38 warnings

PASS (at baseline).
```

### F. Full Vitest Test Suite
```bash
$ pnpm exec vitest run --maxWorkers 4
 Test Files  163 passed | 4 skipped (167)
      Tests  1374 passed | 12 skipped | 7 todo (1393)
   Start at  17:43:47
   Duration  106.56s
```

### G. Production Next.js Build
```bash
$ pnpm build
▲ Next.js 16.4.5 (Turbopack)
- Environments: .env.local
✓ Running next.config.mjs took 1785ms
- Experiments (use with caution):
  · clientTraceMetadata
  · serverActions

  Creating an optimized production build ...
✓ Compiled successfully in 17.9s
  Running next.config.js provided runAfterProductionCompile ...
✓ Completed runAfterProductionCompile in 673ms
  Running TypeScript ...
  Finished TypeScript in 21.1s ...
  Collecting page data using 15 workers ...
✓ Generating static pages using 15 workers (7/7) in 931ms
  Finalizing page optimization ...
# Exit code 0
```

### H. Git Working Tree Status & Diff Stat
```bash
$ git status
On branch fix/sec-007-dependency-audit
Changes not staged for commit:
  (use "git add <file>..." to update what will be committed)
  (use "git restore <file>..." to discard changes in working directory)
	modified:   .github/workflows/ci.yml
	modified:   README.md
	modified:   pnpm-lock.yaml
	modified:   pnpm-workspace.yaml

Untracked files:
  (use "git add <file>..." to include in what will be committed)
	.github/dependabot.yml
	docs/reports/SEC-007-completion.md
	docs/security/dependencies.md
	scripts/ci/audit-gate-core.d.mts
	scripts/ci/audit-gate-core.mjs
	scripts/ci/audit-gate.mjs
	security/audit-allowlist.json
	tests/unit/sec007-audit-gate.test.ts
	tests/unit/sec007-dependency-policy.test.ts

no changes added to commit (use "git add" and/or "git commit -a")
```

```bash
$ git diff --stat
 .github/workflows/ci.yml |  12 +--
 README.md                |   4 +
 pnpm-lock.yaml           | 230 ++++++++++++++++++++++-------------------------
 pnpm-workspace.yaml      |  14 ++-
 4 files changed, 125 insertions(+), 135 deletions(-)
```

---

## 9. Open Questions & Future Considerations

1. **Pre-Launch Evaluation of `@neondatabase/auth` Upstream**:
   The 10 allowlisted `better-auth` advisories expire on **`2027-02-28`**. Prior to general availability launch, maintainers should evaluate new upstream releases of `@neondatabase/auth` (e.g. `0.7.x` or `1.0.x`) to verify if Neon has upgraded `better-auth` internally and resolved these vulnerabilities without breaking Server Component session handling.
2. **Upstream Server Component Cookie Patch**:
   When `@neondatabase/auth` natively handles Next.js 16 Server Component read-only cookies in `dist/next/server/index.mjs`, `patches/@neondatabase__auth.patch` can be safely retired.

---

## 10. Suggested Commit Message (Uncommitted)

```text
fix(security): SEC-007 same-major dependency overrides, blocking audit gate with expiring allowlist, Dependabot, patch docs
```


---

## Reviewer verification (Claude Code, 2026-11-08)

Verified on branch `fix/sec-007-dependency-audit` against `main` `3e0c0f3`; every changed file was read.

- **Lockfile diff, package by package (main vs branch):** removed exactly the vulnerable versions (baseline-browser-mapping 2.9.19, brace-expansion 1.1.15/2.1.1/5.0.6, browserslist 4.28.1, fast-uri 3.1.2, hono 4.12.25, js-yaml 4.2.0, nanoid 3.3.11, postcss 8.5.6/8.5.23/8.5.31, source-map-js 1.2.1, zod 4.3.6) and added their same-major fixes; the only other changes are browserslist's own data packages (caniuse-lite, electron-to-chromium, node-releases, update-browserslist-db). `@neondatabase/auth` 0.4.2-beta and its patch hash are unchanged.
- **Audit re-run myself:** all deps 73 -> 18; production 58 -> 17. The only production high/critical advisories left are the 10 allowlisted better-auth server-side ones. Remaining non-better-auth: moderate esbuild 0.18 (drizzle-kit), uuid 8 (exceljs), glob 13 + minimatch 10 (Sentry build tooling), low deepmerge, and high zod 3.25.76 via `shadcn` (dev-only CLI, not shipped).
- **Gate behaviour re-run myself:** real allowlist -> exit 0; empty allowlist -> exit 1 (blocking); `--today 2027-03-01` -> all 10 entries EXPIRED, exit 1.
- **Reviewer fix (fail-open bug):** the gate treated any valid JSON as a report, so `pnpm audit` error JSON (registry outage) or `{}` would have PASSED CI with zero advisories. Added `assertAuditReport` (requires `advisories` + `metadata`, rejects an `error` key) -> exit 2. Added 3 tests, including a CLI run with error JSON that must exit 2.
- **README:** reworded "continuously audited" to what actually happens (every CI run, blocking gate, expiring allowlist).
- **Print stylesheet:** postcss/browserslist moved, so I rebuilt `lib/pdf/print-stylesheet.generated.ts`: byte-identical (225,718 bytes, no diff).
- **Checks (local):** `pnpm install --frozen-lockfile` clean; `pnpm typecheck` clean; `pnpm lint:ratchet` = baseline; `pnpm exec vitest run` 163 files passed, 4 skipped (1377 tests); `pnpm build` OK.
- **Before launch:** the better-auth allowlist expires 2027-02-28; re-review it together with the @neondatabase/auth 0.7.0-beta evaluation (D5). Session-refresh-after-idle-hour (audit verification item) is a manual check at that evaluation.

### Preview verification (Vercel preview of PR #18, 2026-11-08)

- **CI:** all 6 checks green on `73961ea`, including the now-blocking "Dependency audit" job (CI log: `critical=2, high=8, moderate=5, low=2 (total=17)`, `Result: PASSED`, same as local).
- **Local E2E against the preview** (run after CI's E2E finished): 22 passed, 1 skipped (mailbox). Sign-up with e-mail verification, login, session, admin approval and exports all work with the new lockfile.
- **Note:** in this local run the E2E global setup's first admin login (8 s wait) timed out and the built-in fallback (verify + 20 s re-login) succeeded. CI's E2E on the same commit logged in on the first attempt, and no earlier run showed it, so it is login latency on that run, not a behaviour change from this PR.
- **Hydration probe:** 0 errors on all 8 pages; sidebar 68 / 220 / 68 px at 800 px.
