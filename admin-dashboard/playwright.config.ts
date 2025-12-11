import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  globalSetup: require.resolve('./__tests__/e2e/global-setup.ts'),
  testDir: './__tests__/e2e',
  fullyParallel: false,  // Serial execution like Jest
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [
    ['html', { open: 'never' }],
    ['list']
  ],
  use: {
    baseURL: 'http://localhost:3098',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'PORT=3098 NODE_ENV=test node server.js',
    url: 'http://localhost:3098/login.html',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
  timeout: 30000,
  expect: { timeout: 5000 },
});
