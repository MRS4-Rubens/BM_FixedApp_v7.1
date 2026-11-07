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
import { businesses } from '@/lib/db/schema';
import { SUPPORT_EMAIL } from '@/lib/config/contact';

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
}: SettingsClientProps) {
  const resolveInitialTab = (): NavItem => {
    if (initialTab) {
      const normalized = initialTab.toLowerCase().trim();
      if (
        normalized === 'billing' ||
        normalized === 'billing & usage' ||
        normalized === 'billing and usage' ||
        normalized === 'billing-usage'
      ) {
        return 'Billing & Usage';
      }
      if (
        normalized === 'feedback' ||
        normalized === 'user feedback' ||
        normalized === 'user-feedback'
      ) {
        return 'User Feedback';
      }
      if (
        normalized === 'invoice' ||
        normalized === 'invoice settings' ||
        normalized === 'invoice-settings'
      ) {
        return 'Invoice Settings';
      }
      const match = navItems.find((t) => t.toLowerCase() === normalized);
      if (match) return match;
    }
    return 'Business Profile';
  };

  const [active, setActive] = useState<NavItem>(resolveInitialTab);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1 shrink-0 mb-4">
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground font-heading uppercase">
          SETTINGS
        </h1>
        <p
          className="text-sm font-semibold text-muted-foreground leading-relaxed max-w-[315px]"
          style={{ textAlign: 'justify', textAlignLast: 'justify' }}
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
            {navItems.map((item) => {
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
                      isActive ? 'text-emerald-800 dark:text-emerald-400' : 'text-muted-foreground/70'
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
            {navItems.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setActive(item)}
                className={cn(
                  'rounded-lg px-3 py-2 text-left text-sm transition-colors cursor-pointer',
                  active === item
                    ? 'bg-emerald-50/80 font-bold text-emerald-900 border-l-2 border-emerald-800 pl-2.5 shadow-xs'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground font-medium'
                )}
              >
                {item}
              </button>
            ))}
          </nav>
        </aside>

        {/* -- Content Panel -------------------------------------------------- */}
        <div className="flex-1 min-w-0">
          {/* -- INVOICE SETTINGS TAB ---------------------------------------- */}
          {active === 'Invoice Settings' && (
            <InvoiceSettingsForm business={business} currentFyLabel={currentFyLabel} />
          )}

          {/* -- BUSINESS PROFILE TAB ----------------------------------------- */}
          {active === 'Business Profile' && (
            <BusinessProfileForm
              business={business}
              currentFyLabel={currentFyLabel}
              onSwitchTab={(tab) => setActive(tab as NavItem)}
              identityLocked={identityLocked}
            />
          )}

          {/* -- GENERAL TAB ------------------------------------------------- */}
          {active === 'General' && (
            <div className="space-y-6">
              <LogoUploadCard business={business} />

              <div className="rounded-xl border border-border bg-card px-5 py-4 sm:px-6 sm:py-5">
                <h2 className="mb-1 text-xl font-bold font-heading text-foreground uppercase">General</h2>
                <p className="mb-4 text-sm sm:text-base text-muted-foreground font-medium">
                  Account-level preferences.
                </p>

                <div>
                  <h3 className="mb-2 text-base font-bold text-foreground uppercase tracking-wide">
                    Danger Zone
                  </h3>
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                    <p className="text-base font-bold text-foreground">Delete Business Account</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Permanently delete this business and all its data. This cannot be undone.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        const confirmed = window.confirm(
                          'To protect statutory GST records against accidental loss, business account deletion requests are verified by support. Proceed to send a deletion request?'
                        );
                        if (confirmed) {
                          const subject = encodeURIComponent(
                            `Account Deletion Request - ${business?.legal_name || 'Bill Matrix Workspace'}`
                          );
                          const body = encodeURIComponent(
                            `Please initiate permanent deletion for my business account (${business?.legal_name || 'N/A'}, ID: ${business?.id || 'N/A'}).`
                          );
                          window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
                        }
                      }}
                      className="mt-3 rounded-lg border border-destructive/50 px-4 py-2 text-sm font-bold text-destructive transition-colors hover:bg-destructive/10 cursor-pointer shadow-xs"
                    >
                      Delete Business Account
                    </button>
                  </div>
                </div>
              </div>
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

          {/* -- PLACEHOLDER TABS ------------------------------------------- */}
          {active !== 'Invoice Settings' &&
            active !== 'General' &&
            active !== 'Business Profile' &&
            active !== 'Billing & Usage' &&
            active !== 'User Feedback' && (
              <div className="flex items-center justify-center rounded-xl border border-dashed border-border bg-card p-16 text-center">
                <div>
                  <p className="text-base font-bold text-foreground">{active}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    This section will be available in a future update.
                  </p>
                </div>
              </div>
            )}
        </div>
      </div>
    </div>
  );
}
