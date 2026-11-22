import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, type S3ClientConfig } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getStorageEnv, type StorageEnv } from '@/lib/env';

/**
 * SVC-01: without these the SDK waits forever on a hanging IDrive call (its default requestTimeout is 0, and a
 * requestTimeout only LOGS a warning unless throwOnRequestTimeout is set), so uploads, the logo route, PDF building
 * and archival uploads could hang past Render's proxy limit or the 300 s archival lease.
 * requestTimeout stops at the response HEADERS; socketTimeout (idle socket) keeps watching while a response body is
 * read, so a download that stalls halfway (getFileBuffer) also fails instead of hanging.
 * Normal calls take well under a second (logo <= 30 KB, PDFs ~210 KB). Worst case per call:
 * 2 attempts x (5 s connect + 20 s request) = 50 s, plus at most 20 s of silence while reading a body.
 */
export const STORAGE_CONNECTION_TIMEOUT_MS = 5_000;
export const STORAGE_REQUEST_TIMEOUT_MS = 20_000;
export const STORAGE_SOCKET_IDLE_TIMEOUT_MS = 20_000;
export const STORAGE_MAX_ATTEMPTS = 2;

export function buildStorageClientConfig(
  env: StorageEnv,
  timeouts: {
    readonly connectionTimeoutMs: number;
    readonly requestTimeoutMs: number;
    readonly socketIdleTimeoutMs: number;
  } = {
    connectionTimeoutMs: STORAGE_CONNECTION_TIMEOUT_MS,
    requestTimeoutMs: STORAGE_REQUEST_TIMEOUT_MS,
    socketIdleTimeoutMs: STORAGE_SOCKET_IDLE_TIMEOUT_MS,
  },
): S3ClientConfig {
  return {
    endpoint: env.IDRIVE_E2_ENDPOINT,
    region: env.IDRIVE_E2_REGION,
    credentials: { accessKeyId: env.IDRIVE_E2_ACCESS_KEY, secretAccessKey: env.IDRIVE_E2_SECRET_KEY },
    // forcePathStyle: often required by S3-compatible providers such as iDrive e2. Endpoint is normalised by lib/env.ts.
    forcePathStyle: true,
    maxAttempts: STORAGE_MAX_ATTEMPTS,
    requestHandler: {
      connectionTimeout: timeouts.connectionTimeoutMs,
      requestTimeout: timeouts.requestTimeoutMs,
      throwOnRequestTimeout: true,
      socketTimeout: timeouts.socketIdleTimeoutMs,
    },
  };
}

interface StorageContext {
  readonly client: S3Client;
  readonly bucket: string;
}

let context: StorageContext | undefined;

function getStorage(): StorageContext {
  if (context === undefined) {
    const env = getStorageEnv();
    context = {
      client: new S3Client(buildStorageClientConfig(env)),
      bucket: env.IDRIVE_E2_BUCKET_NAME,
    };
  }
  return context;
}

export interface UploadObjectOptions {
  readonly contentDisposition?: string;
  readonly cacheControl?: string;
}

/**
 * Uploads a file buffer to the configured iDrive e2 bucket.
 */
export async function uploadFileToStorage(
  key: string,
  body: Buffer,
  contentType: string,
  options: UploadObjectOptions = {}
): Promise<void> {
  const { client, bucket } = getStorage();
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
    ContentDisposition: options.contentDisposition,
    CacheControl: options.cacheControl,
  });

  await client.send(command);
}

export interface SignedUrlOptions {
  /** Opt-in: forces `Content-Disposition: attachment` so the object can never render as a page in a browser. */
  readonly forceDownload?: boolean;
}

/** Hard ceiling for any presigned URL issued by this app (SEC-003). */
export const MAX_SIGNED_URL_EXPIRY_SECONDS = 3600;

/**
 * Generates a signed URL for downloading an object, expiring in the specified seconds.
 */
export async function getSignedDownloadUrl(
  key: string,
  expirySeconds: number = 300,
  options: SignedUrlOptions = {}
): Promise<string> {
  if (!Number.isInteger(expirySeconds) || expirySeconds < 1 || expirySeconds > MAX_SIGNED_URL_EXPIRY_SECONDS) {
    throw new RangeError(`Signed URL expiry must be an integer between 1 and ${MAX_SIGNED_URL_EXPIRY_SECONDS} seconds`);
  }
  const { client, bucket } = getStorage();
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
    ResponseContentDisposition: options.forceDownload ? 'attachment' : undefined,
  });

  return await getSignedUrl(client, command, { expiresIn: expirySeconds });
}

/**
 * Fetches an object from the configured iDrive e2 bucket and returns it as a Buffer.
 */
export async function getFileBuffer(key: string): Promise<Buffer> {
  const { client, bucket } = getStorage();
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  const response = await client.send(command);
  
  if (!response.Body) {
    throw new Error('No body returned from S3 GetObjectCommand');
  }

  const byteArray = await response.Body.transformToByteArray();
  return Buffer.from(byteArray);
}

/**
 * Deletes an object from the configured iDrive e2 bucket.
 */
export async function deleteFileFromStorage(key: string): Promise<void> {
  const { client, bucket } = getStorage();
  const command = new DeleteObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  await client.send(command);
}
