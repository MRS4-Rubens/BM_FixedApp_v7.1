import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '@/lib/db/schema';

const state = vi.hoisted(() => ({
  db: undefined as unknown,
  session: null as unknown,
}));

vi.mock('@/lib/db/client', () => ({
  get db() {
    return state.db;
  },
}));

vi.mock('@/lib/auth/server', () => ({
  auth: {
    getSession: vi.fn(async () => state.session),
  },
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock('@/lib/actions/_shared/logger', () => ({
  logError: vi.fn(),
}));

import { ensureAppUser } from '@/lib/auth/ensure-app-user';
import { getCurrentAppUser } from '@/lib/auth/session';
import { logError } from '@/lib/actions/_shared/logger';
import { redirect } from 'next/navigation';

const DRIZZLE_DIR = join(process.cwd(), 'drizzle');

interface JournalEntry {
  tag: string;
}

function readJournal(): JournalEntry[] {
  const raw: unknown = JSON.parse(readFileSync(join(DRIZZLE_DIR, 'meta', '_journal.json'), 'utf8'));
  const entries = (raw as { entries: JournalEntry[] }).entries;
  return entries.map((entry) => ({ tag: entry.tag }));
}

async function applyMigrations(pg: PGlite, entries: JournalEntry[]): Promise<void> {
  for (const entry of entries) {
    const statements = readFileSync(join(DRIZZLE_DIR, `${entry.tag}.sql`), 'utf8')
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);
    for (const statement of statements) {
      await pg.exec(statement);
    }
  }
}

describe('AUTH-002: Provisioning & Self-Healing Integration Tests (PGlite)', () => {
  let pg: PGlite;

  beforeAll(async () => {
    pg = new PGlite();
    await applyMigrations(pg, readJournal());
    state.db = drizzle(pg, { schema });
  }, 60_000);

  afterAll(async () => {
    await pg?.close();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    state.session = null;
    await pg.exec('DELETE FROM users;');
  });

  describe('ensureAppUser', () => {
    it('creates a fresh user row with role=owner, business_id=null', async () => {
      const user = await ensureAppUser({
        authUserId: 'auth_usr_001',
        displayName: 'Alice Owner',
        email: 'alice@example.com',
      });

      expect(user).toBeDefined();
      expect(user.auth_user_id).toBe('auth_usr_001');
      expect(user.role).toBe('owner');
      expect(user.business_id).toBeNull();
      expect(user.display_name).toBe('Alice Owner');
      expect(user.email).toBe('alice@example.com');
    });

    it('returns the same row id on consecutive calls', async () => {
      const first = await ensureAppUser({
        authUserId: 'auth_usr_002',
        displayName: 'Bob',
        email: 'bob@example.com',
      });

      const second = await ensureAppUser({
        authUserId: 'auth_usr_002',
        displayName: 'Bob Updated',
        email: 'bob@example.com',
      });

      expect(second.id).toBe(first.id);
      expect(second.auth_user_id).toBe('auth_usr_002');
    });

    it('handles 10 concurrent calls race-safely creating exactly 1 row', async () => {
      const authUserId = 'auth_usr_race_10';
      const promises = Array.from({ length: 10 }, (_, i) =>
        ensureAppUser({
          authUserId,
          displayName: `Worker ${i}`,
          email: `race_${i}@example.com`,
        })
      );

      const results = await Promise.all(promises);

      // All 10 must resolve to a valid AppUser object (never null)
      expect(results).toHaveLength(10);
      for (const res of results) {
        expect(res).toBeDefined();
        expect(res.auth_user_id).toBe(authUserId);
        expect(res.id).toBe(results[0].id);
      }

      // Check the database table has exactly 1 row
      const rows = await pg.query<{ count: string }>(
        'SELECT count(*) FROM users WHERE auth_user_id = $1;',
        [authUserId]
      );
      expect(Number(rows.rows[0]?.count)).toBe(1);
    });

    it('backfills email once if previously null, and does not overwrite existing email', async () => {
      const authUserId = 'auth_usr_backfill';
      const initial = await ensureAppUser({
        authUserId,
        displayName: 'No Email User',
        email: null,
      });
      expect(initial.email).toBeNull();

      // Backfill with email
      const backfilled = await ensureAppUser({
        authUserId,
        displayName: 'Now Has Email',
        email: 'original@example.com',
      });
      expect(backfilled.id).toBe(initial.id);
      expect(backfilled.email).toBe('original@example.com');

      // Subsequent call with different email does NOT overwrite
      const noOverwrite = await ensureAppUser({
        authUserId,
        displayName: 'Third Call',
        email: 'other@example.com',
      });
      expect(noOverwrite.id).toBe(initial.id);
      expect(noOverwrite.email).toBe('original@example.com');
    });

    it('logs and re-throws real DB failures (never returns null)', async () => {
      const brokenDb = {
        insert: () => {
          throw new Error('Connection terminated unexpectedly');
        },
      };

      const originalDb = state.db;
      state.db = brokenDb;

      try {
        await expect(
          ensureAppUser({
            authUserId: 'auth_usr_db_fail',
            displayName: 'Fail',
            email: 'fail@example.com',
          })
        ).rejects.toThrow('Connection terminated unexpectedly');

        expect(logError).toHaveBeenCalledWith(
          'ensure-app-user',
          expect.any(Error),
          { authUserId: 'auth_usr_db_fail' }
        );
      } finally {
        state.db = originalDb;
      }
    });
  });

  describe('getCurrentAppUser self-healing', () => {
    it('creates missing user row on demand from session data', async () => {
      state.session = {
        data: {
          user: {
            id: 'auth_session_001',
            name: 'Session User',
            email: 'session@example.com',
          },
        },
      };

      const user = await getCurrentAppUser();
      expect(user).toBeDefined();
      expect(user.auth_user_id).toBe('auth_session_001');
      expect(user.display_name).toBe('Session User');
      expect(user.email).toBe('session@example.com');
      expect(user.role).toBe('owner');
    });

    it('recreates user row if deleted after initial creation', async () => {
      state.session = {
        data: {
          user: {
            id: 'auth_session_002',
            name: 'Transient User',
            email: 'transient@example.com',
          },
        },
      };

      const first = await getCurrentAppUser();
      expect(first).toBeDefined();

      // Simulate admin or test deletion
      await pg.exec(`DELETE FROM users WHERE auth_user_id = 'auth_session_002';`);

      // Next call must self-heal and recreate row
      const second = await getCurrentAppUser();
      expect(second).toBeDefined();
      expect(second.auth_user_id).toBe('auth_session_002');
      expect(second.id).not.toBe(first.id);
    });

    it('uses fast path when row exists and does not attempt insert', async () => {
      state.session = {
        data: {
          user: {
            id: 'auth_session_fast',
            name: 'Fast User',
            email: 'fast@example.com',
          },
        },
      };

      // Create row first
      await ensureAppUser({
        authUserId: 'auth_session_fast',
        displayName: 'Fast User',
        email: 'fast@example.com',
      });

      const d = state.db as ReturnType<typeof drizzle>;
      const insertSpy = vi.spyOn(d, 'insert');

      const user = await getCurrentAppUser();
      expect(user).toBeDefined();
      expect(user.auth_user_id).toBe('auth_session_fast');
      expect(insertSpy).not.toHaveBeenCalled();
    });

    it('invokes redirect(/login) when there is no session', async () => {
      state.session = null;
      await expect(getCurrentAppUser()).rejects.toThrow('NEXT_REDIRECT:/login');
      expect(redirect).toHaveBeenCalledWith('/login');
    });
  });
});
