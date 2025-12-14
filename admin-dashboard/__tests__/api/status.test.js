/**
 * Status API Tests
 *
 * Tests for system status and health check endpoints.
 */

const request = require('supertest');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');

// Store original files for restoration
let originalUsersFile;
const usersFilePath = path.join(__dirname, '../../users.json');
const authDataFilePath = path.join(__dirname, '../../auth-data.json');

// Test credentials
const TEST_ADMIN = {
	username: 'statustest',
	password: 'testpassword123'
};

describe('Status API', () => {
	let app;
	let agent;

	beforeAll(async () => {
		// Backup original files
		try {
			originalUsersFile = fs.readFileSync(usersFilePath, 'utf8');
		} catch (e) {
			originalUsersFile = null;
		}

		// Create test user
		const adminHash = await bcrypt.hash(TEST_ADMIN.password, 10);
		const testUsers = {
			users: [{
				id: 1,
				username: TEST_ADMIN.username,
				password: adminHash,
				createdAt: new Date().toISOString()
			}]
		};

		fs.writeFileSync(usersFilePath, JSON.stringify(testUsers, null, 2));
		fs.writeFileSync(authDataFilePath, JSON.stringify({
			failedAttempts: {},
			lockedAccounts: {}
		}));

		// Import app
		const server = require('../../server');
		app = server.app;

		// Create authenticated agent
		agent = request.agent(app);
		await agent.post('/api/auth/login').send({
			username: TEST_ADMIN.username,
			password: TEST_ADMIN.password
		});
	});

	afterAll(async () => {
		// Restore original files
		if (originalUsersFile) {
			fs.writeFileSync(usersFilePath, originalUsersFile);
		}
	});

	describe('GET /api/status', () => {
		test('returns system status for authenticated user', async () => {
			const res = await agent.get('/api/status');

			expect(res.status).toBe(200);
			expect(res.body.success).toBe(true);
			expect(res.body).toHaveProperty('modules');
			expect(res.body.modules).toHaveProperty('match');
			expect(res.body.modules).toHaveProperty('bracket');
			expect(res.body.modules).toHaveProperty('flyer');
		});

		test('status includes online/offline indicators', async () => {
			const res = await agent.get('/api/status');

			expect(res.status).toBe(200);
			// Each module should have a status field
			expect(res.body.modules.match).toHaveProperty('status');
			expect(res.body.modules.bracket).toHaveProperty('status');
			expect(res.body.modules.flyer).toHaveProperty('status');
		});

		test('returns 401 for unauthenticated request', async () => {
			const res = await request(app).get('/api/status');

			expect(res.status).toBe(401);
		});
	});

	describe('GET /api/websocket/status', () => {
		test('returns websocket connection status', async () => {
			const res = await agent.get('/api/websocket/status');

			expect(res.status).toBe(200);
			expect(res.body).toHaveProperty('displays');
			expect(res.body).toHaveProperty('displayCount');
			expect(res.body).toHaveProperty('totalConnections');
			expect(Array.isArray(res.body.displays)).toBe(true);
		});
	});
});
