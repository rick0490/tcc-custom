/**
 * CSRF Protection Tests
 *
 * Tests for CSRF token generation, validation, and exempt routes.
 */

const request = require('supertest');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');

// Store original files for restoration
let originalUsersFile;
let originalAuthDataFile;
const usersFilePath = path.join(__dirname, '../../users.json');
const authDataFilePath = path.join(__dirname, '../../auth-data.json');

// Test user credentials
const TEST_ADMIN = {
	username: 'csrftestadmin',
	password: 'testpassword123',
	role: 'admin'
};

describe('CSRF Protection', () => {
	let app;
	let agent;

	beforeAll(async () => {
		// Backup original files
		try {
			originalUsersFile = fs.readFileSync(usersFilePath, 'utf8');
		} catch (e) {
			originalUsersFile = null;
		}
		try {
			originalAuthDataFile = fs.readFileSync(authDataFilePath, 'utf8');
		} catch (e) {
			originalAuthDataFile = null;
		}

		// Create test user with hashed password
		const adminHash = await bcrypt.hash(TEST_ADMIN.password, 10);

		const testUsers = {
			users: [
				{
					id: 999,
					username: TEST_ADMIN.username,
					password: adminHash,
					role: TEST_ADMIN.role,
					createdAt: new Date().toISOString()
				}
			]
		};

		// Write test users file
		fs.writeFileSync(usersFilePath, JSON.stringify(testUsers, null, 2));

		// Clear auth data (lockouts, failed attempts)
		fs.writeFileSync(authDataFilePath, JSON.stringify({
			failedAttempts: {},
			lockedAccounts: {}
		}));

		// Import app after setting up test data
		const server = require('../../server');
		app = server.app;
	});

	afterAll(() => {
		// Restore original files
		if (originalUsersFile !== null) {
			fs.writeFileSync(usersFilePath, originalUsersFile);
		}
		if (originalAuthDataFile !== null) {
			fs.writeFileSync(authDataFilePath, originalAuthDataFile);
		}
	});

	beforeEach(() => {
		// Create new agent for each test to get fresh session
		agent = request.agent(app);
	});

	describe('Token Generation', () => {
		test('GET /api/csrf-token returns token when authenticated', async () => {
			// Login first
			await agent
				.post('/api/auth/login')
				.send({ username: TEST_ADMIN.username, password: TEST_ADMIN.password });

			const response = await agent.get('/api/csrf-token');

			expect(response.status).toBe(200);
			expect(response.body.success).toBe(true);
			expect(response.body.token).toBeDefined();
			expect(typeof response.body.token).toBe('string');
			expect(response.body.token.length).toBe(64); // 32 bytes hex = 64 chars
		});

		test('CSRF cookie is set on login', async () => {
			const response = await agent
				.post('/api/auth/login')
				.send({ username: TEST_ADMIN.username, password: TEST_ADMIN.password });

			expect(response.status).toBe(200);

			// Check for XSRF-TOKEN cookie
			const cookies = response.headers['set-cookie'];
			const hasXsrfCookie = cookies.some(cookie => cookie.startsWith('XSRF-TOKEN='));
			expect(hasXsrfCookie).toBe(true);
		});

		test('CSRF cookie is NOT httpOnly (readable by JS)', async () => {
			const response = await agent
				.post('/api/auth/login')
				.send({ username: TEST_ADMIN.username, password: TEST_ADMIN.password });

			const cookies = response.headers['set-cookie'];
			const xsrfCookie = cookies.find(cookie => cookie.startsWith('XSRF-TOKEN='));

			// Should NOT contain httpOnly flag (or the cookie wouldn't be readable by JS)
			expect(xsrfCookie.toLowerCase()).not.toContain('httponly');
		});
	});

	describe('Token Validation', () => {
		test('POST without CSRF token returns 403', async () => {
			// Login first
			await agent
				.post('/api/auth/login')
				.send({ username: TEST_ADMIN.username, password: TEST_ADMIN.password });

			// Try POST without CSRF token
			const response = await agent
				.post('/api/ticker/send')
				.send({ message: 'test', duration: 5 });

			expect(response.status).toBe(403);
			expect(response.body.code).toBe('CSRF_INVALID');
		});

		test('POST with valid CSRF token succeeds', async () => {
			// Login first
			const loginResponse = await agent
				.post('/api/auth/login')
				.send({ username: TEST_ADMIN.username, password: TEST_ADMIN.password });

			// Extract CSRF token from cookie
			const cookies = loginResponse.headers['set-cookie'];
			const xsrfCookie = cookies.find(cookie => cookie.startsWith('XSRF-TOKEN='));
			const token = xsrfCookie.split('=')[1].split(';')[0];

			// POST with valid CSRF token (to a safe endpoint that won't fail for other reasons)
			const response = await agent
				.post('/api/auth/logout')
				.set('X-CSRF-Token', token);

			// Should succeed (logout always returns success)
			expect(response.status).toBe(200);
			expect(response.body.success).toBe(true);
		});

		test('POST with invalid CSRF token returns 403', async () => {
			// Login first
			await agent
				.post('/api/auth/login')
				.send({ username: TEST_ADMIN.username, password: TEST_ADMIN.password });

			// Try POST with invalid CSRF token
			const response = await agent
				.post('/api/ticker/send')
				.set('X-CSRF-Token', 'invalid-token-value')
				.send({ message: 'test', duration: 5 });

			expect(response.status).toBe(403);
			expect(response.body.code).toBe('CSRF_INVALID');
		});

		test('PUT request without CSRF token returns 403', async () => {
			// Login first
			await agent
				.post('/api/auth/login')
				.send({ username: TEST_ADMIN.username, password: TEST_ADMIN.password });

			// Try PUT without CSRF token
			const response = await agent
				.put('/api/settings/system')
				.send({ section: 'systemDefaults', data: {} });

			expect(response.status).toBe(403);
			expect(response.body.code).toBe('CSRF_INVALID');
		});

		test('DELETE request without CSRF token returns 403', async () => {
			// Login first
			await agent
				.post('/api/auth/login')
				.send({ username: TEST_ADMIN.username, password: TEST_ADMIN.password });

			// Try DELETE without CSRF token
			const response = await agent
				.delete('/api/settings/activity-log');

			expect(response.status).toBe(403);
			expect(response.body.code).toBe('CSRF_INVALID');
		});

		test('GET requests do not require CSRF token', async () => {
			// Login first
			await agent
				.post('/api/auth/login')
				.send({ username: TEST_ADMIN.username, password: TEST_ADMIN.password });

			// GET should work without CSRF token
			const response = await agent.get('/api/status');

			expect(response.status).toBe(200);
			expect(response.body.success).toBe(true);
		});
	});

	describe('Exempt Routes', () => {
		test('POST /api/auth/login is exempt from CSRF', async () => {
			// Login should work without CSRF token (no session exists yet)
			const response = await request(app)
				.post('/api/auth/login')
				.send({ username: TEST_ADMIN.username, password: TEST_ADMIN.password });

			expect(response.status).toBe(200);
			expect(response.body.success).toBe(true);
		});

		test('POST /api/displays/register is exempt from CSRF', async () => {
			// Display registration should work without CSRF token
			const response = await request(app)
				.post('/api/displays/register')
				.send({
					mac: 'aa:bb:cc:dd:ee:f1',
					hostname: 'test-pi-csrf',
					currentView: 'match'
				});

			expect(response.status).toBe(200);
			expect(response.body.success).toBe(true);
		});

		test('POST /api/displays/:id/heartbeat is exempt from CSRF', async () => {
			// First register a display
			await request(app)
				.post('/api/displays/register')
				.send({
					mac: 'aa:bb:cc:dd:ee:f2',
					hostname: 'test-pi-heartbeat-csrf',
					currentView: 'match'
				});

			// Heartbeat should work without CSRF token (display ID is MAC without colons)
			const response = await request(app)
				.post('/api/displays/aabbccddeef2/heartbeat')
				.send({
					uptimeSeconds: 1000,
					cpuTemp: 45,
					memoryUsage: 50
				});

			expect(response.status).toBe(200);
			expect(response.body.success).toBe(true);
		});

		test('POST /api/displays/:id/logs is exempt from CSRF', async () => {
			// First register a display
			await request(app)
				.post('/api/displays/register')
				.send({
					mac: 'aa:bb:cc:dd:ee:f3',
					hostname: 'test-pi-logs-csrf',
					currentView: 'match'
				});

			// Debug logs push should work without CSRF token (display ID is MAC without colons)
			const response = await request(app)
				.post('/api/displays/aabbccddeef3/logs')
				.send({
					logs: [{ timestamp: new Date().toISOString(), level: 'info', source: 'test', message: 'Test log' }]
				});

			expect(response.status).toBe(200);
			expect(response.body.success).toBe(true);
		});
	});

	describe('Error Messages', () => {
		test('CSRF error provides clear error message', async () => {
			// Login first
			await agent
				.post('/api/auth/login')
				.send({ username: TEST_ADMIN.username, password: TEST_ADMIN.password });

			// Try POST without CSRF token
			const response = await agent
				.post('/api/ticker/send')
				.send({ message: 'test', duration: 5 });

			expect(response.status).toBe(403);
			expect(response.body.success).toBe(false);
			expect(response.body.error).toContain('CSRF');
			expect(response.body.code).toBe('CSRF_INVALID');
		});
	});
});
