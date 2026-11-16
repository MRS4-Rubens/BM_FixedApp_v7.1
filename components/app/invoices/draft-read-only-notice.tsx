import Link from 'next/link';
import { ArrowLeft, Clock } from 'lucide-react';
import { formatIstDate } from '@/lib/invoices/ist-date';
import { formatPaiseAsInr } from '@/lib/money';

export interface DraftReadOnlyNoticeProps {
  readonly invoiceDate: Date | string | null;
  readonly customerName?: string | null;
  readonly grandTotalPaise: number;
}

export function DraftReadOnlyNotice({
  invoiceDate,
  customerName,
  grandTotalPaise,
}: DraftReadOnlyNoticeProps) {
  const customerDisplay = customerName && customerName.trim().length > 0 ? customerName : 'Walk-in customer';
  const formattedDate = invoiceDate ? formatIstDate(invoiceDate) : '—';
  const formattedTotal = formatPaiseAsInr(grandTotalPaise);

  return (
    <div className="mx-auto max-w-2xl py-8 px-4">
      <div className="mb-4">
        <Link
          href="/invoices"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-4" />
          Back to invoices
        </Link>
      </div>

      <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-5">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <Clock className="size-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">
              Draft invoice — not finalized yet
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Drafts can only be edited by the business owner or team members. You will see the full invoice once it is finalized.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 rounded-lg border border-border/60 bg-muted/20 p-4 text-sm">
          <div>
            <span className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Date
            </span>
            <span className="mt-1 block font-medium text-foreground">
              {formattedDate}
            </span>
          </div>
          <div>
            <span className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Customer
            </span>
            <span className="mt-1 block font-medium text-foreground">
              {customerDisplay}
            </span>
          </div>
          <div>
            <span className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Grand Total
            </span>
            <span className="mt-1 block font-mono font-bold text-foreground">
              {formattedTotal}
            </span>
          </div>
        </div>

        <div className="pt-2">
          <Link
            href="/invoices"
            className="inline-flex items-center justify-center rounded-lg bg-secondary px-4 py-2 text-sm font-semibold text-secondary-foreground hover:bg-secondary/80 transition-colors"
          >
            Back to invoices
          </Link>
        </div>
      </div>
    </div>
  );
}
