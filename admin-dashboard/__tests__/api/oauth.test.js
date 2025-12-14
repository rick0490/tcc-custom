/**
 * OAuth API Tests
 *
 * Tests for OAuth token management, status, and encryption.
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
	username: 'testadmin',
	password: 'testpassword123'
};

describe('OAuth API', () => {
	let app;
	let agent;
	let analyticsDb;

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

		// Create test users with hashed passwords
		const adminHash = await bcrypt.hash(TEST_ADMIN.password, 10);

		const testUsers = {
			users: [
				{
					id: 1,
					username: TEST_ADMIN.username,
					password: adminHash,
					createdAt: new Date().toISOString()
				}
			]
		};

		// Write test users file
		fs.writeFileSync(usersFilePath, JSON.stringify(testUsers, null, 2));

		// Clear auth data
		fs.writeFileSync(authDataFilePath, JSON.stringify({
			failedAttempts: {},
			lockedAccounts: {}
		}));

		// Import app after setting up test data
		const server = require('../../server');
		app = server.app;
		analyticsDb = require('../../analytics-db');

		// Login as admin
		agent = request.agent(app);
		await agent
			.post('/api/auth/login')
			.send({ username: TEST_ADMIN.username, password: TEST_ADMIN.password });
	});

	// Helper to get CSRF token
	const getCsrfToken = async () => {
		const res = await agent.get('/api/csrf-token');
		return res.body.token;
	};

	afterAll(async () => {
		// Restore original files
		if (originalUsersFile !== null) {
			fs.writeFileSync(usersFilePath, originalUsersFile);
		}
		if (originalAuthDataFile !== null) {
			fs.writeFileSync(authDataFilePath, originalAuthDataFile);
		}

		// Clean up OAuth tokens from test
		try {
			analyticsDb.deleteOAuthTokens('challonge');
		} catch (e) {
			// Ignore if already cleaned up
		}
	});

	describe('Token Encryption', () => {
		test('encryptToken and decryptToken should be reversible', () => {
			const testToken = 'test_access_token_12345';
			const encrypted = analyticsDb.encryptToken(testToken);

			expect(encrypted).toHaveProperty('encrypted');
			expect(encrypted).toHaveProperty('iv');
			expect(encrypted.encrypted).not.toBe(testToken);

			const decrypted = analyticsDb.decryptToken(encrypted.encrypted, encrypted.iv);
			expect(decrypted).toBe(testToken);
		});

		test('encryptToken should generate unique IVs', () => {
			const testToken = 'test_token';
			const encrypted1 = analyticsDb.encryptToken(testToken);
			const encrypted2 = analyticsDb.encryptToken(testToken);

			expect(encrypted1.iv).not.toBe(encrypted2.iv);
			expect(encrypted1.encrypted).not.toBe(encrypted2.encrypted);
		});
	});

	describe('Token Storage', () => {
		test('saveOAuthTokens should store tokens without error', () => {
			const tokens = {
				access_token: 'test_access_token',
				refresh_token: 'test_refresh_token',
				token_type: 'Bearer',
				expires_in: 7200,
				scope: 'tournaments:read',
				user_id: 'test_user_123',
				username: 'testuser'
			};

			// Should not throw
			expect(() => {
				analyticsDb.saveOAuthTokens(tokens, 'challonge');
			}).not.toThrow();
		});

		test('getOAuthTokens should retrieve stored tokens', () => {
			const tokens = analyticsDb.getOAuthTokens('challonge');

			expect(tokens).not.toBeNull();
			expect(tokens.accessToken).toBe('test_access_token');
			expect(tokens.refreshToken).toBe('test_refresh_token');
			expect(tokens.tokenType).toBe('Bearer');
			expect(tokens.scope).toBe('tournaments:read');
			expect(tokens.challongeUserId).toBe('test_user_123');
			expect(tokens.challongeUsername).toBe('testuser');
		});

		test('isOAuthConnected should return true when token exists and not expired', () => {
			const connected = analyticsDb.isOAuthConnected('challonge');
			expect(connected).toBe(true);
		});

		test('tokenNeedsRefresh should return false for fresh token', () => {
			const needsRefresh = analyticsDb.tokenNeedsRefresh('challonge', 5);
			expect(needsRefresh).toBe(false);
		});

		test('getOAuthStatus should return status object', () => {
			const status = analyticsDb.getOAuthStatus('challonge');

			expect(status).toHaveProperty('connected');
			expect(status).toHaveProperty('challongeUsername');
			expect(status).toHaveProperty('expiresAt');
			expect(status).toHaveProperty('scope');
			expect(status.connected).toBe(true);
		});

		test('deleteOAuthTokens should remove tokens without error', () => {
			// Should not throw
			expect(() => {
				analyticsDb.deleteOAuthTokens('challonge');
			}).not.toThrow();

			const tokens = analyticsDb.getOAuthTokens('challonge');
			expect(tokens).toBeNull();
		});

		test('isOAuthConnected should return false when no token', () => {
			const connected = analyticsDb.isOAuthConnected('challonge');
			expect(connected).toBe(false);
		});
	});

	describe('OAuth Status Endpoint', () => {
		test('GET /api/oauth/status should return not connected when no token', async () => {
			const res = await agent.get('/api/oauth/status');

			expect(res.status).toBe(200);
			expect(res.body.success).toBe(true);
			expect(res.body.connected).toBe(false);
		});

		test('GET /api/oauth/status should return connected when token exists', async () => {
			// Store a test token
			analyticsDb.saveOAuthTokens({
				access_token: 'status_test_token',
				refresh_token: 'status_refresh_token',
				token_type: 'Bearer',
				expires_in: 7200,
				scope: 'tournaments:read',
				user_id: 'user123',
				username: 'statususer'
			}, 'challonge');

			const res = await agent.get('/api/oauth/status');

			expect(res.status).toBe(200);
			expect(res.body.success).toBe(true);
			expect(res.body.connected).toBe(true);
			// API returns challongeUsername but frontend displays as username
			expect(res.body.challongeUsername || res.body.username).toBe('statususer');

			// Clean up
			analyticsDb.deleteOAuthTokens('challonge');
		});
	});

	describe('OAuth Disconnect Endpoint', () => {
		test('POST /api/oauth/disconnect should remove tokens', async () => {
			// Store a test token first
			analyticsDb.saveOAuthTokens({
				access_token: 'disconnect_test_token',
				refresh_token: 'disconnect_refresh_token',
				token_type: 'Bearer',
				expires_in: 7200,
				scope: 'tournaments:read',
				user_id: 'user123',
				username: 'disconnectuser'
			}, 'challonge');

			// Verify token exists
			expect(analyticsDb.isOAuthConnected('challonge')).toBe(true);

			const csrfToken = await getCsrfToken();
			const res = await agent
				.post('/api/oauth/disconnect')
				.set('X-CSRF-Token', csrfToken);

			expect(res.status).toBe(200);
			expect(res.body.success).toBe(true);

			// Verify token is deleted
			expect(analyticsDb.isOAuthConnected('challonge')).toBe(false);
		});

		test('POST /api/oauth/disconnect should succeed even with no token', async () => {
			// Ensure no token exists
			analyticsDb.deleteOAuthTokens('challonge');

			const csrfToken = await getCsrfToken();
			const res = await agent
				.post('/api/oauth/disconnect')
				.set('X-CSRF-Token', csrfToken);

			expect(res.status).toBe(200);
			expect(res.body.success).toBe(true);
		});
	});

	describe('OAuth Refresh Endpoint', () => {
		test('POST /api/oauth/refresh should fail when no token exists', async () => {
			// Ensure no token exists
			analyticsDb.deleteOAuthTokens('challonge');

			const csrfToken = await getCsrfToken();
			const res = await agent
				.post('/api/oauth/refresh')
				.set('X-CSRF-Token', csrfToken);

			expect(res.status).toBe(400);
			expect(res.body.success).toBe(false);
			expect(res.body.error).toContain('refresh token');
		});
	});

	describe('OAuth Authentication Required', () => {
		test('GET /api/oauth/status should require authentication', async () => {
			// Use a fresh agent without login
			const unauthAgent = request.agent(app);
			const res = await unauthAgent.get('/api/oauth/status');

			expect(res.status).toBe(401);
		});

		test('POST /api/oauth/disconnect should require authentication', async () => {
			const unauthAgent = request.agent(app);
			const res = await unauthAgent.post('/api/oauth/disconnect');

			expect(res.status).toBe(401);
		});

		test('POST /api/oauth/refresh should require authentication', async () => {
			const unauthAgent = request.agent(app);
			const res = await unauthAgent.post('/api/oauth/refresh');

			expect(res.status).toBe(401);
		});
	});
});
