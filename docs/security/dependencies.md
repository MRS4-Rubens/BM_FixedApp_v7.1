# Dependency Security & Management Guide

This document defines the dependency management, vulnerability auditing, override rules, and patching strategy for Bill Matrix (SEC-007).

---

## 1. Pinned Authentication Stack: `@neondatabase/auth@0.4.2-beta` (Decision D5)

### Why It Is Pinned
The application relies on `@neondatabase/auth` pinned exactly to `0.4.2-beta`. Upstream versions in the beta series (such as `0.7.0-beta`) introduce breaking changes across session interfaces, cookie handling, and client plugin contracts. To ensure runtime stability and prevent regressions in production authentication, this dependency is strictly pinned.

### What Upgrading to `0.7.0-beta` (or Future Versions) Requires
Upgrading this dependency must be handled as an independent, thoroughly evaluated engineering task. It cannot be performed via automated Dependabot bumps or casual upgrades. A prospective upgrade requires:
- Auditing the upstream changelog and breaking changes.
- Verifying whether `patches/@neondatabase__auth.patch` is still required or if upstream provides native Next.js Server Component support.
- Re-testing all critical authentication flows:
  - User login, logout, and password management.
  - Sign-up email verification and onboarding.
  - Silent session refresh via proxy/middleware and Server Actions.
  - Platform administrator authorization guards (`isPlatformAdmin`, `requirePlatformAdmin`).
  - Full Playwright E2E suite (`pnpm e2e`).

---

## 2. The Neon Auth Patch (`patches/@neondatabase__auth.patch`)

### What It Changes
In `@neondatabase/auth` `0.4.2-beta`, `createNextRequestContext` in `dist/next/server/index.mjs` attempts to call `cookieStore.set(name, value, options)` unconditionally during request context initialization. In Next.js Server Components, cookies are read-only and attempting to call `cookieStore.set` throws a runtime error.

The patch wraps `cookieStore.set` in a `try/catch` block:
```javascript
setCookie(name, value, options) {
  try {
    cookieStore.set(name, value, options);
  } catch {
    // In Next.js Server Components, cookies are read-only and modifying them throws.
    // Silently ignore so getSession() can continue and return the session data safely.
  }
}
```

### Consequences and Guarantees
- **Server Components**: Session refresh cookies cannot be written to the response during a Server Component render pass. The session data is read and verified safely without throwing.
- **Proxy / Middleware & Server Actions**: Cookie mutation is supported in Route Handlers and Server Actions; session tokens continue to be refreshed and persisted in those contexts.

### How to Check Upstream Compatibility
When evaluating a new release of `@neondatabase/auth`:
1. Inspect `dist/next/server/index.mjs` (or equivalent build output) inside `node_modules/@neondatabase/auth/`.
2. Check how `createNextRequestContext` handles `setCookie` when invoked within Server Components.
3. If upstream catches cookie mutation errors or isolates Server Component cookie reading from cookie writing, the patch can be removed from `pnpm-workspace.yaml`. Otherwise, the patch must be ported or regenerated.

---

## 3. Transitive Dependency Overrides (`pnpm-workspace.yaml`)

### Policy: Never Cross a Major in Overrides
Overrides in `pnpm-workspace.yaml` are strictly reserved for enforcing **same-major security floors** for transitive dependencies with published vulnerability fixes. 
- Overrides must **never** specify a different major version, as transitive major bumps risk breaking runtime contracts of parent packages.
- All overrides must include an explicit in-line or documentation reference explaining their security justification.

### Current Overrides Table

| Package | Installed Before | Floor / Target | Reason & CVE / Advisory |
| :--- | :--- | :--- | :--- |
| `brace-expansion@^1` | `1.1.15` | `^1.1.21` | ReDoS vulnerability in brace expansion parsing |
| `brace-expansion@^2` | `2.1.1` | `^2.1.7` | ReDoS vulnerability in brace expansion parsing |
| `brace-expansion@^5` | `5.0.6` | `^5.0.12` | ReDoS vulnerability in brace expansion parsing |
| `browserslist` | `4.28.1` | `^4.29.5` | Regular expression denial of service / query parsing flaw |
| `baseline-browser-mapping` | `2.9.19` | `^2.11.35` | Security and compatibility updates for browser mapping data |
| `fast-uri@^3` | `3.1.2` | `^3.1.9` | URL parsing bypass / prototype issues |
| `js-yaml@^4` | `4.2.0` | `^4.3.2` | Prototype pollution / resource exhaustion in YAML parsing |
| `nanoid@^3` | `3.3.11` | `^3.3.20` | Predictability / generator performance security improvements |
| `postcss@^8` | `8.5.6` | `^8.5.32` | Line return parsing vulnerabilities / CSS injection risks |
| `source-map-js` | `1.2.1` | `^1.2.2` | Source map parsing fixes |
| `zod@^4` | `4.3.6` | `^4.6.7` | ReDoS vulnerabilities in schema string validators |
| `hono` | `4.12.25` | `^4.13.17` | Replaces vulnerable `4.12.25` with patched `4.13.17` floor |

