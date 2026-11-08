// scripts/ci/audit-gate-core.mjs
// SEC-007: Core evaluation logic for dependency audit gate. Zero dependencies.

const GHSA_REGEX = /^GHSA(-[23456789cfghjmpqrvwx]{4}){3}$/;

/**
 * Validates the schema and values of an audit allowlist object.
 * Throws a descriptive Error if validation fails, returns true if valid.
 *
 * @param {any} allowlist
 * @returns {boolean}
 */
export function validateAllowlist(allowlist) {
  if (!allowlist || typeof allowlist !== 'object') {
    throw new Error('Invalid allowlist: root must be an object');
  }
  if (!Array.isArray(allowlist.entries)) {
    throw new Error('Invalid allowlist: missing or non-array "entries" property');
  }

  for (let i = 0; i < allowlist.entries.length; i++) {
    const entry = allowlist.entries[i];
    if (!entry || typeof entry !== 'object') {
      throw new Error(`Invalid allowlist: entry ${i} must be an object`);
    }

    if (!entry.ghsa || typeof entry.ghsa !== 'string' || !GHSA_REGEX.test(entry.ghsa)) {
      throw new Error(
        `Invalid allowlist: entry ${i} has invalid GHSA id '${entry.ghsa}' (must match /^GHSA(-[23456789cfghjmpqrvwx]{4}){3}$/)`
      );
    }

    if (!entry.package || typeof entry.package !== 'string' || entry.package.trim() === '') {
      throw new Error(`Invalid allowlist: entry ${i} (${entry.ghsa}) missing or invalid "package"`);
    }

    if (!entry.severity || typeof entry.severity !== 'string') {
      throw new Error(`Invalid allowlist: entry ${i} (${entry.ghsa}) missing or invalid "severity"`);
    }

    if (!entry.expires || typeof entry.expires !== 'string') {
      throw new Error(`Invalid allowlist: entry ${i} (${entry.ghsa}) missing "expires"`);
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.expires)) {
      throw new Error(
        `Invalid allowlist: entry ${i} (${entry.ghsa}) "expires" must be YYYY-MM-DD, got '${entry.expires}'`
      );
    }

    const [y, m, d] = entry.expires.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
      throw new Error(
        `Invalid allowlist: entry ${i} (${entry.ghsa}) "expires" is not a valid calendar date: '${entry.expires}'`
      );
    }

    if (!entry.reason || typeof entry.reason !== 'string' || entry.reason.length < 20) {
      throw new Error(
        `Invalid allowlist: entry ${i} (${entry.ghsa}) "reason" must be at least 20 characters long`
      );
    }
  }

  return true;
}

/**
 * Fail closed: pnpm can print VALID JSON that is not an audit report (e.g. {"error": {...}} when the registry
 * audit endpoint is unreachable, or {} on an odd response). Treating that as "no advisories" would silently pass CI.
 * Throws unless the object looks like a real report: no "error" key, an "advisories" object and a "metadata" object.
 *
 * @param {any} auditJson
 * @returns {true}
 */
export function assertAuditReport(auditJson) {
  if (!auditJson || typeof auditJson !== 'object' || Array.isArray(auditJson)) {
    throw new Error('Audit output is not a JSON object.');
  }
  if (auditJson.error) {
    const detail = typeof auditJson.error === 'object' ? JSON.stringify(auditJson.error) : String(auditJson.error);
    throw new Error(`pnpm audit reported an error instead of a report: ${detail.slice(0, 500)}`);
  }
  if (!auditJson.advisories || typeof auditJson.advisories !== 'object' || Array.isArray(auditJson.advisories)) {
    throw new Error('Audit output has no "advisories" object - refusing to treat it as a clean report.');
  }
  if (!auditJson.metadata || typeof auditJson.metadata !== 'object') {
    throw new Error('Audit output has no "metadata" object - refusing to treat it as a clean report.');
  }
  return true;
}

/**
 * Evaluates pnpm audit JSON against the allowlist and current date.
 *
 * @param {any} auditJson
 * @param {any} allowlist
 * @param {string} [todayIso]
 * @returns {{
 *   blocking: Array<any>,
 *   allowed: Array<any>,
 *   expired: Array<any>,
 *   stale: Array<any>,
 *   counts: { low: number, moderate: number, high: number, critical: number, total: number }
 * }}
 */
export function evaluateAudit(auditJson, allowlist, todayIso) {
  const today = todayIso || new Date().toISOString().slice(0, 10);
  const entries = Array.isArray(allowlist) ? allowlist : (allowlist?.entries || []);

  const counts = {
    low: 0,
    moderate: 0,
    high: 0,
    critical: 0,
    total: 0,
  };

  const advisoriesMap = auditJson?.advisories || {};
  const advisories = Object.values(advisoriesMap);

  for (const adv of advisories) {
    const sev = (adv.severity || '').toLowerCase();
    if (Object.prototype.hasOwnProperty.call(counts, sev)) {
      counts[sev]++;
    }
    counts.total++;
  }

  const blocking = [];
  const allowed = [];
  const expired = [];
  const matchedEntryIndices = new Set();

  for (const adv of advisories) {
    const severity = (adv.severity || '').toLowerCase();
    if (severity !== 'high' && severity !== 'critical') {
      continue;
    }

    const ghsa = adv.github_advisory_id || adv.cve || String(adv.id || '');
    const pkg = adv.module_name || adv.package || '';
    const firstPath = adv.findings?.[0]?.paths?.[0] || adv.findings?.[0]?.version || '';

    let matchedIndex = -1;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (entry.ghsa === ghsa && entry.package === pkg) {
        matchedIndex = i;
        break;
      }
    }

    const advRecord = {
      ...adv,
      ghsa,
      github_advisory_id: ghsa,
      package: pkg,
      module_name: pkg,
      severity,
      title: adv.title || '',
      patched_versions: adv.patched_versions || '',
      first_path: firstPath,
    };

    if (matchedIndex === -1) {
      blocking.push(advRecord);
    } else {
      matchedEntryIndices.add(matchedIndex);
      const matchedEntry = entries[matchedIndex];
      advRecord.expires = matchedEntry.expires;
      advRecord.reason = matchedEntry.reason;

      if (today <= matchedEntry.expires) {
        allowed.push(advRecord);
      } else {
        expired.push(advRecord);
        blocking.push(advRecord);
      }
    }
  }

  const stale = [];
  for (let i = 0; i < entries.length; i++) {
    if (!matchedEntryIndices.has(i)) {
      stale.push(entries[i]);
    }
  }

  return {
    blocking,
    allowed,
    expired,
    stale,
    counts,
  };
}

