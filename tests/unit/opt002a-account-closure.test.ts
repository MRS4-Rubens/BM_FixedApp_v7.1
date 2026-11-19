import { describe, it, expect, vi, beforeEach } from 'vitest';

// CI sets NEXT_PUBLIC_SUPPORT_EMAIL to a placeholder; pin the recipient so the test does not depend on the environment
// (same approach as tests/unit/debt003b-markup-characterization.test.ts).
vi.mock('@/lib/config/contact', () => ({
  SUPPORT_EMAIL: 'support@billmatrix.in',
  FEEDBACK_RECIPIENT_EMAIL: 'support@billmatrix.in',
}));

const mockGetCurrentAppUser = vi.fn();
vi.mock('@/lib/auth/session', () => ({
  getCurrentAppUser: () => mockGetCurrentAppUser(),
}));

const mockCheckRateLimit = vi.fn();
vi.mock('@/lib/rate-limit/upstash', () => ({
  sensitiveActionLimiter: {},
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  getClientIp: () => '127.0.0.1',
}));

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
}));

const mockLogError = vi.fn();
vi.mock('@/lib/actions/_shared/logger', () => ({
  logError: (...args: unknown[]) => mockLogError(...args),
}));

const mockSendEmail = vi.fn();
vi.mock('@/lib/email/mailer', () => ({
  getMailer: () => ({
    emails: {
      send: (...args: unknown[]) => mockSendEmail(...args),
    },
  }),
}));

vi.mock('@/lib/env', () => ({
  getEmailEnv: () => ({
    EMAIL_FROM: 'support@billmatrix.in',
  }),
}));

const mockGetRequestSession = vi.fn();
vi.mock('@/lib/auth/request-session', () => ({
  getRequestSession: () => mockGetRequestSession(),
}));

vi.mock('@/lib/observability/request-context', () => ({
  currentRequestId: () => 'test-req-id-777',
  runWithRequestId: (_id: string, fn: () => Promise<unknown>) => fn(),
  requestIdFromHeaders: () => 'test-req-id-777',
}));

vi.mock('@/lib/audit/request-context', () => ({
  getAuditRequestContext: async () => ({
    ip: '127.0.0.1',
    userAgent: 'vitest-agent',
  }),
}));

const mockWriteAudit = vi.fn();
vi.mock('@/lib/audit/log', () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
}));

// Spies on DB operations
const mockDbDelete = vi.fn();
const mockDbUpdate = vi.fn();
const mockSelect = vi.fn();
const mockTransaction = vi.fn();

vi.mock('@/lib/db/client', () => ({
  db: {
    select: (...args: unknown[]) => mockSelect(...args),
    transaction: (cb: (tx: unknown) => Promise<unknown>) => mockTransaction(cb),
    delete: (...args: unknown[]) => mockDbDelete(...args),
    update: (...args: unknown[]) => mockDbUpdate(...args),
  },
}));

import { requestAccountClosureAction } from '@/lib/actions/account/request-account-closure';

