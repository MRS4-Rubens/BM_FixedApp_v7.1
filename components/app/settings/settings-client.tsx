'use client';

import { useRef, useState } from 'react';
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
import { SettingsSidePanel, type SettingsNavGroup, type SettingsSaveState } from './settings-side-panel';
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

// UI stage 1: the right panel groups the same sections (labels unchanged).
const NAV_GROUPS: readonly SettingsNavGroup<NavItem>[] = [
  { label: 'Business', items: ['Business Profile', 'Invoice Settings'] },
  { label: 'Team', items: ['Users & Roles'] },
  { label: 'Account', items: ['Billing & Usage', 'Notifications', 'General'] },
  { label: 'Support', items: ['User Feedback'] },
];

/** Sections whose page-wide form the panel's Save button submits. */
const SAVE_FORM_IDS: Partial<Record<NavItem, string>> = {
  'Business Profile': 'settings-business-profile-form',
  'Invoice Settings': 'settings-invoice-settings-form',
};

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

  const [active, setActiveTab] = useState<NavItem>(resolveInitialTab);
  const contentRef = useRef<HTMLDivElement>(null);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<SettingsSaveState>('idle');

  const setActive = (tab: NavItem) => {
    setActiveTab(tab);
    setDirty(false);
    setSaveState('idle');
    // The panel stays in view while scrolling, so a newly opened section must start at its top.
    requestAnimationFrame(() => contentRef.current?.scrollIntoView({ block: 'start' }));
  };

  const handleSaveResult = (ok: boolean) => {
    setSaveState(ok ? 'idle' : 'error');
    if (ok) setDirty(false);
  };

  const saveFormId = isOwner ? (SAVE_FORM_IDS[active] ?? null) : null;

  const visibleNavItems = navItems.filter((item) => isOwner || !STAFF_HIDDEN_TABS.includes(item));

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

      {/* UI stage 1: content on the left, the settings panel on the right (same on every screen size: phones use
          the desktop canvas). */}
      <div className="flex items-start gap-6">
        {/* -- Content Panel -------------------------------------------------- */}
        <div
          ref={contentRef}
          className="flex-1 min-w-0"
          onInput={() => setDirty(true)}
          onChange={() => setDirty(true)}
        >
          {/* -- INVOICE SETTINGS TAB ---------------------------------------- */}
          {active === 'Invoice Settings' && (
            <InvoiceSettingsForm
              business={business}
              currentFyLabel={currentFyLabel}
              signatureDataUri={signatureDataUri}
              isOwner={isOwner}
              formId={SAVE_FORM_IDS['Invoice Settings']}
              onSaveResult={handleSaveResult}
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
              formId={SAVE_FORM_IDS['Business Profile']}
              onSaveResult={handleSaveResult}
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

        <SettingsSidePanel
          groups={NAV_GROUPS}
          visibleItems={visibleNavItems}
          active={active}
          icons={NAV_ICONS}
          onSelect={setActive}
          contentRef={contentRef}
          saveFormId={saveFormId}
          dirty={dirty}
          saveState={saveState}
          onSaveClick={() => setSaveState('saving')}
        />
      </div>
    </div>
  );
}
