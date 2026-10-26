/**
 * Normalises an S3-compatible endpoint into a canonical origin.
 *
 * Accepts all of:
 *   s3.ap-northeast-1.idrivee2.com
 *   https://s3.ap-northeast-1.idrivee2.com
 *   https://s3.ap-northeast-1.idrivee2.com/
 *   localhost:9000          (https assumed)
 *   http://localhost:9000   (explicit http allowed for local S3 emulators)
 *
 * Always returns `<scheme>://<host>[:port]` with no trailing slash.
 * Throws a generic Error (never echoing the input) when the value is unusable.
 */

const EXPLICIT_SCHEME = /^[a-z][a-z\d+.-]*:\/\//i;

export function normalizeS3Endpoint(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error('endpoint is empty.');
  }

  const candidate = EXPLICIT_SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error('endpoint is not a valid URL.');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('endpoint must use http or https.');
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new Error('endpoint must not contain credentials.');
  }
  if (
    parsed.pathname.replace(/\/+$/, '') !== '' ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    throw new Error('endpoint must be a bare host with no path, query or fragment.');
  }

  return parsed.origin;
}
