/**
 * Jest Test Setup
 *
 * This file runs before each test file and sets up the test environment.
 */

// Set test environment
process.env.NODE_ENV = 'test';

// Use a different port for tests to avoid conflicts with running server
process.env.PORT = 3099;

// Use test session secret
process.env.SESSION_SECRET = 'test-secret-key';

// Suppress console output during tests (optional - comment out to debug)
// global.console = {
// 	...console,
// 	log: jest.fn(),
// 	debug: jest.fn(),
// 	info: jest.fn(),
// 	// Keep error and warn for debugging failed tests
// 	error: console.error,
// 	warn: console.warn
// };

// Global test timeout
jest.setTimeout(10000);

// Clean up after all tests
afterAll(async () => {
	// Give time for any async cleanup
	await new Promise(resolve => setTimeout(resolve, 500));
});
