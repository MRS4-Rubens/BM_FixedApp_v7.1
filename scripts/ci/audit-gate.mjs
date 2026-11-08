#!/usr/bin/env node
// scripts/ci/audit-gate.mjs
// SEC-007: Blocking CI dependency audit gate. Zero dependencies.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { assertAuditReport, evaluateAudit, validateAllowlist } from './audit-gate-core.mjs';

function parseArgs() {
  let inputFile = null;
  let allowlistFile = 'security/audit-allowlist.json';
  let today = new Date().toISOString().slice(0, 10);

  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--input' && args[i + 1]) {
      inputFile = args[++i];
    } else if (arg.startsWith('--input=')) {
      inputFile = arg.slice('--input='.length);
    } else if (arg === '--allowlist' && args[i + 1]) {
      allowlistFile = args[++i];
    } else if (arg.startsWith('--allowlist=')) {
      allowlistFile = arg.slice('--allowlist='.length);
    } else if (arg === '--today' && args[i + 1]) {
      today = args[++i];
    } else if (arg.startsWith('--today=')) {
      today = arg.slice('--today='.length);
    }
  }

  return { inputFile, allowlistFile, today };
}

function main() {
  const { inputFile, allowlistFile, today } = parseArgs();

  // 1. Read allowlist
  const allowlistPath = path.resolve(process.cwd(), allowlistFile);
  if (!fs.existsSync(allowlistPath)) {
    console.error(`Audit gate error: allowlist file not found at ${allowlistPath}`);
    process.exit(2);
  }

  let allowlist;
  try {
    const content = fs.readFileSync(allowlistPath, 'utf8');
    allowlist = JSON.parse(content);
  } catch (err) {
    console.error(`Audit gate error: failed to read/parse allowlist file: ${err.message}`);
    process.exit(2);
  }

  try {
    validateAllowlist(allowlist);
  } catch (err) {
    console.error(`Audit gate error: ${err.message}`);
    process.exit(2);
  }

  // 2. Read or run audit
  let auditJson;
  if (inputFile) {
    const inputPath = path.resolve(process.cwd(), inputFile);
    if (!fs.existsSync(inputPath)) {
      console.error(`Audit gate error: input file not found at ${inputPath}`);
      process.exit(2);
    }
    try {
      const raw = fs.readFileSync(inputPath, 'utf8');
      auditJson = JSON.parse(raw);
    } catch (err) {
      console.error(`Audit gate error: failed to parse JSON from ${inputPath}: ${err.message}`);
      process.exit(2);
    }
  } else {
    const isWin = process.platform === 'win32';
    const auditProc = spawnSync(isWin ? 'pnpm.cmd' : 'pnpm', ['audit', '--prod', '--json'], {
      shell: isWin,
      maxBuffer: 64 * 1024 * 1024,
      encoding: 'utf8',
    });

    if (auditProc.error) {
      console.error(`Audit gate error: failed to spawn pnpm: ${auditProc.error.message}`);
      process.exit(2);
    }

    try {
      auditJson = JSON.parse(auditProc.stdout || '');
    } catch {
      console.error('Audit gate error: stdout from "pnpm audit --prod --json" is not valid JSON.');
      if (auditProc.stderr) {
        console.error('Stderr from pnpm:');
        console.error(auditProc.stderr);
      }
      process.exit(2);
    }
  }

  // 3. Fail closed on anything that is not a real audit report (registry outage, error JSON, empty object).
  try {
    assertAuditReport(auditJson);
  } catch (err) {
    console.error(`Audit gate error: ${err.message}`);
    process.exit(2);
  }

  // 4. Evaluate audit
  const result = evaluateAudit(auditJson, allowlist, today);
  const { blocking, allowed, expired, stale, counts } = result;

  // Print warnings for expired entries
  for (const exp of expired) {
    console.log(`EXPIRED allowlist entry ${exp.ghsa} (expired ${exp.expires}) — re-review it`);
  }

  // Print warnings for stale entries
  for (const st of stale) {
    console.log(`STALE allowlist entry ${st.ghsa}`);
  }

  // Summary header & severity counts
  console.log('\n================ Dependency Audit Summary ================');
  console.log(
    `Counts by severity: critical=${counts.critical}, high=${counts.high}, moderate=${counts.moderate}, low=${counts.low} (total=${counts.total})`
  );
  console.log(`${counts.moderate + counts.low} moderate/low advisories (not blocking)\n`);

  if (allowed.length > 0) {
    console.log(`ALLOWED advisories (${allowed.length}):`);
    for (const item of allowed) {
      console.log(
        `  - [${item.severity.toUpperCase()}] ${item.package} ${item.ghsa} (expires: ${item.expires})`
      );
      if (item.reason) {
        console.log(`    Reason: ${item.reason}`);
      }
    }
    console.log('');
  }

  if (blocking.length > 0) {
    console.log(`BLOCKING advisories (${blocking.length}):`);
    for (const item of blocking) {
      console.log(
        `  - [${item.severity.toUpperCase()}] ${item.package} ${item.ghsa}: ${item.title}`
      );
      console.log(`    Patched versions: ${item.patched_versions || 'None'}`);
      if (item.first_path) {
        console.log(`    Path: ${item.first_path}`);
      }
    }
    console.log('\n==========================================================');
    console.log('Result: FAILED (blocking advisories detected)');
    process.exit(1);
  }

  console.log('==========================================================');
  console.log('Result: PASSED (all high/critical advisories allowlisted and active)');
  process.exit(0);
}

main();

