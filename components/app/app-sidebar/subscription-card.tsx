'use client'

import Link from 'next/link'
import { Crown, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useIsOwner } from '@/components/app/current-user-role'

export interface SubscriptionCardProps {
  subscription?: {
    plan: string
    status: string
    endsAt: string | null
  } | null
  daysRemaining: number | null
  isCollapsed: boolean
  onCardNavigate?: () => void
  isOwner?: boolean
}

export function SubscriptionCard({
  subscription,
  daysRemaining,
  isCollapsed,
  onCardNavigate,
  isOwner: isOwnerProp,
}: SubscriptionCardProps) {
  const contextIsOwner = useIsOwner();
  const isOwner = isOwnerProp ?? contextIsOwner;

  return subscription?.status === 'active' ? (
    <div
      className={cn(
        'bg-gradient-to-br from-emerald-500/[0.08] via-indigo-500/[0.04] to-transparent border border-emerald-500/20 rounded-2xl relative overflow-hidden group/upgrade transition-all duration-300 shadow-2xs',
        isCollapsed
          ? 'opacity-0 max-h-0 m-0 border-0 p-0 overflow-hidden pointer-events-none'
          : 'opacity-100 max-h-56 p-2.5 mt-3.5',
      )}
    >
      <div className="absolute -top-6 -right-6 size-16 bg-emerald-500/15 rounded-full blur-xl pointer-events-none transition-all duration-300 group-hover/upgrade:scale-150" />
      <div className="flex items-center justify-between mb-1.5">
        <span className="inline-flex items-center gap-1.5 text-[10px] font-extrabold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">
          <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Active Plan
        </span>
        <span className="text-[9.5px] font-bold capitalize text-foreground bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
          {subscription.plan}
        </span>
      </div>
      <p className="text-[9.5px] text-muted-foreground leading-relaxed mb-2">
        {daysRemaining !== null
          ? `${daysRemaining} days remaining in billing cycle.`
          : 'Unlimited GST invoices & premium suite unlocked.'}
      </p>
      <Link href="/settings?tab=Billing & Usage" onClick={onCardNavigate} className="block w-full">
        <Button
          className="w-full text-[10.5px] font-bold h-7 bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-xs hover:shadow-md hover:translate-y-[-1px] active:translate-y-px transition-all cursor-pointer rounded-xl"
          variant="default"
          size="sm"
        >
          Manage Subscription
        </Button>
      </Link>
    </div>
  ) : (
    <div
      className={cn(
        'bg-gradient-to-br from-indigo-500/[0.08] via-purple-500/[0.04] to-transparent border border-indigo-500/20 rounded-2xl relative overflow-hidden group/upgrade transition-all duration-300 shadow-2xs',
        isCollapsed
          ? 'opacity-0 max-h-0 m-0 border-0 p-0 overflow-hidden pointer-events-none'
          : 'opacity-100 max-h-60 p-2.5 mt-3.5',
      )}
    >
      <div className="absolute -top-8 -right-8 size-20 bg-purple-500/20 rounded-full blur-xl pointer-events-none transition-all duration-300 group-hover/upgrade:scale-150" />

      {/* Header row with crown and miniature illustration */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <div className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-xs">
            <Crown className="size-3" strokeWidth={2.5} />
          </div>
          <span className="text-[9.5px] font-extrabold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
            Upgrade to Pro
          </span>
        </div>

        {/* Decorative Mini Invoice Document */}
        <div className="relative shrink-0 flex items-center justify-center size-7.5 bg-white/95 dark:bg-slate-800/95 rounded-lg border border-indigo-200/80 dark:border-indigo-800/60 shadow-xs p-1">
          <div className="w-full space-y-0.5">
            <div className="h-0.5 w-3/4 rounded-full bg-indigo-500" />
            <div className="h-0.5 w-full rounded-full bg-slate-300 dark:bg-slate-600" />
            <div className="h-0.5 w-1/2 rounded-full bg-slate-300 dark:bg-slate-600" />
          </div>
          <span className="absolute -bottom-1 -right-1 flex size-3 items-center justify-center rounded-full bg-emerald-500 text-[7px] font-bold text-white shadow-xs border border-white">
            ✓
          </span>
        </div>
      </div>

      <p className="text-[10px] font-medium text-slate-600 dark:text-slate-300 leading-snug mb-2.5">
        Unlock unlimited invoices, all templates and WhatsApp sharing.
      </p>

      {isOwner ? (
        <Link href="/checkout" onClick={onCardNavigate} className="block w-full">
          <Button
            className="w-full text-[10.5px] font-bold h-7 bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 text-white shadow-xs hover:shadow-md hover:translate-y-[-1px] active:translate-y-px transition-all cursor-pointer rounded-xl flex items-center justify-center gap-1.5 group/btn"
            variant="default"
            size="sm"
          >
            <span>Upgrade Now</span>
            <ArrowRight className="size-3 transition-transform group-hover/btn:translate-x-0.5" />
          </Button>
        </Link>
      ) : (
        <p className="text-[10px] font-semibold text-slate-600 dark:text-slate-300 leading-snug py-1">
          Ask your business owner to upgrade the plan.
        </p>
      )}
    </div>
  )
}

