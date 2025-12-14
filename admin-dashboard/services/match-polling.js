/**
 * Match Polling Service (tcc-custom)
 *
 * Local database match polling and push to MagicMirror displays.
 * Simplified from Challonge polling to direct database queries.
 *
 * Supports multi-tenant mode: polls for each user's active tournament
 * and broadcasts to user-specific WebSocket rooms.
 */

const path = require('path');
const fsSync = require('fs');
const axios = require('axios');
const crypto = require('crypto');
const { createLogger } = require('./debug-logger');

const logger = createLogger('match-polling');

// References set by init
let io = null;
let matchDb = null;
let tournamentDb = null;
let participantDb = null;
let wsConnections = null;
let broadcastMatchData = null;
let needsHttpFallback = null;
let activeTournamentService = null;
let systemDb = null;

// Match polling state
const matchPollingState = {
	intervalId: null,
	isPolling: false,
	lastPollTime: null,
	pollIntervalMs: 5000,  // 5 seconds - faster since no external API limits
	activeTournamentId: null,  // Legacy: single tournament mode
	multiTenantMode: false,    // New: poll per-user active tournaments
	userLastPoll: new Map()    // Track last poll time per user
};

// Match data cache for resilience
const MATCH_CACHE_FILE = path.join(__dirname, '..', 'cache', 'match-data-cache.json');
const matchDataCache = {
	data: null,
	timestamp: null,
	tournamentId: null,
	staleThresholdMs: 60000  // Data considered stale after 60 seconds
};

/**
 * Initialize the Match Polling service with dependencies
 * @param {Object} options - Configuration options
 */
function init({
	io: ioServer,
	matchDb: matchDbService,
	tournamentDb: tournamentDbService,
	participantDb: participantDbService,
	wsConnections: wsConnectionsRef,
	broadcastMatchData: broadcastFn,
	needsHttpFallback: fallbackFn,
	activeTournamentService: activeTournamentSvc,
	systemDb: systemDbModule,
	multiTenantMode = true
}) {
	io = ioServer;
	matchDb = matchDbService;
	tournamentDb = tournamentDbService;
	participantDb = participantDbService;
	wsConnections = wsConnectionsRef;
	broadcastMatchData = broadcastFn;
	needsHttpFallback = fallbackFn;
	activeTournamentService = activeTournamentSvc;
	systemDb = systemDbModule;
	matchPollingState.multiTenantMode = multiTenantMode;

	// Load cache on init
	loadMatchDataCache();
}

/**
 * Ensure cache directory exists
 */
function ensureCacheDirectory() {
	const cacheDir = path.join(__dirname, '..', 'cache');
	if (!fsSync.existsSync(cacheDir)) {
		fsSync.mkdirSync(cacheDir, { recursive: true });
	}
}

/**
 * Save match data to cache (both memory and file)
 * @param {string} tournamentId - Tournament ID
 * @param {Object} payload - Match payload data
 */
function saveMatchDataCache(tournamentId, payload) {
	const cacheEntry = {
		data: payload,
		timestamp: new Date().toISOString(),
		tournamentId: tournamentId
	};

	matchDataCache.data = payload;
	matchDataCache.timestamp = cacheEntry.timestamp;
	matchDataCache.tournamentId = tournamentId;

	// Persist to file for restart resilience
	try {
		ensureCacheDirectory();
		fsSync.writeFileSync(MATCH_CACHE_FILE, JSON.stringify(cacheEntry, null, 2));
		logger.log('cache:saved', { file: MATCH_CACHE_FILE, tournamentId });
	} catch (error) {
		logger.warn('cache:saveError', error.message, { tournamentId });
	}
}

/**
 * Load match data cache from file (on server startup)
 * @returns {boolean} True if cache was loaded
 */
function loadMatchDataCache() {
	try {
		if (fsSync.existsSync(MATCH_CACHE_FILE)) {
			const data = fsSync.readFileSync(MATCH_CACHE_FILE, 'utf8');
			const cacheEntry = JSON.parse(data);
			matchDataCache.data = cacheEntry.data;
			matchDataCache.timestamp = cacheEntry.timestamp;
			matchDataCache.tournamentId = cacheEntry.tournamentId;
			logger.log('cache:loaded', { timestamp: cacheEntry.timestamp, tournamentId: cacheEntry.tournamentId });
			return true;
		}
	} catch (error) {
		logger.warn('cache:loadError', error.message);
	}
	return false;
}

