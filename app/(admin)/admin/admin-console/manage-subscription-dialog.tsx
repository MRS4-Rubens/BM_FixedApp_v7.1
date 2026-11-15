'use client';

import { Dialog } from '@base-ui/react/dialog';
import {
  Building2,
  X,
  Settings,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { isOneOf } from '@/lib/db/domain-values';
import { OVERRIDE_STATUSES, type OverrideStatus } from '@/lib/validations/admin-subscription';
import { HistoricalClaimsSection } from './historical-claims-section';
import type { BusinessItem, BizHistoryRow } from './types';

interface ManageSubscriptionDialogProps {
  selectedBiz: BusinessItem | null;
  onClose: () => void;
  isPending: boolean;
  bizHistory: BizHistoryRow[];
  bizHistoryPage: number;
  loadingHistory: boolean;
  overridePlan: string;
  overrideStatus: OverrideStatus;
  overrideEndsAt: string;
  overrideError: string | null;
  isSaveDisabled?: boolean;
  onChangePlan: (plan: string) => void;
  onChangeStatus: (status: OverrideStatus) => void;
  onChangeEndsAt: (date: string) => void;
  onSetPresetDate: (months: number) => void;
  onSetGracePeriod?: () => void;
  onSaveOverride: () => void;
  onSetBizHistoryPage: (page: number | ((p: number) => number)) => void;
  onViewProof?: (requestId: string, businessName: string, utr: string) => void;
  onCopy?: (text: string, key: string) => void;
  copiedKey?: string | null;
}

export function ManageSubscriptionDialog({
  selectedBiz,
  onClose,
  isPending,
  bizHistory,
  bizHistoryPage,
  loadingHistory,
  overridePlan,
  overrideStatus,
  overrideEndsAt,
  overrideError,
  isSaveDisabled = false,
  onChangePlan,
  onChangeStatus,
  onChangeEndsAt,
  onSetPresetDate,
  onSetGracePeriod,
  onSaveOverride,
  onSetBizHistoryPage,
  onViewProof,
  onCopy,
  copiedKey = null,
}: ManageSubscriptionDialogProps) {
  const isDateMissing =
    (overrideStatus === 'active' || overrideStatus === 'trial') &&
    (!overrideEndsAt || overrideEndsAt.trim() === '');

  return (
    <Dialog.Root
      open={!!selectedBiz}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      {selectedBiz && (
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs animate-in fade-in duration-200" />
          <Dialog.Viewport className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
            <Dialog.Popup className="w-full max-w-2xl rounded-xl border border-border bg-card p-4 sm:p-5 shadow-2xl relative animate-in fade-in zoom-in duration-200 max-h-[92vh] overflow-y-auto">
              <Dialog.Close
                render={
                  <button
                    type="button"
                    aria-label="Close modal"
                    className="absolute top-4 right-4 text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    <X className="size-5" />
                  </button>
                }
              />

              <Dialog.Title
                render={
                  <h3 className="text-lg font-bold text-foreground font-heading border-b border-border/40 pb-2.5 flex items-center gap-2">
                    <Building2 className="size-5 text-indigo-600" />
                    Manage Subscription: {selectedBiz.legalName}
                  </h3>
                }
              />
              <Dialog.Description
                render={
                  <p className="sr-only">
                    Manual subscription override and historical claims ledger for {selectedBiz.legalName}
                  </p>
                }
              />

              {/* SECTION 1: Subscription override inputs */}
              <div className="mt-3 rounded-xl border border-indigo-500/20 bg-indigo-500/5 px-3.5 py-3 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h4 className="text-sm font-bold text-indigo-700 dark:text-indigo-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Settings className="size-4" /> Manual Subscription Override
                  </h4>
                  <span className="text-xs font-semibold text-muted-foreground">
                    GSTIN: <span className="font-mono text-foreground font-bold">{selectedBiz.gstin || 'Unregistered'}</span>
                  </span>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-muted-foreground uppercase">
                      Plan Tier
                    </label>
                    <select
                      value={overridePlan}
                      onChange={(e) => onChangePlan(e.target.value)}
                      className="h-9 w-full rounded-lg border border-border bg-background text-sm font-semibold px-2.5 outline-none focus:border-indigo-500"
                    >
                      <option value="trial">Trial</option>
                      <option value="free">Free</option>
                      <option value="essentials">Essentials</option>
                      <option value="professional">Professional</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-muted-foreground uppercase">
                      Lifecycle Status
                    </label>
                    <select
                      value={overrideStatus}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (isOneOf(OVERRIDE_STATUSES, v)) onChangeStatus(v);
                      }}
                      className="h-9 w-full rounded-lg border border-border bg-background text-sm font-semibold px-2.5 outline-none focus:border-indigo-500"
                    >
                      <option value="trial">Trial</option>
                      <option value="active">Active</option>
                      <option value="expired">Expired</option>
                      <option value="suspended">Suspended</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-muted-foreground uppercase">
                      Expiry Date {isDateMissing && <span className="text-destructive">*</span>}
                    </label>
                    <input
                      type="date"
                      required={overrideStatus === 'active' || overrideStatus === 'trial'}
                      value={overrideEndsAt}
                      onChange={(e) => onChangeEndsAt(e.target.value)}
                      className={cn(
                        "h-9 w-full rounded-lg border bg-background text-sm font-semibold px-2.5 outline-none transition",
                        isDateMissing
                          ? "border-amber-500/80 focus:border-amber-600 bg-amber-500/5"
                          : "border-border focus:border-indigo-500"
                      )}
                    />
                  </div>
                </div>

                {/* Validation hint if date is missing */}
                {isDateMissing && (
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-800 dark:text-amber-400">
                    <AlertCircle className="size-3.5 shrink-0" />
                    <span>Please choose a future date or select a quick preset below to save an active/trial override.</span>
                  </div>
                )}

                {overrideError && (
                  <p role="alert" className="mt-1 text-xs text-destructive font-medium">
                    {overrideError}
                  </p>
                )}

                {/* Quick Expiry Presets & Save Action Single-Line Lockup */}
                <div className="flex items-center justify-between gap-2 pt-1 border-t border-indigo-500/10 flex-wrap sm:flex-nowrap">
                  <div className="flex items-center gap-1.5 flex-nowrap shrink-0 overflow-x-auto">
                    <span className="text-xs font-bold text-muted-foreground mr-0.5 whitespace-nowrap">
                      Quick Expiry:
                    </span>

                    {/* Pattern 4: +48 Hrs Outage Grace Button */}
                    <button
                      type="button"
                      onClick={() => onSetGracePeriod?.()}
                      className="rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 text-xs font-bold border border-emerald-500/30 hover:bg-emerald-500/20 transition cursor-pointer whitespace-nowrap"
                      title="Adds 48 hours on top of the current expiry (or from now if already expired)"
                    >
                      +48 Hrs (Grace)
                    </button>

                    {[
                      { label: '+30 Days', months: 1 },
                      { label: '+1 Year', months: 12 },
                    ].map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => onSetPresetDate(preset.months)}
                        className="rounded bg-background px-2 py-0.5 text-xs font-bold text-muted-foreground border border-border/80 hover:text-indigo-600 transition cursor-pointer whitespace-nowrap"
                      >
                        {preset.label}
                      </button>
                    ))}

                    <button
                      type="button"
                      onClick={() => onChangeEndsAt('')}
                      className="rounded bg-background px-2 py-0.5 text-xs font-bold text-rose-600 border border-border/80 hover:bg-rose-50 transition cursor-pointer whitespace-nowrap"
                    >
                      Clear Date
                    </button>
                  </div>

                  <Button
                    disabled={isPending || isSaveDisabled}
                    onClick={onSaveOverride}
                    className="h-8 px-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-45 text-white text-xs font-bold cursor-pointer shrink-0 whitespace-nowrap"
                  >
                    {isPending ? <Loader2 className="size-3.5 animate-spin" /> : 'Save Subscription Changes'}
                  </Button>
                </div>
              </div>

              {/* SECTION 2: Historical Claims Table (5 columns) */}
              <HistoricalClaimsSection
                bizHistory={bizHistory}
                bizHistoryPage={bizHistoryPage}
                loadingHistory={loadingHistory}
                businessName={selectedBiz.legalName}
                copiedKey={copiedKey}
                onCopy={onCopy}
                onSetBizHistoryPage={onSetBizHistoryPage}
                onViewProof={onViewProof}
              />
            </Dialog.Popup>
          </Dialog.Viewport>
        </Dialog.Portal>
      )}
    </Dialog.Root>
  );
}
