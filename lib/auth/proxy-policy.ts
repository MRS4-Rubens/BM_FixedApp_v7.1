/**
 * AUTH-005: decides whether a request is a genuine Server Action call that may skip the proxy's auth
 * middleware. Real Server Action requests from React are POST + `next-action` header + a body of
 * `text/plain` (serialized args) or `multipart/form-data` (FormData args). Every condition is required,
 * because the header alone is client-controlled. Actions still enforce the session themselves
 * (createAuthenticatedAction), so skipping the proxy for them is safe.
 */
export interface ProxyRequestShape {
  readonly method: string;
  readonly headers: Pick<Headers, 'get' | 'has'>;
}

const SERVER_ACTION_CONTENT_TYPES = ['text/plain', 'multipart/form-data'] as const;

export function isServerActionRequest(request: ProxyRequestShape): boolean {
  if (request.method.toUpperCase() !== 'POST') return false;
  if (!request.headers.has('next-action')) return false;
  const contentType = (request.headers.get('content-type') ?? '').trim().toLowerCase();
  return SERVER_ACTION_CONTENT_TYPES.some((type) => contentType.startsWith(type));
}

