import { test, expect } from './fixtures/auth.fixture';

test.describe('Matches Page', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.goto('/matches.html');
  });

  test('matches page loads correctly', async ({ authenticatedPage: page }) => {
    await expect(page.locator('h1, .page-title')).toContainText(/Match/i);
  });

  test('filter buttons exist', async ({ authenticatedPage: page }) => {
    const filterButtons = page.locator('[data-filter], .filter-btn, button:has-text("All"), button:has-text("Open"), button:has-text("Progress"), button:has-text("Complete")');
    const count = await filterButtons.count();
    expect(count).toBeGreaterThan(0);
  });

  test('clicking filter buttons changes active state', async ({ authenticatedPage: page }) => {
    // Find open filter button
    const openFilter = page.locator('[data-filter="open"], button:has-text("Open")').first();

    if (await openFilter.isVisible()) {
      await openFilter.click();
      await page.waitForTimeout(200);

      // Button should have active class
      const hasActiveClass = await openFilter.evaluate(el => {
        return el.classList.contains('active') ||
               el.classList.contains('selected') ||
               el.getAttribute('aria-selected') === 'true';
      });
      expect(hasActiveClass).toBeTruthy();
    }
  });

  test('match list container exists', async ({ authenticatedPage: page }) => {
    const matchList = page.locator('#matchList, .match-list, [class*="match"]');
    await expect(matchList.first()).toBeVisible();
  });

  test('station management section exists', async ({ authenticatedPage: page }) => {
    // Look for station-related elements
    const stationSection = page.locator('#stationList, .station-section, [id*="station"], h2:has-text("Station"), h3:has-text("Station")');
    const count = await stationSection.count();
    expect(count).toBeGreaterThan(0);
  });

  test('add station button exists', async ({ authenticatedPage: page }) => {
    const addStationBtn = page.locator('#addStationBtn, button:has-text("Add Station"), button:has-text("Create Station"), button:has-text("New Station")');
    const count = await addStationBtn.count();
    expect(count).toBeGreaterThan(0);
  });
});

test.describe('Match Filters', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.goto('/matches.html');
  });

  test('all filter shows all matches', async ({ authenticatedPage: page }) => {
    const allFilter = page.locator('[data-filter="all"], button:has-text("All")').first();

    if (await allFilter.isVisible()) {
      await allFilter.click();
      await page.waitForTimeout(300);

      // All filter should be active
      const isActive = await allFilter.evaluate(el =>
        el.classList.contains('active') || el.getAttribute('aria-selected') === 'true'
      );
      expect(isActive).toBeTruthy();
    }
  });

  test('filter state persists after interaction', async ({ authenticatedPage: page }) => {
    const completeFilter = page.locator('[data-filter="complete"], button:has-text("Complete")').first();

    if (await completeFilter.isVisible()) {
      await completeFilter.click();
      await page.waitForTimeout(300);

      // Click somewhere else
      await page.click('body');
      await page.waitForTimeout(200);

      // Filter should still be active
      const isStillActive = await completeFilter.evaluate(el =>
        el.classList.contains('active') || el.getAttribute('aria-selected') === 'true'
      );
      expect(isStillActive).toBeTruthy();
    }
  });
});

test.describe('Score Modal', () => {
  test('score modal elements exist in DOM', async ({ authenticatedPage: page }) => {
    await page.goto('/matches.html');

    // Check if score modal exists (may be hidden)
    const scoreModal = page.locator('#scoreModal');
    const exists = await scoreModal.count() > 0;
    expect(exists).toBeTruthy();
  });
});

test.describe('Station Management', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.goto('/matches.html');
  });

  test('auto-assign toggle exists', async ({ authenticatedPage: page }) => {
    const autoAssignToggle = page.locator('#autoAssignToggle, input[type="checkbox"][id*="auto"], label:has-text("Auto")');
    const count = await autoAssignToggle.count();
    expect(count).toBeGreaterThan(0);
  });

  test('station list shows existing stations', async ({ authenticatedPage: page }) => {
    // Wait for potential API response
    await page.waitForTimeout(1000);

    const stationList = page.locator('#stationList, .station-list');
    await expect(stationList.first()).toBeVisible();
  });
});
