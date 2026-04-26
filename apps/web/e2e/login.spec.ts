import { test, expect } from '@playwright/test';

test.describe('Login flow', () => {
  test.use({ storageState: { cookies: [], origins: [] } }); // Start unauthenticated

  test('successful login redirects to main page', async ({ page }) => {
    await page.goto('/login');

    // Fill in the login form (ids from login-form.tsx)
    await page.locator('#username').fill('admin');
    await page.locator('#password').fill('admin123!');

    // Click the submit button
    await page.getByRole('button', { name: '로그인' }).click();

    // Should redirect to the main workspace page
    await page.waitForURL('/');
    await expect(page).toHaveURL('/');

    // Verify a user-related element is visible on the main page.
    // The home page shows "오늘의 도면 업무함" as the heading.
    await expect(page.getByRole('heading', { name: /도면 업무함/ })).toBeVisible();
  });

  test('failed login shows error message', async ({ page }) => {
    await page.goto('/login');

    // Enter valid username but wrong password
    await page.locator('#username').fill('admin');
    await page.locator('#password').fill('wrongpassword');

    // Submit the form
    await page.getByRole('button', { name: '로그인' }).click();

    // Error alert should appear (login-form.tsx renders role="alert" with error message)
    const errorAlert = page.getByRole('alert');
    await expect(errorAlert).toBeVisible();
    await expect(errorAlert).toContainText('올바르지 않습니다');

    // Should stay on the login page
    await expect(page).toHaveURL(/\/login/);
  });
});
