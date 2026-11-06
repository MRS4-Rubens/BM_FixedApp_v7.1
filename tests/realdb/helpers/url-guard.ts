const LOCAL_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export interface DbIdentity {
  readonly host: string;
  readonly database: string;
}

/** Normalises Neon pooled/direct hosts (`ep-x-pooler.region...` vs `ep-x.region...`) to one identity. */
export function parseDbIdentity(connectionString: string): DbIdentity {
  const url = new URL(connectionString);
  return {
    host: url.hostname.toLowerCase().replace(/-pooler(?=\.)/, ''),
    database: decodeURIComponent(url.pathname.replace(/^\//, '')),
  };
}

function tryParseDbIdentity(connectionString: string | undefined): DbIdentity | null {
  if (!connectionString) return null;
  try {
    return parseDbIdentity(connectionString);
  } catch {
    return null;
  }
}

/** Throws unless the URL is safe to run destructive integration tests against. Runs BEFORE any connection. */
export function validateTestDatabaseUrl(url: string | undefined, env: NodeJS.ProcessEnv = process.env): string {
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Real-database tests never skip. Start a local database ' +
        '(docker compose -f docker-compose.test.yml up -d) or point TEST_DATABASE_URL at a DISPOSABLE Neon branch. See docs/TESTING.md.',
    );
  }
  const target = parseDbIdentity(url); // throws on a malformed URL
  for (const protectedUrl of [env.DATABASE_URL, env.DATABASE_URL_UNPOOLED]) {
    const protectedIdentity = tryParseDbIdentity(protectedUrl);
    if (protectedIdentity && protectedIdentity.host === target.host && protectedIdentity.database === target.database) {
      throw new Error('REFUSING TO RUN: TEST_DATABASE_URL targets the same host and database as DATABASE_URL / DATABASE_URL_UNPOOLED.');
    }
  }
  if (!LOCAL_HOSTS.has(target.host) && env.TEST_DATABASE_IS_DISPOSABLE !== '1') {
    throw new Error('REFUSING TO RUN against a non-local host. If this is a DISPOSABLE Neon branch, set TEST_DATABASE_IS_DISPOSABLE=1.');
  }
  return url;
}

