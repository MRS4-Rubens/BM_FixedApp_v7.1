import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

function getAllSourceFiles(dir: string, fileList: string[] = []): string[] {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      getAllSourceFiles(fullPath, fileList);
    } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

describe('CLEAN-002: Flag Enforcement & Plan Hygiene', () => {
  const rootDir = process.cwd();
  const entitlementsFile = path.resolve(rootDir, 'lib/subscriptions/entitlements.ts');
  const entitlementsContent = fs.readFileSync(entitlementsFile, 'utf8');

  it('maps every quota and feature flag to an enforcement symbol and verifies consumer usage', () => {
    // 1. Parse Quotas (lines between '// Quotas' and '// Feature Flags')
    const quotaSectionMatch = entitlementsContent.match(/\/\/\s*Quotas([\s\S]*?)\/\/\s*Feature Flags/);
    expect(quotaSectionMatch).toBeTruthy();
    const quotaSection = quotaSectionMatch![1];
    const quotaKeys = [...quotaSection.matchAll(/([a-zA-Z0-9]+)\s*:\s*number\s*\|\s*null/g)].map(
      (m) => m[1]
    );

    // 2. Parse Feature Flags (lines between '// Feature Flags' and closing '}')
    const flagsSectionMatch = entitlementsContent.match(/\/\/\s*Feature Flags([\s\S]*?)\}/);
    expect(flagsSectionMatch).toBeTruthy();
    const flagsSection = flagsSectionMatch![1];
    const flagKeys = [...flagsSection.matchAll(/([a-zA-Z0-9]+)\s*:\s*boolean/g)].map((m) => m[1]);

    const allKeys = [...quotaKeys, ...flagKeys];

    const enforcementMap: Record<string, string | 'RESERVED'> = {
      invoiceMonthlyLimit: 'canCreateInvoice',
      customerLimit: 'canAddCustomer',
      productLimit: 'canAddProduct',
      teamUserLimit: 'RESERVED',
      canUseAllTemplates: 'canUseTemplate',
      canUploadLogo: 'canUploadBusinessLogo',
      hasWatermark: 'hasWatermark',
      canDirectWhatsApp: 'canShareInvoiceOnWhatsApp',
      canExportExcelReports: 'canExportStatutoryReport',
      canCustomizeInvoiceFormat: 'canCustomizeInvoiceNumberFormat',
    };

    // Check that every key is in the map
    for (const key of allKeys) {
      expect(enforcementMap).toHaveProperty(key);
    }

    // Collect all .ts/.tsx files under app/, components/, lib/ excluding entitlements.ts
    const searchDirs = ['app', 'components', 'lib'].map((d) => path.resolve(rootDir, d));
    const allFiles = searchDirs.flatMap((dir) => (fs.existsSync(dir) ? getAllSourceFiles(dir) : []));
    const consumerFiles = allFiles.filter(
      (f) => path.normalize(f) !== path.normalize(entitlementsFile)
    );

    const consumerFileContents = consumerFiles.map((f) => ({
      path: f,
      content: fs.readFileSync(f, 'utf8'),
    }));

    // Check that every non-RESERVED symbol is referenced in at least one consumer file
    for (const [key, symbol] of Object.entries(enforcementMap)) {
      if (symbol === 'RESERVED') continue;

      const hasReference = consumerFileContents.some((file) =>
        file.content.includes(symbol)
      );
      expect(
        hasReference,
        `Expected enforcement symbol "${symbol}" (for ${key}) to be referenced outside entitlements.ts`
      ).toBe(true);
    }
  });

  it('verifies deleted flag and alias names appear nowhere under app/, components/, lib/', () => {
    const deletedNames = [
      'canFinalizeCreditNotes',
      'canBulkImportCsv',
      'canAccessCaPortal',
      'hasPermanentPdfStorage',
      'resolveSubscriptionPlan',
    ];

    const searchDirs = ['app', 'components', 'lib'].map((d) => path.resolve(rootDir, d));
    const allFiles = searchDirs.flatMap((dir) => (fs.existsSync(dir) ? getAllSourceFiles(dir) : []));

    for (const file of allFiles) {
      const content = fs.readFileSync(file, 'utf8');
      for (const name of deletedNames) {
        expect(
          content.includes(name),
          `Found deleted identifier "${name}" in ${path.relative(rootDir, file)}`
        ).toBe(false);
      }
    }
  });

  it('verifies banned claim strings do not appear in key subscription components', () => {
    const bannedClaims = [
      'CA Accountant Portal',
      'Bulk Data',
      'Bulk Inventory',
      'Unlimited Users',
      'Unlimited Team',
      'Up to 3 Team',
      'e-Waybill',
      'Dedicated Manager',
      '24/7',
      'multi-users',
      'White-Label',
    ];

    const targetFiles = [
      'components/landing/pricing-section.tsx',
      'components/app/settings/billing-tab.tsx',
      'components/app/subscription/upgrade-prompt-modal.tsx',
      'app/(app)/checkout/checkout-form.tsx',
      'components/app/app-sidebar.tsx',
    ].map((f) => path.resolve(rootDir, f));

    for (const filePath of targetFiles) {
      if (!fs.existsSync(filePath)) continue;
      const content = fs.readFileSync(filePath, 'utf8').toLowerCase();
      for (const banned of bannedClaims) {
        expect(
          content.includes(banned.toLowerCase()),
          `Found banned claim "${banned}" in ${path.relative(rootDir, filePath)}`
        ).toBe(false);
      }
    }
  });
});

