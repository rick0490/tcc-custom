/**
 * Authentication API Tests
 *
 * Tests for login, logout, and session management endpoints.
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
	password: 'testpassword123',
	role: 'admin'
};

const TEST_USER = {
	username: 'testuser',
	password: 'userpassword123',
	role: 'user'
};

describe('Authentication API', () => {
	let app;

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
		const userHash = await bcrypt.hash(TEST_USER.password, 10);

		const testUsers = {
			users: [
				{
					id: 1,
					username: TEST_ADMIN.username,
					password: adminHash,
					role: TEST_ADMIN.role,
					createdAt: new Date().toISOString()
				},
				{
					id: 2,
					username: TEST_USER.username,
					password: userHash,
					role: TEST_USER.role,
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

	afterAll(async () => {
		// Restore original files
		if (originalUsersFile) {
			fs.writeFileSync(usersFilePath, originalUsersFile);
		}
		if (originalAuthDataFile) {
			fs.writeFileSync(authDataFilePath, originalAuthDataFile);
		}
	});

	beforeEach(() => {
		// Clear lockouts before each test
		fs.writeFileSync(authDataFilePath, JSON.stringify({
			failedAttempts: {},
			lockedAccounts: {}
		}));
	});

	describe('POST /api/auth/login', () => {
		test('returns 200 and user data for valid admin credentials', async () => {
			const res = await request(app)
				.post('/api/auth/login')
				.send({
					username: TEST_ADMIN.username,
					password: TEST_ADMIN.password
				});

			expect(res.status).toBe(200);
			expect(res.body.success).toBe(true);
			expect(res.body.user).toBeDefined();
			expect(res.body.user.username).toBe(TEST_ADMIN.username);
			expect(res.body.user.role).toBe('admin');
			// Password should not be returned
			expect(res.body.user.password).toBeUndefined();
		});

		test('returns 200 for valid user credentials', async () => {
			const res = await request(app)
				.post('/api/auth/login')
				.send({
					username: TEST_USER.username,
					password: TEST_USER.password
				});

			expect(res.status).toBe(200);
			expect(res.body.success).toBe(true);
			expect(res.body.user.role).toBe('user');
		});

		test('returns 401 for invalid password', async () => {
			const res = await request(app)
				.post('/api/auth/login')
				.send({
					username: TEST_ADMIN.username,
					password: 'wrongpassword'
				});

			expect(res.status).toBe(401);
			expect(res.body.success).toBe(false);
			expect(res.body.message).toBeDefined();
		});

		test('returns 401 for non-existent user', async () => {
			const res = await request(app)
				.post('/api/auth/login')
				.send({
					username: 'nonexistent',
					password: 'anypassword'
				});

			expect(res.status).toBe(401);
			expect(res.body.success).toBe(false);
		});

		test('returns 400 for missing username', async () => {
			const res = await request(app)
				.post('/api/auth/login')
				.send({
					password: 'somepassword'
				});

			expect(res.status).toBe(400);
			expect(res.body.success).toBe(false);
		});

		test('returns 400 for missing password', async () => {
			const res = await request(app)
				.post('/api/auth/login')
				.send({
					username: TEST_ADMIN.username
				});

			expect(res.status).toBe(400);
			expect(res.body.success).toBe(false);
		});

		test('locks account after 5 failed attempts', async () => {
			// Make 5 failed login attempts
			for (let i = 0; i < 5; i++) {
				await request(app)
					.post('/api/auth/login')
					.send({
						username: TEST_ADMIN.username,
						password: 'wrongpassword'
					});
			}

			// 6th attempt should be blocked
			const res = await request(app)
				.post('/api/auth/login')
				.send({
					username: TEST_ADMIN.username,
					password: TEST_ADMIN.password  // Even correct password
				});

			expect(res.status).toBe(403);
			expect(res.body.locked).toBe(true);
			expect(res.body.message).toMatch(/locked/i);
		});
	});

	describe('POST /api/auth/logout', () => {
		test('returns 200 on logout', async () => {
			// First login
			const agent = request.agent(app);
			await agent.post('/api/auth/login').send({
				username: TEST_ADMIN.username,
				password: TEST_ADMIN.password
			});

			// Get CSRF token
			const csrfRes = await agent.get('/api/csrf-token');
			const csrfToken = csrfRes.body.token;

			// Then logout with CSRF token
			const res = await agent
				.post('/api/auth/logout')
				.set('X-CSRF-Token', csrfToken);

			expect(res.status).toBe(200);
			expect(res.body.success).toBe(true);
		});
	});

	describe('GET /api/auth/status', () => {
		test('returns 401 when not logged in', async () => {
			const res = await request(app).get('/api/auth/status');

			// Endpoint requires authentication
			expect(res.status).toBe(401);
		});

		test('returns user info when logged in', async () => {
			const agent = request.agent(app);

			// Login first
			await agent.post('/api/auth/login').send({
				username: TEST_ADMIN.username,
				password: TEST_ADMIN.password
			});

			// Check status
			const res = await agent.get('/api/auth/status');

			expect(res.status).toBe(200);
			expect(res.body.success).toBe(true);
			expect(res.body.user).toBeDefined();
			expect(res.body.user.username).toBe(TEST_ADMIN.username);
		});
	});

	describe('Protected Routes', () => {
		test('returns 401 for unauthenticated access to protected API', async () => {
			const res = await request(app).get('/api/status');

			expect(res.status).toBe(401);
		});

		test('allows authenticated access to protected API', async () => {
			const agent = request.agent(app);

			// Login first
			await agent.post('/api/auth/login').send({
				username: TEST_ADMIN.username,
				password: TEST_ADMIN.password
			});

			// Access protected route
			const res = await agent.get('/api/status');

			expect(res.status).toBe(200);
		});
	});
});
