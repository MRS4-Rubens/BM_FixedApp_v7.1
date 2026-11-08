# Bill Matrix

A GST billing and invoicing web application for Indian small businesses.

## Prerequisites

- **Node.js** — Node 22+ (pinned in `.nvmrc`). If you have [nvm](https://github.com/nvm-sh/nvm) installed, run `nvm use` to switch to the correct version automatically.
- **pnpm** — pnpm 11. Run `corepack enable` to ensure the correct package manager is active. Do not use npm or yarn.

## Local Setup

1. Clone the repo:
   ```bash
   git clone <repo-url>
   cd BM_FixedApp_v7.1
   ```

2. Enable corepack and install dependencies:
   ```bash
   corepack enable
   pnpm install
   ```

3. Copy `.env.example` to `.env.local` and configure:
   ```bash
   cp .env.example .env.local
   ```
   See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for production and environment deployment details.

   **IDRIVE_E2_ENDPOINT** — the iDrive e2 S3 endpoint. Both `s3.<region>.idrivee2.com` and `https://s3.<region>.idrivee2.com` are accepted; a trailing slash is ignored. The value must be a bare host (no bucket path, query string, or credentials).

4. Apply migrations and seed reference data:
   ```bash
   pnpm db:migrate
   pnpm db:seed
   ```

5. Start the local development server:
   ```bash
   pnpm dev
   ```
   The app will be available at [http://localhost:3000](http://localhost:3000).

## Tests

- **Typecheck**: `pnpm typecheck` (runs `tsc --noEmit`)
- **Lint**: `pnpm lint:ratchet` (verifies error/warning counts remain within ratchet baselines)
- **Unit & Mock Integration**: `pnpm exec vitest run`
- **Real Database Integration**: `pnpm test:realdb` (requires disposable PostgreSQL; see [docs/TESTING.md](docs/TESTING.md))
- **End-to-End**: Playwright test suite against Vercel preview staging (see [docs/e2e-staging-setup.md](docs/e2e-staging-setup.md))

## Available Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `dev` | `pnpm dev` | Starts the Next.js development server with hot reload. |
| `build` | `pnpm build` | Creates an optimised production build. |
| `start` | `pnpm start` | Serves the production build locally. |
| `lint` | `pnpm lint` | Runs ESLint to check for code quality issues. |
| `typecheck` | `pnpm typecheck` | Runs the TypeScript compiler in no-emit mode to check for type errors. |

## Dependencies & Security

Every CI run audits production dependencies with a blocking gate (`scripts/ci/audit-gate.mjs`); high/critical advisories fail CI unless they are on an expiring, reviewed allowlist (`security/audit-allowlist.json`). Transitive packages get same-major security floors via `pnpm-workspace.yaml` overrides. The core authentication dependency `@neondatabase/auth` is pinned to `0.4.2-beta` with a Server Component cookie patch (`patches/@neondatabase__auth.patch`). See [docs/security/dependencies.md](docs/security/dependencies.md) for full details on dependency policies, overrides, and the audit allowlist.

## Project Status

This project tracks quality and compliance against the comprehensive production readiness audit. See [docs/BM_FinApp_v1.1_Production-Readiness Audit.md](docs/BM_FinApp_v1.1_Production-Readiness%20Audit.md) and completed task reports in `docs/reports/` for history and verified milestone completions.

## Environment Validation

Environment variables are validated centrally and lazily via `lib/env.ts`, split into Core and Feature groups.

### Environment Groups

| Group | Variables | Validation Timing | Failure Behavior |
|-------|-----------|-------------------|------------------|
| **Core: App** | `NEXT_PUBLIC_APP_URL` | Boot (`instrumentation.ts`) | Fails boot (`EnvConfigError`) |
| **Core: Database** | `DATABASE_URL` | Boot (`instrumentation.ts`) | Fails boot (`EnvConfigError`) |
| **Core: Auth** | `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET` | Boot (`instrumentation.ts`) | Fails boot (`EnvConfigError`) |
| **Core: Cron** | `CRON_SECRET` | Boot (`instrumentation.ts`) | Fails boot (`EnvConfigError`) |
| **Core: Admin** | `PLATFORM_ADMIN_USER_IDS`, `PLATFORM_ADMIN_EMAILS` | Boot (`instrumentation.ts`) | Fails boot (`EnvConfigError`) |
| **Feature: Storage** | `IDRIVE_E2_ENDPOINT`, `IDRIVE_E2_REGION`, `IDRIVE_E2_BUCKET_NAME`, `IDRIVE_E2_ACCESS_KEY`, `IDRIVE_E2_SECRET_KEY` | First use (lazy) | Logged at boot; fails callers on use |
| **Feature: PDF** | `HTML_TO_PDF_API_KEY` | First use (lazy) | Logged at boot; fails callers on use |
| **Feature: Email** | `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | First use (lazy) | Logged at boot; fails callers on use |
| **Feature: Rate Limit** | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | First use (lazy) | Logged at boot; fails callers on use |

### Validation Rules
- **Production rules**: `NEXT_PUBLIC_APP_URL` must use `https://` and be a publicly reachable host (not localhost, `.local`, or `.internal`). `NEON_AUTH_COOKIE_SECRET` and `CRON_SECRET` must be at least 32 characters. At least one administrator must be configured in `PLATFORM_ADMIN_USER_IDS` or `PLATFORM_ADMIN_EMAILS` (comma-separated valid emails).
- **Development defaults**: In non-production environments (`NODE_ENV !== 'production'`), `NEXT_PUBLIC_APP_URL` defaults to `http://localhost:3000` if omitted.
- **Build time bypass**: `SKIP_ENV_VALIDATION=1` skips the boot-time check and relaxes production URL strictness for local and CI builds. It is strictly ignored when `VERCEL_ENV === 'production'`. It never fabricates missing variables; builds still require syntactically valid auth and database variables (dummy-valid values are acceptable in CI).
