import type { businesses } from '@/lib/db/schema';

export interface SubscriptionHistoryItem {
  id: string;
  planName: string;
  billingCycle: string;
  amountPaise: number;
  paymentMethod: string;
  paymentReference: string;
  hasScreenshot: boolean;
  status: string;
  rejectReason: string | null;
  approvedAt: Date | null;
  createdAt: Date;
  userName: string | null;
}

export interface UsageStats {
  invoicesThisMonth: number;
  invoicesTotal: number;
  teamMembersCount: number;
  customersCount: number;
  productsCount: number;
  currentMonthLabel: string;
}

export interface BillingTabProps {
  business: typeof businesses.$inferSelect | null;
  initialSubscriptions?: SubscriptionHistoryItem[];
  usageStats?: UsageStats;
  /** Request render time from the server (lib/time/request-time.ts); keeps server and client output identical. */
  nowMs: number;
}

