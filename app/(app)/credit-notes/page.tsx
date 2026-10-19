import Link from 'next/link'
import { redirect } from 'next/navigation'
import { desc, eq } from 'drizzle-orm'
import { getCurrentAppUser } from '@/lib/auth/session'
import { db } from '@/lib/db/client'
import { creditNotes, invoices } from '@/lib/db/schema'
import { formatPaiseAsInr } from '@/lib/money'

export default async function CreditNotesListPage() {
  const appUser = await getCurrentAppUser()
  if (!appUser) redirect('/login')
  if (!appUser.business_id) redirect('/settings')

  const rows = await db
    .select({
      id: creditNotes.id,
      credit_note_number: creditNotes.credit_note_number,
      issue_date: creditNotes.issue_date,
      lifecycle_status: creditNotes.lifecycle_status,
      status: creditNotes.status,
      grand_total_paise: creditNotes.grand_total_paise,
      original_invoice_id: creditNotes.original_invoice_id,
      original_invoice_number: invoices.invoice_number,
      customer_name_snapshot: invoices.billing_name_snapshot,
    })
    .from(creditNotes)
    .innerJoin(invoices, eq(creditNotes.original_invoice_id, invoices.id))
    .where(eq(creditNotes.business_id, appUser.business_id))
    .orderBy(desc(creditNotes.created_at))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-[#0F172A]">Credit Notes</h1>
          <p className="text-xs text-[#64748B]">
            GST credit notes issued against finalized tax invoices
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground text-sm">
          No credit notes issued yet. Open any finalized invoice to issue a credit note.
        </div>
      ) : (
        <>
          {/* Desktop Table (>= 768px) */}
          <div className="hidden md:block overflow-x-auto rounded-xl border border-border bg-card shadow-xs">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border bg-muted/20 text-[11px] font-bold uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Credit Note #</th>
                  <th className="px-4 py-3">Issue Date</th>
                  <th className="px-4 py-3">Original Invoice</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Lifecycle</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Grand Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((cn) => (
                  <tr key={cn.id} className="hover:bg-muted/10 transition-colors">
                    <td className="px-4 py-3 font-medium text-primary">
                      <Link href={`/credit-notes/${cn.id}`} className="hover:underline font-mono font-bold">
                        {cn.credit_note_number}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{cn.issue_date || '—'}</td>
                    <td className="px-4 py-3 font-mono text-muted-foreground">
                      <Link href={`/invoices/${cn.original_invoice_id}`} className="hover:underline">
                        {cn.original_invoice_number || '—'}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-foreground font-semibold">{cn.customer_name_snapshot || '—'}</td>
                    <td className="px-4 py-3 capitalize text-muted-foreground">{cn.lifecycle_status}</td>
                    <td className="px-4 py-3 capitalize text-muted-foreground">{cn.status}</td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-red-600 dark:text-red-400">
                      -{formatPaiseAsInr(cn.grand_total_paise)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Card Stack (< 768px) */}
          <div className="md:hidden space-y-2.5">
            {rows.map((cn) => (
              <div
                key={cn.id}
                className="bg-card rounded-xl border border-border/80 p-3.5 shadow-2xs space-y-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <Link href={`/credit-notes/${cn.id}`}>
                    <span className="inline-flex items-center rounded-md bg-red-100/70 text-red-700 px-2 py-0.5 font-mono text-[13.5px] font-bold tracking-wide ring-1 ring-red-200">
                      {cn.credit_note_number}
                    </span>
                  </Link>
                  <span className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-muted text-muted-foreground border">
                    {cn.lifecycle_status}
                  </span>
                </div>

                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-bold text-foreground truncate">
                      {cn.customer_name_snapshot || 'Cash Customer'}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5 text-xs">
                      <span className="text-muted-foreground">Against:</span>
                      <Link href={`/invoices/${cn.original_invoice_id}`} className="font-mono font-bold text-primary hover:underline truncate">
                        {cn.original_invoice_number || '—'}
                      </Link>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                      Credit
                    </span>
                    <span className="font-mono text-[15px] font-extrabold text-red-600 dark:text-red-400">
                      -{formatPaiseAsInr(cn.grand_total_paise)}
                    </span>
                  </div>
                </div>

                <div className="pt-2 border-t border-border/50 flex items-center justify-between gap-2">
                  <span className="text-[11px] text-muted-foreground">
                    {cn.issue_date || '—'}
                  </span>
                  <Link
                    href={`/credit-notes/${cn.id}`}
                    className="inline-flex items-center gap-1 py-1 px-3 rounded-lg border border-border bg-background text-foreground text-xs font-bold shadow-2xs hover:bg-accent transition-colors"
                  >
                    View Details
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
