import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('CLEAN-001: Knip Permanent CI Check & Configuration Guards', () => {
  const rootDir = process.cwd();

  it('asserts package.json has knip pinned to an exact version and required scripts are present', () => {
    const pkgPath = path.join(rootDir, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

    const knipVersion = pkg.devDependencies?.knip;
    expect(knipVersion, 'knip must be in devDependencies').toBeDefined();
    expect(knipVersion, 'knip version must not use caret (^) or tilde (~)').not.toMatch(/^[\^~]/);
    expect(knipVersion, 'knip version must be exact semver').toMatch(/^\d+\.\d+\.\d+$/);

    expect(pkg.scripts?.knip, 'package.json must contain "knip" script').toBe('knip');
    expect(
      pkg.scripts?.['ops:audit-gstin'],
      'package.json must contain "ops:audit-gstin" script',
    ).toBe('tsx scripts/ops/audit-gstin-checksums.ts');
  });

  it('asserts ci.yml runs "pnpm knip" in the Quality gates job', () => {
    const ciPath = path.join(rootDir, '.github', 'workflows', 'ci.yml');
    const ciContent = fs.readFileSync(ciPath, 'utf8');

    // Quality gates job section exists and runs pnpm knip
    expect(ciContent).toContain('name: Quality gates');
    expect(ciContent).toMatch(/name:\s*Unused code \(knip\)\s+run:\s*pnpm knip/);

    // Verify it is in the quality job, before or around db:check
    const qualityJobMatch = ciContent.match(/quality:([\s\S]*?)dependency-audit:/);
    expect(qualityJobMatch, 'quality job block found').toBeTruthy();
    expect(qualityJobMatch![1]).toContain('pnpm knip');
    expect(qualityJobMatch![1]).not.toMatch(/continue-on-error:\s*true/);
  });

  it('asserts knip.json exists and does not contain blanket directory ignores', () => {
    const knipJsonPath = path.join(rootDir, 'knip.json');
    expect(fs.existsSync(knipJsonPath), 'knip.json must exist').toBe(true);

    const knipRaw = fs.readFileSync(knipJsonPath, 'utf8');
    const knipConfig = JSON.parse(knipRaw);

    const forbiddenBlanketPatterns = [
      'lib/**',
      'app/**',
      'components/**',
      'lib/*',
      'app/*',
      'components/*',
      '**/*',
      '*',
    ];

    for (const pattern of forbiddenBlanketPatterns) {
      expect(
        knipRaw.includes(`"${pattern}"`),
        `knip.json must not blanket-ignore "${pattern}"`,
      ).toBe(false);
    }

    const ignoredList: string[] = [
      ...(Array.isArray(knipConfig.ignore) ? knipConfig.ignore : []),
      ...(Array.isArray(knipConfig.ignoreFiles) ? knipConfig.ignoreFiles : []),
    ];

    for (const item of ignoredList) {
      expect(
        item.startsWith('lib/') && item.includes('*'),
        `knip.json must not contain directory wildcard in ignore: ${item}`,
      ).toBe(false);
      expect(
        item.startsWith('app/') && item.includes('*'),
        `knip.json must not contain directory wildcard in ignore: ${item}`,
      ).toBe(false);
      expect(
        item.startsWith('components/') && item.includes('*'),
        `knip.json must not contain directory wildcard in ignore: ${item}`,
      ).toBe(false);
    }
  });
});

