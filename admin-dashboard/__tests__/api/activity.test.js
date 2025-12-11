/**
 * Activity API Tests
 *
 * Tests for the Live Activity Feed API endpoints.
 */

const request = require('supertest');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');

// Store original files for restoration
let originalUsersFile;
let originalActivityLog;
const usersFilePath = path.join(__dirname, '../../users.json');
const authDataFilePath = path.join(__dirname, '../../auth-data.json');
const activityLogFilePath = path.join(__dirname, '../../activity-log.json');

// Test credentials
const TEST_ADMIN = {
	username: 'activitytest',
	password: 'testpassword123'
};

// Test activity token (must match the default in server.js)
const VALID_ACTIVITY_TOKEN = 'default-activity-token-change-me';
const INVALID_ACTIVITY_TOKEN = 'invalid_token_12345';

describe('Activity API', () => {
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
			originalActivityLog = fs.readFileSync(activityLogFilePath, 'utf8');
		} catch (e) {
			originalActivityLog = null;
		}

		// Create test user
		const adminHash = await bcrypt.hash(TEST_ADMIN.password, 10);
		const testUsers = {
			users: [{
				id: 1,
				username: TEST_ADMIN.username,
				password: adminHash,
				role: 'admin',
				createdAt: new Date().toISOString()
			}]
		};

		fs.writeFileSync(usersFilePath, JSON.stringify(testUsers, null, 2));
		fs.writeFileSync(authDataFilePath, JSON.stringify({
			failedAttempts: {},
			lockedAccounts: {}
		}));

		// Create test activity log with sample data
		const testActivityLog = {
			logs: [
				{
					id: 'test_1',
					timestamp: new Date().toISOString(),
					userId: 1,
					username: 'admin',
					action: 'admin_login',
					category: 'admin',
					details: { ip: '127.0.0.1' }
				},
				{
					id: 'test_2',
					timestamp: new Date().toISOString(),
					userId: 0,
					username: 'System',
					action: 'participant_signup',
					category: 'participant',
					details: { playerName: 'TestPlayer', tournamentName: 'Test Tournament' }
				},
				{
					id: 'test_3',
					timestamp: new Date().toISOString(),
					userId: 1,
					username: 'admin',
					action: 'match_start',
					category: 'match',
					details: { tournamentId: 'test123', matchId: '456' }
				}
			]
		};
		fs.writeFileSync(activityLogFilePath, JSON.stringify(testActivityLog, null, 2));

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
		if (originalActivityLog) {
			fs.writeFileSync(activityLogFilePath, originalActivityLog);
		}
	});

	describe('GET /api/activity', () => {
		test('returns paginated activity for authenticated user', async () => {
			const res = await agent.get('/api/activity');

			expect(res.status).toBe(200);
			expect(res.body.success).toBe(true);
			expect(res.body).toHaveProperty('activity');
			expect(res.body).toHaveProperty('pagination');
			expect(Array.isArray(res.body.activity)).toBe(true);
			expect(res.body.pagination).toHaveProperty('total');
			expect(res.body.pagination).toHaveProperty('limit');
			expect(res.body.pagination).toHaveProperty('offset');
			expect(res.body.pagination).toHaveProperty('hasMore');
		});

		test('respects limit parameter', async () => {
			const res = await agent.get('/api/activity?limit=2');

			expect(res.status).toBe(200);
			expect(res.body.activity.length).toBeLessThanOrEqual(2);
			expect(res.body.pagination.limit).toBe(2);
		});

		test('respects offset parameter', async () => {
			const res = await agent.get('/api/activity?offset=1');

			expect(res.status).toBe(200);
			expect(res.body.pagination.offset).toBe(1);
		});

		test('filters by category', async () => {
			const res = await agent.get('/api/activity?category=admin');

			expect(res.status).toBe(200);
			expect(res.body.success).toBe(true);
			// All returned activities should be in admin category
			res.body.activity.forEach(activity => {
				expect(activity.category).toBe('admin');
			});
		});

		test('filters by search term', async () => {
			const res = await agent.get('/api/activity?search=TestPlayer');

			expect(res.status).toBe(200);
			expect(res.body.success).toBe(true);
			// At least one activity should match the search
			if (res.body.activity.length > 0) {
				const hasMatch = res.body.activity.some(a =>
					JSON.stringify(a).toLowerCase().includes('testplayer')
				);
				expect(hasMatch).toBe(true);
			}
		});

		test('returns 401 for unauthenticated request', async () => {
			const res = await request(app).get('/api/activity');

			expect(res.status).toBe(401);
		});

		test('includes activity metadata fields', async () => {
			const res = await agent.get('/api/activity');

			expect(res.status).toBe(200);
			if (res.body.activity.length > 0) {
				const activity = res.body.activity[0];
				expect(activity).toHaveProperty('id');
				expect(activity).toHaveProperty('timestamp');
				expect(activity).toHaveProperty('action');
				expect(activity).toHaveProperty('category');
			}
		});
	});

	describe('POST /api/activity/external', () => {
		test('rejects request without token', async () => {
			const res = await request(app)
				.post('/api/activity/external')
				.send({
					action: 'participant_signup',
					source: 'test',
					details: { playerName: 'Test' }
				});

			expect(res.status).toBe(401);
			expect(res.body.success).toBe(false);
			expect(res.body.error).toContain('token');
		});

		test('rejects request with invalid token', async () => {
			const res = await request(app)
				.post('/api/activity/external')
				.set('X-Activity-Token', INVALID_ACTIVITY_TOKEN)
				.send({
					action: 'participant_signup',
					source: 'test',
					details: { playerName: 'Test' }
				});

			expect(res.status).toBe(401);
			expect(res.body.success).toBe(false);
		});

		test('accepts request with valid token', async () => {
			const res = await request(app)
				.post('/api/activity/external')
				.set('X-Activity-Token', VALID_ACTIVITY_TOKEN)
				.send({
					action: 'participant_signup',
					source: 'signup-pwa',
					details: {
						playerName: 'WebhookTestPlayer',
						tournamentName: 'Webhook Tournament'
					}
				});

			expect(res.status).toBe(200);
			expect(res.body.success).toBe(true);
		});

		test('rejects request without action field', async () => {
			const res = await request(app)
				.post('/api/activity/external')
				.set('X-Activity-Token', VALID_ACTIVITY_TOKEN)
				.send({
					source: 'test',
					details: {}
				});

			expect(res.status).toBe(400);
			expect(res.body.success).toBe(false);
		});

		test('uses default source if not provided', async () => {
			const res = await request(app)
				.post('/api/activity/external')
				.set('X-Activity-Token', VALID_ACTIVITY_TOKEN)
				.send({
					action: 'participant_signup',
					details: { playerName: 'NoSourcePlayer' }
				});

			// Should succeed with default source 'External'
			expect(res.status).toBe(200);
			expect(res.body.success).toBe(true);
		});
	});
});