describe('OPT-002a: requestAccountClosureAction Unit Tests', () => {
  const ownerUser = {
    id: 'user_owner_001',
    auth_user_id: 'auth_owner_001',
    business_id: 'biz_closure_001',
    email: 'owner@acme.dev',
    display_name: 'Acme Owner',
    role: 'owner' as const,
  };

  const staffUser = {
    id: 'user_staff_001',
    auth_user_id: 'auth_staff_001',
    business_id: 'biz_closure_001',
    email: 'staff@acme.dev',
    display_name: 'Acme Staff',
    role: 'staff' as const,
  };

  const activeBusiness = {
    id: 'biz_closure_001',
    legal_name: 'Acme Enterprises Pvt Ltd',
    gstin: '29ABCDE1234F1Z5',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentAppUser.mockResolvedValue(ownerUser);
    mockGetRequestSession.mockResolvedValue({
      data: { user: { email: 'owner@acme.dev' } },
    });
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb({}));
    mockSendEmail.mockResolvedValue({ data: { id: 'resend_msg_001' }, error: null });
  });

  function setupDbSelect(options: {
    business?: typeof activeBusiness | null;
    recentAudit?: { created_at: Date }[];
  }) {
    let callCount = 0;
    mockSelect.mockImplementation(() => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => {
              callCount++;
              if (callCount === 1) return options.business ? [options.business] : [];
              return options.recentAudit ?? [];
            },
          }),
          limit: async () => {
            callCount++;
            if (callCount === 1) return options.business ? [options.business] : [];
            return options.recentAudit ?? [];
          },
        }),
      }),
    }));
  }

  it('rejects with CLOSURE_CONFIRMATION_MISMATCH when entered GSTIN does not match business record', async () => {
    setupDbSelect({ business: activeBusiness });

    const result = await requestAccountClosureAction({
      confirmation_gstin: '27AABCU9603R1ZM', // Different GSTIN
      reason: 'Downsizing company',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('CLOSURE_CONFIRMATION_MISMATCH');
      expect(result.error.message).toBe('The GSTIN you typed does not match this business.');
      expect(result.error.fieldErrors?.confirmation_gstin).toBeDefined();
    }
    expect(mockWriteAudit).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('rejects with FORBIDDEN_ROLE when called by a staff user', async () => {
    mockGetCurrentAppUser.mockResolvedValue(staffUser);

    const result = await requestAccountClosureAction({
      confirmation_gstin: '29ABCDE1234F1Z5',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('FORBIDDEN_ROLE');
    }
    expect(mockSelect).not.toHaveBeenCalled();
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });

  it('rejects with CLOSURE_ALREADY_REQUESTED if a request was submitted within the last 30 days', async () => {
    const priorRequestDate = new Date('2026-04-01T10:00:00Z');
    setupDbSelect({
      business: activeBusiness,
      recentAudit: [{ created_at: priorRequestDate }],
    });

    const result = await requestAccountClosureAction({
      confirmation_gstin: '29ABCDE1234F1Z5',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('CLOSURE_ALREADY_REQUESTED');
      expect(result.error.message).toContain('A closure request was already received');
      expect(result.error.message).toContain('Our team will contact you.');
    }
    expect(mockWriteAudit).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('successfully records closure request, writes audit log, and sends email notification', async () => {
    setupDbSelect({
      business: activeBusiness,
      recentAudit: [],
    });

    const result = await requestAccountClosureAction({
      confirmation_gstin: '29ABCDE1234F1Z5',
      reason: 'Closing down retail operations',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.requestedAt).toBeDefined();
    }

    // Verify audit log write
    expect(mockTransaction).toHaveBeenCalled();
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        businessId: 'biz_closure_001',
        actorUserId: 'user_owner_001',
        entityType: 'business',
        entityId: 'biz_closure_001',
        action: 'account_closure_requested',
        metadata: {
          reason: 'Closing down retail operations',
        },
      }),
    );

    // Verify Resend email dispatch
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'Invoice BizFolio <support@billmatrix.in>',
        to: 'support@billmatrix.in',
        subject: 'Account closure request — Acme Enterprises Pvt Ltd (29ABCDE1234F1Z5)',
        text: expect.stringContaining('Business ID: biz_closure_001'),
      }),
    );
    const sentEmailText = mockSendEmail.mock.calls[0][0].text;
    expect(sentEmailText).toContain('Legal Name: Acme Enterprises Pvt Ltd');
    expect(sentEmailText).toContain('GSTIN: 29ABCDE1234F1Z5');
    expect(sentEmailText).toContain('Requester Email: owner@acme.dev');
    expect(sentEmailText).toContain('Request ID: test-req-id-777');
    expect(sentEmailText).toContain('Reason: Closing down retail operations');
  });

  it('succeeds even if email sending fails, recording the audit row and logging error', async () => {
    setupDbSelect({
      business: activeBusiness,
      recentAudit: [],
    });
    mockSendEmail.mockRejectedValueOnce(new Error('Resend network timeout'));

    const result = await requestAccountClosureAction({
      confirmation_gstin: '29ABCDE1234F1Z5',
    });

    expect(result.success).toBe(true);
    expect(mockWriteAudit).toHaveBeenCalled();
    expect(mockLogError).toHaveBeenCalledWith(
      'request-account-closure-email',
      expect.any(Error),
      expect.objectContaining({ businessId: expect.any(String) }),
    );
  });

  it('logs (and still succeeds) when Resend reports an error without throwing', async () => {
    setupDbSelect({
      business: activeBusiness,
      recentAudit: [],
    });
    // The Resend SDK returns { data: null, error } for API failures instead of rejecting.
    mockSendEmail.mockResolvedValueOnce({ data: null, error: { name: 'validation_error', message: 'Invalid from' } });

    const result = await requestAccountClosureAction({
      confirmation_gstin: '29ABCDE1234F1Z5',
    });

    expect(result.success).toBe(true);
    expect(mockWriteAudit).toHaveBeenCalled();
    expect(mockLogError).toHaveBeenCalledWith(
      'request-account-closure-email',
      expect.objectContaining({ message: 'Invalid from' }),
      expect.objectContaining({ businessId: expect.any(String) }),
    );
  });

  it('performs ZERO delete or update mutations on database tables (pure recording)', async () => {
    setupDbSelect({
      business: activeBusiness,
      recentAudit: [],
    });

    await requestAccountClosureAction({
      confirmation_gstin: '29ABCDE1234F1Z5',
    });

    expect(mockDbDelete).not.toHaveBeenCalled();
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });
});
