'use client';

import { useRouter } from 'next/navigation';
import { Dialog } from '@base-ui/react/dialog';
import { Building2, X, Settings, History, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatPaiseAsInr } from '@/lib/money';
import { formatIstDate } from '@/lib/invoices/ist-date';
import { cn } from '@/lib/utils';
import { isOneOf } from '@/lib/db/domain-values';
import { OVERRIDE_STATUSES, type OverrideStatus } from '@/lib/validations/admin-subscription';
import { BusinessIdentityDialog } from '../business-identity-dialog';
import type { BusinessItem, BizHistoryRow } from './types';

interface ManageSubscriptionDialogProps {
  selectedBiz: BusinessItem | null;
  onClose: () => void;
  isPending: boolean;
  identityDialogOpen: boolean;
  onOpenIdentityDialog: (open: boolean) => void;
  bizHistory: BizHistoryRow[];
  bizHistoryPage: number;
  loadingHistory: boolean;
  overridePlan: string;
  overrideStatus: OverrideStatus;
  overrideEndsAt: string;
  overrideError: string | null;
  onChangePlan: (plan: string) => void;
  onChangeStatus: (status: OverrideStatus) => void;
  onChangeEndsAt: (date: string) => void;
  onSetPresetDate: (months: number) => void;
  onSaveOverride: () => void;
  onSetBizHistoryPage: (page: number | ((p: number) => number)) => void;
}

