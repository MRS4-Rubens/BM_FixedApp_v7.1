import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('CLEAN-002: Honest Marketing Copy', () => {
  const rootDir = process.cwd();
  const landingDir = path.resolve(rootDir, 'components/landing');
  const marketingPage = path.resolve(rootDir, 'app/(marketing)/page.tsx');

  it('asserts deleted marketing components social-proof.tsx and testimonials-section.tsx do not exist', () => {
    const socialProofPath = path.resolve(landingDir, 'social-proof.tsx');
    const testimonialsPath = path.resolve(landingDir, 'testimonials-section.tsx');

    expect(fs.existsSync(socialProofPath)).toBe(false);
    expect(fs.existsSync(testimonialsPath)).toBe(false);
  });

  it('asserts no banned claims appear in landing components or the marketing page', () => {
    const bannedClaims = [
      '10,000',
      '10000',
      '500Cr',
      '99.9',
      '99.99',
      'SLA',
      'MeitY',
      'Data Residency',
      'tier-4',
      'auto-lookup',
      'recurring billing',
      'Autopilot',
      'automatically followed up',
      'in bulk',
      'Multi-User',
      'Dedicated CA',
      'Bank-Grade',
      'TLS 1.3',
      'AES-256',
    ];

    const landingFiles = fs
      .readdirSync(landingDir)
      .filter((file) => file.endsWith('.tsx') || file.endsWith('.ts'))
      .map((file) => path.resolve(landingDir, file));

    const allFiles = [...landingFiles, marketingPage];

    for (const filePath of allFiles) {
      const content = fs.readFileSync(filePath, 'utf8');

      for (const term of bannedClaims) {
        // Use word boundary for short acronym 'SLA' to avoid matching CSS class names like 'slate'
        const regex =
          term === 'SLA'
            ? /\bSLA\b/i
            : new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

        expect(
          regex.test(content),
          `Found banned marketing claim "${term}" in ${path.relative(rootDir, filePath)}`
        ).toBe(false);
      }
    }
  });
});

