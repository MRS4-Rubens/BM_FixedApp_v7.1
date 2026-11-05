import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getSignedDownloadUrl, MAX_SIGNED_URL_EXPIRY_SECONDS } from '@/lib/storage/idrive';
import type { GetObjectCommand } from '@aws-sdk/client-s3';

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(async (_client: unknown, command: GetObjectCommand, options?: { expiresIn?: number }) => {
    return `https://storage.test/key?expiresIn=${options?.expiresIn}&disp=${command.input.ResponseContentDisposition ?? ''}`;
  }),
}));

vi.mock('@/lib/env', () => ({
  getStorageEnv: vi.fn(() => ({
    IDRIVE_E2_ENDPOINT: 'https://storage.test',
    IDRIVE_E2_REGION: 'us-east-1',
    IDRIVE_E2_ACCESS_KEY: 'test-key',
    IDRIVE_E2_SECRET_KEY: 'test-secret',
    IDRIVE_E2_BUCKET_NAME: 'test-bucket',
  })),
}));

describe('SEC-003: Signed URL guard and expiry ceiling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports MAX_SIGNED_URL_EXPIRY_SECONDS as 3600', () => {
    expect(MAX_SIGNED_URL_EXPIRY_SECONDS).toBe(3600);
  });

  it('allows 300s (default) and passes exact expiresIn to presigner', async () => {
    const url = await getSignedDownloadUrl('test/path.png');
    expect(getSignedUrl).toHaveBeenCalledTimes(1);
    const call = vi.mocked(getSignedUrl).mock.calls[0];
    expect(call?.[2]).toEqual({ expiresIn: 300 });
    expect(url).toContain('expiresIn=300');
  });

  it('allows 3600s and reaches presigner with expiresIn: 3600', async () => {
    const url = await getSignedDownloadUrl('test/path.png', 3600);
    expect(getSignedUrl).toHaveBeenCalledTimes(1);
    const call = vi.mocked(getSignedUrl).mock.calls[0];
    expect(call?.[2]).toEqual({ expiresIn: 3600 });
    expect(url).toContain('expiresIn=3600');
  });

  it.each([604800, 3601, 0, -1, 1.5, NaN])(
    'throws RangeError and never calls presigner for invalid expiry: %s',
    async (invalidExpiry) => {
      await expect(
        getSignedDownloadUrl('test/path.png', invalidExpiry)
      ).rejects.toThrow(RangeError);
      expect(getSignedUrl).not.toHaveBeenCalled();
    }
  );

  it('sets ResponseContentDisposition: "attachment" when forceDownload is true', async () => {
    await getSignedDownloadUrl('test/path.png', 300, { forceDownload: true });
    expect(getSignedUrl).toHaveBeenCalledTimes(1);
    const call = vi.mocked(getSignedUrl).mock.calls[0];
    const command = call?.[1] as GetObjectCommand;
    expect(command.input.ResponseContentDisposition).toBe('attachment');
  });

  it('leaves ResponseContentDisposition undefined when forceDownload is false or omitted', async () => {
    await getSignedDownloadUrl('test/path.png', 300);
    expect(getSignedUrl).toHaveBeenCalledTimes(1);
    const call = vi.mocked(getSignedUrl).mock.calls[0];
    const command = call?.[1] as GetObjectCommand;
    expect(command.input.ResponseContentDisposition).toBeUndefined();
  });
});