export function ManageSubscriptionDialog({
  selectedBiz,
  onClose,
  isPending,
  identityDialogOpen,
  onOpenIdentityDialog,
  bizHistory,
  bizHistoryPage,
  loadingHistory,
  overridePlan,
  overrideStatus,
  overrideEndsAt,
  overrideError,
  onChangePlan,
  onChangeStatus,
  onChangeEndsAt,
  onSetPresetDate,
  onSaveOverride,
  onSetBizHistoryPage,
}: ManageSubscriptionDialogProps) {
  const router = useRouter();

  return (
    <Dialog.Root
      open={!!selectedBiz}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {selectedBiz && (
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs animate-in fade-in duration-200" />
          <Dialog.Viewport className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto">
            <Dialog.Popup className="w-full max-w-2xl rounded-xl border border-border bg-card p-4.5 sm:p-5 shadow-xl relative animate-in fade-in zoom-in duration-200 max-h-[92vh] overflow-y-auto">
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
                  <h3 className="text-lg font-bold text-foreground font-heading border-b border-border/40 pb-2 flex items-center gap-2">
                    <Building2 className="size-5 text-indigo-600" />
                    Manage Subscription: {selectedBiz.legalName}
                  </h3>
                }
              />
              <Dialog.Description
                render={
                  <p className="sr-only">
                    Manual subscription override and historical ledger for {selectedBiz.legalName}
                  </p>
                }
              />

              {/* Subscription override inputs */}
              <div className="mt-2.5 rounded-xl border border-indigo-500/20 bg-indigo-500/5 px-3.5 py-3 space-y-2.5">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-indigo-700 dark:text-indigo-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Settings className="size-4" /> Manual Subscription Override
                  </h4>
                  <span className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                    <span>GSTIN: {selectedBiz.gstin}</span>
                    <button
                      type="button"
                      onClick={() => onOpenIdentityDialog(true)}
                      className="rounded-md border border-indigo-300 bg-white px-2 py-0.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 cursor-pointer"
                    >
                      Correct GSTIN / state
                    </button>
                  </span>
                </div>

                <BusinessIdentityDialog
                  business={{
                    id: selectedBiz.id,
                    legalName: selectedBiz.legalName,
                    gstin: selectedBiz.gstin,
                    stateCode: selectedBiz.stateCode,
                  }}
                  open={identityDialogOpen}
                  onOpenChange={onOpenIdentityDialog}
                  onSaved={() => {
                    onOpenIdentityDialog(false);
                    onClose();
                    router.refresh();
                  }}
                />

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
                      Expiry Date
                    </label>
                    <input
                      type="date"
                      value={overrideEndsAt}
                      onChange={(e) => onChangeEndsAt(e.target.value)}
                      className="h-9 w-full rounded-lg border border-border bg-background text-sm font-semibold px-2.5 outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>

                {overrideError && (
                  <p role="alert" className="mt-1 text-xs text-destructive font-medium">
                    {overrideError}
                  </p>
                )}

                {/* Quick Expiry Presets & Save Action Single-Line Lockup */}
                <div className="flex items-center justify-between gap-2 pt-1 border-t border-indigo-500/10">
                  <div className="flex items-center gap-1.5 flex-wrap sm:flex-nowrap">
                    <span className="text-xs font-bold text-muted-foreground mr-0.5 whitespace-nowrap">Quick Expiry:</span>
                    {[
                      { label: '+30 Days', months: 1 },
                      { label: '+90 Days', months: 3 },
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
                    disabled={isPending}
                    onClick={onSaveOverride}
                    className="h-8 px-3.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold cursor-pointer shrink-0 whitespace-nowrap"
                  >
                    {isPending ? <Loader2 className="size-3.5 animate-spin" /> : 'Save Subscription Changes'}
                  </Button>
                </div>
              </div>

              {/* Historical transaction ledger */}
              <div className="mt-3 space-y-2">
                <h4 className="text-sm font-bold text-foreground uppercase tracking-wider flex items-center gap-1.5 border-b border-border/40 pb-1.5">
                  <History className="size-4 text-muted-foreground" /> Historical Subscription Claims
                </h4>

                {loadingHistory ? (
                  <div className="flex justify-center py-6">
                    <Loader2 className="size-5 animate-spin text-indigo-600" />
                  </div>
                ) : bizHistory.length === 0 ? (
                  <div className="py-6 text-center text-sm text-muted-foreground font-semibold">
                    No previous subscription claim records for this business.
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="rounded-lg border border-border overflow-hidden">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="bg-muted/40 border-b border-border font-bold text-muted-foreground text-xs">
                            <th className="px-3 py-2">Date</th>
                            <th className="px-3 py-2">Reference / UTR</th>
                            <th className="px-3 py-2">Plan</th>
                            <th className="px-3 py-2">Amount</th>
                            <th className="px-3 py-2">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/30">
                          {bizHistory
                            .slice((bizHistoryPage - 1) * 3, bizHistoryPage * 3)
                            .map((item) => (
                              <tr key={item.id} className="hover:bg-muted/10">
                                <td className="px-3 py-2 font-semibold">
                                  {formatIstDate(item.createdAt)}
                                </td>
                                <td className="px-3 py-2 font-mono text-xs font-bold text-indigo-600">
                                  {item.paymentReference}
                                </td>
                                <td className="px-3 py-2 capitalize font-semibold">
                                  {item.planName} ({item.billingCycle.replace('_', ' ')})
                                </td>
                                <td className="px-3 py-2 font-semibold">{formatPaiseAsInr(item.amountPaise)}</td>
                                <td className="px-3 py-2 font-bold capitalize">
                                  <span
                                    className={cn(
                                      item.status === 'approved' && 'text-emerald-700',
                                      item.status === 'pending' && 'text-amber-800',
                                      item.status === 'rejected' && 'text-rose-700'
                                    )}
                                  >
                                    {item.status}
                                  </span>
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Pagination Controls for Claims */}
                    {bizHistory.length > 0 && (
                      <div className="flex items-center justify-between gap-2 pt-0.5 px-0.5 text-xs">
                        <span className="text-muted-foreground font-medium">
                          Showing {(bizHistoryPage - 1) * 3 + 1} to{' '}
                          {Math.min(bizHistoryPage * 3, bizHistory.length)} of {bizHistory.length} claims
                        </span>

                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-muted-foreground mr-1.5">
                            Page {bizHistoryPage} of {Math.max(1, Math.ceil(bizHistory.length / 3))}
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onSetBizHistoryPage((p) => Math.max(1, p - 1))}
                            disabled={bizHistoryPage === 1}
                            className="h-6.5 px-2 text-xs font-semibold cursor-pointer border-border disabled:opacity-40"
                          >
                            <ChevronLeft className="size-3 mr-0.5" />
                            Previous
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              onSetBizHistoryPage((p) =>
                                Math.min(Math.max(1, Math.ceil(bizHistory.length / 3)), p + 1)
                              )
                            }
                            disabled={bizHistoryPage >= Math.max(1, Math.ceil(bizHistory.length / 3))}
                            className="h-6.5 px-2 text-xs font-semibold cursor-pointer border-border disabled:opacity-40"
                          >
                            Next
                            <ChevronRight className="size-3 ml-0.5" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </Dialog.Popup>
          </Dialog.Viewport>
        </Dialog.Portal>
      )}
    </Dialog.Root>
  );
}

