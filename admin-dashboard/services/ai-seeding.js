/**
 * AI Seeding Service
 *
 * Generates intelligent tournament seeding suggestions using Claude AI.
 * Analyzes player ELO, win rates, recent placements, and historical matchups
 * to optimize bracket structure.
 */

const crypto = require('crypto');
const secrets = require('../config/secrets');
const {
	withRetry,
	circuitBreakers,
	ExternalServiceError,
	RateLimitError
} = require('./error-handler');
const { createLogger } = require('./debug-logger');

const logger = createLogger('ai-seeding');

// Dependencies (set by init)
let io = null;
let analyticsDb = null;
let tournamentApi = null;  // API interface for tournament/participant data
let activityLogger = null;

// Anthropic client (lazy loaded)
let anthropicClient = null;

// Debounce timers for recalculation
const recalcTimers = new Map();
const RECALC_DEBOUNCE_MS = 3000;

// Rate limiting for Claude API
const apiRateLimit = {
	requests: 0,
	lastReset: Date.now(),
	maxPerMinute: 10
};

// Status messages for progress indicator
const STATUS_MESSAGES = [
	'Analyzing player data...',
	'Checking recent matchups...',
	'Optimizing bracket balance...',
	'Generating recommendations...'
];

/**
 * Initialize the AI seeding service
 * @param {Object} deps - Dependencies
 * @param {Server} deps.io - Socket.IO server instance
 * @param {Object} deps.analyticsDb - Analytics database module
 * @param {Object} deps.tournamentApi - Tournament API interface (getTournament, getParticipants)
 * @param {Object} deps.activityLogger - Activity logger module
 */
function init(deps) {
	io = deps.io;
	analyticsDb = deps.analyticsDb;
	tournamentApi = deps.tournamentApi;
	activityLogger = deps.activityLogger;
	console.log('[AI Seeding] Service initialized');
}

/**
 * Get or create Anthropic client
 * @returns {Anthropic|null} Client or null if API key not configured
 */
function getAnthropicClient() {
	if (anthropicClient) return anthropicClient;

	const apiKey = secrets.getAnthropicApiKey();
	if (!apiKey) {
		return null;
	}

	try {
		const Anthropic = require('@anthropic-ai/sdk');
		anthropicClient = new Anthropic({ apiKey });
		return anthropicClient;
	} catch (error) {
		console.error('[AI Seeding] Failed to initialize Anthropic client:', error.message);
		return null;
	}
}

/**
 * Reset the cached Anthropic client
 * Called when API key is updated via platform admin
 */
function resetClient() {
	anthropicClient = null;
	console.log('[AI Seeding] Client cache cleared');
}

/**
 * Check if AI seeding is available
 * @returns {Object} { available, reason }
 */
function isAvailable() {
	const apiKey = secrets.getAnthropicApiKey();
	if (!apiKey) {
		return { available: false, reason: 'Claude API key not configured' };
	}
	return { available: true, reason: null };
}

/**
 * Check rate limit for Claude API
 * @returns {boolean} True if request is allowed
 */
function checkRateLimit() {
	const now = Date.now();
	// Reset counter every minute
	if (now - apiRateLimit.lastReset > 60000) {
		apiRateLimit.requests = 0;
		apiRateLimit.lastReset = now;
	}

	if (apiRateLimit.requests >= apiRateLimit.maxPerMinute) {
		return false;
	}

	apiRateLimit.requests++;
	return true;
}

/**
 * Generate MD5 hash of participant IDs for cache validation
 * @param {Array} participants - Array of participant objects
 * @returns {string} MD5 hash
 */
function generateParticipantHash(participants) {
	const ids = participants.map(p => p.id).sort().join(',');
	return crypto.createHash('md5').update(ids).digest('hex');
}

/**
 * Gather comprehensive player data for AI seeding
 * @param {string} tournamentId - Tournament ID
 * @param {Array} participants - Challonge participants
 * @param {number|null} gameId - Game ID for historical data
 * @returns {Array} Array of player data objects
 */
