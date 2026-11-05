import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: { alias: [{ find: /^@\//, replacement: `${projectRoot}` }] },
  test: {
    environment: 'node',
    include: ['tests/realdb/**/*.test.ts'],
    globalSetup: ['tests/realdb/global-setup.ts'],
    // Suites share one database and assert on global counters per business: run files one at a time.
    fileParallelism: false,
    maxWorkers: 1,
    retry: 0,
    passWithNoTests: false,
    clearMocks: true,
    restoreMocks: true,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});

