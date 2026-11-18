/**
 * scripts/ci/upstash-local-proxy-core.ts
 *
 * CI ONLY (E2E). The browser tests run the app against a local Redis through serverless-redis-http (SRH), so test
 * rate-limit counters never touch the one free Upstash database (Upstash terms: one free account per person).
 *
 * Problem: @upstash/ratelimit's Lua scripts start with `#!lua flags=allow-key-locking`. That flag is an
 * Upstash-only extension (it tells Upstash which keys a script locks); normal Redis rejects it with
 * "ERR Unexpected flag in script shebang". This module removes ONLY that flag from scripts on their way to SRH.
 * The script body (the rate-limit logic) is never changed.
 *
 * EVALSHA: the library first calls EVALSHA with the hash of the ORIGINAL script and falls back to EVAL on NOSCRIPT.
 * Redis stores the cleaned script under a different hash, so we remember original-hash → cleaned-hash and rewrite
 * later EVALSHA calls, which keeps the normal "load once, then call by hash" behaviour.
 */
import { createHash } from 'node:crypto';

const UPSTASH_ONLY_FLAGS = new Set(['allow-key-locking']);
const SHEBANG = /^#!lua([^\n]*)\n/;

export function sha1(text: string): string {
  return createHash('sha1').update(text).digest('hex');
}

/** Removes Upstash-only flags from a Lua shebang. Returns the script unchanged when there is nothing to remove. */
export function stripUpstashOnlyFlags(script: string): string {
  const match = SHEBANG.exec(script);
  if (!match) return script;
  const options = (match[1] ?? '').trim();
  const flagsMatch = /(?:^|\s)flags=([^\s]*)/.exec(options);
  if (!flagsMatch) return script;
  const flags = (flagsMatch[1] ?? '').split(',').filter((flag) => flag !== '');
  const kept = flags.filter((flag) => !UPSTASH_ONLY_FLAGS.has(flag));
  if (kept.length === flags.length) return script;
  const otherOptions = options.replace(flagsMatch[0], '').trim();
  const body = script.slice(match[0].length);
  if (kept.length === 0 && otherOptions === '') {
    // No shebang options left: a plain (legacy) script, which Redis runs without restrictions.
    return body;
  }
  const rebuilt = ['#!lua', otherOptions, kept.length > 0 ? `flags=${kept.join(',')}` : ''].filter((part) => part !== '').join(' ');
  return `${rebuilt}\n${body}`;
}

/** Rewrites one Redis command (as sent in an Upstash REST body). Unknown shapes pass through untouched. */
export function rewriteCommand(command: unknown, shaMap: Map<string, string>): unknown {
  if (!Array.isArray(command) || typeof command[0] !== 'string') return command;
  const name = command[0].toUpperCase();

  const clean = (script: unknown): unknown => {
    if (typeof script !== 'string') return script;
    const stripped = stripUpstashOnlyFlags(script);
    if (stripped !== script) shaMap.set(sha1(script), sha1(stripped));
    return stripped;
  };

  if (name === 'EVAL' || name === 'EVAL_RO') {
    return [command[0], clean(command[1]), ...command.slice(2)];
  }
  if (name === 'SCRIPT' && typeof command[1] === 'string' && command[1].toUpperCase() === 'LOAD') {
    return [command[0], command[1], clean(command[2]), ...command.slice(3)];
  }
  if ((name === 'EVALSHA' || name === 'EVALSHA_RO') && typeof command[1] === 'string') {
    const mapped = shaMap.get(command[1].toLowerCase());
    return mapped ? [command[0], mapped, ...command.slice(2)] : command;
  }
  return command;
}

/** Rewrites a REST request body: one command for `/`, a list of commands for `/pipeline` and `/multi-exec`. */
export function rewriteBody(pathname: string, body: unknown, shaMap: Map<string, string>): unknown {
  const path = pathname.replace(/\/+$/, '');
  if (path === '/pipeline' || path === '/multi-exec') {
    return Array.isArray(body) ? body.map((command) => rewriteCommand(command, shaMap)) : body;
  }
  return rewriteCommand(body, shaMap);
}
