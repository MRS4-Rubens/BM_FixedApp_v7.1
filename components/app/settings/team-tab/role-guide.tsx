import Link from 'next/link';
import { Shield, ShieldAlert, Eye } from 'lucide-react';
import { useIsOwner } from '@/components/app/current-user-role';

export function RoleGuide() {
  const isOwner = useIsOwner();
  return (
    <div className="rounded-xl border border-border bg-card p-4 sm:p-5 shadow-xs space-y-3">
      <h3 className="text-sm font-bold text-foreground">Role Permissions Guide</h3>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 pt-1">
        <div className="rounded-lg border border-indigo-200/60 bg-indigo-50/40 dark:border-indigo-900/40 dark:bg-indigo-950/20 p-3.5 space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-700 dark:text-indigo-400">
            <Shield className="size-3.5" />
            <span>Owner</span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            <strong className="text-foreground">Owner can:</strong> everything, including business settings, billing, team, voiding payments and credit notes.
          </p>
        </div>

        <div className="rounded-lg border border-emerald-200/60 bg-emerald-50/40 dark:border-emerald-900/40 dark:bg-emerald-950/20 p-3.5 space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-700 dark:text-emerald-400">
            <ShieldAlert className="size-3.5" />
            <span>Team member</span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            <strong className="text-foreground">Team member can:</strong> create and send invoices, record payments, manage customers and products, view reports. <strong className="text-foreground">Cannot:</strong> change business settings or billing, invite people, void payments, finalize or void credit notes.
          </p>
        </div>

        <div className="rounded-lg border border-slate-200/60 bg-slate-50/40 dark:border-slate-800/40 dark:bg-slate-900/20 p-3.5 space-y-1.5">
          <div className="flex items-center justify-between gap-1.5 flex-wrap">
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300">
              <Eye className="size-3.5" />
              <span>Accountant (read-only)</span>
            </div>
            {isOwner ? (
              <Link
                href="/checkout?plan=professional"
                className="inline-flex items-center rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-indigo-700 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-50 transition cursor-pointer"
              >
                Professional plan
              </Link>
            ) : (
              <span className="inline-flex items-center rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                Professional plan
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            <strong className="text-foreground">Can:</strong> view the dashboard, invoices, credit notes, payments, customers, products and reports; download PDFs and GST / ITR Excel exports. <strong className="text-foreground">Cannot:</strong> create, edit, finalize, delete or send anything, record payments, or see billing and team settings.
          </p>
        </div>
      </div>
    </div>
  );
}
