import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  PUBLIC_MARKETING_PATHS,
  PRIVATE_PATH_PREFIXES,
  siteOrigin,
  isIndexableDeployment,
} from '@/lib/seo/routes';

describe('FE-006: SEO routes & path classification', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('asserts each matcher prefix from proxy.ts appears in PRIVATE_PATH_PREFIXES', () => {
    const proxyPath = path.resolve(process.cwd(), 'proxy.ts');
    const proxySource = fs.readFileSync(proxyPath, 'utf8');

    const matcherBlockMatch = proxySource.match(/matcher:\s*\[([\s\S]*?)\]/);
    expect(matcherBlockMatch, 'matcher block must exist in proxy.ts').not.toBeNull();

    const matches = [...matcherBlockMatch![1].matchAll(/['"](\/[a-zA-Z0-9_-]+)(?:\/:path\*)?['"]/g)];
    const matcherPrefixes = matches.map((m) => m[1]);

    expect(matcherPrefixes.length).toBeGreaterThan(0);

    for (const prefix of matcherPrefixes) {
      expect(
        (PRIVATE_PATH_PREFIXES as readonly string[]).includes(prefix),
        `proxy.ts matcher prefix "${prefix}" must be in PRIVATE_PATH_PREFIXES`,
      ).toBe(true);
    }
  });

  it('asserts /api, /login, and /signup are present in PRIVATE_PATH_PREFIXES', () => {
    const privatePaths = PRIVATE_PATH_PREFIXES as readonly string[];
    expect(privatePaths).toContain('/api');
    expect(privatePaths).toContain('/login');
    expect(privatePaths).toContain('/signup');
  });

  it('asserts no public marketing path is classified as private', () => {
    const privatePaths = PRIVATE_PATH_PREFIXES as readonly string[];
    for (const publicPath of PUBLIC_MARKETING_PATHS) {
      // The public path itself cannot be an exact private prefix
      expect(privatePaths.includes(publicPath)).toBe(false);

      // Nor can a non-root public path start with a private prefix
      if (publicPath !== '/') {
        for (const privatePrefix of privatePaths) {
          expect(
            publicPath.startsWith(privatePrefix),
            `Public path "${publicPath}" must not collide with private prefix "${privatePrefix}"`,
          ).toBe(false);
        }
      }
    }
  });

  it('tests isIndexableDeployment pure function across deployment environments', () => {
    expect(isIndexableDeployment({ VERCEL_ENV: 'production' })).toBe(true);
    expect(isIndexableDeployment({ VERCEL_ENV: 'preview' })).toBe(false);
    expect(isIndexableDeployment({ VERCEL_ENV: 'development' })).toBe(false);
    expect(isIndexableDeployment({})).toBe(false);
    expect(isIndexableDeployment({ VERCEL_ENV: '' })).toBe(false);
  });

  it('tests siteOrigin resolves origin correctly', () => {
    const origin = siteOrigin();
    expect(origin).toBeDefined();
    expect(origin.startsWith('http://') || origin.startsWith('https://')).toBe(true);
    expect(origin).not.toContain('/path');
    expect(origin.endsWith('/')).toBe(false);
  });
});

