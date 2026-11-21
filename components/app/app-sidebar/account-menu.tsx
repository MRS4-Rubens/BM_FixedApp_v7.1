'use client'

import Link from 'next/link'
import { ArrowRight, CreditCard, Crown, LogOut, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'
import { roleLabel } from '@/components/app/current-user-role'
import type { AccountPlanDisplay } from './account-plan'

interface AccountUser {
  name: string
  role: string
  initials: string
}

export function AccountAvatar({
  user,
  businessLogoUrl,
  className,
}: {
  user?: AccountUser
  businessLogoUrl?: string
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full bg-gradient-to-tr from-amber-400 via-rose-400 to-violet-500 font-bold text-white shadow-sm overflow-hidden border border-border/40',
        className,
      )}
    >
      {businessLogoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={businessLogoUrl} alt="Logo" className="size-full object-contain p-0.5 bg-white" />
      ) : (
        user?.initials || 'U'
      )}
    </div>
  )
}

/** Second line of the bottom account pill: plan name, "UPGRADE TO PRO →", or the role. */
export function AccountPillSubline({ display, role }: { display: AccountPlanDisplay; role?: string }) {
  if (display.pill.kind === 'upgrade') {
    return (
      <span className="mt-0.5 inline-flex items-center gap-0.5 text-[10.5px] font-extrabold uppercase tracking-wider bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent dark:from-indigo-400 dark:to-violet-400">
        Upgrade to Pro
        <ArrowRight className="size-3 text-violet-600 dark:text-violet-400" aria-hidden="true" />
      </span>
    )
  }
  if (display.pill.kind === 'plan') {
    return (
      <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
        <Crown className="size-3" aria-hidden="true" />
        {display.pill.label}
      </span>
    )
  }
  if (display.pill.kind === 'suspended') {
    return <span className="mt-0.5 text-[11px] font-semibold text-rose-600 dark:text-rose-400">Account suspended</span>
  }
  return <span className="mt-0.5 text-[11px] font-semibold text-muted-foreground">{roleLabel(role)}</span>
}

const rowCls =
  'flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-foreground/80 hover:text-foreground hover:bg-accent transition-colors'

/** Body of the account menu: who you are, then Settings / Billing / Upgrade, then Sign Out. */
export function AccountMenuBody({
  user,
  businessLogoUrl,
  display,
  onNavigate,
  onSignOut,
}: {
  user?: AccountUser
  businessLogoUrl?: string
  display: AccountPlanDisplay
  onNavigate: () => void
  onSignOut: () => void
}) {
  const { upgrade, statusTag } = display
  return (
    <div>
      <div className="flex items-center gap-2.5 px-2 pt-1.5 pb-2">
        <AccountAvatar user={user} businessLogoUrl={businessLogoUrl} className="size-9 text-xs" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-foreground truncate">{user?.name || 'User'}</p>
          <p className="mt-0.5 text-[11px] font-semibold text-muted-foreground">
            {roleLabel(user?.role)}
            {statusTag && (
              <>
                <span aria-hidden="true"> · </span>
                <span
                  className={cn(
                    statusTag === 'Trial' ? 'text-amber-700 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400',
                  )}
                >
                  {statusTag}
                </span>
              </>
            )}
          </p>
        </div>
      </div>

      <div className="h-px bg-border/60 my-1" />

      <div className="space-y-0.5 py-1">
        <Link href="/settings" onClick={onNavigate} className={rowCls}>
          <Settings className="size-3.5 text-muted-foreground" />
          <span>Account Settings</span>
        </Link>
        <Link href="/settings?tab=Billing & Usage" onClick={onNavigate} className={rowCls}>
          <CreditCard className="size-3.5 text-muted-foreground" />
          <span>Billing & Plan</span>
        </Link>
        <UpgradeRow upgrade={upgrade} onNavigate={onNavigate} />
      </div>

      <div className="h-px bg-border/60 my-1" />

      <button
        type="button"
        onClick={onSignOut}
        className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 w-full text-left transition-colors cursor-pointer group"
      >
        <LogOut className="size-3.5 transition-transform group-hover:translate-x-0.5" />
        <span>Sign Out</span>
      </button>
    </div>
  )
}

function CrownChip({ muted }: { muted?: boolean }) {
  return (
    <span
      className={cn(
        'flex size-5 shrink-0 items-center justify-center rounded-md text-white shadow-xs',
        muted ? 'bg-slate-400 dark:bg-slate-600' : 'bg-gradient-to-br from-indigo-500 to-violet-600',
      )}
    >
      <Crown className="size-3" strokeWidth={2.5} aria-hidden="true" />
    </span>
  )
}

const upgradeTextCls = 'text-[10.5px] font-extrabold uppercase tracking-wider'

function UpgradeRow({ upgrade, onNavigate }: { upgrade: AccountPlanDisplay['upgrade']; onNavigate: () => void }) {
  if (upgrade.kind === 'hidden') return null
  if (upgrade.kind === 'link') {
    return (
      <Link href={upgrade.href} onClick={onNavigate} className={cn(rowCls, 'gap-2 hover:bg-indigo-500/10')}>
        <CrownChip />
        <span className={cn(upgradeTextCls, 'text-indigo-600 dark:text-indigo-400')}>{upgrade.label}</span>
      </Link>
    )
  }
  if (upgrade.kind === 'muted') {
    return (
      <span
        role="link"
        aria-disabled="true"
        title={upgrade.reason}
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg opacity-60 cursor-not-allowed select-none"
      >
        <CrownChip muted />
        <span className={cn(upgradeTextCls, 'text-muted-foreground')}>{upgrade.label}</span>
      </span>
    )
  }
  return (
    <div className="flex items-start gap-2 px-2.5 py-1.5">
      <CrownChip muted />
      <span className="text-[11px] font-semibold leading-snug text-muted-foreground">
        Ask your business owner to upgrade the plan.
      </span>
    </div>
  )
}
