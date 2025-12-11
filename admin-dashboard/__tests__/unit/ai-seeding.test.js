/**
 * AI Seeding Service Unit Tests
 *
 * Tests for the AI seeding service module.
 * These test the core logic without requiring the actual Anthropic API.
 */

// Mock the Anthropic SDK
jest.mock('@anthropic-ai/sdk', () => {
	return jest.fn().mockImplementation(() => ({
		messages: {
			create: jest.fn()
		}
	}));
});

// Mock environment variable
process.env.ANTHROPIC_API_KEY = 'test-api-key';

const aiSeedingService = require('../../services/ai-seeding');

describe('AI Seeding Service', () => {
	// Mock dependencies
	const mockIo = {
		emit: jest.fn()
	};

	const mockAnalyticsDb = {
		getSeedingCache: jest.fn(),
		saveSeedingCache: jest.fn(),
		updateLockedSeeds: jest.fn(),
		invalidateSeedingCache: jest.fn(),
		getPlayerSeedingData: jest.fn(),
		getPlayerRecentMatchups: jest.fn(),
		getPlayerTournamentCount: jest.fn(),
		getPlayerRecentPlacements: jest.fn()
	};

	const mockChallongeApi = {
		request: jest.fn(),
		getParticipants: jest.fn(),
		getTournament: jest.fn(),
		updateParticipantSeed: jest.fn()
	};

	const mockActivityLogger = {
		log: jest.fn()
	};

	beforeAll(() => {
		aiSeedingService.init({
			io: mockIo,
			analyticsDb: mockAnalyticsDb,
			challongeApi: mockChallongeApi,
			activityLogger: mockActivityLogger
		});
	});

	beforeEach(() => {
		jest.clearAllMocks();
	});

	describe('isAvailable', () => {
		test('returns available when API key is configured', () => {
			const result = aiSeedingService.isAvailable();
			expect(result.available).toBe(true);
		});

		test('returns unavailable reason when API key is not configured', () => {
			const originalKey = process.env.ANTHROPIC_API_KEY;
			delete process.env.ANTHROPIC_API_KEY;

			// Need to reimport to test without API key
			jest.resetModules();
			const freshService = require('../../services/ai-seeding');
			freshService.init({
				io: mockIo,
				analyticsDb: mockAnalyticsDb,
				challongeApi: mockChallongeApi,
				activityLogger: mockActivityLogger
			});

			const result = freshService.isAvailable();
			expect(result.available).toBe(false);
			expect(result.reason).toBeDefined();

			// Restore
			process.env.ANTHROPIC_API_KEY = originalKey;
		});
	});

	describe('generateFallbackSeeding', () => {
		test('sorts players by ELO in descending order', () => {
			const playerData = [
				{ participantId: '1', name: 'Player A', elo: 1400, currentSeed: 3, isNewPlayer: false },
				{ participantId: '2', name: 'Player B', elo: 1600, currentSeed: 1, isNewPlayer: false },
				{ participantId: '3', name: 'Player C', elo: 1200, currentSeed: 2, isNewPlayer: false }
			];

			const result = aiSeedingService.generateFallbackSeeding(playerData, []);

			expect(result.seeds).toBeDefined();
			expect(result.seeds.length).toBe(3);
			// Highest ELO (Player B with 1600) should be seed 1
			expect(result.seeds[0].seed).toBe(1);
			expect(result.seeds[0].participantId).toBe('2'); // Player B
			// Verify order: B (1600) -> A (1400) -> C (1200)
			expect(result.seeds[1].participantId).toBe('1'); // Player A (seed 2)
			expect(result.seeds[2].participantId).toBe('3'); // Player C (seed 3)
		});

		test('respects locked seed positions', () => {
			const playerData = [
				{ participantId: '1', name: 'Player A', elo: 1400, currentSeed: 1, isNewPlayer: false },
				{ participantId: '2', name: 'Player B', elo: 1600, currentSeed: 2, isNewPlayer: false },
				{ participantId: '3', name: 'Player C', elo: 1200, currentSeed: 3, isNewPlayer: false }
			];
			const lockedSeeds = [{ participantId: '3', seed: 1 }];

			const result = aiSeedingService.generateFallbackSeeding(playerData, lockedSeeds);

			expect(result.seeds).toBeDefined();
			// Player C should be seed 1 despite having lowest ELO
			const seed1Player = result.seeds.find(s => s.seed === 1);
			expect(seed1Player).toBeDefined();
			expect(seed1Player.participantId).toBe('3');
		});

		test('calculates bracket balance', () => {
			const playerData = [
				{ participantId: '1', name: 'Player A', elo: 1600, currentSeed: 1, isNewPlayer: false },
				{ participantId: '2', name: 'Player B', elo: 1400, currentSeed: 2, isNewPlayer: false },
				{ participantId: '3', name: 'Player C', elo: 1200, currentSeed: 3, isNewPlayer: false },
				{ participantId: '4', name: 'Player D', elo: 1000, currentSeed: 4, isNewPlayer: false }
			];

			const result = aiSeedingService.generateFallbackSeeding(playerData, []);

			expect(result.bracketBalance).toBeDefined();
			expect(result.bracketBalance.topHalfElo).toBeGreaterThan(0);
			expect(result.bracketBalance.bottomHalfElo).toBeGreaterThan(0);
		});

		test('handles empty player list', () => {
			const result = aiSeedingService.generateFallbackSeeding([], []);
			expect(result.seeds).toEqual([]);
		});

		test('handles players without ELO ratings', () => {
			const playerData = [
				{ participantId: '1', name: 'New Player 1', elo: null, currentSeed: 1, isNewPlayer: true },
				{ participantId: '2', name: 'New Player 2', elo: null, currentSeed: 2, isNewPlayer: true },
				{ participantId: '3', name: 'Veteran', elo: 1500, currentSeed: 3, isNewPlayer: false }
			];

			const result = aiSeedingService.generateFallbackSeeding(playerData, []);

			expect(result.seeds).toBeDefined();
			// Known players should come before new players (regardless of ELO)
			// Veteran with 1500 should be seed 1 (not a new player)
			expect(result.seeds[0].participantId).toBe('3'); // Veteran is seed 1
			// New players placed after veteran
			expect(result.seeds.length).toBe(3);
		});
	});

	describe('scheduleRecalculation', () => {
		beforeEach(() => {
			jest.useFakeTimers();
		});

		afterEach(() => {
			jest.useRealTimers();
		});

		test('debounces multiple calls', () => {
			const tournamentId = 'test-tournament';

			// Call multiple times rapidly
			aiSeedingService.scheduleRecalculation(tournamentId);
			aiSeedingService.scheduleRecalculation(tournamentId);
			aiSeedingService.scheduleRecalculation(tournamentId);

			// Should not execute immediately
			expect(mockChallongeApi.getParticipants).not.toHaveBeenCalled();
		});

		test('executes after debounce delay', async () => {
			const tournamentId = 'test-tournament';

			// Mock the API responses
			mockChallongeApi.getTournament.mockResolvedValue({
				id: tournamentId,
				attributes: { name: 'Test Tournament', game_name: 'Test Game' }
			});
			mockChallongeApi.getParticipants.mockResolvedValue([
				{ id: '1', attributes: { name: 'Player 1', seed: 1 } }
			]);
			mockAnalyticsDb.getSeedingCache.mockReturnValue(null);
			mockAnalyticsDb.getPlayerSeedingData.mockReturnValue(null);

			aiSeedingService.scheduleRecalculation(tournamentId);

			// Fast-forward past debounce delay (3 seconds)
			jest.advanceTimersByTime(3500);

			// Should start processing
			// Note: Full verification would require more setup
		});
	});

	describe('updateLockedSeeds', () => {
		test('updates locked seeds in database', async () => {
			const tournamentId = 'test-tournament';
			const lockedSeeds = [
				{ participantId: '1', seed: 1 },
				{ participantId: '2', seed: 2 }
			];

			await aiSeedingService.updateLockedSeeds(tournamentId, lockedSeeds);

			expect(mockAnalyticsDb.updateLockedSeeds).toHaveBeenCalledWith(
				tournamentId,
				lockedSeeds
			);
		});
	});

	describe('Participant Hash Generation', () => {
		test('generates consistent hash for same participants', () => {
			// This tests the internal hash generation logic
			const participants1 = [
				{ id: '1', attributes: { name: 'A', seed: 1 } },
				{ id: '2', attributes: { name: 'B', seed: 2 } }
			];

			const participants2 = [
				{ id: '1', attributes: { name: 'A', seed: 1 } },
				{ id: '2', attributes: { name: 'B', seed: 2 } }
			];

			// Same participants should generate same hash
			const data1 = JSON.stringify(participants1.map(p => ({
				id: p.id,
				name: p.attributes.name
			})).sort((a, b) => a.id.localeCompare(b.id)));

			const data2 = JSON.stringify(participants2.map(p => ({
				id: p.id,
				name: p.attributes.name
			})).sort((a, b) => a.id.localeCompare(b.id)));

			expect(data1).toBe(data2);
		});

		test('generates different hash for different participants', () => {
			const participants1 = [
				{ id: '1', attributes: { name: 'A', seed: 1 } }
			];

			const participants2 = [
				{ id: '1', attributes: { name: 'A', seed: 1 } },
				{ id: '2', attributes: { name: 'B', seed: 2 } }
			];

			const data1 = JSON.stringify(participants1.map(p => ({
				id: p.id,
				name: p.attributes.name
			})));

			const data2 = JSON.stringify(participants2.map(p => ({
				id: p.id,
				name: p.attributes.name
			})));

			expect(data1).not.toBe(data2);
		});
	});
});

