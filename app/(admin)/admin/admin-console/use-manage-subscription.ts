'use client';

import { useState, type TransitionStartFunction } from 'react';
import { useRouter } from 'next/navigation';
import { updateBusinessSubscription } from '@/lib/actions/subscriptions/update-business-subscription';
import { getBusinessSubscriptions } from '@/lib/actions/subscriptions/get-business-subscriptions';
import { computeGraceEndsAt } from '@/lib/subscriptions/grace-period';
import { formatIstDateAsIso } from '@/lib/invoices/ist-date';
import { isOneOf } from '@/lib/db/domain-values';
import { OVERRIDE_STATUSES, type OverrideStatus } from '@/lib/validations/admin-subscription';
import type { BusinessItem, BizHistoryRow } from './types';

export function useManageSubscription({ startTransition }: { startTransition: TransitionStartFunction }) {
  const router = useRouter();
  const [selectedBiz, setSelectedBiz] = useState<BusinessItem | null>(null);
  const [bizHistory, setBizHistory] = useState<BizHistoryRow[]>([]);
  const [bizHistoryPage, setBizHistoryPage] = useState(1);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [overridePlan, setOverridePlan] = useState('essentials');
  const [overrideStatus, setOverrideStatus] = useState<OverrideStatus>('active');
  const [overrideEndsAt, setOverrideEndsAt] = useState('');
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const [openedAtMs, setOpenedAtMs] = useState(0);
  const [graceEndsAtIso, setGraceEndsAtIso] = useState<string | null>(null);

  const changeEndsAt = (value: string) => {
    setGraceEndsAtIso(null);
    setOverrideEndsAt(value);
  };

  const handleOpenManageBiz = async (biz: BusinessItem) => {
    setOpenedAtMs(Date.now());
    setSelectedBiz(biz);
    setOverrideError(null);
    setGraceEndsAtIso(null);
    setOverridePlan(biz.subscriptionPlan);
    setOverrideStatus(isOneOf(OVERRIDE_STATUSES, biz.subscriptionStatus) ? biz.subscriptionStatus : 'active');
    setOverrideEndsAt(
      biz.subscriptionEndsAt ? formatIstDateAsIso(new Date(biz.subscriptionEndsAt)) : ''
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
        subscription_ends_at: graceEndsAtIso ?? (overrideEndsAt ? new Date(overrideEndsAt).toISOString() : ''),
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
    setGraceEndsAtIso(null);
    const d = new Date();
    d.setMonth(d.getMonth() + months);
    setOverrideEndsAt(formatIstDateAsIso(d));
  };

  const handleSetGracePeriod = () => {
    if (overridePlan === 'free') {
      setOverrideError('Choose a paid plan before granting a grace period.');
      return;
    }
    const ends = computeGraceEndsAt(
      selectedBiz?.subscriptionEndsAt ? new Date(selectedBiz.subscriptionEndsAt) : null,
      new Date()
    );
    // A Trial plan only allows the "trial" status (server rule), so keep it; paid plans become "active".
    setOverrideStatus(overridePlan === 'trial' ? 'trial' : 'active');
    setGraceEndsAtIso(ends.toISOString());
    setOverrideEndsAt(formatIstDateAsIso(ends));
    setOverrideError(null);
  };

  const isDateRequired = overrideStatus === 'active' || overrideStatus === 'trial';
  const isDateValid =
    overrideEndsAt !== '' &&
    !Number.isNaN(new Date(overrideEndsAt).getTime()) &&
    new Date(overrideEndsAt).getTime() > openedAtMs;
  const isSaveDisabled = isDateRequired && !isDateValid;

  return {
    selectedBiz,
    setSelectedBiz,
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
    setOverrideEndsAt: changeEndsAt,
    changeEndsAt,
    overrideError,
    setOverrideError,
    isSaveDisabled,
    handleOpenManageBiz,
    handleSaveOverride,
    handleSetPresetDate,
    handleSetGracePeriod,
  };
}