/**
 * Get cached match data with staleness info
 * @param {string} tournamentId - Tournament ID
 * @returns {Object|null} Cached data with metadata or null
 */
function getMatchDataCache(tournamentId) {
	if (!matchDataCache.data || matchDataCache.tournamentId !== tournamentId) {
		return null;
	}

	const now = Date.now();
	const cacheTime = new Date(matchDataCache.timestamp).getTime();
	const ageMs = now - cacheTime;
	const isStale = ageMs > matchDataCache.staleThresholdMs;

	return {
		...matchDataCache.data,
		cacheTimestamp: matchDataCache.timestamp,
		cacheAgeMs: ageMs,
		isStale: isStale
	};
}

/**
 * Check if match polling should be active
 * @returns {boolean} True if polling should be active
 */
function shouldPollMatches() {
	// Poll if we have an active tournament that is underway
	if (!matchPollingState.activeTournamentId) {
		return false;
	}

	try {
		const tournament = tournamentDb.getById(matchPollingState.activeTournamentId);
		return tournament && tournament.state === 'underway';
	} catch (error) {
		return false;
	}
}

/**
 * Get the current poll interval
 * @returns {number} Poll interval in milliseconds
 */
function getMatchPollInterval() {
	return matchPollingState.pollIntervalMs;
}

/**
 * Find the next suggested match to play (for auto-advance feature)
 * @param {Array} matches - Array of matches
 * @param {Array} assignedStations - Array of assigned station IDs
 * @returns {Object|null} Next suggested match or null
 */
function findNextSuggestedMatch(matches, assignedStations = []) {
	// Filter open matches that are not underway and have both players
	const openMatches = matches.filter(m =>
		m.state === 'open' &&
		!m.underwayAt &&
		m.player1Id &&
		m.player2Id
	);

	if (openMatches.length === 0) return null;

	// Sort by suggested play order
	openMatches.sort((a, b) =>
		(a.suggestedPlayOrder || 9999) - (b.suggestedPlayOrder || 9999)
	);

	return openMatches[0];
}

/**
 * Fetch matches from local database and push to MagicMirror
 * @param {string} tournamentIdOverride - Optional tournament ID to use instead of reading from state file
 */
