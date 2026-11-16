import { Shield, ShieldAlert } from 'lucide-react';

export function RoleGuide() {
  return (
    <div className="rounded-xl border border-border bg-card p-4 sm:p-5 shadow-xs space-y-3">
      <h3 className="text-sm font-bold text-foreground">Role Permissions Guide</h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 pt-1">
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
      </div>
    </div>
  );
}
