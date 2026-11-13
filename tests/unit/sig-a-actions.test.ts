import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FORBIDDEN_ROLE_CODE } from '@/lib/auth/rbac';

const mockUploadFileToStorage = vi.fn();
const mockDeleteFileFromStorage = vi.fn();
const mockDeleteSignatureObjectIfUnreferenced = vi.fn();
const mockWriteAudit = vi.fn();
const mockRevalidatePath = vi.fn();
const mockGetCurrentAppUser = vi.fn();

vi.mock('@/lib/auth/session', () => ({
  getCurrentAppUser: () => mockGetCurrentAppUser(),
}));

vi.mock('@/lib/storage/idrive', () => ({
  uploadFileToStorage: (...args: unknown[]) => mockUploadFileToStorage(...args),
  deleteFileFromStorage: (...args: unknown[]) => mockDeleteFileFromStorage(...args),
}));

vi.mock('@/lib/storage/signature', () => ({
  deleteSignatureObjectIfUnreferenced: (...args: unknown[]) => mockDeleteSignatureObjectIfUnreferenced(...args),
}));

vi.mock('@/lib/audit/log', () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
  AUDIT_EVENTS: {
    business: [
      'profile_create',
      'profile_update',
      'logo_upload',
      'logo_remove',
      'signature_upload',
      'signature_remove',
      'subscription_manual_override',
      'business_identity_changed',
      'business_identity_changed_by_admin',
      'data_export',
      'account_closure_requested',
    ],
  },
}));

vi.mock('@/lib/audit/request-context', () => ({
  getAuditRequestContext: vi.fn().mockResolvedValue({ ip: '127.0.0.1', userAgent: 'test-agent' }),
}));

vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
  revalidateTag: vi.fn(),
}));

vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}));

vi.mock('@/lib/rate-limit/upstash', () => ({
  sensitiveActionLimiter: {},
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, retryAfterSeconds: 0 }),
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
}));

vi.mock('@/lib/actions/_shared/logger', () => ({
  logError: vi.fn(),
}));

// requireActiveSubscription: true -> the wrapper calls assertBusinessNotSuspended(businessId).
const mockAssertBusinessNotSuspended = vi.fn();
vi.mock('@/lib/actions/_shared/subscription-guard', () => ({
  assertBusinessNotSuspended: (...args: unknown[]) => mockAssertBusinessNotSuspended(...args),
}));

const mockTxSelect = vi.fn();
const mockTxUpdate = vi.fn();

const mockTx = {
  select: (...args: unknown[]) => mockTxSelect(...args),
  update: (...args: unknown[]) => mockTxUpdate(...args),
};

vi.mock('@/lib/db/transaction', () => ({
  setLocalLockTimeout: vi.fn().mockResolvedValue(undefined),
  withTransactionRetry: vi.fn(async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx)),
}));

vi.mock('@/lib/db/client', () => ({
  db: {
    transaction: vi.fn(async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx)),
  },
}));

import { uploadBusinessSignature } from '@/lib/actions/business/upload-signature';
import { removeBusinessSignature } from '@/lib/actions/business/remove-signature';

function makeValidSignatureBase64(): string {
  const buf = Buffer.alloc(33);
  buf[0] = 0x89;
  buf[1] = 0x50;
  buf[2] = 0x4e;
  buf[3] = 0x47;
  buf[4] = 0x0d;
  buf[5] = 0x0a;
  buf[6] = 0x1a;
  buf[7] = 0x0a;
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(900, 16);
  buf.writeUInt32BE(300, 20);
  buf.writeUInt8(8, 24);
  buf.writeUInt8(6, 25); // RGBA
  buf.writeUInt8(0, 26);
  buf.writeUInt8(0, 27);
  buf.writeUInt8(0, 28);
  buf.writeUInt32BE(0, 29);
  return `data:image/png;base64,${buf.toString('base64')}`;
}