async function fetchAndPushMatches(tournamentIdOverride = null) {
	// Get tournament info from state file or override
	let tournamentId = tournamentIdOverride || matchPollingState.activeTournamentId;

	if (!tournamentId) {
		const stateFile = process.env.MATCH_STATE_FILE || '/root/tcc-custom/admin-dashboard/tournament-state.json';

		let tournamentState;
		try {
			const data = fsSync.readFileSync(stateFile, 'utf8');
			tournamentState = JSON.parse(data);
		} catch (error) {
			logger.error('fetchAndPush', error, { message: 'Error reading tournament state' });
			return;
		}

		if (!tournamentState || !tournamentState.tournamentId) {
			logger.log('fetchAndPush:skipped', { reason: 'No tournament configured' });
			return;
		}

		tournamentId = tournamentState.tournamentId;
	}

	try {
		const logComplete = logger.start('fetchAndPush', { tournamentId });

		// Get tournament from local DB
		const tournament = tournamentDb.getById(tournamentId);
		if (!tournament) {
			logger.error('fetchAndPush', new Error('Tournament not found'), { tournamentId });
			return;
		}

		// Get participants from local DB
		const participants = participantDb.getByTournament(tournamentId);
		const participantMap = {};
		const participantsCache = {};
		participants.forEach(p => {
			participantMap[String(p.id)] = p.name || p.display_name || 'Player ' + p.id;
			participantsCache[String(p.id)] = p.name || p.display_name || 'Player ' + p.id;
		});

		// Get matches from local DB
		const matchesRaw = matchDb.getByTournament(tournamentId);

		// Get stations from local DB
		const stationMap = {};
		const matchStationMap = {};
		try {
			const tournamentsDb = require('../db/tournaments-db');
			const stations = tournamentsDb.getDb().prepare(`
				SELECT id, name FROM tcc_stations
				WHERE tournament_id = ? AND active = 1
			`).all(tournamentId);

			stations.forEach(s => {
				stationMap[String(s.id)] = s.name;
			});

			// Build match->station mapping
			matchesRaw.forEach(m => {
				if (m.station_id) {
					matchStationMap[String(m.id)] = stationMap[String(m.station_id)] || null;
				}
			});
		} catch (stationError) {
			logger.warn('fetchAndPush:stations', stationError.message, { tournamentId });
		}

		// Available stations from stationMap
		const availableStations = new Set(Object.values(stationMap));

		// Simplify matches for MagicMirror
		const simplified = matchesRaw.map(match => {
			const p1Name = match.player1_id && participantMap[String(match.player1_id)]
				? participantMap[String(match.player1_id)]
				: match.player1_id ? 'Player ' + match.player1_id : 'TBD';

			const p2Name = match.player2_id && participantMap[String(match.player2_id)]
				? participantMap[String(match.player2_id)]
				: match.player2_id ? 'Player ' + match.player2_id : 'TBD';

			const stationName = match.station_id ? stationMap[String(match.station_id)] : null;

			return {
				id: match.id,
				state: match.state,
				round: match.round,
				identifier: match.identifier,
				suggestedPlayOrder: match.suggested_play_order != null ? match.suggested_play_order : 9999,
				player1Id: match.player1_id,
				player2Id: match.player2_id,
				player1Name: p1Name,
				player2Name: p2Name,
				player1Score: match.player1_score,
				player2Score: match.player2_score,
				stationId: match.station_id,
				stationName: stationName,
				underwayAt: match.underway_at,
				winnerId: match.winner_id || null,
				losersBracket: match.losers_bracket || false,
				isGrandFinals: match.is_grand_finals || false
			};
		});

		// Check if tournament is complete for podium
		const has3rdPlaceMatch = matchesRaw.some(m => m.identifier === '3P');
		let podium = { isComplete: false, first: null, second: null, third: null, has3rdPlace: has3rdPlaceMatch };

		if (tournament.state === 'complete' || (matchesRaw.length > 0 && matchesRaw.every(m => m.state === 'complete'))) {
			// Find finals match
			let finalsMatch = null;
			matchesRaw.forEach(m => {
				if (m.is_grand_finals || (m.round > 0 && m.identifier !== '3P')) {
					if (!finalsMatch || m.round > finalsMatch.round) {
						finalsMatch = m;
					}
				}
			});

			if (finalsMatch && finalsMatch.winner_id) {
				const winnerId = finalsMatch.winner_id;
				const secondId = finalsMatch.loser_id;

				const thirdMatch = matchesRaw.find(m => m.identifier === '3P' && m.state === 'complete');
				const thirdId = thirdMatch ? thirdMatch.winner_id : null;

				const nameForId = id => {
					if (!id) return null;
					return participantMap[String(id)] || 'Player ' + id;
				};

				podium = {
					isComplete: true,
					first: nameForId(winnerId),
					second: nameForId(secondId),
					third: thirdId ? nameForId(thirdId) : null,
					has3rdPlace: has3rdPlaceMatch
				};
			}
		}

		// Build payload for push and cache
		const pushTimestamp = new Date().toISOString();

		// Calculate match statistics for metadata
		const completedCount = simplified.filter(m => m.state === 'complete').length;
		const underwayCount = simplified.filter(m => m.state === 'open' && m.underwayAt).length;
		const openCount = simplified.filter(m => m.state === 'open' && !m.underwayAt).length;
		const pendingCount = simplified.filter(m => m.state === 'pending').length;
		const totalCount = simplified.length;

		// Find next suggested match
		const assignedStations = Object.keys(matchStationMap);
		const nextMatch = findNextSuggestedMatch(simplified, assignedStations);

		const payload = {
			tournamentId: tournamentId,
			tournamentName: tournament.name,
			tournamentType: tournament.tournament_type,
			matches: simplified,
			podium: podium,
			availableStations: Array.from(availableStations),
			participantsCache: participantsCache,
			timestamp: pushTimestamp,
			source: 'local',
			metadata: {
				nextMatchId: nextMatch?.id || null,
				nextMatchPlayers: nextMatch ? {
					player1: nextMatch.player1Name,
					player2: nextMatch.player2Name
				} : null,
				completedCount,
				underwayCount,
				openCount,
				pendingCount,
				totalCount,
				progressPercent: totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0
			}
		};

		// Compute hash for deduplication and ACK tracking
		const payloadHash = crypto
			.createHash('md5')
			.update(JSON.stringify({ matches: simplified, podium: podium }))
			.digest('hex');

		// Save to cache before pushing
		saveMatchDataCache(tournamentId, payload);

		// Check if any displays are connected via WebSocket
		const displayCount = wsConnections ? wsConnections.displays.size : 0;
		const hasConnectedDisplays = displayCount > 0;

		// Broadcast via WebSocket to all connected displays
		if (broadcastMatchData) {
			broadcastMatchData(payload, payloadHash);
		}

		// HTTP fallback logic
		const shouldHttpFallback = !hasConnectedDisplays || (needsHttpFallback && needsHttpFallback());

		if (shouldHttpFallback) {
			const matchApiUrl = process.env.MATCH_API_URL || 'http://localhost:2052';
			try {
				await axios.post(`${matchApiUrl}/api/matches/push`, payload, { timeout: 5000 });
				logger.log('fetchAndPush:httpFallback', {
					reason: hasConnectedDisplays ? 'no ACK received' : 'no WS displays'
				});
			} catch (httpError) {
				logger.warn('fetchAndPush:httpFallbackFailed', httpError.message);
			}
		} else {
			logger.log('fetchAndPush:wsDelivered', { displayCount });
		}

		matchPollingState.lastPollTime = pushTimestamp;
		logComplete({
			matchCount: simplified.length,
			displayCount,
			completedCount,
			underwayCount,
			openCount,
			httpFallback: shouldHttpFallback,
			nextMatchId: nextMatch?.id || null
		});

	} catch (error) {
		logger.error('fetchAndPush', error, { tournamentId });

		// If fetch failed, try to push cached data with stale indicator
		const cachedData = getMatchDataCache(tournamentId);
		if (cachedData && cachedData.data) {
			try {
				const matchApiUrl = process.env.MATCH_API_URL || 'http://localhost:2052';
				await axios.post(`${matchApiUrl}/api/matches/push`, {
					...cachedData.data,
					timestamp: cachedData.cacheTimestamp,
					source: 'cache',
					isStale: true,
					cacheAgeMs: cachedData.cacheAgeMs
				}, { timeout: 5000 });
				logger.log('fetchAndPush:cachedFallback', { cacheAgeMs: cachedData.cacheAgeMs });
			} catch (pushError) {
				logger.error('fetchAndPush:cachedFallbackFailed', pushError);
			}
		}
	}
}

