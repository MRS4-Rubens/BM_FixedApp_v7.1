# C — Notifications (C1 backend + C2 screens) — completion report

**Branch:** `feat/notifications` (from `main` c7e81bd) · **Built by:** Claude Code (both C1 and C2, at the user's request) · **Date:** 2026-11-17
**Migration:** `drizzle/0037_notifications.sql` (applied to bm_dev)

## What users get
- **The bell** in the top bar shows a red unread count. Clicking it opens the newest 20 items.
  - Opening an item marks it read and takes you to the right page.
  - "Mark all as read" clears the count, and a link leads to the settings.
- **Settings → Notifications** (the "Coming soon" labels are gone). Each person chooses their own e-mails: one switch per group (only the groups their role can receive), plus "daily summary" or "off".
  - The owner also sets **GST filing frequency** (monthly / quarterly / not filing). Staff and the CA see it read-only.
  - Composition dealers see a note explaining that GST reminders are off for them.
- **E-mail:**
  - a daily summary around 9 AM IST, with one e-mail per person listing all their items;
  - urgent items arrive immediately: payment approved/rejected, and trial or plan ending tomorrow.

## The approved plan, item by item
| Plan item | Who | How |
|---|---|---|
| "N invoices became overdue today (₹X)" | owner, staff, CA | daily; due yesterday, still unpaid (same net-of-payments-and-credit-notes rule as the dashboard) |
| "N invoices due in 3 days" | owner, staff, CA | daily |
| GSTR-1 / GSTR-3B due in 3 days | owner, CA | monthly: 11th / 20th. Quarterly: 13th / 22nd (Category X states) or 24th |
| "Set your GST filing frequency" | owner | daily until set (de-duplicated: shown once) |
| Financial year ends on 31 March | owner, CA | on 25 March |
| Trial ends in 3 days / tomorrow (urgent) / has ended | owner | daily |
| Plan expires in 7 days / tomorrow (urgent) / has expired | owner | daily |
| Payment approved / rejected (with reason) | owner | instantly, urgent e-mail |
| Someone joined your business | owner | instantly in the bell; e-mail in the summary |
| Your role was changed | that person | instantly in the bell; e-mail in the summary |
| A PDF copy could not be saved after every try | owner | daily, one item per document |

## Safety and correctness
- **Never told twice.** Every event has a stable key, and the database refuses a second row for the same person, business and key. Re-running the daily job, or a retried transaction, adds nothing (tested).
- **Never blocks real work.** Notifications for payment approval and team changes are written inside the same transaction, but in a *savepoint*: if notifying fails, the approval or role change still succeeds. If the approval rolls back, nobody is told.
- **E-mail queue:**
  - Rows are claimed atomically (`FOR UPDATE SKIP LOCKED`), so two senders never take the same row.
  - A failed send is retried by the next run and given up after 3 tries.
  - Nothing older than 3 days is e-mailed.
  - At send time the person's current e-mail address, membership and choices are re-checked, so someone who left or switched e-mails off is skipped.
- **Privacy and permissions:**
  - A new permission level, `'self'`, is used: these actions only ever read or change the caller's own rows. A unit test enforces that every `'self'` action scopes its queries to `context.appUser.id`.
  - One person cannot read or mark another person's items (tested).
  - The GST setting is owner-only and audited.
- **Links are in-app only.** The database refuses any link not starting with a single `/`, and the bell re-checks before following one.
- **The scheduled job is protected** by the same `CRON_SECRET` check as the existing nightly job. That check now lives in one shared helper, `lib/cron/verify-cron-request.ts`, and the old job's tests still pass.
- **Clean-up:** items older than 90 days are deleted daily.

## Files
**New:**
- `lib/notifications/*`: catalog, messages, gst-calendar, plan-reminders, prefs, guards, dates, notify, deliver, daily, schedule, monitor.
- `lib/actions/notifications/*`: four `'self'` actions and one owner action.
- `lib/validations/notifications.ts`.
- `lib/email/templates/notification-email.tsx`.
- `lib/cron/verify-cron-request.ts` and `app/api/cron/daily-notifications/route.ts`.
- `lib/db/schema/notifications.ts` and the migration.
- `components/app/notifications/notification-bell.tsx` and `notification-format.ts`.
- `components/app/settings/notifications-tab/*`.

**Changed:**
- `vercel.json`: the second cron, `30 3 * * *`.
- `lib/db/domain-values.ts`, plus the users and businesses schema.
- `lib/auth/action-permissions.ts`: the `'self'` level.
- `lib/audit/log.ts`.
- `process-request.ts`, `accept-team-invite.ts`, `change-team-member-role.ts`: the event hooks.
- `app-topbar.tsx`: the real bell, shown only to people in a business. The admin console no longer shows the dead bell.
- `(app)/layout.tsx`.
- `settings-client.tsx`: the tab is wired in, both "Coming soon" labels are removed, and `?tab=users` now works.
- `retry-invoice-archival/route.ts`: uses the shared cron check.
- `ARCHITECTURE.md` and `docs/DEPLOYMENT.md`: a new section and a new cron monitor alert.

**Tests:**
- New:
  - `tests/integration/notifications.test.ts`: 8 tests, on a real Postgres engine with a fixed clock.
  - `tests/unit/notifications-rules.test.ts`.
  - `tests/unit/notifications-cron.test.ts`.
  - `tests/unit/notification-bell-format.test.ts`.
  - `e2e/specs/11-notifications.spec.ts`.
- Extended:
  - `api009` (approve/reject tell the owner exactly once);
  - `ca-role` (the member is told about each real role change);
  - `team-invites` (the owner is told who joined);
  - `action-permissions` (the `'self'` rule);
  - E2E `09-ca` (the person sees "Your role was changed…" in their bell).
- Fixtures updated for the two new columns.

## Verification
(see the end of this file)

## Known limits (approved)
- GST date extensions announced by the government are not known; the reminder shows the normal date.
- No WhatsApp, SMS or push notifications.
- If the daily job misses a day, that day's date-based reminders are not created (they are never wrong, only missed). The Sentry cron monitor `daily-notifications` alerts on a missed run.
- Before launch, recheck the Vercel cron limits at the infrastructure review. The app now has two daily cron jobs.

### Results (2026-11-17)
- Gate `pnpm typecheck && pnpm lint:ratchet && pnpm knip && pnpm test && pnpm print-css:build && pnpm build` (Turbopack, `NEXT_PUBLIC_APP_URL=https://bm-local.test`): all green. 239 test files, 1995 tests passed (12 skipped); lint 0/0; knip clean.
- Migration 0037 applied to bm_dev; the table and both columns are verified present.
- E2E (`11-notifications`, plus the bell step in `09-ca`) runs in CI against staging.

### Live browser check (dev server on bm_dev, signed in as the owner) — 2026-11-17
I created three real notifications with the app's own `notify()`: overdue, the GST frequency nudge, and trial ending. I set their e-mails to `skipped` afterwards so nothing is ever sent.
- The bell showed **3**, and the panel listed all three with the correct text, ₹42,500.00, and "Just now".
- Opening an item went to its page (`/invoices?status=overdue`, `/settings?tab=notifications`) and lowered the count (3 → 2 → 1).
- "Mark all as read" cleared the badge.
- Escape closed the panel and returned focus to the bell.
- Settings → Notifications:
  - switching "Money to collect" off and the summary off, saving, then reloading kept both choices (the database matched); I then restored the defaults;
  - choosing GST filing frequency **Monthly** saved it, the nudge disappeared, and the database plus the audit entry (`previous: null → monthly`) were confirmed.
- No browser console errors; correct layout at phone width and at 1280 px.

**Bugs found and fixed during the live check:**
1. **The panel hung off the left edge on phones** (360 px anchored under the bell, which is not at the right edge). On small screens it now spans the screen with a 12 px margin; on larger screens it stays under the bell.
2. **The badge could show a stale count after opening an item.** A routine refresh (on window focus) started before the "mark read" save finished, and its old answer overwrote the screen. Fixed with a generation counter: a refresh only applies its answer if nothing newer has started since. After a read-change is saved, the bell refreshes again. Re-tested with a refresh forced mid-click: the count stayed correct.
3. **The four e-mail switches had no proper accessible name**, so a screen reader could not tell them apart. Each is now `aria-labelledby` its title and `aria-describedby` its description. The E2E finds them by exact name.

Gate re-run after the fixes: all green (1995 tests, lint 0/0, knip clean, Turbopack build OK).

**CI note:** GitHub did not start any CI job for this PR: *"recent account payments have failed or your spending limit needs to be increased"*. Once billing is fixed, re-run the checks.

### CI E2E finding and fix — 2026-11-17
Once GitHub ran the Playwright suite, `01-journey` failed at "Step 6: record payment 1". The page snapshot shows the test entered **₹3,54,01,500**: its "1500" was appended to the pre-filled balance "3540", because the form re-filled itself while the test was typing.

**Cause:** the bell loaded its list through a **server action** as soon as each page opened. Next.js runs server actions one at a time per tab and refreshes the page around them, so this background read interfered with the user's own actions on the same page.

**Fix:** the bell now reads `GET /api/notifications`, a plain route that never touches the page's actions. "Mark as read" stays a server action, because it only runs when the user clicks. The `get-notifications` action was removed.

**Tested:**
- the route returns 401 when signed out;
- each person sees only their own items;
- the bell flow was re-checked in the browser.
