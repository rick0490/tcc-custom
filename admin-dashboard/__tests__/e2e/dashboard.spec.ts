import { test, expect } from './fixtures/auth.fixture';

test.describe('Dashboard', () => {
  test('dashboard page loads correctly', async ({ authenticatedPage: page }) => {
    await expect(page).toHaveURL('/');
    await expect(page.locator('h1, .page-title')).toContainText(/Dashboard/i);
  });

  test('status cards are visible', async ({ authenticatedPage: page }) => {
    // Wait for status cards to load
    await page.waitForSelector('.status-card-compact, .status-card', { timeout: 10000 });

    // Should have at least 3 status cards (Match, Bracket, Flyer modules)
    const statusCards = page.locator('.status-card-compact, .status-card');
    const count = await statusCards.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test('status cards show module names', async ({ authenticatedPage: page }) => {
    await page.waitForSelector('.status-card-compact, .status-card', { timeout: 10000 });

    // Check for module names in status cards
    const cardText = await page.locator('.status-card-compact, .status-card').allTextContents();
    const allText = cardText.join(' ').toLowerCase();

    expect(allText).toContain('match');
  });

  test('ticker message section exists', async ({ authenticatedPage: page }) => {
    // Look for ticker-related elements
    const tickerSection = page.locator('#tickerMessage, [id*="ticker"], .ticker-section');
    await expect(tickerSection.first()).toBeVisible();
  });

  test('ticker quick message buttons exist', async ({ authenticatedPage: page }) => {
    // Look for preset ticker buttons
    const presetButtons = page.locator('button:has-text("Break"), button:has-text("Report"), button:has-text("Starting")');
    const count = await presetButtons.count();
    expect(count).toBeGreaterThan(0);
  });

  test('send ticker button exists', async ({ authenticatedPage: page }) => {
    const sendBtn = page.locator('#sendTickerBtn, button:has-text("Send")');
    await expect(sendBtn.first()).toBeVisible();
  });

  test('quick actions section exists', async ({ authenticatedPage: page }) => {
    // Look for quick action links/buttons
    const quickActions = page.locator('.quick-actions, [class*="quick-action"], a[href*="tournament"], a[href*="matches"]');
    const count = await quickActions.count();
    expect(count).toBeGreaterThan(0);
  });

  test('timer controls section exists', async ({ authenticatedPage: page }) => {
    // Look for timer-related elements
    const timerSection = page.locator('[id*="timer"], .timer-section, button:has-text("DQ"), button:has-text("Timer")');
    const count = await timerSection.count();
    expect(count).toBeGreaterThan(0);
  });

  test('QR code section exists', async ({ authenticatedPage: page }) => {
    // Look for QR-related elements
    const qrSection = page.locator('[id*="qr"], .qr-section, button:has-text("QR"), button:has-text("Signup")');
    const count = await qrSection.count();
    expect(count).toBeGreaterThan(0);
  });
});

test.describe('Dashboard Polling', () => {
  test('status updates are fetched periodically', async ({ authenticatedPage: page }) => {
    // Wait for initial load
    await page.waitForSelector('.status-card-compact, .status-card', { timeout: 10000 });

    // Monitor network requests for status API
    const statusRequests: string[] = [];
    page.on('request', request => {
      if (request.url().includes('/api/status')) {
        statusRequests.push(request.url());
      }
    });

    // Wait for potential polling (should happen within 15 seconds)
    await page.waitForTimeout(12000);

    // Should have made at least one status request during this time
    expect(statusRequests.length).toBeGreaterThan(0);
  });
});
