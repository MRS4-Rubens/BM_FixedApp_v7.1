import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  STORAGE_CONNECTION_TIMEOUT_MS,
  STORAGE_MAX_ATTEMPTS,
  STORAGE_REQUEST_TIMEOUT_MS,
  buildStorageClientConfig,
} from '@/lib/storage/idrive';

/** SVC-01: an IDrive call that hangs must fail within the configured timeout instead of hanging forever. */
const env = {
  IDRIVE_E2_ENDPOINT: 'https://s3.example.invalid',
  IDRIVE_E2_REGION: 'ap-southeast-2',
  IDRIVE_E2_BUCKET_NAME: 'bucket',
  IDRIVE_E2_ACCESS_KEY: 'test-access-key',
  IDRIVE_E2_SECRET_KEY: 'test-secret-key',
};

describe('SVC-01: storage client timeouts', () => {
  it('uses a 5 s connection timeout, a 20 s request timeout that THROWS, and 2 attempts', () => {
    const config = buildStorageClientConfig(env);
    expect(config.maxAttempts).toBe(STORAGE_MAX_ATTEMPTS);
    expect(STORAGE_MAX_ATTEMPTS).toBe(2);
    expect(config.requestHandler).toEqual({
      connectionTimeout: STORAGE_CONNECTION_TIMEOUT_MS,
      requestTimeout: STORAGE_REQUEST_TIMEOUT_MS,
      throwOnRequestTimeout: true,
    });
    expect([STORAGE_CONNECTION_TIMEOUT_MS, STORAGE_REQUEST_TIMEOUT_MS]).toEqual([5_000, 20_000]);
    expect(config.forcePathStyle).toBe(true);
  });

  describe('against a server that accepts the request and never answers', () => {
    let server: Server;
    let endpoint: string;
    let requests = 0;

    beforeAll(async () => {
      server = createServer(() => {
        requests += 1; // never respond
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it('rejects with a timeout after exactly 2 attempts instead of hanging', async () => {
      const client = new S3Client(
        buildStorageClientConfig({ ...env, IDRIVE_E2_ENDPOINT: endpoint }, { connectionTimeoutMs: 500, requestTimeoutMs: 300 }),
      );
      const started = Date.now();
      await expect(
        client.send(new PutObjectCommand({ Bucket: 'bucket', Key: 'logos/x.png', Body: Buffer.from('x'), ContentType: 'image/png' })),
      ).rejects.toThrow(/requestTimeout|timeout/i);
      expect(Date.now() - started).toBeLessThan(10_000);
      expect(requests).toBe(2);
      client.destroy();
    }, 20_000);
  });
});
