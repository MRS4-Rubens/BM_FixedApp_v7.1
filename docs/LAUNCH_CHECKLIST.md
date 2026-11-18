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
| 7 | PDF generation | **CustomJS Free**, production key only | 20 PDFs/day, 600/month, **watermark** | ~15+ PDFs/day or watermark not OK → **Pro $9/month** (100/day, no watermark) |
| 8 | File storage | **IDrive e2 Free**, Singapore, private buckets `bizfolio-prod-files`, `bizfolio-test-files`, `bizfolio-backups`; **no Object Lock** for the pilot | 10 GB total; downloads ≤ 3× stored (free-plan permanence unverified) | Near 8 GB or free plan ends → paid ($6/TB) or move to Backblaze B2 (settings only) |
| 9 | Backups | Neon 6 h history **+ nightly encrypted `pg_dump`** of production via GitHub Actions to `bizfolio-backups`, keep 7 daily + 4 weekly, restore drill every 3 months | Neon 5 GB transfer/month | Database > ~150 MB → weekly dumps, or Neon paid for longer history |
| 10 | Rate limiting | **Upstash Redis Free**, Singapore, one database (flushed at the switch). No code change | 500K commands/month, 1 free database per account | Over ~400K/month → add card (PAYG $0.20 per 100K) |
| 11 | Error monitoring | **Sentry Developer Free**, EU region, one project; environments `test` / `production`. Cron monitor only for the PDF archive job | 5K errors/month, 1 user, 1 cron monitor | Regularly > 5K errors or a second person → Team (~$26/month) |
| 12 | Uptime | **UptimeRobot Free** (commercial use allowed): `/ping` every 5 min, `/health-db` every 6 h, e-mail after 2 failures | 50 monitors, 5-min checks | Need faster checks/SMS → paid |
| 13 | Scheduled jobs | **cron-job.org Free**: 2 daily jobs with secret header, failure + recovery e-mails. Manual GitHub "Run cron now" fallback | 30-second timeout | None expected |
| 14 | Domain + DNS | **Free `<name>.onrender.com`** for the pilot | — | First paying user or e-mail problems → buy domain, Cloudflare DNS (free), Render custom domain (2 free) |
| 15 | Business inbox | **One Gmail** (receives support, feedback, payment claims) | — | With domain → Cloudflare Email Routing (free) forwards `support@` to Gmail |
| 16 | Payments | Existing **manual UPI QR + bank transfer**, admin approves | — | Gateway later |
| 17 | Code + CI | GitHub, **public repo** (free unlimited minutes), CI + browser tests on every PR | — | None while public |
| 18 | Test services | Browser tests run the app **inside GitHub's machine** + **Neon test project** + **local Redis + Upstash look-alike** (serverless-redis-http). Mailosaur dropped | — | — |
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
- [x] **2.8 E2E workflow rewrite** `.github/workflows/e2e.yml` *(done: L5)*: build + `next start` on the runner (`http://localhost:3000`); Neon test database + its Neon Auth (new secret `E2E_NEON_AUTH_BASE_URL`); `E2E_VERIFY_MODE=db`; removed the Vercel preview lookup, trusted-domain script, `E2E_VERCEL_BYPASS_SECRET` and Mailosaur; every PR + manual button; fork-PR guard kept; fake CustomJS/Brevo/IDrive keys. **Changed from the plan:** Redis uses the **test Upstash database** (the existing `E2E_UPSTASH_*` secrets), not a serverless-redis-http container, because the app only accepts an `https://` Redis address. The runner app sets `SKIP_ENV_VALIDATION=1` because production validation rejects `http://localhost` (never possible on Render).
- [x] **2.9 E-mail provider swap:** *(done: L3 PR; `lib/email/mailer.ts`, Brevo HTTPS API)* Resend → **Brevo web API** in `lib/email/resend.ts` / `send-customer-email.ts`; rename env vars (e.g. `BREVO_API_KEY`, `EMAIL_FROM`).
- [x] **2.10 Brand clean-up:** *(done: L2 PR; production now refuses to boot without `NEXT_PUBLIC_SUPPORT_EMAIL`)* `lib/config/contact.ts` fallback `support@billmatrix.in`; `.env.example` "Bill Matrix" → Invoice BizFolio, matching section 4 (fake values only).
- [x] **2.11 Docs:** *(done: L6)* `docs/DEPLOYMENT.md`: removed the 8-year Object Lock, 7-day PITR, RPO ≤ 5 min and weekly-dump claims; now describes Render, cron-job.org, UptimeRobot (`/ping`, `/health-db`), the nightly encrypted backup + restore drill, honest recovery targets, and the 7 PR checks. `docs/e2e-staging-setup.md` rewritten for the runner-based E2E. `README.md` env table, background jobs and deploy sections updated.
- [x] **2.12 Tests + gate:** *(done in every L-PR)* tests for every item; snapshots updated; `pnpm typecheck && pnpm lint:ratchet && pnpm knip && pnpm test && pnpm build` (+ `pnpm print-css:build` if UI changed); line endings checked (CRLF → LF) before each commit.

