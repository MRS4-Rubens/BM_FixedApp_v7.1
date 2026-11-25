import { withSentryConfig } from "@sentry/nextjs/config";
import { buildSecurityHeaderRules } from "./config/security-headers.mjs";

/** @type {import('next').NextConfig} */
// LAUNCH-L2: one release name for Sentry on Vercel or Render (Render sets RENDER_GIT_COMMIT at build time).
const releaseName = process.env.VERCEL_GIT_COMMIT_SHA || process.env.RENDER_GIT_COMMIT || '';

const nextConfig = {
  // Inlined into browser code so client-side Sentry events carry the same release as the server.
  env: { NEXT_PUBLIC_SENTRY_RELEASE: releaseName },
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  logging: {
    // Reset callbacks can carry a live credential in the URL.
    incomingRequests: { ignore: [/^\/(?:api\/auth\/)?reset-password(?:[/?]|$)/] },
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

if ((process.env.VERCEL_ENV === 'production' || process.env.RENDER === 'true') && (!sentryOrg || !sentryProject || !sentryAuthToken)) {
  console.warn('[sentry] SENTRY_ORG / SENTRY_PROJECT / SENTRY_AUTH_TOKEN missing: source maps will NOT be uploaded');
}

export default withSentryConfig(nextConfig, {
  org: sentryOrg,
  project: sentryProject,
  authToken: sentryAuthToken,
  ...(releaseName ? { release: { name: releaseName } } : {}),
  silent: !process.env.CI,
  widenClientFileUpload: true,
});
