import { test, expect } from './fixtures/auth.fixture';

test.describe('Navigation', () => {
  test('sidebar is visible after login', async ({ authenticatedPage: page }) => {
    await expect(page.locator('#sidebar')).toBeVisible();
  });

  test('sidebar contains all navigation items', async ({ authenticatedPage: page }) => {
    const navItems = ['Dashboard', 'Tournament', 'Matches', 'Displays', 'Flyers', 'Participants', 'Analytics', 'Settings'];

    for (const item of navItems) {
      await expect(page.locator(`#sidebar >> text=${item}`)).toBeVisible();
    }
  });

  test('clicking navigation items changes page', async ({ authenticatedPage: page }) => {
    // Click Matches
    await page.click('#sidebar >> text=Matches');
    await expect(page).toHaveURL(/matches/);

    // Click Tournament
    await page.click('#sidebar >> text=Tournament');
    await expect(page).toHaveURL(/tournament/);

    // Click Dashboard
    await page.click('#sidebar >> text=Dashboard');
    await expect(page).toHaveURL('/');
  });

  test('sidebar collapse toggle works', async ({ authenticatedPage: page }) => {
    const sidebar = page.locator('#sidebar');
    const toggleBtn = page.locator('#sidebarToggle');

    // Get initial state
    const initialClass = await sidebar.getAttribute('class');
    const isInitiallyCollapsed = initialClass?.includes('collapsed') || initialClass?.includes('sidebar-collapsed');

    // Click toggle
    await toggleBtn.click();
    await page.waitForTimeout(300); // Wait for animation

    // Check state changed
    const newClass = await sidebar.getAttribute('class');
    const isNowCollapsed = newClass?.includes('collapsed') || newClass?.includes('sidebar-collapsed');

    expect(isNowCollapsed).not.toBe(isInitiallyCollapsed);
  });

  test('sidebar state persists after page reload', async ({ authenticatedPage: page }) => {
    const toggleBtn = page.locator('#sidebarToggle');

    // Collapse sidebar
    await toggleBtn.click();
    await page.waitForTimeout(300);

    // Get collapsed state
    const beforeReload = await page.locator('#sidebar').getAttribute('class');
    const wasCollapsed = beforeReload?.includes('collapsed') || beforeReload?.includes('sidebar-collapsed');

    // Reload page
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Check state persisted
    const afterReload = await page.locator('#sidebar').getAttribute('class');
    const isStillCollapsed = afterReload?.includes('collapsed') || afterReload?.includes('sidebar-collapsed');

    expect(isStillCollapsed).toBe(wasCollapsed);
  });

  test('active page is highlighted in navigation', async ({ authenticatedPage: page }) => {
    // On dashboard, Dashboard should be active
    const dashboardLink = page.locator('#sidebar >> text=Dashboard').locator('..');
    await expect(dashboardLink).toHaveClass(/active|current|selected/);

    // Navigate to matches
    await page.click('#sidebar >> text=Matches');
    await page.waitForURL(/matches/);

    // Matches should now be active
    const matchesLink = page.locator('#sidebar >> text=Matches').locator('..');
    await expect(matchesLink).toHaveClass(/active|current|selected/);
  });
});

test.describe('Theme Toggle', () => {
  test('theme toggle button exists', async ({ authenticatedPage: page }) => {
    await expect(page.locator('#themeToggle')).toBeVisible();
  });

  test('clicking theme toggle changes theme', async ({ authenticatedPage: page }) => {
    const html = page.locator('html');
    const themeToggle = page.locator('#themeToggle');

    // Get initial theme
    const initialTheme = await html.getAttribute('data-theme');

    // Click toggle
    await themeToggle.click();
    await page.waitForTimeout(100);

    // Theme should have changed
    const newTheme = await html.getAttribute('data-theme');
    expect(newTheme).not.toBe(initialTheme);
  });

  test('theme persists across page navigation', async ({ authenticatedPage: page }) => {
    const html = page.locator('html');
    const themeToggle = page.locator('#themeToggle');

    // Set to dark mode if not already
    const initialTheme = await html.getAttribute('data-theme');
    if (initialTheme !== 'dark') {
      await themeToggle.click();
      await page.waitForTimeout(100);
    }

    // Verify dark mode
    await expect(html).toHaveAttribute('data-theme', 'dark');

    // Navigate to another page
    await page.click('#sidebar >> text=Matches');
    await page.waitForURL(/matches/);

    // Theme should persist
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('theme persists after page reload', async ({ authenticatedPage: page }) => {
    const html = page.locator('html');
    const themeToggle = page.locator('#themeToggle');

    // Toggle theme
    await themeToggle.click();
    await page.waitForTimeout(100);
    const themeAfterToggle = await html.getAttribute('data-theme');

    // Reload
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Theme should persist
    const themeAfterReload = await page.locator('html').getAttribute('data-theme');
    expect(themeAfterReload).toBe(themeAfterToggle);
  });
});
