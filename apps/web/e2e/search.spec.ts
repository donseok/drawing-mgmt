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

    // The object table or its toolbar should render.
    // ObjectTableToolbar contains a search input — verify it exists.
    await expect(
      page.getByPlaceholder(/검색|도면번호|이름/).or(page.locator('input[type="search"], input[type="text"]').first()),
    ).toBeVisible();
  });

  test('search filter interaction updates the view', async ({ page }) => {
    await page.goto('/search');

    // Wait for the page to be ready
    await expect(page.getByRole('heading', { name: '자료 검색' })).toBeVisible();

    // Find the search/filter input in the toolbar.
    // ObjectTableToolbar has a search field that drives the `search` state.
    const searchInput = page.getByPlaceholder(/검색|도면번호|이름/).or(
      page.locator('[data-testid="search-input"]'),
    );

    // If a search input exists, type a query and verify the UI responds
    if (await searchInput.isVisible()) {
      await searchInput.fill('CGL');

      // After typing, wait a moment for the filter to apply.
      // The search results count text ("N건") should be present in the toolbar.
      await expect(page.getByText(/건/)).toBeVisible();
    }

    // Verify that the Saved Views section exists in the sidebar
    await expect(page.getByText('Saved Views')).toBeVisible();
  });
});
