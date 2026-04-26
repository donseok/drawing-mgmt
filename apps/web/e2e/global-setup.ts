import { test as setup, expect } from '@playwright/test';

const AUTH_FILE = './e2e/.auth/user.json';

/**
 * Global setup: logs in as admin and persists the session to storageState
 * so all subsequent tests reuse the authenticated cookie without repeating
 * the login flow.
 */
setup('authenticate as admin', async ({ page }) => {
  await page.goto('/login');

  // Fill credentials (field ids match login-form.tsx)
  await page.locator('#username').fill('admin');
  await page.locator('#password').fill('admin123!');

  // Submit the form
  await page.getByRole('button', { name: '로그인' }).click();

  // Wait for navigation to the main page after successful login
  await page.waitForURL('/');
  await expect(page).toHaveURL('/');

  // Persist the authenticated state
  await page.context().storageState({ path: AUTH_FILE });
});
