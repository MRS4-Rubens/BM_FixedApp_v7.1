import { withSentryConfig } from "@sentry/nextjs";
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

export default withSentryConfig(nextConfig, {
  org: "bill-matrix",
  project: "bill-matrix",
  silent: !process.env.CI,
  widenClientFileUpload: true,
});
