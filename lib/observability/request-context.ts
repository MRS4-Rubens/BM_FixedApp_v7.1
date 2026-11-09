import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

const storage = new AsyncLocalStorage<string>();

const SAFE_REQUEST_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

export function runWithRequestId<T>(requestId: string, fn: () => Promise<T>): Promise<T> {
  return storage.run(requestId, fn);
}

export function currentRequestId(): string | undefined {
  return storage.getStore();
}

export function requestIdFromHeaders(h: { get(name: string): string | null }): string {
  const vercelId = h.get('x-vercel-id');
  if (vercelId && SAFE_REQUEST_ID_PATTERN.test(vercelId)) {
    return vercelId;
  }

  const requestId = h.get('x-request-id');
  if (requestId && SAFE_REQUEST_ID_PATTERN.test(requestId)) {
    return requestId;
  }

  return randomUUID();
}

