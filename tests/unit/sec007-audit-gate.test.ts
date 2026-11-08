// tests/unit/sec007-audit-gate.test.ts
import { describe, it, expect } from 'vitest';
import { assertAuditReport, evaluateAudit, validateAllowlist } from '../../scripts/ci/audit-gate-core.mjs';

describe('SEC-007: Audit Gate Core Logic', () => {
  it('correctly categorises blocking, allowed, and counts from fixture audit JSON', () => {
    const fixtureAuditJson = {
      advisories: {
        'adv-1': {
          id: 1,
          github_advisory_id: 'GHSA-pw9m-5jxm-xr6h',
          module_name: 'better-auth',
          severity: 'critical',
          title: 'Better Auth critical advisory',
          findings: [{ paths: ['.>@neondatabase/auth>better-auth'] }],
        },
        'adv-2': {
          id: 2,
          github_advisory_id: 'GHSA-xxxx-yyyy-zzzz',
          module_name: 'nanoid',
          severity: 'high',
          title: 'Nanoid high advisory',
          findings: [{ paths: ['.>nanoid'] }],
        },
        'adv-3': {
          id: 3,
          github_advisory_id: 'GHSA-mmmm-nnnn-oooo',
          module_name: 'glob',
          severity: 'moderate',
          title: 'Glob moderate advisory',
          findings: [{ paths: ['.>glob'] }],
        },
      },
    };

    const allowlist = {
      entries: [
        {
          ghsa: 'GHSA-pw9m-5jxm-xr6h',
          package: 'better-auth',
          severity: 'critical',
          expires: '2027-02-28',
          reason: 'Allowlisted server-side better-auth flaw for testing purposes',
        },
      ],
    };

    const result = evaluateAudit(fixtureAuditJson, allowlist, '2026-11-08');

    expect(result.blocking).toHaveLength(1);
    expect(result.blocking[0].package).toBe('nanoid');
    expect(result.allowed).toHaveLength(1);
    expect(result.allowed[0].package).toBe('better-auth');
    expect(result.counts).toEqual({
      critical: 1,
      high: 1,
      moderate: 1,
      low: 0,
      total: 3,
    });
  });

  it('marks an advisory as blocking and expired when today is past the expiry date', () => {
    const fixtureAuditJson = {
      advisories: {
        'adv-1': {
          id: 1,
          github_advisory_id: 'GHSA-pw9m-5jxm-xr6h',
          module_name: 'better-auth',
          severity: 'critical',
          title: 'Better Auth advisory',
          findings: [{ paths: ['.>@neondatabase/auth>better-auth'] }],
        },
      },
    };

    const allowlist = {
      entries: [
        {
          ghsa: 'GHSA-pw9m-5jxm-xr6h',
          package: 'better-auth',
          severity: 'critical',
          expires: '2027-02-28',
          reason: 'Allowlisted server-side better-auth flaw for testing purposes',
        },
      ],
    };

    // Reference date after expires
    const result = evaluateAudit(fixtureAuditJson, allowlist, '2027-03-01');

    expect(result.allowed).toHaveLength(0);
    expect(result.blocking).toHaveLength(1);
    expect(result.blocking[0].package).toBe('better-auth');
    expect(result.expired).toHaveLength(1);
    expect(result.expired[0].ghsa).toBe('GHSA-pw9m-5jxm-xr6h');
  });

  it('does not allow an advisory when GHSA matches but package differs', () => {
    const fixtureAuditJson = {
      advisories: {
        'adv-1': {
          id: 1,
          github_advisory_id: 'GHSA-pw9m-5jxm-xr6h',
          module_name: 'better-auth',
          severity: 'critical',
          title: 'Better Auth advisory',
          findings: [{ paths: ['.>@neondatabase/auth>better-auth'] }],
        },
      },
    };

    const allowlist = {
      entries: [
        {
          ghsa: 'GHSA-pw9m-5jxm-xr6h',
          package: 'other-package',
          severity: 'critical',
          expires: '2027-02-28',
          reason: 'Different package name should not match the incoming advisory',
        },
      ],
    };

    const result = evaluateAudit(fixtureAuditJson, allowlist, '2026-11-08');

    expect(result.allowed).toHaveLength(0);
    expect(result.blocking).toHaveLength(1);
    expect(result.blocking[0].package).toBe('better-auth');
  });

  it('detects stale allowlist entries without blocking', () => {
    const fixtureAuditJson = {
      advisories: {},
    };

    const allowlist = {
      entries: [
        {
          ghsa: 'GHSA-pw9m-5jxm-xr6h',
          package: 'better-auth',
          severity: 'critical',
          expires: '2027-02-28',
          reason: 'Entry that does not match any current finding in the audit JSON',
        },
      ],
    };

    const result = evaluateAudit(fixtureAuditJson, allowlist, '2026-11-08');

    expect(result.blocking).toHaveLength(0);
    expect(result.allowed).toHaveLength(0);
    expect(result.stale).toHaveLength(1);
    expect(result.stale[0].ghsa).toBe('GHSA-pw9m-5jxm-xr6h');
  });

  it('leaves blocking empty when only moderate and low advisories are present', () => {
    const fixtureAuditJson = {
      advisories: {
        'adv-1': {
          id: 1,
          github_advisory_id: 'GHSA-1111-2222-3333',
          module_name: 'deepmerge',
          severity: 'low',
          title: 'Deepmerge low vulnerability',
        },
        'adv-2': {
          id: 2,
          github_advisory_id: 'GHSA-4444-5555-6666',
          module_name: 'glob',
          severity: 'moderate',
          title: 'Glob moderate vulnerability',
        },
      },
    };

    const allowlist = { entries: [] };
    const result = evaluateAudit(fixtureAuditJson, allowlist, '2026-11-08');

    expect(result.blocking).toHaveLength(0);
    expect(result.counts.low).toBe(1);
    expect(result.counts.moderate).toBe(1);
    expect(result.counts.total).toBe(2);
  });

  describe('validateAllowlist schema verification', () => {
    it('accepts a valid allowlist', () => {
      const valid = {
        entries: [
          {
            ghsa: 'GHSA-pw9m-5jxm-xr6h',
            package: 'better-auth',
            severity: 'critical',
            expires: '2027-02-28',
            reason: 'Valid reason exceeding twenty characters in length',
          },
        ],
      };
      expect(validateAllowlist(valid)).toBe(true);
    });

    it('rejects bad GHSA format', () => {
      const invalid = {
        entries: [
          {
            ghsa: 'INVALID-GHSA-FORMAT',
            package: 'better-auth',
            severity: 'critical',
            expires: '2027-02-28',
            reason: 'Valid reason exceeding twenty characters in length',
          },
        ],
      };
      expect(() => validateAllowlist(invalid)).toThrow(/invalid GHSA/i);
    });

    it('rejects missing expiry', () => {
      const invalid = {
        entries: [
          {
            ghsa: 'GHSA-pw9m-5jxm-xr6h',
            package: 'better-auth',
            severity: 'critical',
            reason: 'Valid reason exceeding twenty characters in length',
          },
        ],
      };
      expect(() => validateAllowlist(invalid)).toThrow(/missing "expires"/i);
    });

    it('rejects bad date format or invalid calendar date', () => {
      const badFormat = {
        entries: [
          {
            ghsa: 'GHSA-pw9m-5jxm-xr6h',
            package: 'better-auth',
            severity: 'critical',
            expires: '2027/02/28',
            reason: 'Valid reason exceeding twenty characters in length',
          },
        ],
      };
      expect(() => validateAllowlist(badFormat)).toThrow(/must be YYYY-MM-DD/i);

      const invalidDate = {
        entries: [
          {
            ghsa: 'GHSA-pw9m-5jxm-xr6h',
            package: 'better-auth',
            severity: 'critical',
            expires: '2027-02-31',
            reason: 'Valid reason exceeding twenty characters in length',
          },
        ],
      };
      expect(() => validateAllowlist(invalidDate)).toThrow(/not a valid calendar date/i);
    });

    it('rejects reason shorter than 20 characters', () => {
      const shortReason = {
        entries: [
          {
            ghsa: 'GHSA-pw9m-5jxm-xr6h',
            package: 'better-auth',
            severity: 'critical',
            expires: '2027-02-28',
            reason: 'Too short',
          },
        ],
      };
      expect(() => validateAllowlist(shortReason)).toThrow(/at least 20 characters/i);
    });
  });
});


