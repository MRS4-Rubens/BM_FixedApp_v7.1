import { and, asc, gt, lt, ne, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { businesses, notifications } from '@/lib/db/schema';
import { logError } from '@/lib/actions/_shared/logger';
import { getIndianFinancialYearForDate } from '@/lib/invoices/financial-year';
import { ARCHIVAL_MAX_ATTEMPTS } from '@/lib/storage/archival-config';
import { addDaysIso, istTodayIso } from './dates';
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

export interface DailyNotificationSummary {
  readonly businesses: number;
  readonly created: number;
  readonly businessErrors: number;
  readonly emails: DeliverySummary;
  readonly deleted: number;
}

interface MoneyRow {
  readonly overdueCount: number;
  readonly overdueAmount: number;
  readonly soonCount: number;
  readonly soonAmount: number;
}

function num(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** One query for every business: invoices that became overdue today (due yesterday) and those due in 3 days. */
async function loadMoney(yesterdayIso: string, soonIso: string): Promise<Map<string, MoneyRow>> {
  const result = await db.execute(sql`
    SELECT t.business_id,
      count(*) FILTER (WHERE t.due_date = ${yesterdayIso}::date)::int AS overdue_count,
      coalesce(sum(t.remaining) FILTER (WHERE t.due_date = ${yesterdayIso}::date), 0)::bigint AS overdue_amount,
      count(*) FILTER (WHERE t.due_date = ${soonIso}::date)::int AS soon_count,
      coalesce(sum(t.remaining) FILTER (WHERE t.due_date = ${soonIso}::date), 0)::bigint AS soon_amount
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
        AND i.due_date IN (${yesterdayIso}::date, ${soonIso}::date)
    ) t
    WHERE t.remaining > 0
    GROUP BY t.business_id
  `);
  const map = new Map<string, MoneyRow>();
  for (const raw of result.rows) {
    if (typeof raw !== 'object' || raw === null) continue;
    const row = raw as Record<string, unknown>;
    if (typeof row.business_id !== 'string') continue;
    map.set(row.business_id, {
      overdueCount: num(row.overdue_count),
      overdueAmount: num(row.overdue_amount),
      soonCount: num(row.soon_count),
      soonAmount: num(row.soon_amount),
    });
  }
  return map;
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
 */
export async function runDailyNotifications(
  options: { readonly now?: Date; readonly send?: EmailSender } = {},
): Promise<DailyNotificationSummary> {
  const now = options.now ?? new Date();
  const todayIso = istTodayIso(now);
  const yesterdayIso = addDaysIso(todayIso, -1);
  const soonIso = addDaysIso(todayIso, DUE_SOON_DAYS);
  const gstCheckIso = addDaysIso(todayIso, GST_REMINDER_DAYS_BEFORE);
  const isFyEndingDay = todayIso.endsWith('-03-25');
  const fyLabel = getIndianFinancialYearForDate(now).label;

  const [money, failedArchivals] = await Promise.all([loadMoney(yesterdayIso, soonIso), loadFailedArchivals()]);

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
      if (due && due.overdueCount > 0) {
        items.push({ draft: invoicesOverdueDraft(todayIso, due.overdueCount, due.overdueAmount) });
      }
      if (due && due.soonCount > 0) {
        items.push({ draft: invoicesDueSoonDraft(todayIso, soonIso, due.soonCount, due.soonAmount) });
      }

      // GST reminders apply to regular taxpayers only (composition dealers file different returns).
      if (business.registration_type === 'regular') {
        const frequency = isGstFilingFrequency(business.gst_filing_frequency) ? business.gst_filing_frequency : null;
        if (frequency === null) {
          items.push({ draft: gstFrequencyMissingDraft(), ownerOnly: true });
        } else {
          for (const item of gstReturnsDueOn(gstCheckIso, frequency, business.state_code)) {
            items.push({ draft: gstReturnDueDraft(item) });
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

  const emails = await deliverNotificationEmails(options.send ? { send: options.send } : {});
  await expireStaleEmailQueue();
  const deleted = await db
    .delete(notifications)
    .where(lt(notifications.created_at, new Date(now.getTime() - NOTIFICATION_RETENTION_DAYS * 86_400_000)))
    .returning({ id: notifications.id });

  return { businesses: processed, created, businessErrors, emails, deleted: deleted.length };
}

