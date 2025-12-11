import { Page } from '@playwright/test';

export async function mockChallongeAPI(page: Page) {
  await page.route('**/api.challonge.com/**', async route => {
    const url = route.request().url();

    if (url.includes('/tournaments.json')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: []
        })
      });
    } else {
      await route.continue();
    }
  });
}

export async function mockEmptyMatches(page: Page) {
  await page.route('**/api/matches/**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ matches: [] })
    });
  });
}

export async function mockTournamentStatus(page: Page, status: object = {}) {
  await page.route('**/api/tournament/status', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        configured: true,
        tournamentId: 'test-tournament',
        gameName: 'Test Game',
        ...status
      })
    });
  });
}
