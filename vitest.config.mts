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
  },
});
