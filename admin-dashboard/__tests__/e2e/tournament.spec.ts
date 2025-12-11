import { test, expect } from './fixtures/auth.fixture';
import { mockChallongeAPI } from './fixtures/api-mocks';

test.describe('Tournament Page', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.goto('/tournament.html');
  });

  test('tournament page loads correctly', async ({ authenticatedPage: page }) => {
    await expect(page.locator('h1, .page-title')).toContainText(/Tournament/i);
  });

  test('tournament tabs exist', async ({ authenticatedPage: page }) => {
    // Should have tabs for different tournament states
    const tabs = page.locator('[role="tab"], .tab, button:has-text("Pending"), button:has-text("Progress"), button:has-text("Complete")');
    const count = await tabs.count();
    expect(count).toBeGreaterThan(0);
  });

  test('create tournament button exists', async ({ authenticatedPage: page }) => {
    const createBtn = page.locator('#createTournamentBtn, button:has-text("Create")');
    await expect(createBtn.first()).toBeVisible();
  });
});

test.describe('Tournament Creation Wizard', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await mockChallongeAPI(page);
    await page.goto('/tournament.html');
  });

  test('clicking create opens wizard modal', async ({ authenticatedPage: page }) => {
    const createBtn = page.locator('#createTournamentBtn, button:has-text("Create")').first();
    await createBtn.click();

    // Wizard modal should be visible
    const modal = page.locator('#createWizardModal, .wizard-modal, [role="dialog"]');
    await expect(modal.first()).toBeVisible();
  });

  test('wizard has step indicators', async ({ authenticatedPage: page }) => {
    const createBtn = page.locator('#createTournamentBtn, button:has-text("Create")').first();
    await createBtn.click();

    // Should have step indicators (1, 2, 3 or similar)
    const steps = page.locator('.step-indicator, .wizard-step, [class*="step"]');
    const count = await steps.count();
    expect(count).toBeGreaterThan(0);
  });

  test('wizard step 1 has name field', async ({ authenticatedPage: page }) => {
    const createBtn = page.locator('#createTournamentBtn, button:has-text("Create")').first();
    await createBtn.click();

    // Name field should be visible in step 1
    const nameField = page.locator('#wizardName, input[name="name"], input[placeholder*="name" i]');
    await expect(nameField.first()).toBeVisible();
  });

  test('wizard navigation buttons work', async ({ authenticatedPage: page }) => {
    const createBtn = page.locator('#createTournamentBtn, button:has-text("Create")').first();
    await createBtn.click();

    // Fill required field to enable next
    const nameField = page.locator('#wizardName, input[name="name"]').first();
    await nameField.fill('Test Tournament');

    // Click next
    const nextBtn = page.locator('#wizardNextBtn, button:has-text("Next")').first();
    await nextBtn.click();

    // Step 2 should be visible (format selection)
    const step2Indicator = page.locator('#step2, .step-2, [data-step="2"]');

    // Either step 2 content is visible or we're now on step 2
    const formatSection = page.locator('select[name="tournamentType"], #tournamentType, [id*="format"]');
    const visible = await formatSection.first().isVisible().catch(() => false) ||
                   await step2Indicator.first().isVisible().catch(() => false);
    expect(visible).toBeTruthy();
  });

  test('wizard back button returns to previous step', async ({ authenticatedPage: page }) => {
    const createBtn = page.locator('#createTournamentBtn, button:has-text("Create")').first();
    await createBtn.click();

    // Fill and go to step 2
    const nameField = page.locator('#wizardName, input[name="name"]').first();
    await nameField.fill('Test Tournament');

    const nextBtn = page.locator('#wizardNextBtn, button:has-text("Next")').first();
    await nextBtn.click();
    await page.waitForTimeout(300);

    // Go back
    const prevBtn = page.locator('#wizardPrevBtn, button:has-text("Back"), button:has-text("Previous")').first();
    if (await prevBtn.isVisible()) {
      await prevBtn.click();
      await page.waitForTimeout(300);

      // Name field should be visible again
      await expect(nameField).toBeVisible();
    }
  });

  test('wizard close button works', async ({ authenticatedPage: page }) => {
    const createBtn = page.locator('#createTournamentBtn, button:has-text("Create")').first();
    await createBtn.click();

    // Find close button
    const closeBtn = page.locator('#closeWizardBtn, button:has-text("Cancel"), button:has-text("Close"), .modal-close, [aria-label="Close"]').first();
    await closeBtn.click();

    // Modal should be hidden
    await page.waitForTimeout(300);
    const modal = page.locator('#createWizardModal, .wizard-modal');
    if (await modal.count() > 0) {
      await expect(modal.first()).toBeHidden();
    }
  });

  test('wizard validates required fields', async ({ authenticatedPage: page }) => {
    const createBtn = page.locator('#createTournamentBtn, button:has-text("Create")').first();
    await createBtn.click();

    // Try to proceed without filling name
    const nextBtn = page.locator('#wizardNextBtn, button:has-text("Next")').first();
    await nextBtn.click();

    // Should still be on step 1 or show validation error
    const nameField = page.locator('#wizardName, input[name="name"]').first();
    const isStillVisible = await nameField.isVisible();
    expect(isStillVisible).toBeTruthy();
  });
});

test.describe('Tournament Selection', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.goto('/tournament.html');
  });

  test('tournament list container exists', async ({ authenticatedPage: page }) => {
    const listContainer = page.locator('#tournamentList, .tournament-list, [class*="tournament"]');
    await expect(listContainer.first()).toBeVisible();
  });

  test('refresh tournaments button exists', async ({ authenticatedPage: page }) => {
    const refreshBtn = page.locator('button:has-text("Refresh"), button[title*="Refresh"], #refreshBtn');
    const count = await refreshBtn.count();
    expect(count).toBeGreaterThan(0);
  });
});
