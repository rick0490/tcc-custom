import * as fs from 'fs';
import * as path from 'path';

/**
 * Playwright Global Setup
 *
 * Runs once before any E2E tests to ensure a clean test environment.
 * Resets auth-data.json to prevent account lockout from cascading
 * between test runs (caused by invalid credential tests in auth.spec.ts).
 */
async function globalSetup() {
  const authDataPath = path.join(__dirname, '../../auth-data.json');

  fs.writeFileSync(authDataPath, JSON.stringify({
    failedAttempts: {},
    lockedAccounts: {}
  }, null, 2));

  console.log('[Global Setup] Reset auth-data.json');
}

export default globalSetup;
