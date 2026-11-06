import { describe, expect, it } from 'vitest';
import { normalizePreviewOrigin } from '../../scripts/ci/neon-auth-trusted-origin';

describe('normalizePreviewOrigin (E2E trusted-origin guard)', () => {
  const forbidden = 'bm-fixed-app-v7-1.vercel.app';

  it('accepts an exact Vercel preview origin and strips a trailing slash', () => {
    expect(normalizePreviewOrigin('https://bm-fixed-app-v7-1-abc123-team.vercel.app/', forbidden)).toBe(
      'https://bm-fixed-app-v7-1-abc123-team.vercel.app',
    );
  });

  it.each([
    ['http://bm-fixed-app-v7-1-abc123-team.vercel.app', 'https'],
    ['https://*.vercel.app', 'valid URL|single-label'],
    ['https://evil.example.com', 'single-label'],
    ['https://a.b.vercel.app', 'single-label'],
    ['https://bm-fixed-app-v7-1-abc123-team.vercel.app/login', 'bare origin'],
    ['https://bm-fixed-app-v7-1.vercel.app', 'forbidden'],
    ['not a url', 'valid URL'],
  ])('rejects %s', (input, reason) => {
    expect(() => normalizePreviewOrigin(input, forbidden)).toThrow(new RegExp(reason));
  });
});
