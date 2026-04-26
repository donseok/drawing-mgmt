import { test, expect } from '@playwright/test';

test.describe('Search page', () => {
  // These tests run with the authenticated storageState from the setup project,
  // so the user is already logged in.

  test('loads the search page with table and folder sidebar', async ({ page }) => {
    await page.goto('/search');

    // The search page heading is "자료 검색"
    await expect(page.getByRole('heading', { name: '자료 검색' })).toBeVisible();

    // Folder sidebar should be present (SubSidebar with title "폴더 트리")
    await expect(page.getByText('폴더 트리')).toBeVisible();

    // ObjectTableToolbar contains a search input with known placeholder
    await expect(
      page.getByPlaceholder('도면번호, 자료명, PDF 내용 검색...'),
    ).toBeVisible();
  });

  test('search filter interaction updates the view', async ({ page }) => {
    await page.goto('/search');

    // Wait for the page to be ready
    await expect(page.getByRole('heading', { name: '자료 검색' })).toBeVisible();

    // Find the search input by its exact placeholder
    const searchInput = page.getByPlaceholder('도면번호, 자료명, PDF 내용 검색...');
    await expect(searchInput).toBeVisible();

    // Type a query and verify the UI responds
    await searchInput.fill('CGL');

    // After typing, the toolbar should show result count ("N건")
    await expect(page.getByText(/\d+건/)).toBeVisible({ timeout: 10000 });

    // Saved Views section is always rendered in the sidebar
    await expect(page.getByText('Saved Views')).toBeVisible();
  });
});
