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
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    // Co-located `*.test.ts(x)` and the dedicated `__tests__/` folder are
    // both picked up. Restricting include keeps Vitest from accidentally
    // crawling `.next/` or build artifacts.
    include: [
      '__tests__/**/*.{test,spec}.{ts,tsx}',
      '**/*.{test,spec}.{ts,tsx}',
    ],
    exclude: [
      'node_modules/**',
      '.next/**',
      'tests/**', // Playwright e2e specs live here
      'e2e/**',
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
