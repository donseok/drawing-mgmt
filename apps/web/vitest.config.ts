import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Vitest configuration for the web app.
//
// We use happy-dom for the test environment because it's faster than jsdom for
// the kind of DOM smoke tests we'll add later (jest-dom matchers still work).
// Today's sample suite is pure-function-only, but the env is set up once so
// component tests can be added without re-touching infra.
//
// Path aliases mirror the Next.js `@/*` import convention so test files can
// import production modules with the same paths as the app code.
//
// R36 T-2 — integration tests live under `__tests__/integration/` and use the
// `.int.test.ts` suffix so they're filtered out of the default `pnpm test`
// run (they need a real Postgres). The dedicated `pnpm test:integration`
// script flips `VITEST_INTEGRATION=1`, which switches the include list to
// the integration suffix and the environment to `node` (avoids happy-dom
// loading hooks that don't make sense for DB-backed tests).
const isIntegration = process.env.VITEST_INTEGRATION === '1';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: isIntegration ? 'node' : 'happy-dom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    // Integration runs are slow (DB roundtrip per test), so unit tests run
    // by default. Switching to integration uses a different glob.
    include: isIntegration
      ? ['__tests__/integration/**/*.int.test.ts']
      : [
          '__tests__/**/*.{test,spec}.{ts,tsx}',
          '**/*.{test,spec}.{ts,tsx}',
        ],
    exclude: [
      'node_modules/**',
      '.next/**',
      'tests/**', // Playwright e2e specs live here
      'e2e/**',
      // Filter `.int.test.ts` out of the default unit run.
      ...(isIntegration ? [] : ['__tests__/integration/**']),
    ],
    // Integration tests serialize on the same Postgres → run files in series
    // to avoid TRUNCATE racing across workers. Within a file, tests run in
    // declaration order which is fine for the simple suites we have today.
    ...(isIntegration ? { fileParallelism: false } : {}),
    // Bump the timeout for integration runs — `prisma migrate deploy` on a
    // fresh DB takes a few seconds.
    testTimeout: isIntegration ? 30_000 : 5_000,
    hookTimeout: isIntegration ? 60_000 : 10_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
