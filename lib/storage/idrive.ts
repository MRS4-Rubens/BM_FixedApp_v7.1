import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getStorageEnv } from '@/lib/env';

interface StorageContext {
  readonly client: S3Client;
  readonly bucket: string;
}

let context: StorageContext | undefined;

function getStorage(): StorageContext {
  if (context === undefined) {
    const env = getStorageEnv();
    context = {
      // forcePathStyle: often required by S3-compatible providers such as iDrive e2. Endpoint is normalised by lib/env.ts.
      client: new S3Client({
        endpoint: env.IDRIVE_E2_ENDPOINT,
        region: env.IDRIVE_E2_REGION,
        credentials: { accessKeyId: env.IDRIVE_E2_ACCESS_KEY, secretAccessKey: env.IDRIVE_E2_SECRET_KEY },
        forcePathStyle: true,
      }),
      bucket: env.IDRIVE_E2_BUCKET_NAME,
    };
  }
  return context;
}

/** Lazily constructed S3 client. Throws EnvConfigError if storage variables are invalid. */
export function getS3(): S3Client {
  return getStorage().client;
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

/**
 * Generates a signed URL for downloading an object, expiring in the specified seconds.
 */
export async function getSignedDownloadUrl(
  key: string,
  expirySeconds: number = 300,
  options: SignedUrlOptions = {}
): Promise<string> {
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
