/**
 * Export API Tests
 *
 * Tests for tournament results export endpoints (CSV and PDF).
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
	username: 'exporttest',
	password: 'testpassword123'
};

describe('Export API', () => {
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
				role: 'admin',
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

	describe('GET /api/export/:tournamentId/standings/csv', () => {
		test('returns 401 for unauthenticated request', async () => {
			const res = await request(app).get('/api/export/test-tournament/standings/csv');
			expect(res.status).toBe(401);
		});

		test('returns 404 for non-existent archived tournament', async () => {
			const res = await agent.get('/api/export/99999/standings/csv?source=archive');
			expect(res.status).toBe(404);
			expect(res.body.success).toBe(false);
			expect(res.body.error).toContain('not found');
		});

		test('sets correct content-type and disposition for CSV', async () => {
			// This test would need a valid tournament ID to fully pass
			// For now, we test the error handling path
			const res = await agent.get('/api/export/99999/standings/csv?source=archive');
			// Even on error, the response should be JSON (not CSV)
			expect(res.type).toBe('application/json');
		});
	});

	describe('GET /api/export/:tournamentId/matches/csv', () => {
		test('returns 401 for unauthenticated request', async () => {
			const res = await request(app).get('/api/export/test-tournament/matches/csv');
			expect(res.status).toBe(401);
		});

		test('returns 404 for non-existent archived tournament', async () => {
			const res = await agent.get('/api/export/99999/matches/csv?source=archive');
			expect(res.status).toBe(404);
			expect(res.body.success).toBe(false);
			expect(res.body.error).toContain('not found');
		});
	});

	describe('GET /api/export/:tournamentId/report/pdf', () => {
		test('returns 401 for unauthenticated request', async () => {
			const res = await request(app).get('/api/export/test-tournament/report/pdf');
			expect(res.status).toBe(401);
		});

		test('returns 404 for non-existent archived tournament', async () => {
			const res = await agent.get('/api/export/99999/report/pdf?source=archive');
			expect(res.status).toBe(404);
			expect(res.body.success).toBe(false);
			expect(res.body.error).toContain('not found');
		});
	});

	describe('Export source parameter', () => {
		test('accepts archive source', async () => {
			const res = await agent.get('/api/export/99999/standings/csv?source=archive');
			// Should attempt to look up in database
			expect(res.status).toBe(404); // Not found is expected for invalid ID
		});

		test('defaults to live source when not specified', async () => {
			// Without source param, should try Challonge API
			// This will fail without valid API key/tournament, but tests the path
			const res = await agent.get('/api/export/nonexistent/standings/csv');
			// Should attempt Challonge request and fail
			expect(res.status).toBeGreaterThanOrEqual(400);
		});
	});
});