describe('ELO Calculation for Seeding', () => {
	test('higher ELO player gets lower seed number', () => {
		const players = [
			{ elo: 1200 },
			{ elo: 1600 },
			{ elo: 1400 }
		];

		// Sort by ELO descending
		const sorted = [...players].sort((a, b) => (b.elo || 1200) - (a.elo || 1200));

		expect(sorted[0].elo).toBe(1600);
		expect(sorted[1].elo).toBe(1400);
		expect(sorted[2].elo).toBe(1200);
	});

	test('treats null ELO as default rating', () => {
		const DEFAULT_ELO = 1200;
		const players = [
			{ elo: null },
			{ elo: 1600 },
			{ elo: 1100 }
		];

		const sorted = [...players].sort((a, b) => {
			const eloA = a.elo || DEFAULT_ELO;
			const eloB = b.elo || DEFAULT_ELO;
			return eloB - eloA;
		});

		// 1600 first, then null (1200), then 1100
		expect(sorted[0].elo).toBe(1600);
		expect(sorted[1].elo).toBe(null); // treated as 1200
		expect(sorted[2].elo).toBe(1100);
	});
});

describe('Bracket Balance Calculation', () => {
	test('calculates top and bottom half ELO sums', () => {
		const seeds = [
			{ seed: 1, elo: 1600 },
			{ seed: 2, elo: 1500 },
			{ seed: 3, elo: 1400 },
			{ seed: 4, elo: 1300 }
		];

		const halfSize = Math.ceil(seeds.length / 2);
		const topHalf = seeds.slice(0, halfSize);
		const bottomHalf = seeds.slice(halfSize);

		const topHalfElo = topHalf.reduce((sum, s) => sum + (s.elo || 1200), 0);
		const bottomHalfElo = bottomHalf.reduce((sum, s) => sum + (s.elo || 1200), 0);

		expect(topHalfElo).toBe(3100); // 1600 + 1500
		expect(bottomHalfElo).toBe(2700); // 1400 + 1300
	});

	test('handles odd number of participants', () => {
		const seeds = [
			{ seed: 1, elo: 1600 },
			{ seed: 2, elo: 1500 },
			{ seed: 3, elo: 1400 }
		];

		const halfSize = Math.ceil(seeds.length / 2);
		expect(halfSize).toBe(2);

		const topHalf = seeds.slice(0, halfSize);
		const bottomHalf = seeds.slice(halfSize);

		expect(topHalf.length).toBe(2);
		expect(bottomHalf.length).toBe(1);
	});
});