/**
 * Fetch and push matches for a specific user's active tournament
 * @param {number} userId - User ID to poll for
 */
async function fetchAndPushMatchesForUser(userId) {
	if (!activeTournamentService) {
		logger.warn('fetchAndPushForUser:noService', { userId });
		return;
	}

	try {
		const activeResult = activeTournamentService.getActiveTournament(userId);
		if (!activeResult.tournament) {
			logger.log('fetchAndPushForUser:noActive', { userId });
			return;
		}

		const tournament = activeResult.tournament;
		if (tournament.state !== 'underway') {
			logger.log('fetchAndPushForUser:notUnderway', { userId, state: tournament.state });
			return;
		}

		const logComplete = logger.start('fetchAndPushForUser', { userId, tournamentId: tournament.id });

		// Get participants from local DB
		const participants = participantDb.getByTournament(tournament.id);
		const participantMap = {};
		const participantsCache = {};
		participants.forEach(p => {
			participantMap[String(p.id)] = p.name || p.display_name || 'Player ' + p.id;
			participantsCache[String(p.id)] = p.name || p.display_name || 'Player ' + p.id;
		});

		// Get matches from local DB
		const matchesRaw = matchDb.getByTournament(tournament.id);

		// Get stations from local DB
		const stationMap = {};
		const matchStationMap = {};
		try {
			const tournamentsDb = require('../db/tournaments-db');
			const stations = tournamentsDb.getDb().prepare(`
				SELECT id, name FROM tcc_stations
				WHERE tournament_id = ? AND active = 1
			`).all(tournament.id);

			stations.forEach(s => {
				stationMap[String(s.id)] = s.name;
			});

			// Build match->station mapping
			matchesRaw.forEach(m => {
				if (m.station_id) {
					matchStationMap[String(m.id)] = stationMap[String(m.station_id)] || null;
				}
			});
		} catch (stationError) {
			logger.warn('fetchAndPushForUser:stations', stationError.message, { userId, tournamentId: tournament.id });
		}

		// Available stations from stationMap
		const availableStations = new Set(Object.values(stationMap));

		// Simplify matches for display
		const simplified = matchesRaw.map(match => {
			const p1Name = match.player1_id && participantMap[String(match.player1_id)]
				? participantMap[String(match.player1_id)]
				: match.player1_id ? 'Player ' + match.player1_id : 'TBD';

			const p2Name = match.player2_id && participantMap[String(match.player2_id)]
				? participantMap[String(match.player2_id)]
				: match.player2_id ? 'Player ' + match.player2_id : 'TBD';

			const stationName = match.station_id ? stationMap[String(match.station_id)] : null;

			return {
				id: match.id,
				state: match.state,
				round: match.round,
				identifier: match.identifier,
				suggestedPlayOrder: match.suggested_play_order != null ? match.suggested_play_order : 9999,
				player1Id: match.player1_id,
				player2Id: match.player2_id,
				player1Name: p1Name,
				player2Name: p2Name,
				player1Score: match.player1_score,
				player2Score: match.player2_score,
				stationId: match.station_id,
				stationName: stationName,
				underwayAt: match.underway_at,
				winnerId: match.winner_id || null,
				losersBracket: match.losers_bracket || false,
				isGrandFinals: match.is_grand_finals || false
			};
		});

		// Check if tournament is complete for podium
		const has3rdPlaceMatch = matchesRaw.some(m => m.identifier === '3P');
		let podium = { isComplete: false, first: null, second: null, third: null, has3rdPlace: has3rdPlaceMatch };

		if (tournament.state === 'complete' || (matchesRaw.length > 0 && matchesRaw.every(m => m.state === 'complete'))) {
			let finalsMatch = null;
			matchesRaw.forEach(m => {
				if (m.is_grand_finals || (m.round > 0 && m.identifier !== '3P')) {
					if (!finalsMatch || m.round > finalsMatch.round) {
						finalsMatch = m;
					}
				}
			});

			if (finalsMatch && finalsMatch.winner_id) {
				const winnerId = finalsMatch.winner_id;
				const secondId = finalsMatch.loser_id;
				const thirdMatch = matchesRaw.find(m => m.identifier === '3P' && m.state === 'complete');
				const thirdId = thirdMatch ? thirdMatch.winner_id : null;

				const nameForId = id => {
					if (!id) return null;
					return participantMap[String(id)] || 'Player ' + id;
				};

				podium = {
					isComplete: true,
					first: nameForId(winnerId),
					second: nameForId(secondId),
					third: thirdId ? nameForId(thirdId) : null,
					has3rdPlace: has3rdPlaceMatch
				};
			}
		}

		// Build payload
		const pushTimestamp = new Date().toISOString();
		const completedCount = simplified.filter(m => m.state === 'complete').length;
		const underwayCount = simplified.filter(m => m.state === 'open' && m.underwayAt).length;
		const openCount = simplified.filter(m => m.state === 'open' && !m.underwayAt).length;
		const pendingCount = simplified.filter(m => m.state === 'pending').length;
		const totalCount = simplified.length;

		const assignedStations = Object.keys(matchStationMap);
		const nextMatch = findNextSuggestedMatch(simplified, assignedStations);

		const payload = {
			tournamentId: tournament.url_slug,
			tournamentName: tournament.name,
			tournamentType: tournament.tournament_type,
			matches: simplified,
			podium: podium,
			availableStations: Array.from(availableStations),
			participantsCache: participantsCache,
			timestamp: pushTimestamp,
			source: 'local',
			userId: userId,  // Include userId for multi-tenant identification
			metadata: {
				nextMatchId: nextMatch?.id || null,
				nextMatchPlayers: nextMatch ? {
					player1: nextMatch.player1Name,
					player2: nextMatch.player2Name
				} : null,
				completedCount,
				underwayCount,
				openCount,
				pendingCount,
				totalCount,
				progressPercent: totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0
			}
		};

		// Compute hash for deduplication
		const payloadHash = crypto
			.createHash('md5')
			.update(JSON.stringify({ matches: simplified, podium: podium }))
			.digest('hex');

		// Broadcast to user-specific rooms
		if (io) {
			io.to(`user:${userId}`).emit('matches:update', {
				...payload,
				hash: payloadHash
			});
			logger.log('fetchAndPushForUser:broadcast', { userId, matchCount: simplified.length });
		}

		matchPollingState.userLastPoll.set(userId, pushTimestamp);
		logComplete({ matchCount: simplified.length, completedCount, underwayCount });

	} catch (error) {
		logger.error('fetchAndPushForUser', error, { userId });
	}
}

