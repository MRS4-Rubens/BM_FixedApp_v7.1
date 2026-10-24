# Bill Matrix

A GST billing and invoicing web application for Indian small businesses.

## Prerequisites

- **Node.js** — version pinned in `.nvmrc`. If you have [nvm](https://github.com/nvm-sh/nvm) installed, run `nvm use` to switch to the correct version automatically.
- **pnpm** — this repo enforces pnpm as the only package manager. Do not use npm or yarn.

## Getting Started

1. Clone the repo:
   ```bash
   git clone <repo-url>
   cd BM_TS_v2.0.1C
   ```

2. Switch to the correct Node version (if using nvm):
   ```bash
   nvm use
   ```

3. Install dependencies:
   ```bash
   pnpm install
   ```

4. Copy `.env.example` to `.env.local` and fill in the required values:
   ```bash
   cp .env.example .env.local
   ```

   **IDRIVE_E2_ENDPOINT** — the iDrive e2 S3 endpoint. Both `s3.<region>.idrivee2.com` and `https://s3.<region>.idrivee2.com` are accepted; a trailing slash is ignored. The value must be a bare host (no bucket path, query string, or credentials).

5. Start the local development server:
   ```bash
   pnpm dev
   ```
   The app will be available at [http://localhost:3000](http://localhost:3000).

## Available Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `dev` | `pnpm dev` | Starts the Next.js development server with hot reload. |
| `build` | `pnpm build` | Creates an optimised production build. |
| `start` | `pnpm start` | Serves the production build locally. |
| `lint` | `pnpm lint` | Runs ESLint to check for code quality issues. |
| `typecheck` | `pnpm typecheck` | Runs the TypeScript compiler in no-emit mode to check for type errors. |

## Project Status

This project is being built in phases according to a documented backend roadmap. See `BillMatrix_Backend_Roadmap_v1.md` for current progress and what's implemented so far.

## Environment Validation

Environment variables are validated centrally and lazily via `lib/env.ts`, split into Core and Feature groups.

### Environment Groups

| Group | Variables | Validation Timing | Failure Behavior |
|-------|-----------|-------------------|------------------|
| **Core: App** | `NEXT_PUBLIC_APP_URL` | Boot (`instrumentation.ts`) | Fails boot (`EnvConfigError`) |
| **Core: Database** | `DATABASE_URL` | Boot (`instrumentation.ts`) | Fails boot (`EnvConfigError`) |
| **Core: Auth** | `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET` | Boot (`instrumentation.ts`) | Fails boot (`EnvConfigError`) |
| **Core: Archival** | `ARCHIVAL_SIGNING_SECRET` | Boot (`instrumentation.ts`) | Fails boot (`EnvConfigError`) |
| **Core: Cron** | `CRON_SECRET` | Boot (`instrumentation.ts`) | Fails boot (`EnvConfigError`) |
| **Core: Admin** | `PLATFORM_ADMIN_EMAILS` | Boot (`instrumentation.ts`) | Fails boot (`EnvConfigError`) |
| **Feature: Storage** | `IDRIVE_E2_ENDPOINT`, `IDRIVE_E2_REGION`, `IDRIVE_E2_BUCKET_NAME`, `IDRIVE_E2_ACCESS_KEY`, `IDRIVE_E2_SECRET_KEY` | First use (lazy) | Logged at boot; fails callers on use |
| **Feature: PDF** | `HTML_TO_PDF_API_KEY` | First use (lazy) | Logged at boot; fails callers on use |
| **Feature: Email** | `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | First use (lazy) | Logged at boot; fails callers on use |
| **Feature: Rate Limit** | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | First use (lazy) | Logged at boot; fails callers on use |

### Validation Rules
- **Production rules**: `NEXT_PUBLIC_APP_URL` must use `https://` and be a publicly reachable host (not localhost, `.local`, or `.internal`). `NEON_AUTH_COOKIE_SECRET`, `ARCHIVAL_SIGNING_SECRET`, and `CRON_SECRET` must be at least 32 characters. `PLATFORM_ADMIN_EMAILS` must be a non-empty, comma-separated list of valid email addresses.
- **Development defaults**: In non-production environments (`NODE_ENV !== 'production'`), `NEXT_PUBLIC_APP_URL` defaults to `http://localhost:3000` if omitted.
- **Build time bypass**: `SKIP_ENV_VALIDATION=1` skips the boot-time check and relaxes production URL strictness for local and CI builds. It is strictly ignored when `VERCEL_ENV === 'production'`. It never fabricates missing variables; builds still require syntactically valid auth and database variables (dummy-valid values are acceptable in CI).

