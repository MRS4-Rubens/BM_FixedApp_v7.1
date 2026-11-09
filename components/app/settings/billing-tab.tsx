'use client';

import {
  canShareInvoiceOnWhatsApp,
  canExportStatutoryReport,
} from '@/lib/subscriptions/entitlements';
import { PLAN_CONFIGS } from './billing-tab/plan-configs';
import { useClaimsLedger } from './billing-tab/use-claims-ledger';
import { PlanOverviewCard } from './billing-tab/plan-overview-card';
import { UsageMeters } from './billing-tab/usage-meters';
import { PlanPrivileges } from './billing-tab/plan-privileges';
import { ClaimsLedger } from './billing-tab/claims-ledger';
import { ReceiptModal } from './billing-tab/receipt-modal';
import type {
  SubscriptionHistoryItem,
  UsageStats,
  BillingTabProps,
} from './billing-tab/types';

export type { SubscriptionHistoryItem, UsageStats };

export function BillingTab({
  business,
  initialSubscriptions = [],
  usageStats = {
    invoicesThisMonth: 0,
    invoicesTotal: 0,
    teamMembersCount: 1,
    customersCount: 0,
    productsCount: 0,
    currentMonthLabel: 'Current Month',
  },
  nowMs,
}: BillingTabProps) {
  const ledger = useClaimsLedger(initialSubscriptions, business?.id);

  const currentPlanKey = (business?.subscription_plan || 'free').toLowerCase();
  const status = (business?.subscription_status || 'free').toLowerCase();
  const planConfig = PLAN_CONFIGS[currentPlanKey] || PLAN_CONFIGS.essentials;

  const whatsapp = canShareInvoiceOnWhatsApp(business).allowed;
  const excel = canExportStatutoryReport(business).allowed;

  // Expiration and Days Calculation
  const targetExpiry = business?.subscription_ends_at || business?.trial_ends_at;
  const daysRemaining = targetExpiry
    ? Math.ceil((new Date(targetExpiry).getTime() - nowMs) / (1000 * 60 * 60 * 24))
    : null;

  const isExpired = daysRemaining !== null && daysRemaining <= 0;
  const isExpiringSoon = daysRemaining !== null && daysRemaining > 0 && daysRemaining <= 7;
  const isActive = status === 'active' && !isExpired;

  // Subscription Lifecycle progress
  const lifecycleProgress = (() => {
    const start = business?.subscription_activated_at ? new Date(business.subscription_activated_at).getTime() : null;
    const end = targetExpiry ? new Date(targetExpiry).getTime() : null;

    if (!start || !end || end <= start) return null;
    const total = end - start;
    const elapsed = Math.max(0, Math.min(total, nowMs - start));
    return Math.round((elapsed / total) * 100);
  })();

  return (
    <div className="space-y-5">
      {/* -- 1. Plan Overview Hero Card -------------------------------------- */}
      <PlanOverviewCard
        business={business}
        planConfig={planConfig}
        status={status}
        isActive={isActive}
        isExpired={isExpired}
        isExpiringSoon={isExpiringSoon}
        daysRemaining={daysRemaining}
        targetExpiry={targetExpiry}
        lifecycleProgress={lifecycleProgress}
        copiedUtr={ledger.copiedUtr}
        onCopy={ledger.handleCopy}
      />

      {/* -- 2. Live Resource Consumption & Quotas --------------------------- */}
      <UsageMeters
        usageStats={usageStats}
        planConfig={planConfig}
        currentPlanKey={currentPlanKey}
        whatsapp={whatsapp}
        excel={excel}
      />

      {/* -- 3. Features & Availed Services / Tier Privileges --------------- */}
      <PlanPrivileges
        planConfig={planConfig}
        currentPlanKey={currentPlanKey}
      />

      {/* -- 4. Historical Payment Claims Ledger ---------------------------- */}
      <ClaimsLedger
        searchQuery={ledger.searchQuery}
        statusFilter={ledger.statusFilter}
        isRefreshing={ledger.isRefreshing}
        filteredSubscriptions={ledger.filteredSubscriptions}
        paginatedSubscriptions={ledger.paginatedSubscriptions}
        historyPage={ledger.historyPage}
        totalHistoryPages={ledger.totalHistoryPages}
        copiedUtr={ledger.copiedUtr}
        onCopy={ledger.handleCopy}
        onSearchChange={ledger.changeSearchQuery}
        onStatusFilterChange={ledger.changeStatusFilter}
        onRefresh={ledger.handleRefreshHistory}
        onSetHistoryPage={ledger.setHistoryPage}
        onSelectReceipt={ledger.setSelectedReceipt}
      />

      {/* -- 5. Payment Voucher / Receipt Modal ------------------------------ */}
      <ReceiptModal
        selectedReceipt={ledger.selectedReceipt}
        businessLegalName={business?.legal_name}
        onClose={() => ledger.setSelectedReceipt(null)}
      />
    </div>
  );
}