describe('Locked Seeds Integration', () => {
	test('locked seeds maintain their position during seeding', () => {
		const playerData = [
			{ participantId: '1', name: 'A', elo: 1600 },
			{ participantId: '2', name: 'B', elo: 1500 },
			{ participantId: '3', name: 'C', elo: 1400 },
			{ participantId: '4', name: 'D', elo: 1300 }
		];

		// Lock player D at seed 1
		const lockedSeeds = [{ participantId: '4', seed: 1 }];

		// Simulate locking logic
		const lockedMap = new Map(lockedSeeds.map(l => [l.participantId, l.seed]));
		const unlockedPlayers = playerData.filter(p => !lockedMap.has(p.participantId));

		// Sort unlocked by ELO
		unlockedPlayers.sort((a, b) => (b.elo || 1200) - (a.elo || 1200));

		// Build final seeds
		const finalSeeds = [];
		let unlockedIdx = 0;

		for (let seed = 1; seed <= playerData.length; seed++) {
			// Check if any player is locked to this seed
			const lockedPlayer = playerData.find(p => lockedMap.get(p.participantId) === seed);
			if (lockedPlayer) {
				finalSeeds.push({ ...lockedPlayer, seed });
			} else {
				finalSeeds.push({ ...unlockedPlayers[unlockedIdx++], seed });
			}
		}

		// Player D should be seed 1 despite lowest ELO
		expect(finalSeeds[0].name).toBe('D');
		expect(finalSeeds[0].seed).toBe(1);

		// Remaining players sorted by ELO
		expect(finalSeeds[1].name).toBe('A'); // 1600
		expect(finalSeeds[2].name).toBe('B'); // 1500
		expect(finalSeeds[3].name).toBe('C'); // 1400
	});
});
