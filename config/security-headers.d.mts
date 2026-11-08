export type HeaderEntry = {
  key: string;
  value: string;
};

export type HeaderRule = {
  source: string;
  headers: HeaderEntry[];
};

export type SecurityHeaderOptions = {
  isProduction: boolean;
  sentryDsn?: string | undefined;
  storageEndpoint?: string | undefined;
};

export type ParsedSentryDsn = {
  publicKey: string;
  origin: string;
  pathPrefix: string;
  projectId: string;
};

export declare const CSP_MODE: 'report-only' | 'enforce';

export declare function parseSentryDsn(dsn: string | undefined): ParsedSentryDsn | null;

export declare function buildSentryCspReportUri(
  dsn: string | undefined,
  environment: string
): string | null;

export declare function parseStorageOrigins(endpoint: string | undefined): string[];

export declare function buildEnforcedCspBaseline(): string;

export declare function buildAppCspPolicy(options: SecurityHeaderOptions): string;

export declare function buildSecurityHeaderRules(
  options: SecurityHeaderOptions,
  mode?: 'report-only' | 'enforce'
): HeaderRule[];