describe('SEC-007 reviewer: audit gate fails closed on non-report output', () => {
  it('rejects pnpm error JSON, empty objects and missing advisories/metadata', () => {
    expect(() => assertAuditReport({ error: { code: 'ERR_PNPM_AUDIT_BAD_RESPONSE', message: 'registry down' } })).toThrow(
      /reported an error/,
    );
    expect(() => assertAuditReport({})).toThrow(/no "advisories"/);
    expect(() => assertAuditReport({ advisories: {} })).toThrow(/no "metadata"/);
    expect(() => assertAuditReport([])).toThrow(/not a JSON object/);
    expect(() => assertAuditReport(null)).toThrow(/not a JSON object/);
  });

  it('accepts a real (even clean) report', () => {
    expect(assertAuditReport({ advisories: {}, metadata: { vulnerabilities: {} } })).toBe(true);
  });

  it('the CLI exits 2 (not 0) when the audit output is error JSON', async () => {
    const { spawnSync } = await import('node:child_process');
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'sec007-'));
    const input = join(dir, 'audit.json');
    writeFileSync(input, JSON.stringify({ error: { code: 'ERR_PNPM_AUDIT_BAD_RESPONSE' } }));
    const run = spawnSync(process.execPath, ['scripts/ci/audit-gate.mjs', '--input', input], { encoding: 'utf8' });
    expect(run.status).toBe(2);
    expect(run.stderr).toMatch(/reported an error/);
  });
});
