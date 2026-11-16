'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Dialog } from '@base-ui/react/dialog';
import {
  Crown,
  Sparkles,
  X,
  CheckCircle2,
  ArrowRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useIsOwner } from '@/components/app/current-user-role';
import { useIsClient } from '@/lib/hooks/use-is-client';
import { PLAN_CATALOG, formatPlanPrice } from '@/lib/subscriptions/plan-catalog';

const ESSENTIALS_MONTHLY = formatPlanPrice('essentials', 'monthly');
const ESSENTIALS_YEARLY = formatPlanPrice('essentials', 'yearly');
const PROFESSIONAL_MONTHLY = formatPlanPrice('professional', 'monthly');
const PROFESSIONAL_YEARLY = formatPlanPrice('professional', 'yearly');

export interface UpgradePromptModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description: string;
  featureName?: string;
  recommendedPlan?: 'essentials' | 'professional';
  highlights?: string[];
  ctaText?: string;
}

export function UpgradePromptModal({
  isOpen,
  onClose,
  title,
  description,
  featureName,
}: UpgradePromptModalProps) {
  const isClient = useIsClient();
  const isOwner = useIsOwner();
  const [selectedPlan] = useState<'essentials'>('essentials');

  if (!isClient) return null;

  const activeFeatures = PLAN_CATALOG.essentials.features;

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200" />
        <Dialog.Viewport className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
          <Dialog.Popup className="relative w-full max-w-lg sm:max-w-[480px] rounded-2xl border border-indigo-100 bg-white shadow-2xl overflow-hidden max-h-[92dvh] overflow-y-auto animate-in zoom-in-95 duration-200">
            {/* Top Gradient Banner */}
            <div className="relative overflow-hidden bg-gradient-to-br from-indigo-600 via-indigo-700 to-violet-800 p-4 sm:px-5 sm:py-4.5 text-white">
              <div className="absolute -top-12 -right-12 size-36 rounded-full bg-white/10 blur-xl pointer-events-none" />
              <div className="absolute -bottom-10 -left-10 size-32 rounded-full bg-violet-400/20 blur-xl pointer-events-none" />

              {/* Close button with elevated z-index */}
              <Dialog.Close
                render={
                  <button
                    type="button"
                    className="absolute top-4 right-4 z-10 flex size-8 items-center justify-center rounded-full bg-white/10 text-white/80 hover:bg-white/20 hover:text-white transition-all cursor-pointer"
                    aria-label="Close modal"
                  >
                    <X className="size-4" />
                  </button>
                }
              />

              {/* Feature Badge with right clearance to prevent collision with (X) button */}
              <div className="flex items-center gap-2 mb-2 pr-10">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 backdrop-blur-md px-3 py-1 text-xs font-bold text-amber-300 border border-white/10 max-w-full">
                  <Crown className="size-3.5 shrink-0" />
                  <span className="truncate sm:whitespace-normal">
                    {featureName ? `${featureName} is a Pro Feature` : 'Upgrade Required'}
                  </span>
                </span>
              </div>

              <Dialog.Title
                render={
                  <h3 className="text-xl sm:text-2xl font-black tracking-tight font-heading pr-8 sm:pr-0">
                    {title}
                  </h3>
                }
              />

              <Dialog.Description
                render={
                  <p className="mt-1.5 text-xs sm:text-sm text-indigo-100/90 leading-relaxed pr-6 sm:pr-0">
                    {description}
                  </p>
                }
              />
            </div>

            {/* Modal Body */}
            <div className="p-4 sm:px-3.5 sm:py-4 space-y-3">
              {/* Dual Tier Plan Comparison Cards */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-slate-600">
                    Available Plans:
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {/* Card 1: Essentials Pro Plan */}
                  <div
                    className="relative rounded-xl border px-2.5 py-1.5 sm:px-2.5 sm:py-2 select-none text-left border-indigo-600 bg-indigo-50/70 ring-2 ring-indigo-600/30 shadow-xs"
                  >
                    <div className="flex items-center gap-[7px] mb-1">
                      <span className="text-xs sm:text-[12.5px] font-black tracking-tight text-slate-900 uppercase font-heading">
                        {PLAN_CATALOG.essentials.name}
                      </span>
                      <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.2 text-[9.5px] sm:text-[10px] font-black text-amber-800 shrink-0">
                        <Crown className="size-2.5 text-amber-700" />
                        Popular
                      </span>
                    </div>

                    <div className="flex items-center border-t border-slate-200/70 pt-1 mb-0.5">
                      <div className="flex items-baseline gap-0.5">
                        <span className="text-[15px] sm:text-base font-black text-slate-950 font-heading">{ESSENTIALS_MONTHLY.headline}</span>
                        <span className="text-[10.5px] sm:text-[11px] font-semibold text-slate-600">/month</span>
                      </div>
                      <span aria-hidden="true" className="text-slate-300 mx-[5px] text-xs font-light select-none">|</span>
                      <div className="flex items-baseline gap-0.5">
                        <span className="text-[15px] sm:text-base font-black text-slate-950 font-heading">{ESSENTIALS_YEARLY.yearlyTotal}</span>
                        <span className="text-[10.5px] sm:text-[11px] font-semibold text-slate-600">/year</span>
                      </div>
                    </div>

                    <div className="text-[10.5px] sm:text-[11px] font-bold text-emerald-700">
                      Save {ESSENTIALS_YEARLY.savingsPercent}% on Annual ({ESSENTIALS_YEARLY.headline}/mo)
                    </div>
                  </div>

                  {/* Card 2: Professional (Disabled / Coming Soon) */}
                  <div
                    aria-disabled="true"
                    className="relative rounded-xl border border-dashed px-2.5 py-1.5 sm:px-2.5 sm:py-2 select-none text-left border-slate-300 bg-slate-50 cursor-not-allowed"
                  >
                    <div className="flex items-center gap-[7px] mb-1">
                      <span className="text-xs sm:text-[12.5px] font-black tracking-tight text-slate-700 uppercase font-heading">
                        {PLAN_CATALOG.professional.name}
                      </span>
                      <span className="inline-flex items-center gap-0.5 rounded-full bg-slate-200 border border-slate-300 px-1.5 py-0.2 text-[9.5px] sm:text-[10px] font-black text-slate-700 shrink-0">
                        Coming soon
                      </span>
                    </div>

                    <div className="flex items-center border-t border-slate-200/70 pt-1 mb-0.5">
                      <div className="flex items-baseline gap-0.5">
                        <span className="text-[15px] sm:text-base font-black text-slate-700 font-heading">{PROFESSIONAL_MONTHLY.headline}</span>
                        <span className="text-[10.5px] sm:text-[11px] font-semibold text-slate-600">/month</span>
                      </div>
                      <span aria-hidden="true" className="text-slate-300 mx-[5px] text-xs font-light select-none">|</span>
                      <div className="flex items-baseline gap-0.5">
                        <span className="text-[15px] sm:text-base font-black text-slate-700 font-heading">{PROFESSIONAL_YEARLY.yearlyTotal}</span>
                        <span className="text-[10.5px] sm:text-[11px] font-semibold text-slate-600">/year</span>
                      </div>
                    </div>

                    <div className="text-[10.5px] sm:text-[11px] font-bold text-slate-600">
                      Save {PROFESSIONAL_YEARLY.savingsPercent}% on Annual ({PROFESSIONAL_YEARLY.headline}/mo)
                    </div>
                  </div>
                </div>
              </div>

              {/* Dynamic Feature Highlights from PLAN_CATALOG */}
              <div className="space-y-1.5 pt-0.5">
                <p className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-slate-600">
                  What you unlock with Essentials Pro:
                </p>
                <ul className="space-y-1.5">
                  {activeFeatures.map((feat, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-xs sm:text-[13px] text-slate-700 font-medium">
                      {feat.status === 'included' ? (
                        <>
                          <CheckCircle2 className="size-3.5 sm:size-4 shrink-0 mt-0.5 text-emerald-700" />
                          <span>{feat.label}</span>
                        </>
                      ) : (
                        <div className="flex items-center gap-1.5 text-slate-600">
                          <span className="text-[9.5px] uppercase font-bold tracking-wider bg-slate-100 text-slate-700 border border-slate-200 px-1.5 py-0.2 rounded-full shrink-0">
                            Coming soon
                          </span>
                          <span>{feat.label}</span>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Action CTAs */}
              <div className="pt-1.5 flex flex-col sm:flex-row gap-2">
                {isOwner ? (
                  <Link
                    href={`/checkout?plan=${selectedPlan}`}
                    className="flex-1 min-w-0"
                    onClick={onClose}
                  >
                    <Button
                      className="w-full h-10 gap-2 text-white font-bold text-xs sm:text-[13px] shadow-md cursor-pointer rounded-xl transition-all px-3 bg-gradient-to-r from-indigo-600 via-indigo-700 to-violet-700 hover:from-indigo-500 hover:to-violet-600"
                    >
                      <Sparkles className="size-3.5 sm:size-4 text-amber-300 shrink-0" />
                      <span className="truncate">
                        Upgrade to {PLAN_CATALOG.essentials.name} ({ESSENTIALS_MONTHLY.headline}/mo)
                      </span>
                      <ArrowRight className="size-3.5 sm:size-4 shrink-0" />
                    </Button>
                  </Link>
                ) : (
                  <p className="flex-1 min-w-0 flex items-center text-xs sm:text-sm font-medium text-muted-foreground px-1">
                    Ask your business owner to upgrade the plan.
                  </p>
                )}

                <Button
                  type="button"
                  variant="outline"
                  onClick={onClose}
                  className="h-10 px-3 border-slate-300 text-slate-700 hover:bg-slate-100 font-bold text-xs sm:text-sm rounded-xl cursor-pointer shrink-0"
                >
                  Maybe Later
                </Button>
              </div>
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