async function gatherPlayerData(tournamentId, participants, gameId) {
	const playerData = [];
	const playerIds = [];

	for (const participant of participants) {
		const name = participant.name || participant.display_name;
		const playerMatch = analyticsDb.findPlayerByName(name);

		let data = {
			participantId: participant.id,
			name: name,
			currentSeed: participant.seed,
			playerId: null,
			matchType: 'none',
			elo: analyticsDb.ELO_INITIAL_RATING,
			peakElo: analyticsDb.ELO_INITIAL_RATING,
			matchesPlayed: 0,
			wins: 0,
			losses: 0,
			winRate: 0,
			tournamentsAttended: 0,
			isNewPlayer: true,
			recentPlacements: [],
			recentMatchups: []
		};

		if (playerMatch && gameId) {
			data.playerId = playerMatch.player.id;
			data.matchType = playerMatch.matchType;
			playerIds.push(playerMatch.player.id);

			// Get comprehensive player data
			const seedingData = analyticsDb.getPlayerSeedingData(playerMatch.player.id, gameId);
			if (seedingData) {
				data.elo = seedingData.elo;
				data.peakElo = seedingData.peakElo;
				data.matchesPlayed = seedingData.matchesPlayed;
				data.wins = seedingData.wins;
				data.losses = seedingData.losses;
				data.winRate = seedingData.winRate;
				data.tournamentsAttended = seedingData.tournamentsAttended;
				data.isNewPlayer = seedingData.isNewPlayer;
				data.recentPlacements = seedingData.recentPlacements;
			}
		}

		playerData.push(data);
	}

	// Get recent matchups between these players
	if (playerIds.length > 1 && gameId) {
		const matchups = analyticsDb.getPlayerRecentMatchups(playerIds, gameId, 2);

		// Map matchups to player names for clarity
		const playerIdToName = {};
		for (const p of playerData) {
			if (p.playerId) {
				playerIdToName[p.playerId] = p.name;
			}
		}

		for (const matchup of matchups) {
			const p1Name = playerIdToName[matchup.player1Id];
			const p2Name = playerIdToName[matchup.player2Id];

			if (p1Name && p2Name) {
				// Add matchup to both players' data
				for (const p of playerData) {
					if (p.playerId === matchup.player1Id || p.playerId === matchup.player2Id) {
						p.recentMatchups.push({
							opponent: p.playerId === matchup.player1Id ? p2Name : p1Name,
							tournament: matchup.tournamentName,
							round: matchup.round
						});
					}
				}
			}
		}
	}

	return playerData;
}

/**
 * Build the Claude prompt for seeding analysis
 * @param {Object} tournament - Tournament info
 * @param {Array} playerData - Comprehensive player data
 * @param {Array} lockedSeeds - Locked seed positions
 * @returns {string} Formatted prompt
 */
