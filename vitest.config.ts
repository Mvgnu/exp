import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: [
      'packages/*/test/**/*.test.ts',
      'apps/*/test/**/*.test.ts',
      'sites/*/test/**/*.test.ts',
      'test/architecture/**/*.test.ts',
    ],
    testTimeout: 30000,
    hookTimeout: 60000,
    maxWorkers: 2,
    fileParallelism: false,
  },
});
