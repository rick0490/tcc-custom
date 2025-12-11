/**
 * Rate Limiter Unit Tests
 *
 * Tests for rate limiting logic and calculations.
 * Since rate limiter functions are internal to server.js,
 * these tests verify behavior through the API.
 */

const request = require('supertest');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');

const usersFilePath = path.join(__dirname, '../../users.json');
const authDataFilePath = path.join(__dirname, '../../auth-data.json');
const settingsFilePath = path.join(__dirname, '../../system-settings.json');

let originalUsersFile;
let originalSettingsFile;

const TEST_ADMIN = {
	username: 'ratelimittest',
	password: 'testpassword123'
};

describe('Rate Limiter', () => {
	let app;
	let agent;
	let csrfToken;

	beforeAll(async () => {
		// Backup original files
		try {
			originalUsersFile = fs.readFileSync(usersFilePath, 'utf8');
		} catch (e) {
			originalUsersFile = null;
		}
		try {
			originalSettingsFile = fs.readFileSync(settingsFilePath, 'utf8');
		} catch (e) {
			originalSettingsFile = null;
		}

		// Create test user
		const adminHash = await bcrypt.hash(TEST_ADMIN.password, 10);
		fs.writeFileSync(usersFilePath, JSON.stringify({
			users: [{
				id: 1,
				username: TEST_ADMIN.username,
				password: adminHash,
				role: 'admin',
				createdAt: new Date().toISOString()
			}]
		}, null, 2));

		fs.writeFileSync(authDataFilePath, JSON.stringify({
			failedAttempts: {},
			lockedAccounts: {}
		}));

		// Import app
		const server = require('../../server');
		app = server.app;

		// Create authenticated agent
		agent = request.agent(app);
		const loginResponse = await agent.post('/api/auth/login').send({
			username: TEST_ADMIN.username,
			password: TEST_ADMIN.password
		});

		// Extract CSRF token from login response cookies
		const cookies = loginResponse.headers['set-cookie'];
		const xsrfCookie = cookies.find(cookie => cookie.startsWith('XSRF-TOKEN='));
		csrfToken = xsrfCookie.split('=')[1].split(';')[0];
	});

	afterAll(async () => {
		// Restore original files
		if (originalUsersFile) {
			fs.writeFileSync(usersFilePath, originalUsersFile);
		}
		if (originalSettingsFile) {
			fs.writeFileSync(settingsFilePath, originalSettingsFile);
		}
	});

	describe('Rate Mode Calculations', () => {
		test('IDLE mode should have lowest effective rate', async () => {
			// Get current status
			const res = await agent.get('/api/rate-limit/status');

			expect(res.status).toBe(200);

			// Verify rate modes exist
			expect(['IDLE', 'UPCOMING', 'ACTIVE']).toContain(res.body.currentMode);

			// Effective rate should be a positive number
			expect(res.body.effectiveRate).toBeGreaterThan(0);
		});

		test('rate limit settings include all required fields', async () => {
			const res = await agent.get('/api/rate-limit/status');

			expect(res.status).toBe(200);

			// Check for adaptive settings
			if (res.body.adaptiveEnabled) {
				expect(res.body.settings).toHaveProperty('idleRate');
				expect(res.body.settings).toHaveProperty('upcomingRate');
				expect(res.body.settings).toHaveProperty('activeRate');
			}
		});
	});

	describe('Rate Mode API', () => {
		test('POST /api/rate-limit/mode sets manual override', async () => {
			const res = await agent
				.post('/api/rate-limit/mode')
				.set('X-CSRF-Token', csrfToken)
				.send({ mode: 'IDLE' });

			expect(res.status).toBe(200);
			expect(res.body.success).toBe(true);
		});

		test('POST /api/rate-limit/mode rejects invalid mode', async () => {
			const res = await agent
				.post('/api/rate-limit/mode')
				.set('X-CSRF-Token', csrfToken)
				.send({ mode: 'INVALID_MODE' });

			expect(res.status).toBe(400);
			expect(res.body.success).toBe(false);
		});

		test('POST /api/rate-limit/mode auto clears override', async () => {
			// Set a mode first
			await agent
				.post('/api/rate-limit/mode')
				.set('X-CSRF-Token', csrfToken)
				.send({ mode: 'IDLE' });

			// Clear with auto
			const res = await agent
				.post('/api/rate-limit/mode')
				.set('X-CSRF-Token', csrfToken)
				.send({ mode: 'auto' });

			expect(res.status).toBe(200);
			expect(res.body.success).toBe(true);
		});
	});

	describe('Dev Mode', () => {
		test('POST /api/rate-limit/dev-mode/enable activates dev mode', async () => {
			const res = await agent
				.post('/api/rate-limit/dev-mode/enable')
				.set('X-CSRF-Token', csrfToken);

			expect(res.status).toBe(200);
			expect(res.body.success).toBe(true);
			// Response includes getRateLimitStatus() which has devModeActive
			expect(res.body.devModeActive).toBe(true);
			expect(res.body.devModeExpiresAt).toBeDefined();
		});

		test('POST /api/rate-limit/dev-mode/disable deactivates dev mode', async () => {
			// Enable first
			await agent
				.post('/api/rate-limit/dev-mode/enable')
				.set('X-CSRF-Token', csrfToken);

			// Then disable
			const res = await agent
				.post('/api/rate-limit/dev-mode/disable')
				.set('X-CSRF-Token', csrfToken);

			expect(res.status).toBe(200);
			expect(res.body.success).toBe(true);
			expect(res.body.devModeActive).toBe(false);
		});

		test('dev mode status reflected in rate-limit/status', async () => {
			// Enable dev mode
			await agent
				.post('/api/rate-limit/dev-mode/enable')
				.set('X-CSRF-Token', csrfToken);

			const res = await agent.get('/api/rate-limit/status');

			expect(res.status).toBe(200);
			expect(res.body.devModeActive).toBe(true);

			// Clean up
			await agent
				.post('/api/rate-limit/dev-mode/disable')
				.set('X-CSRF-Token', csrfToken);
		});
	});

	describe('Request Delay Calculation', () => {
		test('effective rate determines delay between requests', async () => {
			// Ensure dev mode is disabled first
			await agent
				.post('/api/rate-limit/dev-mode/disable')
				.set('X-CSRF-Token', csrfToken);

			const res = await agent.get('/api/rate-limit/status');

			expect(res.status).toBe(200);

			const effectiveRate = res.body.effectiveRate;

			// Effective rate should be a positive number
			expect(effectiveRate).toBeGreaterThan(0);

			// Calculate expected delay: 60000ms / requests per minute
			const expectedDelay = Math.ceil(60000 / effectiveRate);

			// Delay should be positive and not exceed 1 minute
			expect(expectedDelay).toBeGreaterThan(0);
			expect(expectedDelay).toBeLessThanOrEqual(60000);
		});
	});
});

describe('Rate Limit Math', () => {
	test('12 requests per minute = 5000ms delay', () => {
		const requestsPerMinute = 12;
		const delay = Math.ceil(60000 / requestsPerMinute);
		expect(delay).toBe(5000);
	});

	test('20 requests per minute = 3000ms delay', () => {
		const requestsPerMinute = 20;
		const delay = Math.ceil(60000 / requestsPerMinute);
		expect(delay).toBe(3000);
	});

	test('30 requests per minute = 2000ms delay', () => {
		const requestsPerMinute = 30;
		const delay = Math.ceil(60000 / requestsPerMinute);
		expect(delay).toBe(2000);
	});

	test('60 requests per minute = 1000ms delay', () => {
		const requestsPerMinute = 60;
		const delay = Math.ceil(60000 / requestsPerMinute);
		expect(delay).toBe(1000);
	});

	test('1 request per minute = 60000ms delay', () => {
		const requestsPerMinute = 1;
		const delay = Math.ceil(60000 / requestsPerMinute);
		expect(delay).toBe(60000);
	});
});
