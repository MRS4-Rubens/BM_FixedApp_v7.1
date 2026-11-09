'use server';

import { and, asc, desc, eq, gte, ilike, isNull, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { db } from '@/lib/db/client';
import { customers, invoices } from '@/lib/db/schema';
import { formatIstDateAsIso } from '@/lib/invoices/ist-date';
import {
  buildDisplayStatusCondition,
  INVOICE_LIST_STATUSES,
  resolveListPeriod,
} from '@/lib/invoices/list-filters';
import { defaultListPeriod } from '@/lib/invoices/list-period';
import {
  buildPageSlice,
  decodeCursor,
  type Page,
  type PageCursor,
  pageSizeSchema,
} from '@/lib/pagination/keyset';
import { buildContainsPattern, normalizeSearchTerm } from '@/lib/pagination/search';

const listInvoicesSchema = z
  .object({
    q: z.string().max(100).optional(),
    month: z.number().int().min(1).max(12).optional(),
    year: z.number().int().min(2017).max(2100).optional(),
    status: z.enum(INVOICE_LIST_STATUSES).default('all'),
    limit: pageSizeSchema,
    after: z.string().max(512).optional(),
    before: z.string().max(512).optional(),
  })
  .refine((data) => !(data.after && data.before), {
    message: 'Cannot provide both after and before cursors',
  });

export interface InvoiceListItem {
  readonly id: string;
  readonly invoice_number: string;
  readonly invoice_date: string | null;
  readonly grand_total_paise: number;
  readonly lifecycle_status: 'draft' | 'finalized';
  readonly payment_status: 'unpaid' | 'partially_paid' | 'paid' | 'overdue';
  readonly due_date: string | null;
  readonly customer_name: string;
  readonly place_of_supply_state_code: string | null;
}

export const listInvoices = createAuthenticatedAction(
  listInvoicesSchema,
  async (input, context): Promise<Page<InvoiceListItem>> => {
    const businessId = context.appUser.business_id;
    if (!businessId) {
      return {
        items: [],
        pageInfo: {
          hasNext: false,
          hasPrevious: false,
          nextCursor: null,
          previousCursor: null,
          hasNextPage: false,
          hasPreviousPage: false,
          startCursor: null,
          endCursor: null,
        },
        total: 0,
        totalCount: 0,
      };
    }

    const now = new Date();
    const defaults = defaultListPeriod(now);
    const month = input.month ?? defaults.month;
    const year = input.year ?? defaults.year;
    const period = resolveListPeriod({ month, year }, now);
    const todayIso = formatIstDateAsIso(now);

    const baseFilterConditions = [eq(invoices.business_id, businessId)];

    // 1. Period filter (undated drafts included in current month only)
    if (period.isCurrentMonth) {
      baseFilterConditions.push(
        or(
          and(gte(invoices.invoice_date, period.startDate), lte(invoices.invoice_date, period.endDate)),
          isNull(invoices.invoice_date),
        )!,
      );
    } else {
      baseFilterConditions.push(
        and(gte(invoices.invoice_date, period.startDate), lte(invoices.invoice_date, period.endDate))!,
      );
    }

    // 2. Search filter
    const normalizedQ = normalizeSearchTerm(input.q);
    if (normalizedQ) {
      const pattern = buildContainsPattern(normalizedQ);
      baseFilterConditions.push(
        or(
          ilike(invoices.invoice_number, pattern),
          ilike(invoices.billing_name_snapshot, pattern),
          and(isNull(invoices.billing_name_snapshot), ilike(customers.name, pattern)),
        )!,
      );
    }

    // 3. Status filter
    const statusCondition = buildDisplayStatusCondition(input.status, todayIso);
    if (statusCondition) {
      baseFilterConditions.push(statusCondition);
    }

    // 4. Cursor / Keyset condition
    const queryConditions = [...baseFilterConditions];
    const afterCursor = input.after ? decodeCursor(input.after) : null;
    const beforeCursor = input.before ? decodeCursor(input.before) : null;

    const isBackward = Boolean(beforeCursor && beforeCursor.k === 'ts');
    const activeCursor = isBackward ? beforeCursor : afterCursor;
    const hasCursor = Boolean(activeCursor && activeCursor.k === 'ts');

    if (activeCursor && activeCursor.k === 'ts') {
      if (isBackward) {
        queryConditions.push(
          sql`(${invoices.created_at}, ${invoices.id}) > (${activeCursor.t}::timestamptz, ${activeCursor.id}::uuid)`,
        );
      } else {
        queryConditions.push(
          sql`(${invoices.created_at}, ${invoices.id}) < (${activeCursor.t}::timestamptz, ${activeCursor.id}::uuid)`,
        );
      }
    }

    // Order: forward = created_at DESC, id DESC. backward = created_at ASC, id ASC.
    const orderBy = isBackward
      ? [asc(invoices.created_at), asc(invoices.id)]
      : [desc(invoices.created_at), desc(invoices.id)];

    const limitPlusOne = input.limit + 1;

    // Run query and total count in parallel
    const [rows, countResult] = await Promise.all([
      db
        .select({
          id: invoices.id,
          invoice_number: invoices.invoice_number,
          invoice_date: invoices.invoice_date,
          grand_total_paise: invoices.grand_total_paise,
          lifecycle_status: invoices.lifecycle_status,
          payment_status: invoices.payment_status,
          due_date: invoices.due_date,
          customer_name: sql<string>`coalesce(${invoices.billing_name_snapshot}, ${customers.name}, 'One-Time Customer')`,
          place_of_supply_state_code: invoices.place_of_supply_state_code,
          cursor_ts: sql<string>`${invoices.created_at}::text`,
        })
        .from(invoices)
        .leftJoin(
          customers,
          and(eq(invoices.customer_id, customers.id), eq(customers.business_id, invoices.business_id)),
        )
        .where(and(...queryConditions))
        .orderBy(...orderBy)
        .limit(limitPlusOne),

      db
        .select({ count: sql<number>`count(*)::int` })
        .from(invoices)
        .leftJoin(
          customers,
          and(eq(invoices.customer_id, customers.id), eq(customers.business_id, invoices.business_id)),
        )
        .where(and(...baseFilterConditions)),
    ]);

    const total = countResult[0]?.count ?? 0;

    const slice = buildPageSlice(rows, {
      limit: input.limit,
      direction: isBackward ? 'backward' : 'forward',
      hasCursor,
      toCursor: (row): PageCursor => ({
        v: 1,
        k: 'ts',
        t: row.cursor_ts,
        id: row.id,
      }),
    });

    const items: InvoiceListItem[] = slice.rows.map((row) => ({
      id: row.id,
      invoice_number: row.invoice_number,
      invoice_date: row.invoice_date,
      grand_total_paise: row.grand_total_paise,
      lifecycle_status: row.lifecycle_status,
      payment_status: row.payment_status,
      due_date: row.due_date,
      customer_name: row.customer_name,
      place_of_supply_state_code: row.place_of_supply_state_code,
    }));

    return {
      items,
      pageInfo: slice.pageInfo,
      total,
      totalCount: total,
    };
  },
  'list-invoices',
);
