'use client';

import { Button } from '@/components/ui/button';
import { RefreshCw, FileSpreadsheet, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ConsoleHeaderProps {
  isPending: boolean;
  onRefresh: () => void;
  onExportCsv: () => void;
  onViewPending: () => void;
  pendingCount: number;
}

export function ConsoleHeader({
  isPending,
  onRefresh,
  onExportCsv,
  onViewPending,
  pendingCount,
}: ConsoleHeaderProps) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between border-b border-border/50 pb-3">
      <div>
        <div className="flex items-center gap-2.5">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-bold text-emerald-700 dark:text-emerald-400 border border-emerald-500/20">
            <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
            SYSTEM ACTIVE
          </span>
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
            SUPER ADMIN CONSOLE
          </span>
        </div>
        <h1 className="mt-1.5 text-3xl lg:text-4xl font-extrabold tracking-tight text-foreground font-heading">
          Platform Administration
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5 max-w-3xl lg:max-w-4xl leading-relaxed">
          Real-time subscriber metrics, manual payment verification queue, and client tenancy management.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <Button
          variant="outline"
          size="sm"
          onClick={onRefresh}
          disabled={isPending}
          className="h-8.5 gap-1.5 text-sm font-semibold shadow-xs hover:bg-muted"
        >
          <RefreshCw className={cn('size-4', isPending && 'animate-spin text-indigo-600')} />
          Refresh
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={onExportCsv}
          className="h-8.5 gap-1.5 text-sm font-semibold shadow-xs hover:bg-muted"
        >
          <FileSpreadsheet className="size-4 text-emerald-700" />
          Export Directory
        </Button>

        <Button
          size="sm"
          onClick={onViewPending}
          className={cn(
            'h-8.5 gap-1.5 text-sm font-bold transition-all shadow-xs',
            pendingCount > 0
              ? 'btn-shine-amber'
              : 'btn-shine-indigo'
          )}
        >
          <Clock className="size-4" />
          Pending Queue ({pendingCount})
        </Button>
      </div>
    </div>
  );
}

