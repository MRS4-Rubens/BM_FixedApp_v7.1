// @ts-check
/**
 * SEC-001: single source of truth for HTTP security headers (consumed by next.config.mjs and unit-tested).
 * Plain ESM + JSDoc because Next loads next.config.mjs with Node (no TypeScript transpilation).
 */

/** Flip to 'enforce' in a dedicated PR after Sentry shows no unexpected violations (see ARCHITECTURE.md). */
export const CSP_MODE = 'report-only';

const HSTS_VALUE = 'max-age=63072000; includeSubDomains; preload';
const PERMISSIONS_POLICY_VALUE = 'camera=(), microphone=(), geolocation=()';

/** @typedef {{ key: string, value: string }} HeaderEntry */
/** @typedef {{ source: string, headers: HeaderEntry[] }} HeaderRule */
/** @typedef {{ isProduction: boolean, sentryDsn?: string | undefined, storageEndpoint?: string | undefined }} SecurityHeaderOptions */
/** @typedef {{ publicKey: string, origin: string, pathPrefix: string, projectId: string }} ParsedSentryDsn */

/**
 * @param {string | undefined} dsn
 * @returns {ParsedSentryDsn | null}
 */
export function parseSentryDsn(dsn) {
  if (typeof dsn !== 'string' || dsn.trim() === '') return null;
  try {
    const url = new URL(dsn.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    const publicKey = decodeURIComponent(url.username);
    const segments = url.pathname.split('/').filter((segment) => segment !== '');
    const projectId = segments.pop();
    if (publicKey === '' || projectId === undefined || !/^\d+$/.test(projectId)) return null;
    const pathPrefix = segments.length > 0 ? `/${segments.join('/')}` : '';
    return { publicKey, origin: url.origin, pathPrefix, projectId };
  } catch {
    return null;
  }
}

/**
 * Sentry "security" ingestion endpoint for CSP reports (derived from the public DSN).
 * @param {string | undefined} dsn
 * @param {string} environment
 * @returns {string | null}
 */
export function buildSentryCspReportUri(dsn, environment) {
  const parsed = parseSentryDsn(dsn);
  if (parsed === null) return null;
  const query = new URLSearchParams({ sentry_key: parsed.publicKey, sentry_environment: environment });
  return `${parsed.origin}${parsed.pathPrefix}/api/${parsed.projectId}/security/?${query.toString()}`;
}

/**
 * Origins from which signed storage URLs (admin proof images) are served: path-style host and virtual-hosted-style subdomains.
 * @param {string | undefined} endpoint
 * @returns {string[]}
 */
export function parseStorageOrigins(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.trim() === '') return [];
  try {
    const raw = endpoint.trim();
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return [];
    if (!url.hostname || (!url.hostname.includes('.') && url.hostname !== 'localhost')) return [];
    return [`https://${url.host}`, `https://*.${url.host}`];
  } catch {
    return [];
  }
}

/** @param {readonly (readonly [string, readonly string[]])[]} directives */
function serialize(directives) {
  return directives.map(([name, values]) => (values.length > 0 ? `${name} ${values.join(' ')}` : name)).join('; ');
}

/** Directives that are safe to ENFORCE today. */
function buildEnforcedCspBaseline() {
  return serialize([
    ['frame-ancestors', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['object-src', ["'none'"]],
  ]);
}

/** Full application policy (report-only for now). @param {SecurityHeaderOptions} options */
export function buildAppCspPolicy(options) {
  const reportUri = options.isProduction ? buildSentryCspReportUri(options.sentryDsn, 'production') : null;
  const sentry = parseSentryDsn(options.sentryDsn);
  const storageOrigins = parseStorageOrigins(options.storageEndpoint);
  /** @type {(readonly [string, readonly string[]])[]} */
  const directives = [
    ['default-src', ["'self'"]],
    ['script-src', ["'self'", "'unsafe-inline'", 'https://va.vercel-scripts.com', ...(options.isProduction ? [] : ["'unsafe-eval'"])]],
    // fonts.googleapis.com: inline @import in invoice templates 1-4 (tracked debt: self-host Lora).
    ['style-src', ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com']],
    ['font-src', ["'self'", 'data:', 'https://fonts.gstatic.com']],
    // api.qrserver.com: checkout QR (REMOVE when FE-005 lands, before enforcing). Storage origins: admin payment-proof lightbox.
    ['img-src', ["'self'", 'data:', 'blob:', 'https://api.qrserver.com', ...storageOrigins]],
    ['connect-src', ["'self'", 'https://*.sentry.io', ...(sentry !== null ? [sentry.origin] : []), 'https://vitals.vercel-insights.com',
      ...(options.isProduction ? [] : ['ws://localhost:*', 'ws://127.0.0.1:*', 'http://localhost:*'])]],
    ['worker-src', ["'self'", 'blob:']],
    ['manifest-src', ["'self'"]],
    ['frame-src', ["'none'"]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['form-action', ["'self'"]],
    ['frame-ancestors', ["'none'"]],
  ];
  if (reportUri !== null) directives.push(['report-uri', [reportUri]]);
  return serialize(directives);
}

/** @param {SecurityHeaderOptions} options @returns {HeaderEntry[]} */
function baseHeaders(options) {
  return [
    ...(options.isProduction ? [{ key: 'Strict-Transport-Security', value: HSTS_VALUE }] : []),
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: PERMISSIONS_POLICY_VALUE },
  ];
}

/** @param {string} fullPolicy @param {'report-only' | 'enforce'} mode @param {boolean} includeBaseline @returns {HeaderEntry[]} */
function cspHeaders(fullPolicy, mode, includeBaseline) {
  if (mode === 'enforce') return [{ key: 'Content-Security-Policy', value: fullPolicy }];
  return [
    ...(includeBaseline ? [{ key: 'Content-Security-Policy', value: buildEnforcedCspBaseline() }] : []),
    { key: 'Content-Security-Policy-Report-Only', value: fullPolicy },
  ];
}

/**
 * Header rules for next.config.mjs.
 * @param {SecurityHeaderOptions} options
 * @param {'report-only' | 'enforce'} [mode]
 * @returns {HeaderRule[]}
 */
export function buildSecurityHeaderRules(options, mode = CSP_MODE) {
  return [
    {
      source: '/:path*',
      headers: [
        ...baseHeaders(options),
        { key: 'X-Frame-Options', value: 'DENY' },
        ...cspHeaders(buildAppCspPolicy(options), mode, true),
      ],
    },
  ];
}

