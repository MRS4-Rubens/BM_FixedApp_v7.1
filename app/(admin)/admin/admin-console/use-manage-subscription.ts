'use client';

import { useState, type TransitionStartFunction } from 'react';
import { useRouter } from 'next/navigation';
import { updateBusinessSubscription } from '@/lib/actions/subscriptions/update-business-subscription';
import { getBusinessSubscriptions } from '@/lib/actions/subscriptions/get-business-subscriptions';
import { isOneOf } from '@/lib/db/domain-values';
import { OVERRIDE_STATUSES, type OverrideStatus } from '@/lib/validations/admin-subscription';
import type { BusinessItem, BizHistoryRow } from './types';

export function useManageSubscription({ startTransition }: { startTransition: TransitionStartFunction }) {
  const router = useRouter();
  const [selectedBiz, setSelectedBiz] = useState<BusinessItem | null>(null);
  const [identityDialogOpen, setIdentityDialogOpen] = useState(false);
  const [bizHistory, setBizHistory] = useState<BizHistoryRow[]>([]);
  const [bizHistoryPage, setBizHistoryPage] = useState(1);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [overridePlan, setOverridePlan] = useState('essentials');
  const [overrideStatus, setOverrideStatus] = useState<OverrideStatus>('active');
  const [overrideEndsAt, setOverrideEndsAt] = useState('');
  const [overrideError, setOverrideError] = useState<string | null>(null);

  const handleOpenManageBiz = async (biz: BusinessItem) => {
    setSelectedBiz(biz);
    setOverrideError(null);
    setOverridePlan(biz.subscriptionPlan);
    setOverrideStatus(isOneOf(OVERRIDE_STATUSES, biz.subscriptionStatus) ? biz.subscriptionStatus : 'active');
    setOverrideEndsAt(
      biz.subscriptionEndsAt ? new Date(biz.subscriptionEndsAt).toISOString().split('T')[0] : ''
    );
    setBizHistoryPage(1);
    setLoadingHistory(true);

    try {
      const result = await getBusinessSubscriptions({ business_id: biz.id });
      if (result.success && result.data) {
        setBizHistory(result.data);
      } else {
        setBizHistory([]);
      }
    } catch {
      setBizHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleSaveOverride = () => {
    if (!selectedBiz) return;
    setOverrideError(null);

    startTransition(async () => {
      const result = await updateBusinessSubscription({
        business_id: selectedBiz.id,
        subscription_plan: overridePlan,
        subscription_status: overrideStatus,
        subscription_ends_at: overrideEndsAt ? new Date(overrideEndsAt).toISOString() : '',
      });

      if (result.success) {
        setSelectedBiz(null);
        router.refresh();
      } else {
        setOverrideError(result.error?.message || 'Failed to update subscription override.');
      }
    });
  };

  const handleSetPresetDate = (months: number) => {
    const d = new Date();
    d.setMonth(d.getMonth() + months);
    setOverrideEndsAt(d.toISOString().split('T')[0]);
  };

  return {
    selectedBiz,
    setSelectedBiz,
    identityDialogOpen,
    setIdentityDialogOpen,
    bizHistory,
    setBizHistory,
    bizHistoryPage,
    setBizHistoryPage,
    loadingHistory,
    overridePlan,
    setOverridePlan,
    overrideStatus,
    setOverrideStatus,
    overrideEndsAt,
    setOverrideEndsAt,
    overrideError,
    setOverrideError,
    handleOpenManageBiz,
    handleSaveOverride,
    handleSetPresetDate,
  };
}

