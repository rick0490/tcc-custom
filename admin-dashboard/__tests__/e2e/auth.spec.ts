import { test, expect } from '@playwright/test';
import { testCredentials } from './fixtures/test-data';

test.describe('Authentication', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login.html');
  });

  test('login page loads correctly', async ({ page }) => {
    await expect(page).toHaveTitle(/Login|Tournament/i);
    await expect(page.locator('#username')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
    await expect(page.locator('#loginBtn')).toBeVisible();
  });

  test('successful login redirects to dashboard', async ({ page }) => {
    await page.fill('#username', testCredentials.admin.username);
    await page.fill('#password', testCredentials.admin.password);
    await page.click('#loginBtn');

    await expect(page).toHaveURL('/');
    await expect(page.locator('#sidebar')).toBeVisible();
  });

  test('invalid credentials shows error message', async ({ page }) => {
    await page.fill('#username', testCredentials.invalid.username);
    await page.fill('#password', testCredentials.invalid.password);
    await page.click('#loginBtn');

    // Should stay on login page
    await expect(page).toHaveURL(/login/);
    // Error message should be visible
    await expect(page.locator('.alert-error, #errorMessage, .error')).toBeVisible();
  });

  test('empty credentials shows validation error', async ({ page }) => {
    await page.click('#loginBtn');

    // Should stay on login page
    await expect(page).toHaveURL(/login/);
  });

  test('logout redirects to login page', async ({ page }) => {
    // Login first
    await page.fill('#username', testCredentials.admin.username);
    await page.fill('#password', testCredentials.admin.password);
    await page.click('#loginBtn');
    await page.waitForURL('/');

    // Find and click logout button
    await page.click('#logoutBtn');

    await expect(page).toHaveURL(/login/);
  });

  test('protected route redirects unauthenticated users', async ({ page }) => {
    // Try to access dashboard directly without login
    await page.goto('/');

    // Should redirect to login
    await expect(page).toHaveURL(/login/);
  });

  test('protected page redirects to login', async ({ page }) => {
    await page.goto('/matches.html');
    await expect(page).toHaveURL(/login/);
  });

  test('session persists across page navigation', async ({ page }) => {
    // Login
    await page.fill('#username', testCredentials.admin.username);
    await page.fill('#password', testCredentials.admin.password);
    await page.click('#loginBtn');
    await page.waitForURL('/');

    // Navigate to another page
    await page.goto('/matches.html');

    // Should not redirect to login
    await expect(page).not.toHaveURL(/login/);
    await expect(page.locator('#sidebar')).toBeVisible();
  });
});