function buildSeedingPrompt(tournament, playerData, lockedSeeds = []) {
	const lockedParticipantIds = new Set(lockedSeeds.map(s => s.participantId));

	// Separate locked and unlocked players
	const lockedPlayers = playerData.filter(p => lockedParticipantIds.has(p.participantId));
	const unlockedPlayers = playerData.filter(p => !lockedParticipantIds.has(p.participantId));

	// Format player data for the prompt
	const formatPlayer = (p) => ({
		participantId: p.participantId,
		name: p.name,
		elo: p.elo,
		peakElo: p.peakElo,
		matchesPlayed: p.matchesPlayed,
		wins: p.wins,
		losses: p.losses,
		winRate: p.winRate,
		tournamentsAttended: p.tournamentsAttended,
		isNewPlayer: p.isNewPlayer,
		recentPlacements: p.recentPlacements.slice(0, 3),
		recentMatchups: p.recentMatchups.slice(0, 5)
	});

	const prompt = `You are a tournament seeding expert. Analyze the player data below and generate optimal seeding for a ${tournament.tournamentType || 'single elimination'} bracket.

## Tournament Information
- Name: ${tournament.name}
- Game: ${tournament.gameName || 'Unknown'}
- Format: ${tournament.tournamentType || 'single elimination'}
- Total Participants: ${playerData.length}

## Seeding Principles (MUST Follow)
1. **Top Seeds Separation**: Seeds 1-4 should not meet until quarterfinals or later. Seeds 1 & 2 should only meet in finals.
2. **Bracket Balance**: Balance bracket halves by total ELO sum (aim for <5% difference).
3. **New Player Protection**: Players with < 3 tournaments (isNewPlayer: true) should face mid-tier opponents in round 1, not top seeds.
4. **Repeat Matchup Avoidance**: Avoid early-round matchups between players who faced each other in recent tournaments (see recentMatchups).
5. **Standard Seeding Pattern**: Follow snake seeding pattern (1 vs 16, 8 vs 9, 4 vs 13, 5 vs 12, etc. for 16-player bracket).

## Locked Seeds (DO NOT CHANGE)
${lockedSeeds.length > 0
		? lockedSeeds.map(s => `- Seed ${s.seed}: ${s.name} (participantId: ${s.participantId})`).join('\n')
		: 'None - all positions can be optimized.'}

## Player Data to Seed
${JSON.stringify(unlockedPlayers.map(formatPlayer), null, 2)}

${lockedPlayers.length > 0 ? `\n## Locked Players (for reference only)\n${JSON.stringify(lockedPlayers.map(formatPlayer), null, 2)}` : ''}

## Response Format
Return ONLY valid JSON with this exact structure:
{
  "seeds": [
    {"seed": 1, "participantId": "xxx", "reasoning": "Brief reason for this seed position"}
  ],
  "bracketBalance": {
    "topHalfElo": 12500,
    "bottomHalfElo": 12350,
    "balancePercent": 1.2
  },
  "newPlayerPlacements": ["Description of how new players were protected"],
  "avoidedMatchups": ["Description of repeat matchups that were avoided"],
  "overallReasoning": "1-2 sentence summary of the seeding strategy"
}

IMPORTANT:
- Include ALL ${playerData.length} participants in the seeds array
- Include locked seeds in the output (keeping their exact positions)
- Seed numbers must be 1 to ${playerData.length} with no duplicates
- Return ONLY the JSON object, no other text`;

	return prompt;
}

/**
 * Call Claude API for seeding suggestions
 * Uses circuit breaker and retry logic for resilience
 * @param {string} prompt - The formatted prompt
 * @returns {Object|null} Parsed AI response or null on failure
 */
async function callClaudeForSeeding(prompt) {
	const client = getAnthropicClient();
	if (!client) {
		logger.error('callClaudeForSeeding', new Error('Anthropic client not available'));
		return null;
	}

	if (!checkRateLimit()) {
		logger.warn('callClaudeForSeeding', 'Rate limit exceeded, waiting...');
		await new Promise(resolve => setTimeout(resolve, 5000));
	}

	try {
		logger.log('callClaudeForSeeding', 'Calling Claude API...');
		const startTime = Date.now();

		// Execute through circuit breaker with retry logic
		const response = await circuitBreakers.anthropic.execute(async () => {
			return withRetry(async () => {
				const result = await client.messages.create({
					model: 'claude-sonnet-4-20250514',
					max_tokens: 4096,
					messages: [
						{
							role: 'user',
							content: prompt
						}
					]
				});
				return result;
			}, {
				maxRetries: 2,
				initialDelayMs: 2000,
				backoffMultiplier: 2,
				maxDelayMs: 10000
			});
		});

		const duration = Date.now() - startTime;
		logger.log('callClaudeForSeeding', `Claude API responded in ${duration}ms`);

		// Extract text content
		const textContent = response.content.find(c => c.type === 'text');
		if (!textContent) {
			logger.error('callClaudeForSeeding', new Error('No text content in response'));
			return null;
		}

		// Parse JSON from response
		const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
		if (!jsonMatch) {
			logger.error('callClaudeForSeeding', new Error('No JSON found in response'));
			return null;
		}

		const parsed = JSON.parse(jsonMatch[0]);
		return parsed;

	} catch (error) {
		// Log the error with structured logging
		logger.error('callClaudeForSeeding', error, {
			errorType: error.code || error.name,
			service: 'Anthropic'
		});

		// Return null to trigger fallback seeding
		return null;
	}
}

/**
 * Generate fallback seeding (pure ELO-based)
 * @param {Array} playerData - Player data array
 * @param {Array} lockedSeeds - Locked seed positions
 * @returns {Object} Seeding suggestions in standard format
 */
function generateFallbackSeeding(playerData, lockedSeeds = []) {
	const lockedParticipantIds = new Set(lockedSeeds.map(s => s.participantId));
	const lockedSeedNumbers = new Set(lockedSeeds.map(s => s.seed));

	// Sort unlocked players by ELO (highest first), then by new player status
	const unlockedPlayers = playerData
		.filter(p => !lockedParticipantIds.has(p.participantId))
		.sort((a, b) => {
			// Known players before new players
			if (a.isNewPlayer !== b.isNewPlayer) {
				return a.isNewPlayer ? 1 : -1;
			}
			// Higher ELO first
			return b.elo - a.elo;
		});

	// Find available seed positions
	const availableSeeds = [];
	for (let i = 1; i <= playerData.length; i++) {
		if (!lockedSeedNumbers.has(i)) {
			availableSeeds.push(i);
		}
	}

	// Assign seeds
	const seeds = [];

	// Add locked seeds first
	for (const locked of lockedSeeds) {
		const player = playerData.find(p => p.participantId === locked.participantId);
		seeds.push({
			seed: locked.seed,
			participantId: locked.participantId,
			reasoning: `Locked by organizer`
		});
	}

	// Assign remaining players to available seeds
	unlockedPlayers.forEach((player, index) => {
		if (index < availableSeeds.length) {
			const reason = player.isNewPlayer
				? 'New player - ranked by default ELO'
				: `ELO: ${player.elo}, Win rate: ${player.winRate}%`;

			seeds.push({
				seed: availableSeeds[index],
				participantId: player.participantId,
				reasoning: reason
			});
		}
	});

	// Sort by seed number
	seeds.sort((a, b) => a.seed - b.seed);

	// Calculate bracket balance
	const midpoint = Math.ceil(playerData.length / 2);
	const topHalf = seeds.filter(s => s.seed <= midpoint);
	const bottomHalf = seeds.filter(s => s.seed > midpoint);

	const getElo = (participantId) => {
		const p = playerData.find(pd => pd.participantId === participantId);
		return p ? p.elo : 1200;
	};

	const topHalfElo = topHalf.reduce((sum, s) => sum + getElo(s.participantId), 0);
	const bottomHalfElo = bottomHalf.reduce((sum, s) => sum + getElo(s.participantId), 0);
	const totalElo = topHalfElo + bottomHalfElo;
	const balancePercent = totalElo > 0
		? Math.abs((topHalfElo - bottomHalfElo) / totalElo * 100)
		: 0;

	// Identify new players
	const newPlayers = playerData.filter(p => p.isNewPlayer);
	const newPlayerPlacements = newPlayers.map(p => {
		const seedInfo = seeds.find(s => s.participantId === p.participantId);
		return `${p.name} (seed ${seedInfo?.seed || '?'}) - new player placed by ELO`;
	});

	return {
		seeds,
		bracketBalance: {
			topHalfElo: Math.round(topHalfElo),
			bottomHalfElo: Math.round(bottomHalfElo),
			balancePercent: Math.round(balancePercent * 10) / 10
		},
		newPlayerPlacements,
		avoidedMatchups: [],
		overallReasoning: 'Fallback seeding - sorted by ELO rating with new players at end of bracket.'
	};
}

/**
 * Generate AI-powered seeding suggestions
 * @param {string} tournamentId - Tournament ID
 * @param {boolean} forceRegenerate - Force new generation even if cached
 * @returns {Object} Seeding suggestions response
 */
async function generateSeedingSuggestions(tournamentId, forceRegenerate = false) {
	const availability = isAvailable();

	try {
		// Broadcast generating status
		broadcastSeedingStatus(tournamentId, 'generating', STATUS_MESSAGES[0]);

		// Fetch tournament info using tournament API interface
		const tournamentData = await tournamentApi.getTournament(tournamentId);
		if (!tournamentData) {
			return { success: false, error: 'Tournament not found' };
		}
		const tournament = {
			id: tournamentData.id,
			url: tournamentData.url_slug || tournamentData.attributes?.url || tournamentId,
			name: tournamentData.name || tournamentData.attributes?.name || 'Unknown',
			gameName: tournamentData.game_name || tournamentData.attributes?.game_name || null,
			tournamentType: tournamentData.tournament_type || tournamentData.attributes?.tournament_type || 'single elimination',
			participantCount: tournamentData.participants_count || tournamentData.attributes?.participants_count || 0
		};

		// Fetch participants
		broadcastSeedingStatus(tournamentId, 'generating', STATUS_MESSAGES[0]);
		const participantsData = await tournamentApi.getParticipants(tournamentId);
		const participants = (participantsData || []).map(p => ({
			id: parseInt(p.id),
			name: p.name || p.attributes?.name,
			display_name: p.display_name || p.attributes?.display_name,
			seed: p.seed || p.attributes?.seed
		}));

		if (participants.length === 0) {
			return {
				success: false,
				error: 'No participants found in tournament'
			};
		}

		// Generate participant hash for cache validation
		const participantHash = generateParticipantHash(participants);

		// Check cache unless forced regenerate
		if (!forceRegenerate) {
			const cached = analyticsDb.getSeedingCache(tournamentId);
			if (cached && cached.participantHash === participantHash) {
				console.log(`[AI Seeding] Returning cached suggestions for ${tournamentId}`);
				return {
					success: true,
					source: cached.source,
					cached: true,
					cachedAt: cached.updatedAt,
					tournament,
					...cached.suggestions,
					lockedSeeds: cached.lockedSeeds,
					generationCount: cached.generationCount,
					timestamp: new Date().toISOString()
				};
			}
		}

		// Get game info
		const game = tournament.gameName ? analyticsDb.getOrCreateGame(tournament.gameName) : null;
		const gameId = game?.id || null;

		// Get locked seeds from cache (preserve during regeneration)
		const cachedData = analyticsDb.getSeedingCache(tournamentId);
		const lockedSeeds = cachedData?.lockedSeeds || [];

		// Gather comprehensive player data
		broadcastSeedingStatus(tournamentId, 'generating', STATUS_MESSAGES[1]);
		const playerData = await gatherPlayerData(tournamentId, participants, gameId);

		let suggestions;
		let source = 'ai';

		if (availability.available) {
			// Build prompt and call Claude
			broadcastSeedingStatus(tournamentId, 'generating', STATUS_MESSAGES[2]);
			const prompt = buildSeedingPrompt(tournament, playerData, lockedSeeds);

			broadcastSeedingStatus(tournamentId, 'generating', STATUS_MESSAGES[3]);
			const aiResponse = await callClaudeForSeeding(prompt);

			if (aiResponse && aiResponse.seeds && Array.isArray(aiResponse.seeds)) {
				suggestions = aiResponse;
				console.log(`[AI Seeding] AI generated ${suggestions.seeds.length} seeds`);
			} else {
				// Fall back to ELO-based seeding
				console.warn('[AI Seeding] AI response invalid, falling back to ELO');
				suggestions = generateFallbackSeeding(playerData, lockedSeeds);
				source = 'fallback';
			}
		} else {
			// AI not available, use fallback
			console.log(`[AI Seeding] AI not available: ${availability.reason}`);
			suggestions = generateFallbackSeeding(playerData, lockedSeeds);
			source = 'fallback';
		}

		// Enrich seeds with player names
		suggestions.seeds = suggestions.seeds.map(s => {
			const player = playerData.find(p => p.participantId === s.participantId);
			return {
				...s,
				name: player?.name || 'Unknown',
				elo: player?.elo,
				isNewPlayer: player?.isNewPlayer,
				matchType: player?.matchType
			};
		});

		// Save to cache
		analyticsDb.saveSeedingCache(
			tournamentId,
			tournament.url,
			gameId,
			suggestions,
			participantHash,
			source
		);

		// Log activity
		if (activityLogger && activityLogger.log) {
			activityLogger.log('system', 'System', 'ai_seeding_generated', {
				tournamentId,
				tournamentName: tournament.name,
				source,
				participantCount: participants.length
			});
		}

		// Broadcast completion
		const result = {
			success: true,
			source,
			cached: false,
			cachedAt: null,
			tournament,
			...suggestions,
			lockedSeeds,
			generationCount: (cachedData?.generationCount || 0) + 1,
			timestamp: new Date().toISOString()
		};

		broadcastSeedingUpdate(tournamentId, result);

		return result;

	} catch (error) {
		console.error('[AI Seeding] Error generating suggestions:', error);
		broadcastSeedingError(tournamentId, error.message);
		return {
			success: false,
			error: error.message
		};
	}
}

/**
 * Schedule a debounced recalculation
 * Called when participants change
 * @param {string} tournamentId - Tournament ID
 */
function scheduleRecalculation(tournamentId) {
	// Clear existing timer
	if (recalcTimers.has(tournamentId)) {
		clearTimeout(recalcTimers.get(tournamentId));
	}

	console.log(`[AI Seeding] Scheduling recalculation for ${tournamentId} in ${RECALC_DEBOUNCE_MS}ms`);

	// Invalidate cache immediately
	analyticsDb.invalidateSeedingCache(tournamentId);

	// Schedule new calculation
	const timer = setTimeout(async () => {
		recalcTimers.delete(tournamentId);
		console.log(`[AI Seeding] Running scheduled recalculation for ${tournamentId}`);
		await generateSeedingSuggestions(tournamentId, true);
	}, RECALC_DEBOUNCE_MS);

	recalcTimers.set(tournamentId, timer);
}

/**
 * Update locked seeds for a tournament
 * @param {string} tournamentId - Tournament ID
 * @param {Array} lockedSeeds - Array of {participantId, seed, name}
 */
function updateLockedSeeds(tournamentId, lockedSeeds) {
	analyticsDb.updateLockedSeeds(tournamentId, lockedSeeds);

	// Log activity
	if (activityLogger && activityLogger.log) {
		activityLogger.log('system', 'System', 'ai_seeding_locked', {
			tournamentId,
			lockedCount: lockedSeeds.length
		});
	}
}

/**
 * Get current locked seeds for a tournament
 * @param {string} tournamentId - Tournament ID
 * @returns {Array} Locked seeds array
 */
function getLockedSeeds(tournamentId) {
	const cached = analyticsDb.getSeedingCache(tournamentId);
	return cached?.lockedSeeds || [];
}

// ============================================
// WEBSOCKET BROADCASTING
// ============================================

/**
 * Broadcast seeding update to connected clients
 * @param {string} tournamentId - Tournament ID
 * @param {Object} suggestions - Seeding suggestions
 */
function broadcastSeedingUpdate(tournamentId, suggestions) {
	if (io) {
		io.emit('seeding:update', {
			tournamentId,
			suggestions,
			timestamp: new Date().toISOString()
		});
		console.log(`[AI Seeding] Broadcast seeding:update for ${tournamentId}`);
	}
}

/**
 * Broadcast seeding status (generating)
 * @param {string} tournamentId - Tournament ID
 * @param {string} status - Status ('generating', 'complete', 'error')
 * @param {string} message - Status message
 */
function broadcastSeedingStatus(tournamentId, status, message = '') {
	if (io) {
		io.emit('seeding:generating', {
			tournamentId,
			status,
			message,
			timestamp: new Date().toISOString()
		});
	}
}

/**
 * Broadcast seeding error
 * @param {string} tournamentId - Tournament ID
 * @param {string} error - Error message
 */
function broadcastSeedingError(tournamentId, error) {
	if (io) {
		io.emit('seeding:error', {
			tournamentId,
			error,
			timestamp: new Date().toISOString()
		});
		console.log(`[AI Seeding] Broadcast seeding:error for ${tournamentId}: ${error}`);
	}
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
	init,
	isAvailable,
	resetClient,
	generateSeedingSuggestions,
	generateFallbackSeeding,
	scheduleRecalculation,
	updateLockedSeeds,
	getLockedSeeds,
	generateParticipantHash,
	gatherPlayerData,
	buildSeedingPrompt,

	// WebSocket broadcasting
	broadcastSeedingUpdate,
	broadcastSeedingStatus,
	broadcastSeedingError
};
