import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { isServerActionRequest, type ProxyRequestShape } from '@/lib/auth/proxy-policy';

const { middlewareSpy } = vi.hoisted(() => {
  const middlewareSpy = vi.fn((request: NextRequest) => {
    return NextResponse.redirect(new URL('/login', request.url));
  });
  return { middlewareSpy };
});

vi.mock('@/lib/auth/server', () => ({
  auth: {
    middleware: () => middlewareSpy,
  },
}));

import proxy, { config } from '@/proxy';

describe('6.1 isServerActionRequest pure predicate', () => {
  it('returns true for genuine Server Action requests', () => {
    // POST + next-action + text/plain;charset=UTF-8
    const req1: ProxyRequestShape = {
      method: 'POST',
      headers: new Headers({
        'next-action': 'action-id-1',
        'content-type': 'text/plain;charset=UTF-8',
      }),
    };
    expect(isServerActionRequest(req1)).toBe(true);

    // POST + next-action + multipart/form-data; boundary=----x
    const req2: ProxyRequestShape = {
      method: 'POST',
      headers: new Headers({
        'next-action': 'action-id-2',
        'content-type': 'multipart/form-data; boundary=----x',
      }),
    };
    expect(isServerActionRequest(req2)).toBe(true);

    // 'post' (lowercase method) + next-action + 'Text/Plain' (case-insensitive)
    const req3: ProxyRequestShape = {
      method: 'post',
      headers: new Headers({
        'next-action': 'action-id-3',
        'content-type': 'Text/Plain',
      }),
    };
    expect(isServerActionRequest(req3)).toBe(true);
  });

  it('returns false for spoofed, non-POST, or non-action requests', () => {
    // GET + next-action + text/plain;charset=UTF-8
    const reqGet: ProxyRequestShape = {
      method: 'GET',
      headers: new Headers({
        'next-action': 'action-id-spoof',
        'content-type': 'text/plain;charset=UTF-8',
      }),
    };
    expect(isServerActionRequest(reqGet)).toBe(false);

    // POST without next-action + text/plain
    const reqNoHeader: ProxyRequestShape = {
      method: 'POST',
      headers: new Headers({
        'content-type': 'text/plain',
      }),
    };
    expect(isServerActionRequest(reqNoHeader)).toBe(false);

    // POST + next-action + application/json
    const reqJson: ProxyRequestShape = {
      method: 'POST',
      headers: new Headers({
        'next-action': 'action-id-json',
        'content-type': 'application/json',
      }),
    };
    expect(isServerActionRequest(reqJson)).toBe(false);

    // POST + next-action + application/x-www-form-urlencoded
    const reqForm: ProxyRequestShape = {
      method: 'POST',
      headers: new Headers({
        'next-action': 'action-id-form',
        'content-type': 'application/x-www-form-urlencoded',
      }),
    };
    expect(isServerActionRequest(reqForm)).toBe(false);

    // POST + next-action + no content-type at all
    const reqNoContentType: ProxyRequestShape = {
      method: 'POST',
      headers: new Headers({
        'next-action': 'action-id-no-ct',
      }),
    };
    expect(isServerActionRequest(reqNoContentType)).toBe(false);
  });
});

describe('6.2 proxy middleware behaviour', () => {
  beforeEach(() => {
    middlewareSpy.mockClear();
  });

  it('a) redirects to /login when GET /dashboard has a spoofed next-action header', async () => {
    const request = new NextRequest('http://localhost:3000/dashboard', {
      method: 'GET',
      headers: {
        'next-action': 'x',
      },
    });

    const response = await proxy(request);
    expect(middlewareSpy).toHaveBeenCalledTimes(1);
    expect(response.status === 307 || response.status === 308).toBe(true);
    expect(response.headers.get('location')?.endsWith('/login')).toBe(true);
  });

  it('b) passes through genuine Server Action POST without calling auth middleware', async () => {
    const request = new NextRequest('http://localhost:3000/invoices/new', {
      method: 'POST',
      headers: {
        'next-action': 'abc',
        'content-type': 'text/plain;charset=UTF-8',
      },
    });

    const response = await proxy(request);
    expect(middlewareSpy).not.toHaveBeenCalled();
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('c) calls protect middleware for POST /invoices/new with application/json', async () => {
    const request = new NextRequest('http://localhost:3000/invoices/new', {
      method: 'POST',
      headers: {
        'next-action': 'abc',
        'content-type': 'application/json',
      },
    });

    await proxy(request);
    expect(middlewareSpy).toHaveBeenCalledTimes(1);
  });

  it('d) calls protect middleware for plain GET /settings with no header', async () => {
    const request = new NextRequest('http://localhost:3000/settings', {
      method: 'GET',
    });

    await proxy(request);
    expect(middlewareSpy).toHaveBeenCalledTimes(1);
  });
});

// This test replaces the manual "remember to add new pages" reminder by verifying
// that config.matcher mirrors the app route folders exactly.
describe('6.3 matcher coverage and filesystem synchronization', () => {
  function getTopLevelFolders(relDir: string): string[] {
    const fullDir = resolve(process.cwd(), relDir);
    if (!existsSync(fullDir)) return [];
    return readdirSync(fullDir).filter((entry) => {
      const entryPath = resolve(fullDir, entry);
      return (
        statSync(entryPath).isDirectory() &&
        !entry.startsWith('(') &&
        !entry.startsWith('_') &&
        !entry.startsWith('[')
      );
    });
  }

  const appFolders = getTopLevelFolders('app/(app)');
  const adminFolders = getTopLevelFolders('app/(admin)');
  const allExpectedFolders = [...appFolders, ...adminFolders];

  it('contains an exact prefix entry for every top-level app and admin folder', () => {
    expect(allExpectedFolders.length).toBeGreaterThan(0);
    for (const folder of allExpectedFolders) {
      const expectedMatcher = `/${folder}/:path*`;
      expect(config.matcher).toContain(expectedMatcher);
    }
  });

  it('ensures every matcher entry corresponds to an existing top-level app or admin folder', () => {
    const matcherRegex = /^\/([^/:]+)\/:path\*$/;
    for (const entry of config.matcher) {
      const match = entry.match(matcherRegex);
      expect(match).not.toBeNull();
      const folderName = match ? match[1] : '';
      expect(allExpectedFolders).toContain(folderName);
    }
  });

  it('does not contain /payments/:path* or /dev-sentry-test/:path*', () => {
    expect(config.matcher).not.toContain('/payments/:path*');
    expect(config.matcher).not.toContain('/dev-sentry-test/:path*');
  });

  it('ensures app/(app)/dev-sentry-test does not exist on disk', () => {
    const devSentryPath = resolve(process.cwd(), 'app/(app)/dev-sentry-test');
    expect(existsSync(devSentryPath)).toBe(false);
  });
});

