# Invoice BizFolio — Launch Checklist (₹0 pilot, real launch)

> **Status:** all services decided on 2026-11-18. Nothing below has been built or created yet.
> **This is the REAL launch setup, not a mock.** We create a **test** version and a **production** version of each service side by side, test everything on the test versions, then **switch Render's values to production** at the end. Production data stays 100% clean.
> **Goal:** onboard 2 pilot shops (3 users including the owner) for ₹0, then upgrade service by service when people pay.
> **How to use this file:** work top to bottom and tick each box. In a new Claude session say: *"Read docs/LAUNCH_CHECKLIST.md and continue from the first unticked box."*
> **Rule:** every approved point here is a requirement. Do not drop sub-points during implementation.
> Prices and limits were checked on 2026-11-18. Items marked **(unverified)** must be re-checked on the day. Dashboard menu names can change; follow the meaning if a label differs.

---

## 0. Why test and production are kept apart (read once)

- The database **blocks deleting or editing finalized records**: invoices, credit notes, their line items, payments, the audit log (it even blocks emptying the table) and the payment-settings history (`bm_invoices_guard`, `bm_audit_log_guard` and others in `drizzle/*.sql`). This is the legal-safety design.
- So any test invoice finalized on the production database could **never be removed**, and **invoice numbering would continue from the test ones**.
- Therefore **all go-live testing happens on the test setup**. The production database is migrated, seeded and then **left untouched until the switch** (section 7).

---

## 1. Final decisions

