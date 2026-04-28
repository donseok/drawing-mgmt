import { defineConfig } from 'vitest/config';

// Migration package — pure unit/integration tests against in-memory mock
// source. No DB roundtrip in default `pnpm -F @drawing-mgmt/migration test`,
// so no integration split needed (yet). When the real TeamPlus dump arrives,
// we can mirror the web app's `VITEST_INTEGRATION` flag for live-DB tests.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['__tests__/**/*.{test,spec}.ts'],
    exclude: ['node_modules/**', 'dist/**'],
    testTimeout: 10_000,
  },
});