describe('SPEC: Authorised signature server actions (SIG-A)', () => {
  const dummyOwner = {
    id: 'user_owner_001',
    auth_user_id: 'auth_owner_001',
    business_id: 'biz_001',
    display_name: 'Test Owner',
    email: 'owner@example.com',
    role: 'owner' as const,
    created_at: new Date(),
    updated_at: new Date(),
  };

  const dummyStaff = {
    ...dummyOwner,
    id: 'user_staff_001',
    role: 'staff' as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockAssertBusinessNotSuspended.mockResolvedValue(undefined);
    mockGetCurrentAppUser.mockResolvedValue(dummyOwner);
    mockUploadFileToStorage.mockResolvedValue(undefined);
    mockDeleteFileFromStorage.mockResolvedValue(undefined);
    mockDeleteSignatureObjectIfUnreferenced.mockResolvedValue('deleted');
    mockWriteAudit.mockResolvedValue(undefined);

    // Default tx query behavior
    const selectChain = {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          for: vi.fn().mockResolvedValue([{ key: 'signatures/biz_001/prev.png' }]),
        }),
      }),
    };
    mockTxSelect.mockReturnValue(selectChain);

    const updateChain = {
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: 'biz_001' }]),
      }),
    };
    mockTxUpdate.mockReturnValue(updateChain);
  });

  describe('uploadBusinessSignature', () => {
    it('suspended business fails with ACCOUNT_SUSPENDED before any storage call (Policy P2: suspended = read-only)', async () => {
      const { ActionError } = await import('@/lib/actions/_shared/errors');
      mockAssertBusinessNotSuspended.mockRejectedValueOnce(
        new ActionError('Your account has been suspended.', { code: 'ACCOUNT_SUSPENDED' }),
      );

      const res = await uploadBusinessSignature({ base64Data: makeValidSignatureBase64() });

      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe('ACCOUNT_SUSPENDED');
      }
      expect(mockUploadFileToStorage).not.toHaveBeenCalled();
    });

    it('staff role fails with FORBIDDEN_ROLE before any storage call', async () => {
      mockGetCurrentAppUser.mockResolvedValue(dummyStaff);

      const res = await uploadBusinessSignature({
        base64Data: makeValidSignatureBase64(),
      });

      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe(FORBIDDEN_ROLE_CODE);
      }
      expect(mockUploadFileToStorage).not.toHaveBeenCalled();
    });

    it('invalid image (bad ratio) returns INVALID_SIGNATURE_IMAGE and aborts before upload', async () => {
      // 900x301 has invalid ratio
      const buf = Buffer.alloc(33);
      buf[0] = 0x89;
      buf[1] = 0x50;
      buf[2] = 0x4e;
      buf[3] = 0x47;
      buf[4] = 0x0d;
      buf[5] = 0x0a;
      buf[6] = 0x1a;
      buf[7] = 0x0a;
      buf.writeUInt32BE(13, 8);
      buf.write('IHDR', 12, 'ascii');
      buf.writeUInt32BE(900, 16);
      buf.writeUInt32BE(301, 20);
      buf.writeUInt8(8, 24);
      buf.writeUInt8(6, 25);
      const badBase64 = `data:image/png;base64,${buf.toString('base64')}`;

      const res = await uploadBusinessSignature({ base64Data: badBase64 });

      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe('INVALID_SIGNATURE_IMAGE');
        expect(res.error.fieldErrors?.signature).toBeDefined();
      }
      expect(mockUploadFileToStorage).not.toHaveBeenCalled();
    });

    it('success uploads to signatures/<businessId>/<uuid>.png with private no-store, writes audit signature_upload, deletes previous unreferenced key, and returns hasSignature: true (no key/url)', async () => {
      const res = await uploadBusinessSignature({
        base64Data: makeValidSignatureBase64(),
      });

      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data).toEqual({ hasSignature: true });
        // Response contains no key or URL
        expect((res.data as Record<string, unknown>).storageKey).toBeUndefined();
        expect((res.data as Record<string, unknown>).signatureUrl).toBeUndefined();
        expect((res.data as Record<string, unknown>).url).toBeUndefined();
      }

      // Upload called with expected key prefix and private cache control
      expect(mockUploadFileToStorage).toHaveBeenCalledTimes(1);
      const [storageKey, , mime, options] = mockUploadFileToStorage.mock.calls[0];
      expect(storageKey).toMatch(/^signatures\/biz_001\/[0-9a-f-]+\.png$/);
      expect(mime).toBe('image/png');
      expect(options).toEqual({
        contentDisposition: 'attachment',
        cacheControl: 'private, no-store',
      });

      // Audit row written
      expect(mockWriteAudit).toHaveBeenCalledTimes(1);
      const [, auditPayload] = mockWriteAudit.mock.calls[0];
      expect(auditPayload.action).toBe('signature_upload');
      expect(auditPayload.businessId).toBe('biz_001');
      expect(auditPayload.entityType).toBe('business');
      expect(auditPayload.metadata.signature_storage_key).toBe(storageKey);
      expect(auditPayload.metadata.previous_signature_storage_key).toBe('signatures/biz_001/prev.png');

      // Previous key deleted after commit
      expect(mockDeleteSignatureObjectIfUnreferenced).toHaveBeenCalledWith('biz_001', 'signatures/biz_001/prev.png');

      // Paths revalidated
      expect(mockRevalidatePath).toHaveBeenCalledWith('/settings');
      expect(mockRevalidatePath).toHaveBeenCalledWith('/invoices');
      expect(mockRevalidatePath).toHaveBeenCalledWith('/credit-notes');
    });

    it('DB failure during swap deletes only the newly uploaded object and rolls back', async () => {
      // Make DB transaction throw
      const selectChain = {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            for: vi.fn().mockRejectedValue(new Error('Simulated DB deadlock')),
          }),
        }),
      };
      mockTxSelect.mockReturnValue(selectChain);

      const res = await uploadBusinessSignature({
        base64Data: makeValidSignatureBase64(),
      });

      expect(res.success).toBe(false);
      // New object was deleted to prevent orphan storage
      expect(mockDeleteFileFromStorage).toHaveBeenCalledTimes(1);
      const deletedKey = mockDeleteFileFromStorage.mock.calls[0][0];
      expect(deletedKey).toMatch(/^signatures\/biz_001\/[0-9a-f-]+\.png$/);
      // Previous key was NOT touched
      expect(mockDeleteSignatureObjectIfUnreferenced).not.toHaveBeenCalled();
    });
  });

  describe('removeBusinessSignature', () => {
    it('staff role fails with FORBIDDEN_ROLE', async () => {
      mockGetCurrentAppUser.mockResolvedValue(dummyStaff);

      const res = await removeBusinessSignature({});

      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe(FORBIDDEN_ROLE_CODE);
      }
    });

    it('success updates business, writes signature_remove audit, deletes previous key if unreferenced, returns hasSignature: false', async () => {
      const res = await removeBusinessSignature({});

      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data).toEqual({ hasSignature: false });
      }

      expect(mockWriteAudit).toHaveBeenCalledTimes(1);
      const [, auditPayload] = mockWriteAudit.mock.calls[0];
      expect(auditPayload.action).toBe('signature_remove');
      expect(auditPayload.metadata.previous_signature_storage_key).toBe('signatures/biz_001/prev.png');

      expect(mockDeleteSignatureObjectIfUnreferenced).toHaveBeenCalledWith('biz_001', 'signatures/biz_001/prev.png');
      expect(mockRevalidatePath).toHaveBeenCalledWith('/settings');
      expect(mockRevalidatePath).toHaveBeenCalledWith('/invoices');
      expect(mockRevalidatePath).toHaveBeenCalledWith('/credit-notes');
    });
  });
});
