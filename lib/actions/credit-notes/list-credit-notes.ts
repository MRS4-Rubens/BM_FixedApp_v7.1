'use server';

import { and, asc, desc, eq, gte, ilike, isNull, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { ActionError } from '@/lib/actions/_shared/errors';
import { db } from '@/lib/db/client';
import { creditNotes, invoices } from '@/lib/db/schema';
import { defaultListPeriod, resolveListPeriod } from '@/lib/invoices/list-filters';
import {
  buildPageSlice,
  decodeCursor,
  type Page,
  type PageCursor,
  pageSizeSchema,
} from '@/lib/pagination/keyset';
import { buildContainsPattern, normalizeSearchTerm } from '@/lib/pagination/search';

const listCreditNotesSchema = z
  .object({
    invoice_id: z.string().uuid().optional(),
    q: z.string().max(100).optional(),
    month: z.number().int().min(1).max(12).optional(),
    year: z.number().int().min(2017).max(2100).optional(),
    limit: pageSizeSchema,
    after: z.string().max(512).optional(),
    before: z.string().max(512).optional(),
  })
  .refine((data) => !(data.after && data.before), {
    message: 'Cannot provide both after and before cursors',
  });

export interface CreditNoteListItem {
  readonly id: string;
  readonly credit_note_number: string | null;
  readonly credit_note_sequence: number | null;
  readonly reason: string | null;
  readonly lifecycle_status: 'draft' | 'finalized';
  readonly issue_date: string | null;
  readonly subtotal_paise: number;
  readonly total_tax_paise: number;
  readonly grand_total_paise: number;
  readonly created_at: Date;
  readonly status: 'active' | 'voided';
  readonly voided_at: Date | null;
  readonly void_reason: string | null;
  readonly void_notes: string | null;
  readonly original_invoice_id: string;
  readonly original_invoice_number: string;
  readonly original_invoice_date: string | null;
  readonly billing_name_snapshot: string | null;
  readonly billing_gstin_snapshot: string | null;
}

export const listCreditNotes = createAuthenticatedAction(
  listCreditNotesSchema,
  async (input, context): Promise<Page<CreditNoteListItem>> => {
    const businessId = context.appUser.business_id;
    if (!businessId) {
      throw new ActionError('Your account is not linked to a business profile.', {
        code: 'NO_BUSINESS_LINKED',
      });
    }

    const baseFilterConditions = [eq(creditNotes.business_id, businessId)];

    if (input.invoice_id) {
      baseFilterConditions.push(eq(creditNotes.original_invoice_id, input.invoice_id));
    } else {
      // Period filter applied when invoice_id is not given
      const now = new Date();
      const defaults = defaultListPeriod(now);
      const month = input.month ?? defaults.month;
      const year = input.year ?? defaults.year;
      const period = resolveListPeriod({ month, year }, now);

      const periodCondition = or(
        and(gte(creditNotes.issue_date, period.startDate), lte(creditNotes.issue_date, period.endDate)),
        and(
          isNull(creditNotes.issue_date),
          gte(creditNotes.created_at, new Date(`${period.startDate}T00:00:00.000Z`)),
          lte(creditNotes.created_at, new Date(`${period.endDate}T23:59:59.999Z`)),
        ),
      );
      if (periodCondition) {
        baseFilterConditions.push(periodCondition);
      }
    }

    // Search filter
    const normalizedQ = normalizeSearchTerm(input.q);
    if (normalizedQ) {
      const pattern = buildContainsPattern(normalizedQ);
      baseFilterConditions.push(
        or(
          ilike(creditNotes.credit_note_number, pattern),
          ilike(invoices.invoice_number, pattern),
          ilike(invoices.billing_name_snapshot, pattern),
          ilike(creditNotes.reason, pattern),
        )!,
      );
    }

    // Keyset conditions
    const queryConditions = [...baseFilterConditions];
    const afterCursor = input.after ? decodeCursor(input.after) : null;
    const beforeCursor = input.before ? decodeCursor(input.before) : null;

    const isBackward = Boolean(beforeCursor && beforeCursor.k === 'ts');
    const activeCursor = isBackward ? beforeCursor : afterCursor;
    const hasCursor = Boolean(activeCursor && activeCursor.k === 'ts');

    if (activeCursor && activeCursor.k === 'ts') {
      if (isBackward) {
        queryConditions.push(
          sql`(${creditNotes.created_at}, ${creditNotes.id}) > (${activeCursor.t}::timestamptz, ${activeCursor.id}::uuid)`,
        );
      } else {
        queryConditions.push(
          sql`(${creditNotes.created_at}, ${creditNotes.id}) < (${activeCursor.t}::timestamptz, ${activeCursor.id}::uuid)`,
        );
      }
    }

    const orderBy = isBackward
      ? [asc(creditNotes.created_at), asc(creditNotes.id)]
      : [desc(creditNotes.created_at), desc(creditNotes.id)];

    const limitPlusOne = input.limit + 1;

    const [rows, countResult] = await Promise.all([
      db
        .select({
          id: creditNotes.id,
          credit_note_number: creditNotes.credit_note_number,
          credit_note_sequence: creditNotes.credit_note_sequence,
          reason: creditNotes.reason,
          lifecycle_status: creditNotes.lifecycle_status,
          issue_date: creditNotes.issue_date,
          subtotal_paise: creditNotes.subtotal_paise,
          total_tax_paise: creditNotes.total_tax_paise,
          grand_total_paise: creditNotes.grand_total_paise,
          created_at: creditNotes.created_at,
          status: creditNotes.status,
          voided_at: creditNotes.voided_at,
          void_reason: creditNotes.void_reason,
          void_notes: creditNotes.void_notes,
          original_invoice_id: creditNotes.original_invoice_id,
          original_invoice_number: invoices.invoice_number,
          original_invoice_date: invoices.invoice_date,
          billing_name_snapshot: invoices.billing_name_snapshot,
          billing_gstin_snapshot: invoices.billing_gstin_snapshot,
          cursor_ts: sql<string>`${creditNotes.created_at}::text`,
        })
        .from(creditNotes)
        .innerJoin(invoices, eq(creditNotes.original_invoice_id, invoices.id))
        .where(and(...queryConditions))
        .orderBy(...orderBy)
        .limit(limitPlusOne),

      db
        .select({ count: sql<number>`count(*)::int` })
        .from(creditNotes)
        .innerJoin(invoices, eq(creditNotes.original_invoice_id, invoices.id))
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

    const items: CreditNoteListItem[] = slice.rows.map((row) => ({
      id: row.id,
      credit_note_number: row.credit_note_number,
      credit_note_sequence: row.credit_note_sequence,
      reason: row.reason,
      lifecycle_status: row.lifecycle_status,
      issue_date: row.issue_date,
      subtotal_paise: row.subtotal_paise,
      total_tax_paise: row.total_tax_paise,
      grand_total_paise: row.grand_total_paise,
      created_at: row.created_at,
      status: row.status,
      voided_at: row.voided_at,
      void_reason: row.void_reason,
      void_notes: row.void_notes,
      original_invoice_id: row.original_invoice_id,
      original_invoice_number: row.original_invoice_number,
      original_invoice_date: row.original_invoice_date,
      billing_name_snapshot: row.billing_name_snapshot,
      billing_gstin_snapshot: row.billing_gstin_snapshot,
    }));

    return {
      items,
      pageInfo: slice.pageInfo,
      total,
      totalCount: total,
    };
  },
  'list-credit-notes',
);
