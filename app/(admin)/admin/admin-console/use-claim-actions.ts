'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { processSubscriptionClaim } from '@/lib/actions/subscriptions/process-request';
import type { PendingRequestItem } from './types';

export function useClaimActions() {
  const router = useRouter();
  // One shared transition for every admin action (as before the DEBT-003B split): while any approve, reject,
  // override save or refresh runs, all action buttons stay disabled.
  const [isPending, startTransition] = useTransition();
  const [approvingClaimId, setApprovingClaimId] = useState<string | null>(null);
  const [rejectingClaim, setRejectingClaim] = useState<PendingRequestItem | null>(null);
  const [claimActionError, setClaimActionError] = useState<string | null>(null);

  const handleApprove = (requestId: string) => {
    setClaimActionError(null);
    setApprovingClaimId(requestId);
  };

  const handleConfirmApprove = async () => {
    if (!approvingClaimId) return;
    const requestId = approvingClaimId;
    setClaimActionError(null);
    startTransition(async () => {
      const result = await processSubscriptionClaim({
        request_id: requestId,
        action: 'approve',
      });
      if (result.success) {
        setApprovingClaimId(null);
        router.refresh();
      } else {
        setApprovingClaimId(null);
        setClaimActionError(result.error?.message || 'Failed to approve claim.');
      }
    });
  };

  return {
    isPending,
    startTransition,
    approvingClaimId,
    setApprovingClaimId,
    rejectingClaim,
    setRejectingClaim,
    claimActionError,
    setClaimActionError,
    handleApprove,
    handleConfirmApprove,
  };
}