/**
 * Poll all users with active underway tournaments (multi-tenant mode)
 */
async function pollAllActiveUsers() {
	if (!systemDb || !activeTournamentService) {
		logger.warn('pollAllActiveUsers:missingDeps');
		return;
	}

	try {
		// Get all users who might have active tournaments
		const users = systemDb.getDb().prepare('SELECT id FROM users WHERE is_active = 1').all();
		let polledCount = 0;

		for (const user of users) {
			try {
				const activeResult = activeTournamentService.getActiveTournament(user.id);
				if (activeResult.tournament && activeResult.tournament.state === 'underway') {
					await fetchAndPushMatchesForUser(user.id);
					polledCount++;
				}
			} catch (err) {
				logger.warn('pollAllActiveUsers:userError', { userId: user.id, error: err.message });
			}
		}

		if (polledCount > 0) {
			logger.log('pollAllActiveUsers:complete', { usersPolled: polledCount });
		}
	} catch (error) {
		logger.error('pollAllActiveUsers', error);
	}
}

/**
 * Trigger immediate poll for a specific user
 * @param {number} userId - User ID to poll for
 */
async function triggerImmediatePollForUser(userId) {
	if (matchPollingState.multiTenantMode && activeTournamentService) {
		await fetchAndPushMatchesForUser(userId);
	}
}

