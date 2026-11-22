'use client'

import { AlertTriangle, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * BUG-04: shown on a finalized invoice when its payments or credit notes could not be loaded (for example a cold
 * database timing out). Without it the page showed "no payments" with the full amount due, and the payment form
 * pre-filled the whole total, so a shop could think a payment had vanished.
 */
export function HistoryLoadNotice() {
  return (
    <div
      role="alert"
      className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3 py-3 shadow-sm space-y-2"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="size-[18px] shrink-0 text-amber-700 dark:text-amber-400 mt-0.5" />
        <div className="space-y-0.5">
          <p className="text-[13px] font-bold text-foreground">Couldn&apos;t load payments and credit notes</p>
          <p className="text-[13px] text-muted-foreground">
            The amount due can&apos;t be shown right now, so recording a payment is paused. Nothing has been lost. Reload
            the page to try again.
          </p>
        </div>
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => window.location.reload()}
        className="text-[13px] font-semibold"
      >
        <RotateCcw className="size-4 shrink-0" /> Reload page
      </Button>
    </div>
  )
}
