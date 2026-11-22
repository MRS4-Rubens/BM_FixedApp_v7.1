import { and, asc, eq, gt, lt, ne, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { businesses, notifications, platformSettings } from '@/lib/db/schema';
import { logError } from '@/lib/actions/_shared/logger';
import { getIndianFinancialYearForDate } from '@/lib/invoices/financial-year';
import { ARCHIVAL_MAX_ATTEMPTS } from '@/lib/storage/archival-config';
import { addDaysIso, catchUpDaysIso, isIsoCalendarDate, istTodayIso } from './dates';
import { deliverNotificationEmails, expireStaleEmailQueue, type DeliverySummary, type EmailSender } from './deliver';
import { isGstFilingFrequency } from './guards';
import { gstReturnsDueOn } from './gst-calendar';
import {
  fyEndingDraft,
  gstFrequencyMissingDraft,
  gstReturnDueDraft,
  invoicesDueSoonDraft,
  invoicesOverdueDraft,
  pdfArchivalFailedDraft,
  type NotificationDraft,
} from './messages';
import { notify } from './notify';
import { planReminderDrafts } from './plan-reminders';

/** Notifications older than this are deleted (read or not). */
const NOTIFICATION_RETENTION_DAYS = 90;
const BUSINESS_PAGE = 200;
const GST_REMINDER_DAYS_BEFORE = 3;
const DUE_SOON_DAYS = 3;
const ARCHIVAL_PER_RUN_LIMIT = 200;
/**
 * BUG-01: a run also covers the days the job missed (redeploy at 09:00, cron-job.org or Neon outage), up to this many
 * days including today. Older missed days are dropped: their reminders would be stale.
 */
const CATCH_UP_MAX_DAYS = 7;
/** platform_settings row holding the last IST day the job finished for every business: { "date": "YYYY-MM-DD" }. */
export const DAILY_RUN_MARKER_KEY = 'daily_notifications_last_run';

export interface DailyNotificationSummary {
  /** The IST days this run covered, oldest first (just today unless it caught up on missed days). */
  readonly days: readonly string[];
  readonly businesses: number;
  readonly created: number;
  readonly businessErrors: number;
  readonly emails: DeliverySummary;
  readonly deleted: number;
}

interface DueTotals {
  readonly count: number;
  readonly amountPaise: number;
}

function num(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * One query for every business: the still-unpaid finalized invoices due on each of `dueDates`, totalled per business
 * and due date (business id → "YYYY-MM-DD" → totals). Only dates with something left to collect appear.
 */
async function loadMoney(dueDates: readonly string[]): Promise<Map<string, Map<string, DueTotals>>> {
  const map = new Map<string, Map<string, DueTotals>>();
  if (dueDates.length === 0) return map;
  const dateList = sql.join(
    dueDates.map((iso) => sql`${iso}::date`),
    sql`, `,
  );
  const result = await db.execute(sql`
    SELECT t.business_id, to_char(t.due_date, 'YYYY-MM-DD') AS due_iso,
      count(*)::int AS invoice_count,
      coalesce(sum(t.remaining), 0)::bigint AS amount
    FROM (
      SELECT i.business_id, i.due_date,
        greatest(0, i.grand_total_paise - coalesce(p.paid, 0) - coalesce(c.credited, 0)) AS remaining
      FROM invoices i
      LEFT JOIN LATERAL (
        -- NET kept from the customer: refunds count as money paid back (same rule as the dashboard).
        SELECT sum(CASE WHEN pay.kind = 'refund' THEN -pay.amount_paise ELSE pay.amount_paise END) AS paid
        FROM payments pay WHERE pay.invoice_id = i.id AND pay.status = 'active'
      ) p ON true
      LEFT JOIN LATERAL (
        SELECT sum(cn.grand_total_paise) AS credited
        FROM credit_notes cn
        WHERE cn.original_invoice_id = i.id AND cn.lifecycle_status = 'finalized' AND cn.status = 'active'
      ) c ON true
      WHERE i.lifecycle_status = 'finalized'
        AND i.payment_status IN ('unpaid', 'partially_paid', 'overdue')
        AND i.due_date IN (${dateList})
    ) t
    WHERE t.remaining > 0
    GROUP BY t.business_id, t.due_date
  `);
  for (const raw of result.rows) {
    if (typeof raw !== 'object' || raw === null) continue;
    const row = raw as Record<string, unknown>;
    if (typeof row.business_id !== 'string' || typeof row.due_iso !== 'string') continue;
    const count = num(row.invoice_count);
    if (count <= 0) continue;
    const perDate = map.get(row.business_id) ?? new Map<string, DueTotals>();
    perDate.set(row.due_iso, { count, amountPaise: num(row.amount) });
    map.set(row.business_id, perDate);
  }
  return map;
}

interface LastRunRecord {
  /** The last IST day the job finished for every business; null when there is no usable record. */
  readonly usableIso: string | null;
  /** The stored "date" text exactly as read (null when there is no row or no text), for the compare-and-set save. */
  readonly storedText: string | null;
}

/**
 * Reads the last-run record. It is usable only when it holds a real calendar date that is not after today: an
 * unreadable value, an impossible date ("2027-02-30") or a future date (the server clock went backwards) is not used,
 * and the save below replaces it.
 */
async function loadLastRun(todayIso: string): Promise<LastRunRecord> {
  const [row] = await db
    .select({ value: platformSettings.value })
    .from(platformSettings)
    .where(eq(platformSettings.key, DAILY_RUN_MARKER_KEY))
    .limit(1);
  const value: unknown = row?.value;
  const date: unknown = typeof value === 'object' && value !== null && 'date' in value ? value.date : null;
  const storedText = typeof date === 'string' ? date : null;
  const usableIso = storedText !== null && isIsoCalendarDate(storedText) && storedText <= todayIso ? storedText : null;
  return { usableIso, storedText };
}

/**
 * Records that every business was handled up to `finishedIso`. A usable record only moves forward (a slower run
 * finishing late never rewinds it). An unusable one is replaced, but only if it is still the value this run read
 * (compare-and-set), so a newer day saved meanwhile by another run is kept. A failure here is logged, not thrown: the
 * next run catches up again, and every item is de-duplicated, so nobody is told twice.
 */
async function saveLastRunIso(finishedIso: string, read: LastRunRecord, now: Date): Promise<void> {
  const stored = sql`${platformSettings.value}->>'date'`;
  const unchangedUnusable =
    read.usableIso === null ? sql` OR ${stored} IS NOT DISTINCT FROM ${read.storedText}::text` : sql``;
  try {
    await db
      .insert(platformSettings)
      .values({ key: DAILY_RUN_MARKER_KEY, value: { date: finishedIso }, updated_at: now })
      .onConflictDoUpdate({
        target: platformSettings.key,
        set: { value: { date: finishedIso }, updated_at: now },
        setWhere: sql`(${stored} < ${finishedIso}${unchangedUnusable})`,
      });
  } catch (error: unknown) {
    logError('daily-notifications', error, { step: 'save-last-run', finishedIso });
  }
}

interface FailedDocument {
  readonly kind: 'invoice' | 'credit_note';
  readonly id: string;
  readonly number: string;
}

/** Finalized documents whose permanent PDF copy failed every attempt (same rule as the archival sweep). */
async function loadFailedArchivals(): Promise<Map<string, FailedDocument[]>> {
  const result = await db.execute(sql`
    (SELECT 'invoice' AS kind, id, business_id, invoice_number AS number FROM invoices
      WHERE lifecycle_status = 'finalized' AND archival_status <> 'archived'
        AND archival_attempts >= ${ARCHIVAL_MAX_ATTEMPTS}::int
      ORDER BY finalized_at LIMIT ${ARCHIVAL_PER_RUN_LIMIT}::int)
    UNION ALL
    (SELECT 'credit_note' AS kind, id, business_id, credit_note_number AS number FROM credit_notes
      WHERE lifecycle_status = 'finalized' AND archival_status <> 'archived'
        AND archival_attempts >= ${ARCHIVAL_MAX_ATTEMPTS}::int
      ORDER BY finalized_at LIMIT ${ARCHIVAL_PER_RUN_LIMIT}::int)
  `);
  const map = new Map<string, FailedDocument[]>();
  for (const raw of result.rows) {
    if (typeof raw !== 'object' || raw === null) continue;
    const row = raw as Record<string, unknown>;
    if (
      (row.kind !== 'invoice' && row.kind !== 'credit_note') ||
      typeof row.id !== 'string' ||
      typeof row.business_id !== 'string' ||
      typeof row.number !== 'string'
    ) {
      continue;
    }
    const list = map.get(row.business_id) ?? [];
    list.push({ kind: row.kind, id: row.id, number: row.number });
    map.set(row.business_id, list);
  }
  return map;
}

interface DraftWithAudience {
  readonly draft: NotificationDraft;
  readonly ownerOnly?: boolean;
}

/**
 * Feature C: the once-a-day job (around 9 AM IST). For every business that is not suspended it works out what
 * people need to know today, creates the notifications (idempotently: a second run the same day adds nothing),
 * then sends the e-mails and tidies up. One business failing never stops the others.
 *
 * BUG-01: if earlier days were missed, the run also creates those days' reminders (up to CATCH_UP_MAX_DAYS), worded
 * for today and with the same de-duplication keys the missed run would have used. Reminders whose moment has passed
 * are not sent late: a "due soon" for an invoice that is already due, or a GST return whose due date has gone.
 * Trial / plan reminders need no catch-up: the next one still comes, and "has ended" is shown for 3 days.
 * Today is recorded as finished only when every business succeeded; otherwise the next run retries the covered days.
 */
export async function runDailyNotifications(
  options: { readonly now?: Date; readonly send?: EmailSender } = {},
): Promise<DailyNotificationSummary> {
  const now = options.now ?? new Date();
  const todayIso = istTodayIso(now);
  const lastRun = await loadLastRun(todayIso);
  const days = catchUpDaysIso(lastRun.usableIso, todayIso, CATCH_UP_MAX_DAYS);

  // For each covered day D: invoices due on D-1 became overdue on D; invoices due on D+3 were "due soon" on D (kept
  // only while that due date is still ahead of today).
  const overdueByDay = days.map((day) => ({ day, dueIso: addDaysIso(day, -1) }));
  const dueSoonByDay = days
    .map((day) => ({ day, dueIso: addDaysIso(day, DUE_SOON_DAYS) }))
    .filter((entry) => entry.dueIso > todayIso);
  const gstCheckDays = days.map((day) => addDaysIso(day, GST_REMINDER_DAYS_BEFORE));
  // A covered 25 March is at most CATCH_UP_MAX_DAYS - 1 = 6 days ago, so today is still in that financial year.
  const isFyEndingDay = days.some((day) => day.endsWith('-03-25'));
  const fyLabel = getIndianFinancialYearForDate(now).label;

  const [money, failedArchivals] = await Promise.all([
    loadMoney([...overdueByDay, ...dueSoonByDay].map((entry) => entry.dueIso)),
    loadFailedArchivals(),
  ]);

  let processed = 0;
  let created = 0;
  let businessErrors = 0;
  let lastId: string | null = null;

  for (;;) {
    const page = await db
      .select({
        id: businesses.id,
        state_code: businesses.state_code,
        registration_type: businesses.registration_type,
        gst_filing_frequency: businesses.gst_filing_frequency,
        subscription_plan: businesses.subscription_plan,
        subscription_status: businesses.subscription_status,
        trial_ends_at: businesses.trial_ends_at,
        subscription_ends_at: businesses.subscription_ends_at,
      })
      .from(businesses)
      .where(
        lastId === null
          ? ne(businesses.subscription_status, 'suspended')
          : and(ne(businesses.subscription_status, 'suspended'), gt(businesses.id, lastId)),
      )
      .orderBy(asc(businesses.id))
      .limit(BUSINESS_PAGE);
    if (page.length === 0) break;

    for (const business of page) {
      processed += 1;
      const items: DraftWithAudience[] = [];

      const due = money.get(business.id);
      for (const { day, dueIso } of overdueByDay) {
        const totals = due?.get(dueIso);
        if (totals) items.push({ draft: invoicesOverdueDraft(day, totals.count, totals.amountPaise, todayIso) });
      }
      for (const { day, dueIso } of dueSoonByDay) {
        const totals = due?.get(dueIso);
        if (totals) {
          items.push({ draft: invoicesDueSoonDraft(day, dueIso, totals.count, totals.amountPaise, todayIso) });
        }
      }

      // GST reminders apply to regular taxpayers only (composition dealers file different returns).
      if (business.registration_type === 'regular') {
        const frequency = isGstFilingFrequency(business.gst_filing_frequency) ? business.gst_filing_frequency : null;
        if (frequency === null) {
          items.push({ draft: gstFrequencyMissingDraft(), ownerOnly: true });
        } else {
          for (const checkIso of gstCheckDays) {
            for (const item of gstReturnsDueOn(checkIso, frequency, business.state_code)) {
              // A due date that has already passed is not announced late as "is due on".
              if (item.dueDateIso >= todayIso) items.push({ draft: gstReturnDueDraft(item) });
            }
          }
        }
        if (isFyEndingDay) items.push({ draft: fyEndingDraft(fyLabel) });
      }

      for (const draft of planReminderDrafts(business, now)) items.push({ draft });

      for (const doc of failedArchivals.get(business.id) ?? []) {
        items.push({ draft: pdfArchivalFailedDraft(doc.kind, doc.id, doc.number) });
      }

      try {
        for (const item of items) {
          const result = await notify(db, {
            businessId: business.id,
            draft: item.draft,
            ...(item.ownerOnly ? { onlyRoles: ['owner'] as const } : {}),
          });
          created += result.created;
        }
      } catch (error: unknown) {
        businessErrors += 1;
        logError('daily-notifications', error, { businessId: business.id });
      }
    }
    lastId = page[page.length - 1]?.id ?? null;
    if (page.length < BUSINESS_PAGE) break;
  }

  // All covered days are finished only when no business failed. Otherwise the record is set to the day before the
  // first covered day (never later than what it was), so the next run retries these days, also after a failed
  // first-ever run that had no record yet.
  await saveLastRunIso(businessErrors === 0 ? todayIso : addDaysIso(days[0] ?? todayIso, -1), lastRun, now);

  const emails = await deliverNotificationEmails(options.send ? { send: options.send } : {});
  await expireStaleEmailQueue();
  const deleted = await db
    .delete(notifications)
    .where(lt(notifications.created_at, new Date(now.getTime() - NOTIFICATION_RETENTION_DAYS * 86_400_000)))
    .returning({ id: notifications.id });

  return { days, businesses: processed, created, businessErrors, emails, deleted: deleted.length };
}

