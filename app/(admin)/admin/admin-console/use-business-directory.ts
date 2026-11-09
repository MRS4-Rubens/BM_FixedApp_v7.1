'use client';

import { useState, useMemo } from 'react';
import type { BusinessItem } from './types';
import { ROWS_PER_PAGE } from './pagination';

export function useBusinessDirectory(businesses: BusinessItem[]) {
  const [bizSearch, setBizSearch] = useState('');
  const [bizStatusFilter, setBizStatusFilter] = useState<'all' | 'active' | 'trial' | 'expired' | 'suspended'>('all');
  const [bizSortField, setBizSortField] = useState<'name' | 'invoices' | 'date' | 'expiry'>('date');
  const [bizSortOrder, setBizSortOrder] = useState<'asc' | 'desc'>('desc');
  const [bizPage, setBizPage] = useState(1);

  const changeBizSearch = (value: string) => {
    setBizSearch(value);
    setBizPage(1);
  };

  const changeBizStatusFilter = (status: 'all' | 'active' | 'trial' | 'expired' | 'suspended') => {
    setBizStatusFilter(status);
    setBizPage(1);
  };

  const toggleBizSort = (field: 'name' | 'expiry' | 'invoices') => {
    if (bizSortField === field) {
      setBizSortOrder(bizSortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setBizSortField(field);
      setBizSortOrder(field === 'invoices' ? 'desc' : 'asc');
    }
    setBizPage(1);
  };

  const filteredBusinesses = useMemo(() => {
    const result = businesses.filter((b) => {
      const matchSearch =
        b.legalName.toLowerCase().includes(bizSearch.toLowerCase()) ||
        (b.tradeName && b.tradeName.toLowerCase().includes(bizSearch.toLowerCase())) ||
        b.gstin.toLowerCase().includes(bizSearch.toLowerCase()) ||
        (b.email && b.email.toLowerCase().includes(bizSearch.toLowerCase()));

      const matchStatus = bizStatusFilter === 'all' ? true : b.subscriptionStatus === bizStatusFilter;
      return matchSearch && matchStatus;
    });

    result.sort((a, b) => {
      if (bizSortField === 'name') {
        return bizSortOrder === 'asc'
          ? a.legalName.localeCompare(b.legalName)
          : b.legalName.localeCompare(a.legalName);
      }
      if (bizSortField === 'invoices') {
        return bizSortOrder === 'asc' ? a.invoiceCount - b.invoiceCount : b.invoiceCount - a.invoiceCount;
      }
      if (bizSortField === 'expiry') {
        const dateA = a.subscriptionEndsAt ? new Date(a.subscriptionEndsAt).getTime() : 0;
        const dateB = b.subscriptionEndsAt ? new Date(b.subscriptionEndsAt).getTime() : 0;
        return bizSortOrder === 'asc' ? dateA - dateB : dateB - dateA;
      }
      // default 'date'
      const dateA = new Date(a.createdAt).getTime();
      const dateB = new Date(b.createdAt).getTime();
      return bizSortOrder === 'asc' ? dateA - dateB : dateB - dateA;
    });

    return result;
  }, [businesses, bizSearch, bizStatusFilter, bizSortField, bizSortOrder]);

  const totalBizPages = Math.max(1, Math.ceil(filteredBusinesses.length / ROWS_PER_PAGE));
  const safeBizPage = Math.min(Math.max(1, bizPage), totalBizPages);
  const paginatedBusinesses = useMemo(() => {
    const start = (safeBizPage - 1) * ROWS_PER_PAGE;
    return filteredBusinesses.slice(start, start + ROWS_PER_PAGE);
  }, [filteredBusinesses, safeBizPage]);

  return {
    bizSearch,
    bizStatusFilter,
    bizSortField,
    bizSortOrder,
    bizPage,
    setBizPage,
    changeBizSearch,
    changeBizStatusFilter,
    toggleBizSort,
    filteredBusinesses,
    totalBizPages,
    safeBizPage,
    paginatedBusinesses,
  };
}

