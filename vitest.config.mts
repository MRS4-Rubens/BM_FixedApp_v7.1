import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    // Mirrors the "@/*" path alias from tsconfig.json.
    alias: [{ find: /^@\//, replacement: `${projectRoot}` }],
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules/**', '.next/**'],
    // An empty suite must fail CI loudly instead of passing silently.
    passWithNoTests: false,
    clearMocks: true,
    restoreMocks: true,
    testTimeout: 10_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      include: [
        'lib/gst/**/*.ts',
        'lib/money.ts',
        'lib/invoices/number-format.ts',
        'lib/invoices/ist-date.ts',
        'lib/invoices/financial-year.ts',
        'lib/invoices/status.ts',
        'lib/subscriptions/entitlements.ts',
        'lib/pdf/number-to-words.ts',
      ],
      exclude: ['lib/gst/types.ts', '**/*.d.ts'],
      thresholds: {
        'lib/gst/**/*.ts': { statements: 90, branches: 90, functions: 90, lines: 90 },
        'lib/money.ts': { statements: 90, branches: 90, functions: 90, lines: 90 },
        'lib/invoices/number-format.ts': { statements: 90, branches: 85, functions: 90, lines: 90 },
        'lib/invoices/ist-date.ts': { statements: 90, branches: 85, functions: 90, lines: 90 },
        'lib/invoices/financial-year.ts': { statements: 90, branches: 85, functions: 90, lines: 90 },
        'lib/invoices/status.ts': { statements: 90, branches: 85, functions: 90, lines: 90 },
        'lib/subscriptions/entitlements.ts': { statements: 90, branches: 85, functions: 90, lines: 90 },
        'lib/pdf/number-to-words.ts': { statements: 90, branches: 85, functions: 90, lines: 90 },
      },
    },
  },
});
