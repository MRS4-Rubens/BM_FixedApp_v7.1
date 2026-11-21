'use client';

import { useCallback, useEffect, useState } from 'react';
import { Activity, Loader2, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatIstTime } from '@/lib/invoices/ist-date';
import { formatMb, formatUptime, memoryLevel, type ServerHealth } from '@/lib/admin/server-health';

const LEVEL_STYLES = {
  ok: { bar: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-400', label: 'Healthy' },
  watch: { bar: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-400', label: 'Watch' },
  danger: { bar: 'bg-rose-500', text: 'text-rose-700 dark:text-rose-400', label: 'Near the limit' },
} as const;

/**
 * B1: admin-only card with the live memory of the server process (GET /api/admin/server-health). Loaded once when the
 * Overview tab opens and on Refresh; never polled.
 */
export function ServerHealthCard() {
  const [health, setHealth] = useState<ServerHealth | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/server-health', { cache: 'no-store', credentials: 'same-origin' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setHealth((await res.json()) as ServerHealth);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    return () => clearTimeout(first);
  }, [load]);

  const level = health ? memoryLevel(health.rssBytes, health.limitBytes) : null;
  const style = level ? LEVEL_STYLES[level.level] : null;

  return (
    <section aria-labelledby="server-health-title" className="rounded-xl border border-border bg-card p-4 shadow-xs">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300">
            <Activity className="size-4" aria-hidden="true" />
          </span>
          <div>
            <h3 id="server-health-title" className="text-base font-bold text-foreground font-heading">
              Server health
            </h3>
            <p className="text-xs text-muted-foreground">
              Whole app on one Render instance (all users together), not per user.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-bold text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-60 cursor-pointer"
        >
          {loading ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="size-3.5" aria-hidden="true" />}
          Refresh
        </button>
      </div>

      {failed && (
        <p role="alert" className="mt-3 text-sm font-semibold text-rose-700">
          {health
            ? 'Refresh failed. The reading below is from the last successful check.'
            : 'Could not read server health. Try Refresh.'}
        </p>
      )}

      {health && level && style && (
        <div className="mt-3 space-y-2.5">
          <div>
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-semibold text-foreground">
                Memory in use: {formatMb(health.rssBytes)} of {formatMb(health.limitBytes)}
              </span>
              <span className={cn('font-bold', style.text)}>
                {level.percent}% · {style.label}
              </span>
            </div>
            <div
              className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-muted"
              role="meter"
              aria-label="Server memory used"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={level.percent}
            >
              <div className={cn('h-full rounded-full transition-all', style.bar)} style={{ width: `${level.percent}%` }} />
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
            <div>
              <dt className="text-muted-foreground">JS heap used</dt>
              <dd className="font-bold text-foreground">
                {formatMb(health.heapUsedBytes)} / {formatMb(health.heapTotalBytes)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Other (buffers)</dt>
              <dd className="font-bold text-foreground">{formatMb(health.externalBytes)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Running for</dt>
              <dd className="font-bold text-foreground">{formatUptime(health.uptimeSeconds)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Measured</dt>
              <dd className="font-bold text-foreground">
                {formatIstTime(health.measuredAt)} · Node {health.nodeVersion}
              </dd>
            </div>
          </dl>
        </div>
      )}
    </section>
  );
}
