import { describe, expect, it } from 'vitest';
import {
  buildAppCspPolicy,
  buildSecurityHeaderRules,
  buildSentryCspReportUri,
  CSP_MODE,
  parseSentryDsn,
  parseStorageOrigins,
} from '../../config/security-headers.mjs';

const MOCK_DSN = 'https://abc123def456@o999999.ingest.sentry.io/1234567';
const MOCK_STORAGE = 'https://s3.ap-northeast-1.idrivee2.com';

describe('Security Headers & CSP (SEC-001)', () => {
  it('(1) sets the global headers and disables referrers from the password reset page', () => {
    const rules = buildSecurityHeaderRules({
      isProduction: true,
      sentryDsn: MOCK_DSN,
      storageEndpoint: MOCK_STORAGE,
    });

    expect(rules).toHaveLength(2);
    expect(rules[1]).toMatchObject({
      source: '/reset-password',
    });
    const globalRule = rules[0];
    expect(globalRule.source).toBe('/:path*');

    const headerMap = new Map(globalRule.headers.map((h) => [h.key, h.value]));
    expect(headerMap.get('Strict-Transport-Security')).toBe(
      'max-age=63072000; includeSubDomains; preload'
    );
    expect(headerMap.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headerMap.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(headerMap.get('Permissions-Policy')).toBe(
      'camera=(), microphone=(), geolocation=()'
    );
    expect(headerMap.get('X-Frame-Options')).toBe('DENY');
    expect(headerMap.get('Content-Security-Policy')).toBe(
      "frame-ancestors 'none'; base-uri 'self'; object-src 'none'"
    );
    expect(headerMap.get('Content-Security-Policy-Report-Only')).toBeTruthy();
    const resetHeaders = new Map(rules[1].headers.map(({ key, value }) => [key, value]));
    expect(resetHeaders.get('Referrer-Policy')).toBe('no-referrer');
    expect(resetHeaders.get('Cache-Control')).toBe('private, no-store');
    expect(resetHeaders.get('Content-Security-Policy')).toBe(headerMap.get('Content-Security-Policy'));
    const globalReportPolicy = headerMap.get('Content-Security-Policy-Report-Only');
    expect(globalReportPolicy).toContain('report-uri');
    expect(resetHeaders.get('Content-Security-Policy-Report-Only')).toBe(globalReportPolicy?.split('; report-uri ')[0]);
  });

  it('(2) isProduction: false omits HSTS and report-uri, and includes unsafe-eval and dev websockets', () => {
    const devRules = buildSecurityHeaderRules({
      isProduction: false,
      sentryDsn: MOCK_DSN,
      storageEndpoint: MOCK_STORAGE,
    });

    const headerMap = new Map(devRules[0].headers.map((h) => [h.key, h.value]));
    expect(headerMap.has('Strict-Transport-Security')).toBe(false);

    const devPolicy = headerMap.get('Content-Security-Policy-Report-Only');
    expect(devPolicy).toBeDefined();
    expect(devPolicy).toContain("'unsafe-eval'");
    expect(devPolicy).toContain('ws://localhost:*');
    expect(devPolicy).toContain('ws://127.0.0.1:*');
    expect(devPolicy).toContain('http://localhost:*');
    expect(devPolicy).not.toContain('report-uri');

    // Production policy must not have unsafe-eval
    const prodPolicy = buildAppCspPolicy({
      isProduction: true,
      sentryDsn: MOCK_DSN,
      storageEndpoint: MOCK_STORAGE,
    });
    expect(prodPolicy).not.toContain("'unsafe-eval'");
  });

  it('(3) validates full production CSP policy content and strictness', () => {
    const policy = buildAppCspPolicy({
      isProduction: true,
      sentryDsn: MOCK_DSN,
      storageEndpoint: MOCK_STORAGE,
    });

    // Directive checks
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("script-src 'self' 'unsafe-inline'");
    // LAUNCH-L2: Vercel Analytics removed, so its script and beacon origins are no longer allowed.
    expect(policy).not.toContain('vercel-scripts.com');
    expect(policy).not.toContain('vercel-insights.com');
    expect(policy).toContain("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com");
    expect(policy).toContain("font-src 'self' data: https://fonts.gstatic.com");
    expect(policy).toContain(
      "img-src 'self' data: blob: https://s3.ap-northeast-1.idrivee2.com https://*.s3.ap-northeast-1.idrivee2.com"
    );
    expect(policy).not.toContain('qrserver'); // SEC-03: the checkout QR is generated locally (FE-005)
    expect(policy).toContain(
      "connect-src 'self' https://*.sentry.io https://o999999.ingest.sentry.io"
    );
    expect(policy).toContain("worker-src 'self' blob:");
    expect(policy).toContain("manifest-src 'self'");
    expect(policy).toContain("frame-src 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'self'");
    expect(policy).toContain("form-action 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain('report-uri https://o999999.ingest.sentry.io/api/1234567/security/?');

    // Negative hygiene checks
    expect(policy).not.toMatch(/(^|\s)\*(?!\.)/); // No bare wildcard '*'
    expect(policy).not.toContain('http:');
    expect(policy).not.toContain("'unsafe-eval'");
  });

  it('(4) parseSentryDsn and buildSentryCspReportUri handle regional, self-hosted, and invalid DSNs', () => {
    // Standard SaaS DSN
    const dsn1 = 'https://PUBKEY@o123.ingest.sentry.io/456';
    expect(parseSentryDsn(dsn1)).toEqual({
      publicKey: 'PUBKEY',
      origin: 'https://o123.ingest.sentry.io',
      pathPrefix: '',
      projectId: '456',
    });
    expect(buildSentryCspReportUri(dsn1, 'production')).toBe(
      'https://o123.ingest.sentry.io/api/456/security/?sentry_key=PUBKEY&sentry_environment=production'
    );

    // Regional (DE) DSN
    const dsn2 = 'https://PUBKEY@o123.ingest.de.sentry.io/456';
    expect(parseSentryDsn(dsn2)?.origin).toBe('https://o123.ingest.de.sentry.io');

    // Self-hosted DSN with path prefix and trailing slash
    const dsn3 = 'https://PUBKEY@sentry.mycorp.com/prefix/sub/789/';
    expect(parseSentryDsn(dsn3)).toEqual({
      publicKey: 'PUBKEY',
      origin: 'https://sentry.mycorp.com',
      pathPrefix: '/prefix/sub',
      projectId: '789',
    });
    expect(buildSentryCspReportUri(dsn3, 'staging')).toBe(
      'https://sentry.mycorp.com/prefix/sub/api/789/security/?sentry_key=PUBKEY&sentry_environment=staging'
    );

    // Invalid / empty / non-numeric project IDs
    expect(parseSentryDsn(undefined)).toBeNull();
    expect(parseSentryDsn('')).toBeNull();
    expect(parseSentryDsn('not-a-url')).toBeNull();
    expect(parseSentryDsn('https://PUBKEY@sentry.io/not-a-number')).toBeNull();
    expect(parseSentryDsn('https://@sentry.io/123')).toBeNull();
    expect(buildSentryCspReportUri('invalid', 'production')).toBeNull();
  });

  it('(5) parseStorageOrigins handles with scheme, without scheme, trailing slash, with port, and garbage', () => {
    const expected = [
      'https://s3.ap-northeast-1.idrivee2.com',
      'https://*.s3.ap-northeast-1.idrivee2.com',
    ];

    // With scheme
    expect(parseStorageOrigins('https://s3.ap-northeast-1.idrivee2.com')).toEqual(expected);
    // Without scheme
    expect(parseStorageOrigins('s3.ap-northeast-1.idrivee2.com')).toEqual(expected);
    // Trailing slash
    expect(parseStorageOrigins('s3.ap-northeast-1.idrivee2.com/')).toEqual(expected);
    // With port
    expect(parseStorageOrigins('localhost:9000')).toEqual([
      'https://localhost:9000',
      'https://*.localhost:9000',
    ]);
    expect(parseStorageOrigins('s3.example.com:8443')).toEqual([
      'https://s3.example.com:8443',
      'https://*.s3.example.com:8443',
    ]);

    // Garbage / empty
    expect(parseStorageOrigins(undefined)).toEqual([]);
    expect(parseStorageOrigins('')).toEqual([]);
    expect(parseStorageOrigins('   ')).toEqual([]);
    expect(parseStorageOrigins(':::not:a:host:::')).toEqual([]);
    expect(parseStorageOrigins('garbage')).toEqual([]);
  });

  it('(6) CSP_MODE is report-only; enforce mode emits single Content-Security-Policy header', () => {
    // Intentional guard test: CSP_MODE must remain 'report-only' in this task
    expect(CSP_MODE).toBe('report-only');

    const enforceRules = buildSecurityHeaderRules(
      {
        isProduction: true,
        sentryDsn: MOCK_DSN,
      },
      'enforce'
    );

    const globalHeaders = enforceRules[0].headers;
    const cspHeaders = globalHeaders.filter((h) => h.key === 'Content-Security-Policy');
    const reportOnlyHeaders = globalHeaders.filter(
      (h) => h.key === 'Content-Security-Policy-Report-Only'
    );

    expect(cspHeaders).toHaveLength(1);
    expect(reportOnlyHeaders).toHaveLength(0);
    expect(cspHeaders[0].value).toContain("default-src 'self'");
    expect(cspHeaders[0].value).toContain("frame-ancestors 'none'");
    expect(enforceRules[1].headers.filter(({ key }) => key.startsWith('Content-Security-Policy'))).toEqual([
      { key: 'Content-Security-Policy', value: cspHeaders[0].value.split('; report-uri ')[0] },
    ]);
  });

  it('(7) No header value contains newlines or non-ASCII characters', () => {
    const rules = buildSecurityHeaderRules({
      isProduction: true,
      sentryDsn: MOCK_DSN,
      storageEndpoint: MOCK_STORAGE,
    });

    for (const rule of rules) {
      for (const header of rule.headers) {
        expect(header.key).not.toMatch(/[\r\n]/);
        expect(header.value).not.toMatch(/[\r\n]/);
        // ASCII check: character codes 0 to 127 only
        for (let i = 0; i < header.value.length; i++) {
          expect(header.value.charCodeAt(i)).toBeLessThanOrEqual(127);
        }
      }
    }
  });
});

