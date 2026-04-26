import { test as base, expect } from '@playwright/test';

/**
 * Extended test fixture that provides a pre-authenticated page context.
 *
 * Usage in test files:
 *   import { test, expect } from './fixtures/auth';
 *   test('...', async ({ authenticatedPage }) => { ... });
 *
 * The storageState is loaded from the file produced by global-setup.ts,
 * which runs as a project dependency before any chromium tests execute.
 */
export const test = base.extend<{ authenticatedPage: ReturnType<typeof base['page']> }>({
  authenticatedPage: async ({ browser }, use) => {
    const context = await browser.newContext({
      storageState: './e2e/.auth/user.json',
    });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
});

export { expect };