---

## 3. Create accounts — test and production together

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
- [ ] Test: `DATABASE_URL_UNPOOLED=<test direct URL>` → run `pnpm db:migrate` then `pnpm db:seed`.
- [ ] Production: `DATABASE_URL_UNPOOLED=<prod direct URL>` → run `pnpm db:migrate` then `pnpm db:seed`. **After this, do not sign up or create anything on production until section 7.**
- [ ] Proof (production): the database has **0** rows in businesses, users, invoices, payments and audit_log; only the seeded tax rates exist.

### 3.5 IDrive e2 — three buckets
- [ ] Sign up (free 10 GB) → region **Singapore (ap-southeast-1)**.
- [ ] Create private buckets (public access OFF, **Object Lock OFF**): `bizfolio-prod-files`, `bizfolio-test-files`, `bizfolio-backups`.
- [ ] Access keys → create **app key** (prod + test file buckets) and **backup key** (`bizfolio-backups` only, if per-bucket keys are supported — unverified; otherwise one key, stored as secret).
- [ ] Note the exact S3 endpoint host for Singapore (expected `s3.ap-southeast-1.idrivee2.com`; confirm in the dashboard).
- [ ] Save endpoint, region, bucket names and keys (app key: both folders; backup key: PRODUCTION).

### 3.6 Upstash — one database
> **Open item (CodeRabbit, PR #73):** E2E needs its **own** Upstash database (`E2E_UPSTASH_*`), but the free plan allows one database per account and this step creates only the production one. Decide before 3.14: a local Upstash look-alike for E2E (small code change, the original decision 18) or a second free Upstash account for testing.
- [ ] Sign up → Create Redis database → name `bizfolio` → region **AWS ap-southeast-1 (Singapore)** → Free.
- [ ] Copy the **REST URL** and **REST token** (PRODUCTION folder; it is also used during testing and flushed at the switch).

### 3.7 CustomJS
- [ ] Sign up (free) → copy the API key → PRODUCTION folder as `HTML_TO_PDF_API_KEY`.
- [ ] Never put this key in GitHub test secrets. During go-live tests on Render it is used (about 5–10 PDFs; the daily 20 resets).

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
- [ ] Sign up with GitHub → Hobby workspace.
- [ ] New → Web Service → connect the repo → **choose the final service name now** (the address `https://<name>.onrender.com` comes from it and stays after the switch).
- [ ] Region **Singapore**, instance **Free**, branch `main`.
- [ ] Build command `pnpm install && pnpm build`; start command `pnpm start`; Node 24 (from `engines` / `.nvmrc`).
- [ ] Health check path `/ping`.
- [ ] Environment → add the **"During testing"** values from section 4.1. **Never set `SKIP_ENV_VALIDATION`.**
- [ ] Deploy → note the address → set `NEXT_PUBLIC_APP_URL` to it → redeploy.

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
- [ ] New monitor `https://<name>.onrender.com/health-db`, interval **6 hours**.
- [ ] Alert contact = your Gmail; alert after **2** failed checks.

### 3.14 GitHub Secrets and Variables
- [ ] Settings → Secrets and variables → Actions → add everything in section 4.2.
- [ ] **Replace every old development value.** Until now the E2E secrets (`E2E_STAGING_DATABASE_URL`, `E2E_STAGING_DATABASE_URL_UNPOOLED`, `E2E_NEON_AUTH_BASE_URL`, `E2E_UPSTASH_*`) and the variables `E2E_DB_HOST_ALLOWLIST` / `E2E_UPSTASH_HOST_ALLOWLIST` point at the **old development** accounts. Overwrite all of them with the new **test** values, and set `E2E_FORBIDDEN_DB_HOSTS` / `E2E_FORBIDDEN_HOSTS` to the new **production** host and address. Then run E2E once (Actions → E2E (runner app) → Run workflow) and check it passes.
- [ ] Delete the unused secrets/variables: `NEON_API_KEY`, `NEON_PROJECT_ID`, `NEON_STAGING_BRANCH_ID`, `E2E_VERCEL_BYPASS_SECRET`, `MAILOSAUR_API_KEY`, `MAILOSAUR_SERVER_ID`, `E2E_VERIFY_MODE`.
- [ ] Variable `E2E_EXPECT_ARCHIVAL=false` (the E2E workflow already forces `E2E_VERIFY_MODE=db`). Leave `BACKUPS_ENABLED` unset until section 7.
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
| `IDRIVE_E2_REGION` | `ap-southeast-1` | same | No |
| `IDRIVE_E2_BUCKET_NAME` | `bizfolio-test-files` | **`bizfolio-prod-files`** | No |
| `IDRIVE_E2_ACCESS_KEY` / `IDRIVE_E2_SECRET_KEY` | App key | same (or rotate) | **Yes** |
| `HTML_TO_PDF_API_KEY` | CustomJS key | same | **Yes** |
| `BREVO_API_KEY` | Brevo key | same | **Yes** |
| `EMAIL_FROM` | `"Invoice BizFolio <yourapp@gmail.com>"` | same | No |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Upstash DB | same (**flushed** at switch) | Token **Yes** |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` | DSN | same | No (public by design) |
| `NEXT_PUBLIC_SENTRY_ENVIRONMENT` (added in 2.4; build time, so redeploy after changing) | `test` | **`production`** | No |
| `SENTRY_AUTH_TOKEN` / `SENTRY_ORG` / `SENTRY_PROJECT` | Build upload | same | Token **Yes** |
| `NEXT_PUBLIC_SUPPORT_EMAIL` / `FEEDBACK_RECIPIENT_EMAIL` | Your Gmail (**required**: the server won't start without the first one) | same | No |
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
| `E2E_UPSTASH_REST_URL` / `E2E_UPSTASH_REST_TOKEN` + variable `E2E_UPSTASH_HOST_ALLOWLIST` | Secret / Variable | **Test** Upstash database | E2E (rate limits; flushed between runs) |
| `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD`, `E2E_CONFIRM_STAGING` | Secret | Test values only | E2E |
| `E2E_DB_HOST_ALLOWLIST` | Variable | **Test** Neon host | E2E safety guard |
| `E2E_FORBIDDEN_DB_HOSTS` / `E2E_FORBIDDEN_HOSTS` | Variable | **Prod** Neon host / prod address | E2E safety guard |
| `E2E_EXPECT_ARCHIVAL=false` | Variable | — | E2E |
| ~~`NEON_API_KEY`, `NEON_PROJECT_ID`, `NEON_STAGING_BRANCH_ID`, `E2E_VERCEL_BYPASS_SECRET`, `MAILOSAUR_*`~~ | — | **No longer used** (L5): delete them from GitHub after L5 merges | — |
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

- [ ] **Speed:** dashboard, invoice list, new invoice; acceptable on 0.1 CPU? (if not → Starter $7)
- [ ] **Memory:** a bulk Excel import and a report export finish without a crash (Render logs)
- [ ] **Sign-up:** code e-mail arrives (check spam), code works, wrong/expired code rejected, resend works
- [ ] **Admin:** set `PLATFORM_ADMIN_USER_IDS` to your test user ID → admin pages open
- [ ] **Team invite:** invite e-mail arrives; accepting requires a verified e-mail
- [ ] **Invoice:** finalize → PDF archived in `bizfolio-test-files` (archive status OK) → download works via signed link
- [ ] **Credit note:** finalize → archived
- [ ] **Customer e-mail buttons hidden;** WhatsApp shows the upgrade box on Free; download/print works
- [ ] **Payment claim:** UPI QR shows *your* details; claim e-mail reaches your Gmail; approve → user gets the urgent e-mail
- [ ] **Feedback** from Settings reaches your Gmail
- [ ] **Bell:** updates on page change, focus and click
- [ ] **Crons:** "Run now" each job in cron-job.org → reply 202 + work done (Sentry check-in for the archive job)
- [ ] **Uptime:** both monitors green; a test alert reaches your Gmail
- [ ] **Backup:** set variable `BACKUPS_ENABLED=true`, temporarily point `DATABASE_URL_UNPOOLED` at the **test** direct URL, and run the backup workflow manually (Actions → Nightly database backup → Run workflow) → encrypted file appears → **restore it into a Neon branch of the test project** and check invoices, numbers and logins → then set `DATABASE_URL_UNPOOLED` back to **prod** and delete `BACKUPS_ENABLED` again until 7.11 and delete the test backup files from `bizfolio-backups`
- [ ] **Sentry:** a test error arrives with environment `test`
- [ ] **robots.txt** says disallow all (expected on Render)
- [ ] **CI:** open a small PR → CI checks + browser tests pass on GitHub

---

## 7. Switch to production ("change the lock")

Do this in one sitting, in order. Each step has a proof check.

- [ ] **7.1** cron-job.org: confirm both jobs are **paused**.
- [ ] **7.2** Generate new production `NEON_AUTH_COOKIE_SECRET` and `CRON_SECRET` (`openssl rand -hex 32`) → save in PRODUCTION folder.
- [ ] **7.3** Render → Environment → change to the **"After switch"** column (section 4.1): `DATABASE_URL`, `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET`, `CRON_SECRET`, `IDRIVE_E2_BUCKET_NAME`, `NEXT_PUBLIC_SENTRY_ENVIRONMENT=production`. Remove the test `PLATFORM_ADMIN_USER_IDS` for now.
- [ ] **7.4** Upstash → database → **Flush** (clears test rate-limit counters). Proof: key count **0**.
- [ ] **7.5** Proof before redeploy — production database: **0** businesses, users, invoices, payments, audit_log rows. Production bucket `bizfolio-prod-files`: **empty**.
- [ ] **7.6** Render → **Manual deploy** (redeploy with new values). Proof: `/ping` OK and `/health-db` OK.
- [ ] **7.7** Sign up yourself on production (code e-mail works) → copy your new user ID → Render `PLATFORM_ADMIN_USER_IDS` → redeploy. Proof: admin pages open.
- [ ] **7.8** Smoke test **without finalizing anything**: log in, open dashboard, customers, settings; upload your logo/signature if wanted. Your first real invoice will get number 1.
- [ ] **7.9** cron-job.org: update both headers to the **production** `CRON_SECRET` → **resume** both jobs. Proof: next run succeeds (or "Run now" → 202).
- [ ] **7.10** GitHub: update the `CRON_SECRET` and `CRON_APP_URL` secrets for the manual cron workflow; confirm `DATABASE_URL_UNPOOLED` = **prod**.
- [ ] **7.11** Set GitHub variable **`BACKUPS_ENABLED=true`** (with `DATABASE_URL_UNPOOLED` = prod). First nightly backup runs after the switch. Proof: `bizfolio-backups` contains **only** post-switch files.
- [ ] **7.12** Sentry: resolve/delete test issues. Proof: no open issues tagged `test`.
- [ ] **7.13** Invite the 2 shops; tell them to check spam for the first e-mail, mark **"Not spam"** and add the sender to contacts.

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
| **Old development accounts** (old Neon account with `bm_dev` + `staging-e2e`, the Vercel project, old Upstash / IDrive / Resend / Mailosaur accounts) | Delete **after** the switch is proven (section 7 done, E2E green on the new test project) and after copying anything you still need | The old Neon and Vercel dashboards no longer list the projects |
| **Stays on purpose:** Neon test project, `bizfolio-test-files` | Used by CI browser tests and restore drills | — |
| **Stays on purpose:** `tests/`, `e2e/`, `docs/reports/` | Protect future changes / fix history; never shipped to users | — |

---

## 9. Ongoing checks

| When | Check | Act when |
|---|---|---|
| Weekly | Render bandwidth | Near 4 GB → investigate bots / plan Starter + domain + Cloudflare |
| Weekly | Neon prod CU-hours | On pace for > 80 → Launch plan |
| Weekly | CustomJS daily usage / failed archives | Often near 20/day → Pro $9 |
| Weekly | Sentry new issues | Fix |
| Monthly | Upstash commands, IDrive GB, Brevo daily sends | Near limits → section 1 triggers |
| Month 1 | Review "Failed to fetch" errors | Filter only harmless ones |
| Every 3 months | **Restore drill** (latest prod backup → Neon branch of the test project) | Record the result |
| Every 3 months | Rotate `CRON_SECRET` (optional) | Update Render + cron-job.org + GitHub |
| 2027-02-28 | SEC-007 better-auth allowlist expires | Re-evaluate the Neon Auth package |

---

## 10. When the first shop pays (upgrade path, in order)

1. **Render Starter** ($7/month): speed, no sleep; keep UptimeRobot as monitoring.
2. **CustomJS Pro** ($9/month): no watermark, 100/day.
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
| CustomJS | $0 (watermark) | **$29 Ultra** (500/day, tight) | **$99 Mega** (5,000/day, tight) |
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
- Neon built-in sender rate limit; Neon Auth accepting `http://localhost:3000` as a trusted origin
- IDrive free 10 GB permanence; per-bucket keys; exact Singapore endpoint host
- Upstash behaviour at the free limit
- Sentry Spike Protection on the Developer plan
- serverless-redis-http compatibility with our Upstash code
- Render larger-instance prices; Brevo paid prices; domain price

---

## 13. Sources (checked 2026-11-18)

Render: [free](https://render.com/docs/free), [pricing](https://render.com/pricing.md), [compute plans](https://render.com/docs/compute-plans), [regions](https://render.com/docs/regions), [custom domains](https://render.com/docs/custom-domains) ·
Vercel: [terms](https://vercel.com/legal/terms.md), [Hobby](https://vercel.com/docs/plans/hobby) ·
Neon: [plans](https://neon.com/docs/introduction/plans), [pricing](https://neon.com/pricing), [regions](https://neon.com/docs/introduction/regions), [email verification](https://neon.com/docs/auth/guides/email-verification), [production checklist](https://neon.com/docs/auth/production-checklist) ·
IDrive: [pricing](https://www.idrive.com/s3-storage-e2/pricing), [locations](https://www.idrive.com/s3-storage-e2/locations) ·
CustomJS: [pricing](https://www.customjs.space/pricing) ·
Brevo: [sender requirements](https://help.brevo.com/hc/en-us/articles/14925263522578) ·
Google: [sender guidelines](https://support.google.com/a/answer/81126) ·
Upstash: [pricing](https://upstash.com/docs/redis/overall/pricing), [regions](https://upstash.com/docs/common/concepts/global-replication) ·
Sentry: [pricing](https://sentry.io/pricing/) ·
UptimeRobot: [pricing](https://uptimerobot.com/pricing/) ·
cron-job.org: [home](https://cron-job.org/en/), [FAQ](https://cron-job.org/en/faq/) ·
GitHub: [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions) ·
Cloudflare: [Email Routing](https://developers.cloudflare.com/email-routing/) ·
[Public Suffix List](https://publicsuffix.org/list/public_suffix_list.dat)
