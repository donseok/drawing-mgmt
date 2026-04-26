import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E configuration for drawing-mgmt web app.
 *
 * - baseURL: http://localhost:3000 (Next.js dev server)
 * - webServer: starts `pnpm dev` if port 3000 is not already in use
 * - Single project (chromium) for initial setup; expand later as needed
 * - Auth storageState is prepared by the global setup (e2e/fixtures/auth.ts)
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  timeout: 30_000,

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    // Setup project: authenticates once and saves storageState for dependent tests
    {
      name: 'setup',
      testMatch: /global-setup\.ts/,
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Reuse the authenticated session produced by the setup project
        storageState: './e2e/.auth/user.json',
      },
      dependencies: ['setup'],
    },
  ],

  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