| # | Service | Decision | Free limit that matters | Upgrade trigger → what to buy |
|---|---|---|---|---|
| 1 | Hosting | **Render Free**, region **Singapore**, one web service | 750 h/month, 0.1 CPU, 512 MB RAM, **5 GB bandwidth/month**, 500 build min, sleeps after 15 min | First paying user, slow pages, or bandwidth near 5 GB → **Starter $7/month** (0.5 CPU, no sleep) |
| 2 | Database | **Neon Free**: projects `bizfolio-prod` + `bizfolio-test`, Singapore, Postgres 17, compute fixed **0.25 CU** | 100 CU-hours/month **per project**, 1 GB, 6 h restore history | ~80 CU-h used in a month → **Launch** (pay per use: $0.106/CU-h + $0.35/GB-month) |
| 3 | Authentication | **Neon Auth**, sign-up verification **ON with codes only** (no links) | 60,000 monthly users | — |
| 4 | Auth e-mails | **Neon's built-in sender** (`auth@mail.myneon.app`) | Rate-limited (number not published) | Domain bought → switch Neon Auth to Brevo SMTP |
| 5 | App e-mails | **Brevo Free, web API** (not SMTP: Render Free blocks e-mail ports 25/465/587), sender = your Gmail. **Only to business users and you.** Customer e-mails (invoice + reminder) **turned off, code kept** | 300 e-mails/day (unverified on Brevo's own page) | Domain bought, or near 300/day |
| 6 | Invoice sharing | **WhatsApp stays paid** (Essentials Pro). Free plan = download/print PDF only | — | — |
| 7 | PDF generation | **Cloudflare Browser Rendering (Workers Free)**, production token only (switched from CustomJS in L7: unreliable account, watermark, 20/day) | 10 browser-minutes/day, REST **1 request / 10 s** (app queues 10.5 s apart), no watermark, no card. Measured ~0.4 s per invoice locally and ~0.6 s of browser time per PDF on the live Cloudflare account (font embedded, no network) | Daily time near 10 min or 429s piling up → **Workers Paid $5/month** |
| 8 | File storage | **IDrive e2 Free**, Singapore, private buckets `bizfolio-prod-files`, `bizfolio-test-files`, `bizfolio-backups`; **no Object Lock** for the pilot | 10 GB total; downloads ≤ 3× stored (free-plan permanence unverified) | Near 8 GB or free plan ends → paid ($6/TB) or move to Backblaze B2 (settings only) |
| 9 | Backups | Neon 6 h history **+ nightly encrypted `pg_dump`** of production via GitHub Actions to `bizfolio-backups`, keep 7 daily + 4 weekly, restore drill every 3 months | Neon 5 GB transfer/month | Database > ~150 MB → weekly dumps, or Neon paid for longer history |
| 10 | Rate limiting | **Upstash Redis Free**, Singapore, **one account, one database** for production (flushed at the switch). CI uses a local look-alike, never Upstash. No code change | 500K commands/month; **one free account per person** and one free database (Upstash terms) | Over ~400K/month → add card (PAYG $0.20 per 100K) |
| 11 | Error monitoring | **Sentry Developer Free**, EU region, one project; environments `test` / `production`. Cron monitor only for the PDF archive job | 5K errors/month, 1 user, 1 cron monitor | Regularly > 5K errors or a second person → Team (~$26/month) |
| 12 | Uptime | **UptimeRobot Free** (commercial use allowed): `/ping` every 5 min, `/health-db` every 6 h, e-mail after 2 failures | 50 monitors, 5-min checks | Need faster checks/SMS → paid |
| 13 | Scheduled jobs | **cron-job.org Free**: 2 daily jobs with secret header, failure + recovery e-mails. Manual GitHub "Run cron now" fallback | 30-second timeout | None expected |
| 14 | Domain + DNS | **Free `<name>.onrender.com`** for the pilot | — | First paying user or e-mail problems → buy domain, Cloudflare DNS (free), Render custom domain (2 free) |
| 15 | Business inbox | **One Gmail** (receives support, feedback, payment claims) | — | With domain → Cloudflare Email Routing (free) forwards `support@` to Gmail |
| 16 | Payments | Existing **manual UPI QR + bank transfer**, admin approves | — | Gateway later |
| 17 | Code + CI | GitHub, **public repo** (free unlimited minutes), CI + browser tests on every PR | — | None while public |
| 18 | Test services | Browser tests run the app **inside GitHub's machine** + **Neon test project** + **local Redis + Upstash look-alike** (serverless-redis-http) behind a small CI-only proxy that removes the Upstash-only `allow-key-locking` script flag. Mailosaur dropped | — | — |
| 19 | Web analytics | **Removed** (Vercel Analytics deleted) | — | Cloudflare Web Analytics later if wanted |
| 20 | Notification bell | **Option C**: refresh on page change, window focus, bell click, plus every 30 min | — | — |
| 21 | Secrets | Render env for the app, GitHub Secrets for CI/backups/tests, cron-job.org header for `CRON_SECRET`. All fresh; test and production values always different | — | — |
| 22 | Fonts | Keep `next/font` (self-hosted at build) | — | — |

---

## 2. Code batch (build BEFORE creating accounts)

One launch-prep branch, one review, one PR. Never commit to `main` directly.

- [x] **2.1 Customer e-mails off (keep code):** *(done: PR #68, switch in `lib/config/features.ts`)* one switch; hide the **Email** and **Reminder** buttons in `components/app/invoices/invoice-detail.tsx`; guard `lib/actions/invoices/email-invoice.ts` and `send-payment-reminder.ts` so they refuse while off.
- [x] **2.2 Wording:** *(plan + landing: PR #68; privacy page: L3 PR)*
  - `lib/subscriptions/plan-catalog.ts`: Free + Essentials rows stop promising "E-mail invoices (PDF) and payment reminders"; Free says "Download and print invoice PDFs".
  - `components/landing/features-section.tsx`, `comparison-table.tsx`, `how-it-works.tsx`.
  - Privacy page: Resend → Brevo; add Render, UptimeRobot, cron-job.org; Neon and IDrive now in Singapore; Sentry EU.
- [x] **2.3 Sign-up verification code screen** (auth, high risk, built in Claude Code, not Antigravity): done in L4. After sign-up (and after a sign-in with an unconfirmed e-mail) the modal shows a 6-digit code box (server action → `auth.emailOtp.verifyEmail`), a "Resend code" button (`auth.sendVerificationEmail`, 3 per e-mail per 15 min, fail-closed, 30 s button cooldown) and the 15-minute expiry message (Neon docs). Wrong codes get one neutral message; verify uses the login limits (10 per e-mail per 15 min). Needs the Neon console setting in 3.x below (Verify at Sign-up ON, method Verification code). Live check: one real sign-up on the test Neon project.
- [x] **2.4 Render readiness:** *(done: L2 PR)*
  - Make `isEnvValidationSkipped` safe off Vercel (today it only checks `VERCEL_ENV`).
  - Sentry release from `RENDER_GIT_COMMIT` (`lib/observability/sentry-config.ts`, `next.config.mjs`); explicit environment via `NEXT_PUBLIC_SENTRY_ENVIRONMENT` (`test` / `production`, read at build time).
  - Remove `@vercel/analytics` (`app/layout.tsx`, `package.json`).
  - New routes: **`/ping`** (no database, no Redis) and **`/health-db`** (database check).
  - Sentry ignores errors from `/ping` and `/health-db`. Do **not** filter "Failed to fetch" until the month-1 review.
- [x] **2.5 Cron routes reply first:** *(done: L2 PR; schedules in `lib/cron/schedules.ts`, workflow `run-cron-now.yml`)* both `app/api/cron/*` routes check the secret, reply **202** immediately, then run the work with `after()`. The archive job stays inside `Sentry.withMonitor`; **remove** `Sentry.withMonitor` from daily-notifications. Delete the crons from `vercel.json`. Add a manual GitHub workflow "Run cron now".
- [x] **2.6 Bell Option C** *(done: PR #68)* in `components/app/notifications/notification-bell.tsx` (replace `REFRESH_MS = 120_000`).
- [x] **2.7 Backup workflow** `.github/workflows/backup-db.yml` *(done: L5)*: 21:00 UTC (02:30 IST) + manual button; Postgres 17 `pg_dump` (custom format, compressed; checked to contain `invoices`) → encrypt (gpg AES-256) with `BACKUP_ENCRYPTION_PASSPHRASE` → upload to `bizfolio-backups` under `daily/` (+ `weekly/` on Sundays) → prune to 7 daily + 4 weekly. **Off until the variable `BACKUPS_ENABLED=true`** is set (section 7); once on, a missing secret fails the run. Restore steps are in the workflow header.
- [x] **2.8 E2E workflow rewrite** `.github/workflows/e2e.yml` *(done: L5)*: build + `next start` on the runner (`http://localhost:3000`); Neon test database + its Neon Auth (new secret `E2E_NEON_AUTH_BASE_URL`); `E2E_VERIFY_MODE=db`; removed the Vercel preview lookup, trusted-domain script, `E2E_VERCEL_BYPASS_SECRET` and Mailosaur; every PR + manual button; fork-PR guard kept; fake Cloudflare/Brevo/IDrive keys. Redis: **local Redis + serverless-redis-http** service containers (empty every run) behind `scripts/ci/upstash-local-proxy.ts`, which removes the Upstash-only `allow-key-locking` script flag (PR #76). `lib/env.ts` accepts its `http://localhost` address only when validation is skipped, never on Render. The runner app sets `SKIP_ENV_VALIDATION=1` because production validation rejects `http://localhost` (never possible on Render).
- [x] **2.9 E-mail provider swap:** *(done: L3 PR; `lib/email/mailer.ts`, Brevo HTTPS API)* Resend → **Brevo web API** in `lib/email/resend.ts` / `send-customer-email.ts`; rename env vars (e.g. `BREVO_API_KEY`, `EMAIL_FROM`).
- [x] **2.10 Brand clean-up:** *(done: L2 PR; production now refuses to boot without `NEXT_PUBLIC_SUPPORT_EMAIL`)* `lib/config/contact.ts` fallback `support@billmatrix.in`; `.env.example` "Bill Matrix" → Invoice BizFolio, matching section 4 (fake values only).
- [x] **2.11 Docs:** *(done: L6)* `docs/DEPLOYMENT.md`: removed the 8-year Object Lock, 7-day PITR, RPO ≤ 5 min and weekly-dump claims; now describes Render, cron-job.org, UptimeRobot (`/ping`, `/health-db`), the nightly encrypted backup + restore drill, honest recovery targets, and the 7 PR checks. `docs/e2e-staging-setup.md` rewritten for the runner-based E2E. `README.md` env table, background jobs and deploy sections updated.
- [x] **2.12 Tests + gate:** *(done in every L-PR)* tests for every item; snapshots updated; `pnpm typecheck && pnpm lint:ratchet && pnpm knip && pnpm test && pnpm build` (+ `pnpm print-css:build` if UI changed); line endings checked (CRLF → LF) before each commit.

---

## 3. Create accounts — test and production together

> **Status (2026-11-20): section 3 is done.** The notes below record what was actually set up where it differs from the original plan.

> **Before you start:** open the password manager. Every key, URL and password goes in **the moment it is created**, in two folders: **"BizFolio — TEST"** and **"BizFolio — PRODUCTION"**.
> Generate random secrets with `openssl rand -hex 32` (Git Bash / terminal). **Never reuse a test value in production.**

### 3.1 Password manager
- [ ] Create a vault "Invoice BizFolio" with two folders: **TEST** and **PRODUCTION**.
- [ ] Save there: Gmail login, every account login, every key below.

### 3.2 Gmail (business inbox)
- [ ] Create one dedicated Gmail (e.g. `yourapp@gmail.com`); turn on 2-step verification.
- [ ] Use it to sign up for every service below.
- [ ] Optional plus-addresses for filtering: `yourapp+support@gmail.com`, `yourapp+billing@gmail.com`.

### 3.3 GitHub settings (repo `MRS4-Rubens/BM_FixedApp_v7.1`, already public)
- [ ] Settings → Code security → **Secret scanning: ON** and **Push protection: ON**.
- [ ] Settings → Actions → General → Fork pull request workflows → **Require approval** for outside contributors.
- [ ] Rule: never add a `pull_request_target` trigger to any workflow.
- [ ] Rule: keys only in GitHub Secrets / Render, never in files.

### 3.4 Neon — two projects
**Production project**
- [ ] Neon Console → New project → name `bizfolio-prod` → region **AWS Asia Pacific (Singapore) `aws-ap-southeast-1`** → Postgres **17**. (The region can't be changed later.)
- [ ] Compute settings → autoscaling **min 0.25 CU / max 0.25 CU**.
- [ ] Enable **Neon Auth** for the project.
- [ ] Auth settings → Sign-up with Email **ON** → **Verify at Sign-up ON** → method **Verification code** (not link) → email provider **Shared** → application name **Invoice BizFolio**. *(Set on dev 2026-11-19 and live-tested in L4. Never switch it off to make testing easier; live sign-up tests need a throwaway inbox.)*
- [ ] Settings → Better Auth → **Allow Localhost OFF** (production only: stops sign-in requests from `localhost`).
- [ ] Note which **database** holds the `neon_auth` schema (usually the default `neondb`). **The app's tables go into that same database**, so one backup contains users too.
- [ ] Copy into the password manager (PRODUCTION): pooled connection string → `DATABASE_URL`; direct (unpooled) string → `DATABASE_URL_UNPOOLED`; Auth URL → `NEON_AUTH_BASE_URL`.

**Test project**
- [ ] New project `bizfolio-test` → same region, Postgres 17, compute 0.25/0.25, Neon Auth ON with the **same code-verification settings**, app name "Invoice BizFolio (TEST)". Keep **Allow Localhost ON** here (the CI browser tests sign in from `http://localhost:3000`).
- [ ] Copy into the password manager (TEST): pooled URL, direct URL, Auth URL, project ID.

**Set up both databases** (from your PC, in the project folder)
> Set **both** variables for the target first. `pnpm db:migrate` uses `DATABASE_URL_UNPOOLED` (direct URL), but
> `pnpm db:seed` writes through the app's normal connection, `DATABASE_URL` (pooled URL). The seed also reads
> `.env.local`; values set in the terminal win over that file, so nothing goes to the database named there. Close the
> terminal afterwards so the next command cannot reach this database by mistake.
- [ ] Test (PowerShell): `$env:DATABASE_URL='<test pooled URL>'; $env:DATABASE_URL_UNPOOLED='<test direct URL>'; pnpm db:migrate; if ($LASTEXITCODE -eq 0) { pnpm db:seed }`
- [ ] Production, in a **new** terminal: `$env:DATABASE_URL='<prod pooled URL>'; $env:DATABASE_URL_UNPOOLED='<prod direct URL>'; pnpm db:migrate; if ($LASTEXITCODE -eq 0) { pnpm db:seed }`. If the migration prints an error, stop and fix it first; the seed only runs after a clean migration. **After this, do not sign up or create anything on production until section 7.** *(Production was set up this way on 2026-11-19; repeat only for a new database.)*
- [ ] Proof (production): the database has **0** rows in businesses, users, invoices, payments and audit_log, and **`tax_rates` = 4** (0, 5, 18 and 40 %).

### 3.5 IDrive e2 — three buckets
- [ ] Sign up (free 10 GB) → region **Singapore** (IDrive's region code is **`ap-southeast-2`**, endpoint `s3.ap-southeast-2.idrivee2.com`; not AWS's `ap-southeast-1`).
- [ ] Create private buckets (public access OFF, **Object Lock OFF**): `bizfolio-prod-files`, `bizfolio-test-files`, `bizfolio-backups`.
- [ ] Access keys → per-bucket keys **are** supported, so create **three** keys: **prod app key** (`bizfolio-prod-files` only), **test app key** (`bizfolio-test-files` only), **backup key** (`bizfolio-backups` only).
- [ ] Note the S3 endpoint from the dashboard (Enabled regions). *Actual: `https://s3.ap-southeast-2.idrivee2.com`, region code `ap-southeast-2`.*
- [ ] Save endpoint, region, bucket names and keys (test app key: TEST folder; prod app key + backup key: PRODUCTION).

### 3.6 Upstash — one account, one database
> **Upstash terms:** one free account per person and one free database. So: no second (alias) account for tests, and
> **delete the old development Upstash account first** (Upstash console → Account → Delete account) so you never hold
> two free accounts at once. CI browser tests do not need Upstash: they use a local look-alike on GitHub's machine.
>
> **Inactivity:** Upstash may treat a free database as inactive after 1 week without requests and delete unused
> accounts. Every sign-in or sign-up uses it (rate limits), so normal use keeps it active. The cron jobs and uptime checks do **not** touch Redis, so in a quiet week sign in once yourself (weekly check in section 9).

- [ ] Delete the **old development** Upstash account (after copying nothing: rate-limit counters are throwaway).
- [ ] Sign up (your Gmail) → Create Redis database → name `bizfolio` → region **AWS ap-southeast-1 (Singapore)** → Free.
- [ ] Copy the **REST URL** and **REST token** (PRODUCTION folder; it is also used during testing and flushed at the switch).

### 3.7 Cloudflare — PDF rendering (Browser Rendering)
- [ ] Sign up (business Gmail) at dash.cloudflare.com — Free plan, **no card** (stop if one is asked for).
- [ ] Copy the **Account ID** (32 characters; dashboard → account home / Workers & Pages overview) → PRODUCTION folder as `CLOUDFLARE_ACCOUNT_ID`.
- [ ] My Profile → API Tokens → **Create Token** → **Create Custom Token** → name `bizfolio-pdf` → Permissions: **Account → Browser Rendering (Browser Run) → Edit** only → Account resources: this account only → no IP filter, no expiry → Create → copy once → PRODUCTION folder as `CLOUDFLARE_API_TOKEN`.
- [ ] Never put the token in GitHub test secrets (CI uses fake values). During go-live tests on Render it is used for a few PDFs; check the render time in section 6.
- [ ] After launch: delete the old development CustomJS account (section 8).

### 3.8 Brevo
- [ ] Sign up (free) → Settings → Senders → add sender **your Gmail** (name "Invoice BizFolio") → verify via the e-mail Brevo sends.
- [ ] SMTP & API → API keys → create key `bizfolio-prod` → PRODUCTION folder.
- [ ] Accept: Brevo may rewrite a Gmail sender; users mark the first e-mail "Not spam".

### 3.9 Sentry
- [ ] Sign up → new organization → data region **EU** → create project **Next.js** `invoice-bizfolio`.
- [ ] Copy the **DSN** (used for both `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN`).
- [ ] Settings → Auth tokens → create a token with **only release / source-map upload** permissions → `SENTRY_AUTH_TOKEN`; note `SENTRY_ORG` and `SENTRY_PROJECT` slugs.
- [ ] Alerts → e-mail for new issues in environment `production` (the archive cron monitor appears by itself on the first check-in).

### 3.10 Render — one web service (starts on TEST values)
- [ ] Sign up with your business **Gmail** (not GitHub) → Hobby workspace → then connect GitHub only to pick the repo.
- [ ] New → Web Service → connect the repo → **choose the final service name now** (the address `https://<name>.onrender.com` comes from it and stays after the switch).
- [ ] Region **Singapore**, instance **Free**, branch `main`.
- [ ] Build command `pnpm install && pnpm build`; start command `node_modules/.bin/next start` (runs Next directly, without an extra pnpm process, to save memory on the 512 MB instance); Node 24 (from `engines` / `.nvmrc`).
- [ ] Health check path `/ping`.
- [ ] Environment → add the **"During testing"** values from section 4.1. **Never set `SKIP_ENV_VALIDATION`.**
- [ ] Deploy → note the address → set `NEXT_PUBLIC_APP_URL` to it → **Save, rebuild, and deploy** (it is a build-time value).

### 3.11 Neon Auth trusted domains
- [ ] Test project: add `https://<name>.onrender.com`. `localhost` needs no entry while Allow Localhost is ON (Neon docs: localhost ports are pre-approved).
- [ ] Production project: add `https://<name>.onrender.com`.

### 3.12 cron-job.org — create, then PAUSE
- [ ] Sign up → create job **Archive retry**: `GET https://<name>.onrender.com/api/cron/retry-invoice-archival`, daily **20:00 UTC** (01:30 IST), header `Authorization: Bearer <TEST CRON_SECRET>`.
- [ ] Create job **Daily notifications**: `GET https://<name>.onrender.com/api/cron/daily-notifications`, daily **03:30 UTC** (09:00 IST), same header.
- [ ] Turn on e-mail notifications for **failure** and **recovery** on both.
- [ ] Use "Run now" during testing; keep both **paused** until section 7.

### 3.13 UptimeRobot
- [ ] Sign up → New monitor HTTP(s) `https://<name>.onrender.com/ping`, interval **5 min**.
- [ ] New monitor `https://<name>.onrender.com/health-db`, interval **6 hours** (offered on the free plan).
- [ ] Delete the monitor UptimeRobot creates by itself at sign-up for the home page: it repeats `/ping` and renders the full page every 5 minutes.
- [ ] UptimeRobot terms: commercial use allowed, **one account per person**.
- [ ] Alert contact = your Gmail; alert after **2** failed checks.

### 3.14 GitHub Secrets and Variables
- [ ] Settings → Secrets and variables → Actions → add everything in section 4.2.
- [ ] **Replace every old development value.** Until now the E2E secrets (`E2E_STAGING_DATABASE_URL`, `E2E_STAGING_DATABASE_URL_UNPOOLED`, `E2E_NEON_AUTH_BASE_URL`) and the variable `E2E_DB_HOST_ALLOWLIST` point at the **old development** accounts. Overwrite all of them with the new **test** values, and set `E2E_FORBIDDEN_DB_HOSTS` / `E2E_FORBIDDEN_HOSTS` to the new **production** host and address. Then run E2E once (Actions → E2E (runner app) → Run workflow) and check it passes.
- [ ] Delete the unused secrets/variables: `NEON_API_KEY`, `NEON_PROJECT_ID`, `NEON_STAGING_BRANCH_ID`, `E2E_VERCEL_BYPASS_SECRET`, `MAILOSAUR_API_KEY`, `MAILOSAUR_SERVER_ID`, `E2E_VERIFY_MODE`, `E2E_UPSTASH_REST_URL`, `E2E_UPSTASH_REST_TOKEN`, `E2E_UPSTASH_HOST_ALLOWLIST`.
- [ ] `E2E_ADMIN_EMAIL` = a fake address such as `e2e-admin@example.test` (never receives mail; global setup creates the account on the first run) and a new random `E2E_ADMIN_PASSWORD` (TEST folder). Leave `BACKUPS_ENABLED`, `CRON_SECRET` and `CRON_APP_URL` unset until section 7 (7.10, 7.11). Add the production `DATABASE_URL_UNPOOLED` and the `BACKUP_*` secrets now; nothing uses them before section 7.
- [ ] Proof: the manual E2E run passes. *(2026-11-20: 24 passed on the new test project.)*
- [ ] `E2E_FORBIDDEN_DB_HOSTS` = the **production** Neon host(s); `E2E_FORBIDDEN_HOSTS` = the production address. These guards stop tests from ever touching production.

---

## 4. Environment variables

### 4.1 Render — "During testing" vs "After switch"

| Variable | During testing (section 6) | After switch (section 7) | Secret? |
|---|---|---|---|
| `NEXT_PUBLIC_APP_URL` | `https://<name>.onrender.com` | **same** | No |
| `DATABASE_URL` | Test pooled URL | **Prod pooled URL** | **Yes** |
| `NEON_AUTH_BASE_URL` | Test Auth URL | **Prod Auth URL** | No |
| `NEON_AUTH_COOKIE_SECRET` | Test value | **New prod value** | **Yes** |
| `CRON_SECRET` | Test value | **New prod value** (also update cron-job.org) | **Yes** |
| `PLATFORM_ADMIN_USER_IDS` | Your user ID in the test project | **Your new user ID in prod** | No |
| `PLATFORM_ADMIN_EMAILS` | Optional fallback | same | No |
| `IDRIVE_E2_ENDPOINT` | Singapore endpoint | same | No |
| `IDRIVE_E2_REGION` | `ap-southeast-2` | same | No |
| `IDRIVE_E2_BUCKET_NAME` | `bizfolio-test-files` | **`bizfolio-prod-files`** | No |
| `IDRIVE_E2_ACCESS_KEY` / `IDRIVE_E2_SECRET_KEY` | **Test** app key | **Prod** app key (each key opens only its own bucket) | **Yes** |
| `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN` | Cloudflare (Browser Rendering token) | same | Token **Yes** |
| `BREVO_API_KEY` | Brevo key | same | **Yes** |
| `EMAIL_FROM` | `"Invoice BizFolio <yourapp@gmail.com>"` | same | No |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Upstash DB | same (**flushed** at switch) | Token **Yes** |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` | DSN | same | No (public by design) |
| `NEXT_PUBLIC_SENTRY_ENVIRONMENT` (added in 2.4; **build time**: after changing, use **Save, rebuild, and deploy**) | `test` | **`production`** | No |
| `SENTRY_AUTH_TOKEN` / `SENTRY_ORG` / `SENTRY_PROJECT` | Build upload | same | Token **Yes** |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | `invoicebizfolio26+support@gmail.com` (**required**: the server won't start without it; **build time**, so change it with **Save, rebuild, and deploy**). Shown on the site; also the **reply-to** of invites and notifications, so replies land in the Support label | same | No |
| `FEEDBACK_RECIPIENT_EMAIL` | leave unset (= support address) or `…+support@gmail.com` | same | No |
| `BILLING_EMAIL` | `invoicebizfolio26+billing@gmail.com`: payment-claim notices, sent as "Invoice BizFolio Billing" (unset = the admins) | same | No |
| `ADMIN_UPI_ID` / `ADMIN_UPI_NAME` | Your real UPI (to test the QR) | same (**shown to customers**) | No |
| `ADMIN_BANK_NAME` / `ADMIN_BANK_ACC_NAME` / `ADMIN_BANK_ACC_NO` / `ADMIN_BANK_IFSC` | Your bank details | same (**shown to customers**, double-check) | No |
| ~~`SKIP_ENV_VALIDATION`~~ | **never** | **never** | — |

### 4.2 GitHub (Settings → Secrets and variables → Actions)

| Name | Type | Points to | Used by |
|---|---|---|---|
| `DATABASE_URL_UNPOOLED` | Secret | **Prod** direct URL | Production migration workflow + backup workflow |
| `BACKUP_ENCRYPTION_PASSPHRASE` | Secret | — (≥ 32 characters; also in password manager: without it backups can't be opened) | Backup workflow |
| `BACKUP_S3_ENDPOINT` (`https://…idrivee2.com`), `BACKUP_S3_REGION`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` | Secret | Backups bucket key | Backup workflow |
| `BACKUP_S3_BUCKET` (optional, default `bizfolio-backups`), `BACKUPS_ENABLED=true` (**only from section 7**) | Variable | — | Backup workflow |
| `CRON_SECRET` + `CRON_APP_URL` (`https://<name>.onrender.com`) | Secret | **Prod** value after the switch | Manual "Run cron now" workflow (`run-cron-now.yml`) |
| `E2E_STAGING_DATABASE_URL` (pooled), `E2E_STAGING_DATABASE_URL_UNPOOLED` (direct), `E2E_NEON_AUTH_BASE_URL` | Secret | **Test** Neon project | E2E (app on the runner + tests) |
| `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD`, `E2E_CONFIRM_STAGING` | Secret | Test values only | E2E |
| `E2E_DB_HOST_ALLOWLIST` | Variable | **Test** Neon host | E2E safety guard |
| `E2E_FORBIDDEN_DB_HOSTS` / `E2E_FORBIDDEN_HOSTS` | Variable | **Prod** Neon host / prod address | E2E safety guard |
| `E2E_EXPECT_VERIFICATION_REQUIRED` (optional) | Variable | Default **`true`** (unset = true): the tests expect a new sign-up to need the e-mail code. Set `false` only if the test project's Verify at Sign-up is ever OFF | E2E sign-up specs (journey, team, CA) |
| ~~`NEON_API_KEY`, `NEON_PROJECT_ID`, `NEON_STAGING_BRANCH_ID`, `E2E_VERCEL_BYPASS_SECRET`, `MAILOSAUR_*`, `E2E_UPSTASH_REST_URL`, `E2E_UPSTASH_REST_TOKEN`, `E2E_UPSTASH_HOST_ALLOWLIST`~~ | — | **No longer used** (L5): delete them from GitHub after L5 merges | — |
| Cookie secret / cron secret for the runner app | — | Generated fresh **every run** by `e2e.yml` (never stored) | E2E app on the runner |

### 4.3 Elsewhere
- **cron-job.org:** `Authorization: Bearer <CRON_SECRET>` on both jobs (test value first, prod value at the switch).
- **Password manager:** master copy of everything, in TEST and PRODUCTION folders.

---

## 5. Secrets — good habits (repeat every time keys are touched)

1. **Master copy** of every key in the password manager (TEST and PRODUCTION folders).
2. **Least privilege:** Sentry token only for releases/source maps; backup key only for the backups bucket; test keys never reach production.
3. **Leak = rotate now:** if a key appears in a chat, screenshot, file or commit, create a new one, update Render/GitHub, delete the old one.
4. **Never `SKIP_ENV_VALIDATION`** on Render.
5. **`NEXT_PUBLIC_…` is public:** never put a secret in one.
6. **Test and production are always different values.**

---

## 6. Go-live tests (on the TEST setup)

Render is on "During testing" values. Finalizing invoices and recording payments is fine here.

> **Expected while testing (not faults):**
> - Sentry → Crons: the **archive** monitor shows **Missed** every night while the cron-job.org jobs are paused. It turns
>   green after 7.9 (jobs resumed). A "Run now" check-in during testing turns it green once.
> - The TEST database holds a backlog of invoices/credit notes whose PDF archiving failed: the CI browser tests finalize
>   documents with **fake** Cloudflare/IDrive keys. The archive job retries them against the real test keys; failures
>   for those E2E documents are harmless. Production never receives them (section 0).

- [ ] **Speed:** dashboard, invoice list, new invoice; acceptable on 0.1 CPU? (if not → Starter $7)
- [ ] **Memory:** a bulk Excel import, a report export **and** an account data export (Settings → General → **Download your data**) finish without a crash (Render logs)
- [ ] **Sign-up:** code e-mail arrives (check spam), code works, wrong/expired code rejected, resend works
- [ ] **Password reset:** verify the TEST Render origin is trusted in the TEST Neon Auth branch and enable **Revoke sessions on password reset** there. With a test account and inbox, request a link and confirm it lands on the TEST Render reset screen. Verify the old password fails, the new one works, a used link is rejected, and an earlier session requires sign-in again after its local cache expires (up to five minutes). Confirm the production branch's revocation setting before switch-over.
- [ ] **Rate limits per person (SEC-01):** two sign-ups or sign-ins within the hour from **two different networks** (phone on mobile data + laptop on Wi-Fi) → neither is rate-limited because of the other
- [ ] **Admin:** set `PLATFORM_ADMIN_USER_IDS` to your test user ID → admin pages open
- [ ] **Team invite:** invite e-mail arrives; accepting requires a verified e-mail
- [ ] **Invoice:** finalize → PDF archived in `bizfolio-test-files` (archive status OK) → download works via signed link
- [ ] **Invoice number format (MONEY-01):** Settings → a custom format without `{FY}` (for example `INV/{SEQ:4}`) is **rejected** with a clear message; `INV/{FY}/{SEQ:4}` is accepted
- [ ] **Customer GSTIN (MONEY-02):** new invoice → pick a saved customer → edit the GSTIN field → the customer selection clears, and the finalized invoice shows the GSTIN you typed
- [ ] **Credit note:** finalize → archived
- [ ] **Credit-note prefix (MONEY-04):** Settings → a prefix longer than **6** characters is rejected; the live preview shows the number
- [ ] **Customer e-mail buttons hidden;** WhatsApp shows the upgrade box on Free; download/print works
- [ ] **Payment claim:** UPI QR shows *your* details; claim e-mail reaches your Gmail; approve → user gets the urgent e-mail
- [ ] **Feedback** from Settings reaches your Gmail
- [ ] **Bell:** updates on page change, focus and click
- [ ] **Crons:** "Run now" each job in cron-job.org → reply 202 + work done (Sentry check-in for the archive job)
- [ ] **Daily notifications run once per day (BUG-01):** "Run now" on the notifications job **twice** → the second run sends nothing new (the bell does not show duplicates)
- [ ] *(Optional, SVC-02)* Archive with a temporarily **wrong** Cloudflare token: "Run now" the archive job twice → each failing document's attempt count rises by **1 per run** (not 5); put the right token back (Save and deploy) and run once more → archived
- [ ] **Uptime:** both monitors green; a test alert reaches your Gmail
- [ ] **Backup:** set variable `BACKUPS_ENABLED=true`, temporarily point `DATABASE_URL_UNPOOLED` at the **test** direct URL, and run the backup workflow manually (Actions → Nightly database backup → Run workflow) → encrypted file appears → restore it into an **empty** database in a new branch of the test project with the exact steps in `docs/DEPLOYMENT.md` → "Restore" (`pg_restore --exit-on-error`, exit status **0**) → run the SQL checks there and on a **reference branch of the test project created from the end of the run's "Dump the database" step** (same file, step 4; do it within 6 hours of the run). Login rows, invoices, credit notes, payments, counters and newest invoice numbers must match → then set `DATABASE_URL_UNPOOLED` back to **prod** and delete `BACKUPS_ENABLED` again until 7.11 and delete the test backup files from `bizfolio-backups`
- [ ] **Sentry:** a test error arrives with environment `test`
- [ ] **CSP reports (SEC-03 part 2):** Sentry → Issues filtered to CSP / security reports: **one week with no unexpected violation** on TEST. Only then switch `CSP_MODE` to `'enforce'` (`config/security-headers.mjs`) in its own PR
- [ ] **Real iPhone (UX-01):** Safari on an iPhone → new invoice, customer and settings forms → tapping a small input does **not** zoom the page
- [ ] **robots.txt** says disallow all (expected on Render)
- [ ] **CI:** open a small PR → CI checks + browser tests pass on GitHub

---

## 7. Switch to production ("change the lock")

Do this in one sitting, in order. Each step has a proof check.

- [ ] **7.1** cron-job.org: confirm both jobs are **paused**.
- [ ] **7.2** Generate new production `NEON_AUTH_COOKIE_SECRET` and `CRON_SECRET` (`openssl rand -hex 32`) → save in PRODUCTION folder.
- [ ] **7.3** Render → Environment → change to the **"After switch"** column (section 4.1): `DATABASE_URL`, `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET`, `CRON_SECRET`, `IDRIVE_E2_BUCKET_NAME`, `IDRIVE_E2_ACCESS_KEY` / `IDRIVE_E2_SECRET_KEY` (**prod** app key: the test key cannot open the prod bucket), `NEXT_PUBLIC_SENTRY_ENVIRONMENT=production`, `PLATFORM_ADMIN_EMAILS` = your real business Gmail (removes the throwaway test admin). Remove the test `PLATFORM_ADMIN_USER_IDS` for now.
- [ ] **7.4** Upstash → database → **Flush** (clears test rate-limit counters). Proof: key count **0**.
- [ ] **7.5** Proof before redeploy — production database: **0** businesses, users, invoices, payments, audit_log rows and **`tax_rates` = 4**. Production bucket `bizfolio-prod-files`: **empty**.
- [ ] **7.5b** Bring the production database up to date with `main` (migrations added after 3.4, e.g. `0038_br01_override_admin_note`): Neon → production project → create a backup branch → GitHub → Actions → **Production DB migration (manual)** → Run workflow from `main` → backup branch created **yes**, confirm `MIGRATE`. Proof: the run is green. (Production still has 0 rows, so this only adds tables/columns.)
- [ ] **7.5c** Before deploying against production, confirm **Revoke sessions on password reset** is enabled on the Neon Auth branch whose Auth URL is recorded in 7.3.
- [ ] **7.6** Save the 7.3 values with **Save, rebuild, and deploy** (or, if already saved: **Manual Deploy → Deploy latest commit**). Never **Save and deploy**: it reuses the old build, so the `NEXT_PUBLIC_…` values (Sentry environment, support e-mail) would stay at their test values. Proof: `/ping` OK, `/health-db` OK, and a test error in Sentry shows environment `production`.
- [ ] **7.7** Sign up yourself on production (code e-mail works) → copy your new user ID → Render `PLATFORM_ADMIN_USER_IDS` → **Save and deploy** is enough here (a server-only value). Proof: admin pages open.
- [ ] **7.8** Smoke test **without finalizing anything**: log in, open dashboard, customers, settings; upload your logo/signature if wanted. Your first real invoice will get number 1.
- [ ] **7.8b** Before announcing the launch or resuming scheduled jobs, repeat the password-reset smoke test from section 6 on production with an account and inbox you control. Check the Render link, old and new passwords, link reuse, and rejection of an earlier session after the cache expires (up to five minutes). If a check fails, suspend the service and fix it before continuing.
- [ ] **7.9** cron-job.org: update both headers to the **production** `CRON_SECRET` → **resume** both jobs. Proof: next run succeeds (or "Run now" → 202).
- [ ] **7.10** GitHub: update the `CRON_SECRET` and `CRON_APP_URL` secrets for the manual cron workflow; confirm `DATABASE_URL_UNPOOLED` = **prod**.
- [ ] **7.11** Set GitHub variable **`BACKUPS_ENABLED=true`** (with `DATABASE_URL_UNPOOLED` = prod). First nightly backup runs after the switch. Proof: `bizfolio-backups` contains **only** post-switch files.
- [ ] **7.12** Sentry: resolve/delete test issues. Proof: no open issues tagged `test`.
- [ ] **7.13** Local development: remove the Upstash values from your PC's `.env.local` (they are production now) and use the local Redis look-alike from `docs/e2e-staging-setup.md` section 4 instead.
- [ ] **7.14** Invite the 2 shops; tell them to check spam for the first e-mail, mark **"Not spam"** and add the sender to contacts.

---

## 8. Clean-up: what is removed and what stays

| Item | Action | Proof |
|---|---|---|
| Production database | Never receives test data (section 0) | Counts in 7.5 are 0 |
| Production files bucket | Never receives test files | Empty in 7.5 |
| Upstash | Flushed in 7.4 | Key count 0 |
| Backups bucket | Test backup files deleted in section 6 | Only post-switch files in 7.11 |
| Sentry test issues | Resolved/deleted in 7.12 | No open `test` issues |
| GitHub test reports | Auto-delete after **7 days** (`retention-days: 7` in `e2e.yml`) | Nothing to do |
| Local temp files: `coverage/`, `playwright-report/`, `test-results/`, `repomix-output-P2.md`, `tsconfig.tsbuildinfo`, `.env*.local` | Ignored by git (checked 2026-11-18), never reach GitHub; delete locally whenever you like | `git status` clean |
| **Dev test accounts** (Neon `bm_dev`: `l4-code-check-1119@example.com`, `tilak.verma@inboxorigin.com`, `l4-unverified-probe-1119@example.com`, plus any made later) | Delete **all at once at the end of the code batch** (before section 3), click-by-click, after confirming the list | Neon Auth → Users shows none of them |
| **Old development accounts** (old Neon account with `bm_dev` + `staging-e2e`, the Vercel project, old Upstash / IDrive / Resend / Mailosaur accounts, old CustomJS account) | Delete **after** the switch is proven (section 7 done, E2E green on the new test project) and after copying anything you still need | The old Neon and Vercel dashboards no longer list the projects |
| **Stays on purpose:** Neon test project, `bizfolio-test-files` | Used by CI browser tests and restore drills | — |
| **Stays on purpose:** `tests/`, `e2e/`, `docs/reports/` | Protect future changes / fix history; never shipped to users | — |

---

## 9. Ongoing checks

| When | Check | Act when |
|---|---|---|
| Weekly | Render bandwidth | Near 4 GB → investigate bots / plan Starter + domain + Cloudflare |
| Weekly | Neon prod CU-hours | On pace for > 80 → Launch plan |
| Weekly | Cloudflare → Workers & Pages → Browser Rendering usage (minutes/day) + failed/429 archives in Sentry | Often near 10 min/day → Workers Paid $5 |
| Weekly | Sentry new issues | Fix |
| Weekly | GitHub → Actions → **Nightly database backup**: one green run per night | A missed or failed night → run it by hand and find out why |
| Weekly | GitHub → Actions → **Nightly database backup** is not marked **disabled**. GitHub switches off scheduled workflows in a public repository after **60 days without a commit** | Disabled → open the workflow → **Enable workflow**, then run it once by hand |
| Monthly | Upstash commands, IDrive GB, Brevo daily sends | Near limits → section 1 triggers |
| Weekly | Upstash console: database still listed and active (free databases can be removed after a week without requests) | Quiet week → sign in once; gone → recreate it and update Render |
| Month 1 | Review "Failed to fetch" errors | Filter only harmless ones |
| Every 3 months | **Restore drill** (latest prod backup → Neon branch of the test project) | Record the result |
| Every 3 months | Rotate `CRON_SECRET` (optional) | Update Render + cron-job.org + GitHub |
| 2027-02-28 | SEC-007 better-auth allowlist expires | Re-evaluate the Neon Auth package |

---

## 10. When the first shop pays (upgrade path, in order)

1. **Render Starter** ($7/month): speed, no sleep; keep UptimeRobot as monitoring.
2. **Cloudflare Workers Paid** ($5/month) if PDF rendering time nears the free 10 minutes/day.
3. **Buy a domain** → Cloudflare DNS → Render custom domain → Brevo domain authentication (SPF/DKIM/DMARC) → Neon Auth custom SMTP via Brevo → Cloudflare Email Routing for `support@` → update `NEXT_PUBLIC_APP_URL`, Neon trusted domains, cron-job.org + UptimeRobot URLs, robots/indexing.
4. Optionally **turn customer e-mails back on** (the switch from 2.1).
5. Later: a separate **Object Lock archive bucket** for invoice PDFs; a monthly PDF copy to Backblaze B2.

---

## 11. Monthly cost forecast (USD, estimates)

Assumptions per active business: ~5 invoices/day, app open during shop hours, ~2 app e-mails/day (no customer e-mails), ~0.3–0.6 GB Render bandwidth/month.

| Service | 1 business (pilot) | 100 businesses | 1,000 businesses |
|---|---|---|---|
| Render | $0 (Free) | $7 Starter + ~$4–8 bandwidth over 5 GB | Larger instance(s) **(price unverified)** + ~$45–90 bandwidth (reduce with Cloudflare cache + domain) |
| Neon | $0 | ~$10–25 (Launch, pay per use) | ~$45–80 + storage |
| Cloudflare (PDF) | $0 | $0–5 (Workers Paid if > 10 min/day) | ~$5 + browser hours **(estimate)** |
| IDrive e2 | $0 | $0 → cents after 10 GB | ~$1–2 |
| Upstash | $0 | ~$0–1 | ~$9 |
| Brevo | $0 | $0 (≈200/day) once a domain is bought | Paid plan for ~60K e-mails/month **(price unverified)** |
| Sentry | $0 | $0–26 | ~$26 (Team) |
| UptimeRobot / cron-job.org / GitHub | $0 | $0 | $0 |
| Domain | — | Yearly fee **(check registrar)** | Yearly fee |
| **Total / month** | **$0** | **≈ $50–90** + domain | **≈ $230–400+** + unverified items |

At 100+ businesses, compare these costs with revenue, and consider server-side PDF generation (no per-PDF fee) and Cloudflare in front of Render.

---

## 12. Still unverified (check on the day)

- Brevo free limit and branding on its own pricing page
- Neon built-in sender rate limit
- IDrive free 10 GB permanence; per-bucket keys; exact Singapore endpoint host
- Upstash behaviour at the free limit
- Sentry Spike Protection on the Developer plan
- Render larger-instance prices; Brevo paid prices; domain price

---

## 13. Sources (checked 2026-11-18)

Render: [free](https://render.com/docs/free), [pricing](https://render.com/pricing.md), [compute plans](https://render.com/docs/compute-plans), [regions](https://render.com/docs/regions), [custom domains](https://render.com/docs/custom-domains) ·
Vercel: [terms](https://vercel.com/legal/terms.md), [Hobby](https://vercel.com/docs/plans/hobby) ·
Neon: [plans](https://neon.com/docs/introduction/plans), [pricing](https://neon.com/pricing), [regions](https://neon.com/docs/introduction/regions), [email verification](https://neon.com/docs/auth/guides/email-verification), [production checklist](https://neon.com/docs/auth/production-checklist) ·
IDrive: [pricing](https://www.idrive.com/s3-storage-e2/pricing), [locations](https://www.idrive.com/s3-storage-e2/locations) ·
Cloudflare: [Browser Rendering limits](https://developers.cloudflare.com/browser-rendering/limits/), [PDF endpoint](https://developers.cloudflare.com/browser-rendering/rest-api/pdf-endpoint/), [supported fonts](https://developers.cloudflare.com/browser-run/reference/supported-fonts/) ·
Brevo: [sender requirements](https://help.brevo.com/hc/en-us/articles/14925263522578) ·
Google: [sender guidelines](https://support.google.com/a/answer/81126) ·
Upstash: [pricing](https://upstash.com/docs/redis/overall/pricing), [regions](https://upstash.com/docs/common/concepts/global-replication) ·
Sentry: [pricing](https://sentry.io/pricing/) ·
UptimeRobot: [pricing](https://uptimerobot.com/pricing/) ·
cron-job.org: [home](https://cron-job.org/en/), [FAQ](https://cron-job.org/en/faq/) ·
GitHub: [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions) ·
Cloudflare: [Email Routing](https://developers.cloudflare.com/email-routing/) ·
[Public Suffix List](https://publicsuffix.org/list/public_suffix_list.dat)