/**
 * Set the active tournament for polling
 * @param {number|string} tournamentId - Tournament ID
 */
function setActiveTournament(tournamentId) {
	matchPollingState.activeTournamentId = tournamentId;
	logger.log('setActiveTournament', { tournamentId });
}

/**
 * Start match polling
 * @param {number|string} tournamentId - Optional tournament ID to poll (ignored in multi-tenant mode)
 */
function startMatchPolling(tournamentId = null) {
	if (matchPollingState.intervalId) {
		clearInterval(matchPollingState.intervalId);
		matchPollingState.intervalId = null;
	}

	const interval = getMatchPollInterval();

	// Multi-tenant mode: poll all users with active tournaments
	if (matchPollingState.multiTenantMode && activeTournamentService) {
		logger.log('startPolling:multiTenant', { intervalSeconds: interval / 1000 });

		matchPollingState.isPolling = true;

		// Poll immediately
		pollAllActiveUsers();

		// Then at interval
		matchPollingState.intervalId = setInterval(() => {
			pollAllActiveUsers();
		}, interval);
		return;
	}

	// Legacy single-tenant mode
	if (tournamentId) {
		matchPollingState.activeTournamentId = tournamentId;
	}

	if (!matchPollingState.activeTournamentId) {
		logger.log('startPolling:skipped', { reason: 'No tournament configured' });
		return;
	}

	logger.log('startPolling', {
		tournamentId: matchPollingState.activeTournamentId,
		intervalSeconds: interval / 1000
	});

	matchPollingState.isPolling = true;

	// Poll immediately
	fetchAndPushMatches();

	// Then at interval
	matchPollingState.intervalId = setInterval(() => {
		if (shouldPollMatches()) {
			fetchAndPushMatches();
		} else {
			// Tournament may have completed
			const tournament = tournamentDb.getById(matchPollingState.activeTournamentId);
			if (tournament && tournament.state === 'complete') {
				// Push one final update then stop
				fetchAndPushMatches();
				stopMatchPolling();
			}
		}
	}, interval);
}

/**
 * Stop match polling
 */
function stopMatchPolling() {
	if (matchPollingState.intervalId) {
		clearInterval(matchPollingState.intervalId);
		matchPollingState.intervalId = null;
	}
	matchPollingState.isPolling = false;
	logger.log('stopPolling', { tournamentId: matchPollingState.activeTournamentId });
}

/**
 * Update match polling based on tournament state changes
 */
function updateMatchPolling() {
	if (shouldPollMatches()) {
		if (!matchPollingState.isPolling) {
			startMatchPolling();
		}
	} else {
		stopMatchPolling();
	}
}

/**
 * Trigger an immediate poll (useful after score updates)
 */
function triggerImmediatePoll() {
	if (matchPollingState.activeTournamentId) {
		fetchAndPushMatches();
	}
}

/**
 * Get match polling state
 * @returns {Object} Current polling state
 */
function getMatchPollingState() {
	return {
		active: matchPollingState.isPolling,
		intervalMs: getMatchPollInterval(),
		lastPollTime: matchPollingState.lastPollTime,
		tournamentId: matchPollingState.activeTournamentId
	};
}

module.exports = {
	init,
	saveMatchDataCache,
	loadMatchDataCache,
	getMatchDataCache,
	shouldPollMatches,
	getMatchPollInterval,
	findNextSuggestedMatch,
	setActiveTournament,
	fetchAndPushMatches,
	fetchAndPushMatchesForUser,
	pollAllActiveUsers,
	triggerImmediatePollForUser,
	startMatchPolling,
	stopMatchPolling,
	updateMatchPolling,
	triggerImmediatePoll,
	getMatchPollingState
};
