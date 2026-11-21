'use client';

import { useState } from 'react';
import {
  Building2,
  FileSpreadsheet,
  Users,
  CreditCard,
  MessageSquarePlus,
  Bell,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { BusinessProfileForm } from './business-profile-form';
import { InvoiceSettingsForm } from './invoice-settings-form';
import { BillingTab, type SubscriptionHistoryItem } from './billing-tab';
import { LogoUploadCard } from './logo-upload-card';
import { UserFeedbackForm } from './user-feedback-form';
import { AccountDataSection } from './account-data-section';
import { TeamTab } from './team-tab/team-tab';
import { NotificationsTab } from './notifications-tab/notifications-tab';
import { useCurrentUserRole } from '@/components/app/current-user-role';
import type { businesses } from '@/lib/db/schema';
import type { AppRole } from '@/lib/auth/rbac';

interface SettingsClientProps {
  business: typeof businesses.$inferSelect | null;
  currentFyLabel: string;
  initialTab?: string;
  initialSubscriptions?: SubscriptionHistoryItem[];
  usageStats?: {
    invoicesThisMonth: number;
    invoicesTotal: number;
    teamMembersCount: number;
    customersCount: number;
    productsCount: number;
    currentMonthLabel: string;
  };
  identityLocked?: boolean;
  /** Request render time from the server page, forwarded to BillingTab. */
  nowMs: number;
  userRole?: AppRole;
  signatureDataUri?: string | null;
}

const navItems = [
  'Business Profile',
  'Invoice Settings',
  'Users & Roles',
  'Billing & Usage',
  'User Feedback',
  'Notifications',
  'General',
] as const;

type NavItem = (typeof navItems)[number];

const STAFF_HIDDEN_TABS: readonly NavItem[] = ['Users & Roles', 'Billing & Usage', 'General'];

const NAV_ICONS: Record<NavItem, LucideIcon> = {
  'Business Profile': Building2,
  'Invoice Settings': FileSpreadsheet,
  'Users & Roles': Users,
  'Billing & Usage': CreditCard,
  'User Feedback': MessageSquarePlus,
  Notifications: Bell,
  General: SlidersHorizontal,
};

export function SettingsClient({
  business,
  currentFyLabel,
  initialTab,
  initialSubscriptions,
  usageStats,
  identityLocked = false,
  nowMs,
  userRole,
  signatureDataUri,
}: SettingsClientProps) {
  const contextRole = useCurrentUserRole();
  const effectiveRole = userRole ?? contextRole;
  const isOwner = effectiveRole === 'owner';

  const resolveInitialTab = (): NavItem => {
    let resolved: NavItem = 'Business Profile';
    if (initialTab) {
      const normalized = initialTab.toLowerCase().trim();
      if (
        normalized === 'billing' ||
        normalized === 'billing & usage' ||
        normalized === 'billing and usage' ||
        normalized === 'billing-usage'
      ) {
        resolved = 'Billing & Usage';
      } else if (
        normalized === 'feedback' ||
        normalized === 'user feedback' ||
        normalized === 'user-feedback'
      ) {
        resolved = 'User Feedback';
      } else if (normalized === 'users' || normalized === 'team' || normalized === 'users-roles') {
        resolved = 'Users & Roles';
      } else if (
        normalized === 'invoice' ||
        normalized === 'invoice settings' ||
        normalized === 'invoice-settings'
      ) {
        resolved = 'Invoice Settings';
      } else {
        const match = navItems.find((t) => t.toLowerCase() === normalized);
        if (match) resolved = match;
      }
    }
    if (!isOwner && STAFF_HIDDEN_TABS.includes(resolved)) {
      return 'Business Profile';
    }
    return resolved;
  };

  const [active, setActive] = useState<NavItem>(resolveInitialTab);

  const visibleNavItems = navItems.filter((item) => isOwner || !STAFF_HIDDEN_TABS.includes(item));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1 shrink-0 mb-4">
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground font-heading uppercase">
          SETTINGS
        </h1>
        <p
          className="text-sm font-semibold text-muted-foreground leading-relaxed max-w-[315px] sm:text-justify sm:[text-align-last:justify]"
        >
          Effortlessly Track, Organize, Maintain, and <br />
          Manage Your Business Account Configurations
        </p>
      </div>

      <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-start sm:gap-6">
        {/* -- Mobile Horizontal Tab Bar (< 640px) --------------------------- */}
        <div className="-mx-3 overflow-x-auto px-3 sm:hidden">
          <nav
            aria-label="Settings sections"
            className="flex w-max min-w-full gap-1.5 rounded-lg border border-border bg-card p-1 shadow-xs"
          >
            {visibleNavItems.map((item) => {
              const Icon = NAV_ICONS[item];
              const isActive = active === item;
              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => setActive(item)}
                  className={cn(
                    'flex min-h-[40px] items-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors cursor-pointer',
                    isActive
                      ? 'bg-emerald-50/80 font-bold text-emerald-900 shadow-2xs dark:bg-emerald-950/50 dark:text-emerald-300'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                  )}
                >
                  <Icon
                    className={cn(
                      'size-3.5 shrink-0',
                      isActive ? 'text-emerald-800 dark:text-emerald-400' : 'text-muted-foreground'
                    )}
                  />
                  <span>{item}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* -- Settings Navigation Sidebar (Desktop >= 640px) ---------------- */}
        <aside className="hidden w-[168px] shrink-0 sm:block">
          <nav aria-label="Settings sections" className="flex flex-col gap-1">
            {visibleNavItems.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setActive(item)}
                className={cn(
                  'rounded-lg px-3 py-2 text-left text-sm transition-colors cursor-pointer flex items-center justify-between gap-1.5',
                  active === item
                    ? 'bg-emerald-50/80 font-bold text-emerald-900 border-l-2 border-emerald-800 pl-2.5 shadow-xs'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground font-medium'
                )}
              >
                <span>{item}</span>
              </button>
            ))}
          </nav>
        </aside>

        {/* -- Content Panel -------------------------------------------------- */}
        <div className="flex-1 min-w-0">
          {/* -- INVOICE SETTINGS TAB ---------------------------------------- */}
          {active === 'Invoice Settings' && (
            <InvoiceSettingsForm
              business={business}
              currentFyLabel={currentFyLabel}
              signatureDataUri={signatureDataUri}
              isOwner={isOwner}
            />
          )}

          {/* -- BUSINESS PROFILE TAB ----------------------------------------- */}
          {active === 'Business Profile' && (
            <BusinessProfileForm
              business={business}
              currentFyLabel={currentFyLabel}
              onSwitchTab={(tab) => setActive(tab as NavItem)}
              identityLocked={identityLocked}
              readOnly={!isOwner}
            />
          )}

          {/* -- USERS & ROLES TAB ------------------------------------------- */}
          {active === 'Users & Roles' && (
            <TeamTab
              onSwitchTab={(tab) => setActive(tab as NavItem)}
              businessName={business?.trade_name || business?.legal_name || 'your business'}
            />
          )}

          {/* -- GENERAL TAB ------------------------------------------------- */}
          {active === 'General' && (
            <div className="space-y-6">
              <LogoUploadCard business={business} />

              <AccountDataSection isOwner={isOwner} />
            </div>
          )}

          {/* -- BILLING & USAGE TAB ----------------------------------------- */}
          {active === 'Billing & Usage' && (
            <BillingTab
              business={business}
              initialSubscriptions={initialSubscriptions}
              usageStats={usageStats}
              nowMs={nowMs}
            />
          )}

          {/* -- USER FEEDBACK TAB ------------------------------------------- */}
          {active === 'User Feedback' && <UserFeedbackForm />}

          {/* -- NOTIFICATIONS TAB (feature C): every role manages their own e-mail choices -- */}
          {active === 'Notifications' && <NotificationsTab />}
        </div>
      </div>
    </div>
  );
}
