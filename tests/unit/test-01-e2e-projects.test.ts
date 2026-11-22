import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import config from '../../playwright.config';

/**
 * TEST-01: specs 10, 11 and 12 sat in e2e/specs for weeks without running, because Playwright only runs files that a
 * project's testMatch lists. This guard fails as soon as a spec file is not matched by any project.
 */
const SPEC_DIR = join(process.cwd(), 'e2e', 'specs');

function matches(pattern: unknown, file: string): boolean {
  if (typeof pattern === 'string') return pattern === file;
  if (pattern instanceof RegExp) return pattern.test(file);
  if (Array.isArray(pattern)) return pattern.some((entry) => matches(entry, file));
  return false;
}

describe('TEST-01: every E2E spec is registered in a Playwright project', () => {
  const specs = readdirSync(SPEC_DIR).filter((file) => file.endsWith('.spec.ts'));
  const projects = config.projects ?? [];

  it('finds the spec files (sanity)', () => {
    expect(specs.length).toBeGreaterThanOrEqual(11);
  });

  it.each(specs)('%s is matched by a project', (spec) => {
    const owners = projects.filter((project) => matches(project.testMatch, spec)).map((project) => project.name);
    expect(owners, `${spec} is not listed in any project's testMatch in playwright.config.ts`).not.toHaveLength(0);
  });

  it('specs 10–12 depend on the journey that creates their owner, business and admin sessions', () => {
    for (const name of ['import', 'notifications', 'checkout']) {
      const project = projects.find((candidate) => candidate.name === name);
      expect(project?.dependencies, name).toContain('journey');
    }
  });
});
