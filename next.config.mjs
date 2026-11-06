import { withSentryConfig } from "@sentry/nextjs/config";
import { buildSecurityHeaderRules } from "./config/security-headers.mjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ['127.0.0.1', 'localhost', 'localhost:3000', '127.0.0.1:3000'],
  images: {
    unoptimized: true,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '6mb',
    },
  },
  poweredByHeader: false, // SEC-001: do not advertise the framework
  async headers() {
    // Config files are the only place allowed to read process.env directly (ARCH-002 exception).
    return buildSecurityHeaderRules({
      isProduction: process.env.NODE_ENV === 'production',
      sentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      storageEndpoint: process.env.IDRIVE_E2_ENDPOINT,
    });
  },
};

const sentryOrg = process.env.SENTRY_ORG;
const sentryProject = process.env.SENTRY_PROJECT;
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;

if (process.env.VERCEL_ENV === 'production' && (!sentryOrg || !sentryProject || !sentryAuthToken)) {
  console.warn('[sentry] SENTRY_ORG / SENTRY_PROJECT / SENTRY_AUTH_TOKEN missing: source maps will NOT be uploaded');
}

export default withSentryConfig(nextConfig, {
  org: sentryOrg,
  project: sentryProject,
  authToken: sentryAuthToken,
  ...(process.env.VERCEL_GIT_COMMIT_SHA ? { release: { name: process.env.VERCEL_GIT_COMMIT_SHA } } : {}),
  silent: !process.env.CI,
  widenClientFileUpload: true,
});
