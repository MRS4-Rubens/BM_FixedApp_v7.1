import type { getBusinessSubscriptions } from '@/lib/actions/subscriptions/get-business-subscriptions';

export type BizHistoryRow = Extract<
  Awaited<ReturnType<typeof getBusinessSubscriptions>>,
  { success: true }
>['data'][number];

export type AdminTab = 'overview' | 'pending' | 'businesses' | 'users' | 'settings';

export type ProofViewer =
  | { readonly requestId: string; readonly businessName: string; readonly title: string; readonly utr: string; readonly status: 'loading' }
  | { readonly requestId: string; readonly businessName: string; readonly title: string; readonly utr: string; readonly status: 'ready'; readonly url: string; readonly expiresInSeconds: number }
  | { readonly requestId: string; readonly businessName: string; readonly title: string; readonly utr: string; readonly status: 'error'; readonly message: string };

export interface PendingRequestItem {
  id: string;
  businessId: string;
  businessName: string;
  businessGstin: string | null;
  businessEmail: string | null;
  userId: string;
  userName: string | null;
  planName: string;
  billingCycle: string;
  amountPaise: number;
  paymentMethod: string;
  paymentReference: string;
  paidToVpa?: string | null;
  paidToAccount?: string | null;
  paidToIfsc?: string | null;
  hasScreenshot: boolean;
  createdAt: string;
  currentPlan: string;
  planChange: {
    kind: 'new' | 'renewal' | 'upgrade' | 'downgrade';
    fromPlan: string | null;
    unusedDays: number;
    creditedDays: number;
    endsAt: string;
  } | null;
}

export interface BusinessItem {
  id: string;
  legalName: string;
  tradeName: string | null;
  gstin: string;
  stateCode: string;
  email: string | null;
  phone: string | null;
  subscriptionPlan: string;
  subscriptionStatus: string;
  subscriptionEndsAt: string | null;
  activeUtrNo: string | null;
  createdAt: string;
  invoiceCount: number;
  userCount: number;
}

export interface UserItem {
  id: string;
  displayName: string | null;
  role: string;
  createdAt: string;
  businessId: string | null;
  businessName: string | null;
}

export interface UpiConfig {
  upiId: string;
  upiName: string;
  bankName: string;
  accName: string;
  accNo: string;
  ifsc: string;
}

export interface AdminStats {
  totalBusinesses: number;
  activeSubscriptions: number;
  totalRevenuePaise: number;
  pendingRequestsCount: number;
  platformInvoiceCount?: number;
  planDistribution?: Record<string, number>;
  monthlyRevenue?: Array<{ month: string; revenuePaise: number; claimCount: number }>;
}

export interface AdminConsoleProps {
  stats: AdminStats;
  pendingRequests: PendingRequestItem[];
  businesses: BusinessItem[];
  users: UserItem[];
  upiConfig: UpiConfig | null;
  payeeConfigIssue?: string | null;
  payeeSource: 'database' | 'env';
}

