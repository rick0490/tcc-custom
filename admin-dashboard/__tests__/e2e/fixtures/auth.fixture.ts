import { test as base, Page } from '@playwright/test';

export const test = base.extend<{ authenticatedPage: Page }>({
  authenticatedPage: async ({ page }, use) => {
    await page.goto('/login.html');
    await page.fill('#username', 'admin');
    await page.fill('#password', 'tournament2024');
    await page.click('#loginBtn');
    await page.waitForURL('/');
    await use(page);
  },
});

export { expect } from '@playwright/test';
