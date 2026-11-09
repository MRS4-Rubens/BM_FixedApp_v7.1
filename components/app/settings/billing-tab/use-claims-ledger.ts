'use client';

import { useState, useTransition, useMemo } from 'react';
import { getBusinessSubscriptions } from '@/lib/actions/subscriptions/get-business-subscriptions';
import { isOneOf } from '@/lib/db/domain-values';
import { STATUS_FILTERS, ITEMS_PER_PAGE, type StatusFilter } from './plan-configs';
import type { SubscriptionHistoryItem } from './types';

export function useClaimsLedger(
  initialSubscriptions: SubscriptionHistoryItem[] = [],
  businessId: string | undefined
) {
  const [subscriptions, setSubscriptions] = useState<SubscriptionHistoryItem[]>(initialSubscriptions);
  const [copiedUtr, setCopiedUtr] = useState<string | null>(null);
  const [isRefreshing, startTransition] = useTransition();

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [historyPage, setHistoryPage] = useState(1);
  const [selectedReceipt, setSelectedReceipt] = useState<SubscriptionHistoryItem | null>(null);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedUtr(text);
    setTimeout(() => setCopiedUtr(null), 2000);
  };

  const handleRefreshHistory = () => {
    if (!businessId) return;
    startTransition(async () => {
      const res = await getBusinessSubscriptions({ business_id: businessId });
      if (res.success && res.data) {
        setSubscriptions(res.data);
      }
    });
  };

  const changeSearchQuery = (query: string) => {
    setSearchQuery(query);
    setHistoryPage(1);
  };

  const changeStatusFilter = (filter: string) => {
    if (isOneOf(STATUS_FILTERS, filter)) {
      setStatusFilter(filter);
      setHistoryPage(1);
    }
  };

  const filteredSubscriptions = useMemo(() => {
    return subscriptions.filter((sub) => {
      const matchesSearch =
        sub.paymentReference.toLowerCase().includes(searchQuery.toLowerCase()) ||
        sub.planName.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus = statusFilter === 'all' || sub.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [subscriptions, searchQuery, statusFilter]);

  const totalHistoryPages = Math.max(1, Math.ceil(filteredSubscriptions.length / ITEMS_PER_PAGE));
  const paginatedSubscriptions = useMemo(() => {
    const start = (historyPage - 1) * ITEMS_PER_PAGE;
    return filteredSubscriptions.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredSubscriptions, historyPage]);

  return {
    subscriptions,
    copiedUtr,
    isRefreshing,
    searchQuery,
    statusFilter,
    historyPage,
    setHistoryPage,
    selectedReceipt,
    setSelectedReceipt,
    filteredSubscriptions,
    totalHistoryPages,
    paginatedSubscriptions,
    handleCopy,
    handleRefreshHistory,
    changeSearchQuery,
    changeStatusFilter,
  };
}

