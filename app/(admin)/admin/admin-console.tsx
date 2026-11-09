'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useIsClient } from '@/lib/hooks/use-is-client';

import type { AdminConsoleProps, AdminTab } from './admin-console/types';
import { ConsoleHeader } from './admin-console/console-header';
import { KpiCards } from './admin-console/kpi-cards';
import { TabNav } from './admin-console/tab-nav';
import { OverviewTab } from './admin-console/overview-tab';
import { PendingClaimsTab } from './admin-console/pending-claims-tab';
import { BusinessesTab } from './admin-console/businesses-tab';
import { UsersTab } from './admin-console/users-tab';
import { SettingsTab } from './admin-console/settings-tab';
import { RejectClaimDialog } from './admin-console/reject-claim-dialog';
import { ManageSubscriptionDialog } from './admin-console/manage-subscription-dialog';
import { ProofLightbox } from './admin-console/proof-lightbox';
import { useCopyFeedback } from './admin-console/use-copy-feedback';
import { useBusinessDirectory } from './admin-console/use-business-directory';
import { useUserDirectory } from './admin-console/use-user-directory';
import { useClaimActions } from './admin-console/use-claim-actions';
import { useManageSubscription } from './admin-console/use-manage-subscription';
import { useProofViewer } from './admin-console/use-proof-viewer';
import { downloadBusinessesCsv } from './admin-console/businesses-csv';

export type { AdminConsoleProps };