---

## 4. The CI Audit Gate (`scripts/ci/audit-gate.mjs`)

### How CI Enforces Dependency Security
The `dependency-audit` job in `.github/workflows/ci.yml` runs:
```bash
node scripts/ci/audit-gate.mjs
```
The audit gate enforces:
1. Runs `pnpm audit --prod --json` (reads lockfile; zero production dependencies installed in CI).
2. Fails the build (exit code `1`) if any **High** or **Critical** production advisory is detected, unless it is actively allowlisted.
3. Validates that every allowlisted advisory is recorded in `security/audit-allowlist.json` with a valid package name, severity, valid expiry date (`YYYY-MM-DD`), and a substantive justification (>= 20 characters).
4. If an allowlist entry has expired (`today > expires`), it is immediately treated as **blocking**, failing the CI build.
5. Emits warnings for stale allowlist entries that no longer match any audit finding.
6. Moderate and Low severity advisories are summarized in the console output but are **not blocking**.

### Running the Audit Gate Locally
```bash
# Standard local audit run
node scripts/ci/audit-gate.mjs

# Using custom input JSON, allowlist, or reference date (for testing)
node scripts/ci/audit-gate.mjs --input audit.json --allowlist security/audit-allowlist.json --today 2026-11-08
```

### Allowlist Policy and Renewals (`security/audit-allowlist.json`)
The 10 current allowlisted advisories correspond to `better-auth@1.4.18` server-side vulnerabilities introduced via `@neondatabase/auth@0.4.2-beta`.
- **Reason**: The Better Auth authentication server is managed and hosted directly by Neon Cloud infrastructure. The Bill Matrix application only imports client-side plugins and cookie parsing utilities (`better-auth/react`, `better-auth/client`, `better-auth/cookies`).
- **Expiry**: All 10 entries are configured to expire on **`2027-02-28`**.
- **Launch Review**: Prior to production launch, security leads and maintainers must re-evaluate the status of `@neondatabase/auth` and confirm whether an official upstream update resolving these advisories can be safely adopted.

To add or renew an entry:
1. Confirm the flaw is either not reachable in the application runtime or mitigated by infrastructure controls.
2. Add an entry to `security/audit-allowlist.json` containing: `ghsa`, `package`, `severity`, `expires` (maximum 1 year out), and a detailed `reason`.
3. Require explicit review from the engineering and security leads before merging.

---

## 5. Known Moderate and Low Severity Advisories (Non-Blocking)

The following transitive dependencies have known moderate or low severity advisories with no fix available within their current major version:

1. **`glob@13.x` and `minimatch@10.x`**: Used exclusively in Sentry CLI and build tooling. Not exposed to user input or web requests.
2. **`uuid@8.3.2`**: Pulled transitively via `exceljs`. Used internally for spreadsheet object generation; not exposed to untrusted random seed manipulation.
3. **`esbuild@0.18.20`**: Pulled transitively via `drizzle-kit` CLI tooling for schema migrations; not executed in production serving.
4. **`deepmerge@4.3.1` (Low)**: Prototype poisoning alert in deep object merging; inputs in transactional billing and auth flows do not pass raw untrusted JSON structures to `deepmerge`.
5. **`zod@3.25.76`**: Pulled transitively in dev-only tooling. The production application runs `zod@^4.6.7`.

These findings do not pose an exploitable vector in Bill Matrix and are intentionally allowed as non-blocking by policy.

---

## 6. Dependabot Configuration (`.github/dependabot.yml`)

Dependabot is configured with a monthly cadence:
- **Major updates ignored**: All semver major bumps (`version-update:semver-major`) are ignored across all ecosystems to prevent automated disruption.
- **Authentication stack ignored**: `@neondatabase/auth`, `@neondatabase/auth-ui`, `better-auth`, and `@better-auth/*` are strictly ignored. All changes to the authentication stack require deliberate manual migration and thorough verification under Decision D5.
- **GitHub Actions**: Actions dependencies are grouped and audited monthly.

