// scripts/ci/audit-gate-core.d.mts
// SEC-007: Type definitions for audit-gate-core.mjs

export interface AllowlistEntry {
  ghsa: string;
  package: string;
  severity: string;
  expires: string;
  reason: string;
}

export interface AuditAllowlist {
  $comment?: string;
  entries: AllowlistEntry[];
}

export interface AdvisoryFinding {
  version?: string;
  paths?: string[];
  dev?: boolean;
  optional?: boolean;
  bundled?: boolean;
}

export interface RawAdvisory {
  id?: number | string;
  github_advisory_id?: string;
  cve?: string;
  module_name?: string;
  package?: string;
  severity: string;
  title?: string;
  vulnerable_versions?: string;
  patched_versions?: string;
  url?: string;
  findings?: AdvisoryFinding[];
}

export interface AuditJson {
  advisories?: Record<string, RawAdvisory>;
  metadata?: Record<string, unknown>;
}

export interface EvaluatedAdvisory extends RawAdvisory {
  ghsa: string;
  package: string;
  module_name: string;
  severity: string;
  title: string;
  patched_versions: string;
  first_path: string;
  expires?: string;
  reason?: string;
}

export interface AuditCounts {
  low: number;
  moderate: number;
  high: number;
  critical: number;
  total: number;
}

export interface AuditEvaluationResult {
  blocking: EvaluatedAdvisory[];
  allowed: EvaluatedAdvisory[];
  expired: EvaluatedAdvisory[];
  stale: AllowlistEntry[];
  counts: AuditCounts;
}

export function validateAllowlist(allowlist: unknown): boolean;

export function evaluateAudit(
  auditJson: unknown,
  allowlist: unknown,
  todayIso?: string
): AuditEvaluationResult;


/** Throws unless the value is a real pnpm audit report (fails closed on error JSON / empty output). */
export function assertAuditReport(auditJson: unknown): true;