export function AdminConsole({
  stats,
  pendingRequests,
  businesses,
  users,
  upiConfig,
  payeeConfigIssue = null,
}: AdminConsoleProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const isMounted = useIsClient();

  const { copiedKey, handleCopy } = useCopyFeedback();
  const bizDir = useBusinessDirectory(businesses);
  const userDir = useUserDirectory(users);
  const claims = useClaimActions();
  const manageSub = useManageSubscription({ startTransition: claims.startTransition });
  const proof = useProofViewer();

  const handleTabChange = (tab: AdminTab) => {
    setActiveTab(tab);
    claims.setClaimActionError(null);
  };

  const handleExportCsv = () => {
    downloadBusinessesCsv(bizDir.filteredBusinesses);
  };

  return (
    <div className="space-y-4">
      {/* 1. Sleek Command Header */}
      <ConsoleHeader
        isPending={claims.isPending}
        onRefresh={() => {
          claims.startTransition(() => {
            router.refresh();
          });
        }}
        onExportCsv={handleExportCsv}
        onViewPending={() => handleTabChange('pending')}
        pendingCount={pendingRequests.length}
      />

      {/* 2. Executive KPI Cards Grid */}
      <KpiCards
        stats={stats}
        pendingCount={pendingRequests.length}
        onSelectPendingTab={() => handleTabChange('pending')}
      />

      {/* 3. Modern Segmented Tab Navigation */}
      <TabNav
        activeTab={activeTab}
        onSelectTab={handleTabChange}
        pendingCount={pendingRequests.length}
        businessesCount={businesses.length}
        usersCount={users.length}
      />

      {claimActionErrorBanner(claims.claimActionError)}

      {/* 4. TAB CONTENT */}

      {/* TAB 1: OVERVIEW & ANALYTICS */}
      {activeTab === 'overview' && (
        <OverviewTab
          stats={stats}
          pendingRequests={pendingRequests}
          upiConfig={upiConfig}
          payeeConfigIssue={payeeConfigIssue}
          isMounted={isMounted}
          isPending={claims.isPending}
          copiedKey={copiedKey}
          onCopy={handleCopy}
          onSelectTab={handleTabChange}
          onOpenProof={proof.openProof}
          onApprove={claims.handleApprove}
          onReject={claims.setRejectingClaim}
        />
      )}

      {/* TAB 2: PENDING CLAIMS VERIFICATION QUEUE */}
      {activeTab === 'pending' && (
        <PendingClaimsTab
          pendingRequests={pendingRequests}
          isPending={claims.isPending}
          copiedKey={copiedKey}
          onCopy={handleCopy}
          onOpenProof={proof.openProof}
          onApprove={claims.handleApprove}
          onReject={claims.setRejectingClaim}
        />
      )}

      {/* TAB 3: BUSINESSES DIRECTORY */}
      {activeTab === 'businesses' && (
        <BusinessesTab
          totalBusinessesCount={businesses.length}
          filteredBusinesses={bizDir.filteredBusinesses}
          paginatedBusinesses={bizDir.paginatedBusinesses}
          bizSearch={bizDir.bizSearch}
          bizStatusFilter={bizDir.bizStatusFilter}
          totalBizPages={bizDir.totalBizPages}
          safeBizPage={bizDir.safeBizPage}
          copiedKey={copiedKey}
          onCopy={handleCopy}
          onChangeBizSearch={bizDir.changeBizSearch}
          onChangeBizStatusFilter={bizDir.changeBizStatusFilter}
          onToggleBizSort={bizDir.toggleBizSort}
          onSetBizPage={bizDir.setBizPage}
          onExportCsv={handleExportCsv}
          onOpenManageBiz={manageSub.handleOpenManageBiz}
        />
      )}

      {/* TAB 4: PLATFORM USERS */}
      {activeTab === 'users' && (
        <UsersTab
          totalUsersCount={users.length}
          filteredUsers={userDir.filteredUsers}
          paginatedUsers={userDir.paginatedUsers}
          userSearch={userDir.userSearch}
          roleFilterOptions={userDir.roleFilterOptions}
          effectiveRoleFilter={userDir.effectiveRoleFilter}
          totalUserPages={userDir.totalUserPages}
          safeUserPage={userDir.safeUserPage}
          onChangeUserSearch={userDir.changeUserSearch}
          onChangeUserRoleFilter={userDir.changeUserRoleFilter}
          onSetUserPage={userDir.setUserPage}
        />
      )}

      {/* TAB 5: GATEWAYS & SETTINGS */}
      {activeTab === 'settings' && (
        <SettingsTab
          upiConfig={upiConfig}
          payeeConfigIssue={payeeConfigIssue}
          copiedKey={copiedKey}
          onCopy={handleCopy}
        />
      )}

      {/* ========================================================================= */}
      {/* MODAL 1: REJECT CLAIM DIALOG */}
      {/* ========================================================================= */}
      <RejectClaimDialog
        rejectingClaim={claims.rejectingClaim}
        onClose={() => claims.setRejectingClaim(null)}
        isPending={claims.isPending}
        startTransition={claims.startTransition}
      />

      {/* ========================================================================= */}
      {/* MODAL 2: MANAGE BUSINESS SUBSCRIPTION & HISTORICAL LEDGER */}
      {/* ========================================================================= */}
      <ManageSubscriptionDialog
        selectedBiz={manageSub.selectedBiz}
        onClose={() => manageSub.setSelectedBiz(null)}
        isPending={claims.isPending}
        identityDialogOpen={manageSub.identityDialogOpen}
        onOpenIdentityDialog={manageSub.setIdentityDialogOpen}
        bizHistory={manageSub.bizHistory}
        bizHistoryPage={manageSub.bizHistoryPage}
        loadingHistory={manageSub.loadingHistory}
        overridePlan={manageSub.overridePlan}
        overrideStatus={manageSub.overrideStatus}
        overrideEndsAt={manageSub.overrideEndsAt}
        overrideError={manageSub.overrideError}
        onChangePlan={manageSub.setOverridePlan}
        onChangeStatus={manageSub.setOverrideStatus}
        onChangeEndsAt={manageSub.setOverrideEndsAt}
        onSetPresetDate={manageSub.handleSetPresetDate}
        onSaveOverride={manageSub.handleSaveOverride}
        onSetBizHistoryPage={manageSub.setBizHistoryPage}
      />

      {/* ========================================================================= */}
      {/* MODAL 3: SCREENSHOT LIGHTBOX MODAL (SEC-003) */}
      {/* ========================================================================= */}
      <ProofLightbox
        proofViewer={proof.proofViewer}
        onClose={proof.closeProof}
        onRetry={proof.openProof}
        onImageError={() => {
          proof.setProofViewer((current) => {
            if (!current || current.status !== 'ready' || current.requestId !== proof.proofViewer?.requestId) return current;
            return {
              ...current,
              status: 'error',
              message: 'This secure link has expired or could not be loaded. Click Try again to load a fresh one.',
            };
          });
        }}
      />

      {/* Approve Claim Confirmation Dialog */}
      <ConfirmDialog
        open={!!claims.approvingClaimId}
        onOpenChange={(open) => {
          if (!open) claims.setApprovingClaimId(null);
        }}
        title="Approve payment claim?"
        description="Approve this manual payment claim and activate the subscription immediately?"
        confirmLabel="Approve claim"
        onConfirm={claims.handleConfirmApprove}
      />
    </div>
  );
}

function claimActionErrorBanner(error: string | null) {
  if (!error) return null;
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-lg bg-destructive/10 border border-destructive/20 p-4 text-sm text-destructive font-medium animate-shake"
    >
      <AlertCircle className="size-5 shrink-0 mt-0.5" />
      <span>{error}</span>
    </div>
  );
}
