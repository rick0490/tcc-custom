import { test, expect } from './fixtures/auth.fixture';

test.describe('Theme System', () => {
  test('theme toggle button is accessible', async ({ authenticatedPage: page }) => {
    const themeToggle = page.locator('#themeToggle');
    await expect(themeToggle).toBeVisible();

    // Should be clickable
    await expect(themeToggle).toBeEnabled();
  });

  test('theme toggle has appropriate icon', async ({ authenticatedPage: page }) => {
    const themeToggle = page.locator('#themeToggle');

    // Should contain sun or moon icon (SVG or text)
    const content = await themeToggle.innerHTML();
    const hasIcon = content.includes('svg') ||
                   content.includes('sun') ||
                   content.includes('moon') ||
                   content.includes('icon');
    expect(hasIcon).toBeTruthy();
  });

  test('dark mode applies correct data attribute', async ({ authenticatedPage: page }) => {
    const html = page.locator('html');
    const themeToggle = page.locator('#themeToggle');

    // Get current theme
    const currentTheme = await html.getAttribute('data-theme');

    // If light, toggle to dark
    if (currentTheme !== 'dark') {
      await themeToggle.click();
      await page.waitForTimeout(100);
    }

    await expect(html).toHaveAttribute('data-theme', 'dark');
  });

  test('light mode applies correct data attribute', async ({ authenticatedPage: page }) => {
    const html = page.locator('html');
    const themeToggle = page.locator('#themeToggle');

    // Get current theme
    const currentTheme = await html.getAttribute('data-theme');

    // If dark, toggle to light
    if (currentTheme !== 'light') {
      await themeToggle.click();
      await page.waitForTimeout(100);
    }

    await expect(html).toHaveAttribute('data-theme', 'light');
  });

  test('theme affects background color', async ({ authenticatedPage: page }) => {
    const body = page.locator('body');
    const themeToggle = page.locator('#themeToggle');

    // Get background color in current theme
    const initialBg = await body.evaluate(el =>
      window.getComputedStyle(el).backgroundColor
    );

    // Toggle theme
    await themeToggle.click();
    await page.waitForTimeout(200);

    // Get new background color
    const newBg = await body.evaluate(el =>
      window.getComputedStyle(el).backgroundColor
    );

    // Colors should be different
    expect(newBg).not.toBe(initialBg);
  });

  test('theme is stored in localStorage', async ({ authenticatedPage: page }) => {
    const themeToggle = page.locator('#themeToggle');

    // Toggle theme twice to ensure localStorage is set
    await themeToggle.click();
    await page.waitForTimeout(100);

    // Check localStorage
    const storedTheme = await page.evaluate(() => localStorage.getItem('theme'));
    expect(storedTheme).toBeTruthy();
    expect(['light', 'dark']).toContain(storedTheme);
  });
});

test.describe('Theme Consistency', () => {
  test('theme is consistent across all main pages', async ({ authenticatedPage: page }) => {
    const themeToggle = page.locator('#themeToggle');

    // Set to dark mode
    const currentTheme = await page.locator('html').getAttribute('data-theme');
    if (currentTheme !== 'dark') {
      await themeToggle.click();
      await page.waitForTimeout(100);
    }

    // Check theme on each page
    const pages = ['/matches.html', '/tournament.html', '/displays.html', '/flyers.html', '/participants.html', '/analytics.html', '/settings.html'];

    for (const pagePath of pages) {
      await page.goto(pagePath);
      await page.waitForLoadState('domcontentloaded');

      const theme = await page.locator('html').getAttribute('data-theme');
      expect(theme).toBe('dark');
    }
  });

  test('theme toggle works on all pages', async ({ authenticatedPage: page }) => {
    const pages = ['/', '/matches.html', '/tournament.html'];

    for (const pagePath of pages) {
      await page.goto(pagePath);
      await page.waitForLoadState('domcontentloaded');

      const themeToggle = page.locator('#themeToggle');
      await expect(themeToggle).toBeVisible();

      // Toggle should work
      const beforeTheme = await page.locator('html').getAttribute('data-theme');
      await themeToggle.click();
      await page.waitForTimeout(100);
      const afterTheme = await page.locator('html').getAttribute('data-theme');

      expect(afterTheme).not.toBe(beforeTheme);
    }
  });
});
