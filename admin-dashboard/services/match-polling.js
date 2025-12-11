/**
 * Match Polling Service (tcc-custom)
 *
 * Local database match polling and push to MagicMirror displays.
 * Simplified from Challonge polling to direct database queries.
 */

const path = require('path');
const fsSync = require('fs');
const axios = require('axios');
const crypto = require('crypto');

// References set by init
let io = null;
let matchDb = null;
let tournamentDb = null;
let participantDb = null;
let wsConnections = null;
let broadcastMatchData = null;
let needsHttpFallback = null;

// Match polling state
const matchPollingState = {
	intervalId: null,
	isPolling: false,
	lastPollTime: null,
	pollIntervalMs: 5000,  // 5 seconds - faster since no external API limits
	activeTournamentId: null
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
	needsHttpFallback: fallbackFn
}) {
	io = ioServer;
	matchDb = matchDbService;
	tournamentDb = tournamentDbService;
	participantDb = participantDbService;
	wsConnections = wsConnectionsRef;
	broadcastMatchData = broadcastFn;
	needsHttpFallback = fallbackFn;

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
		console.log('[Match Cache] Saved to file:', MATCH_CACHE_FILE);
	} catch (error) {
		console.warn('[Match Cache] Failed to save cache file:', error.message);
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
			console.log('[Match Cache] Loaded from file, timestamp:', cacheEntry.timestamp);
			return true;
		}
	} catch (error) {
		console.warn('[Match Cache] Failed to load cache file:', error.message);
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
		!m.underway_at &&
		m.player1_id &&
		m.player2_id
	);

	if (openMatches.length === 0) return null;

	// Sort by suggested play order
	openMatches.sort((a, b) =>
		(a.suggested_play_order || 9999) - (b.suggested_play_order || 9999)
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
		const stateFile = process.env.MATCH_STATE_FILE || '/root/tcc-custom/MagicMirror-match/modules/MMM-TournamentNowPlaying/tournament-state.json';

		let tournamentState;
		try {
			const data = fsSync.readFileSync(stateFile, 'utf8');
			tournamentState = JSON.parse(data);
		} catch (error) {
			console.error('[Match Polling] Error reading tournament state:', error.message);
			return;
		}

		if (!tournamentState || !tournamentState.tournamentId) {
			console.log('[Match Polling] No tournament configured - skipping');
			return;
		}

		tournamentId = tournamentState.tournamentId;
	}

	try {
		console.log('[Match Polling] Fetching matches for tournament:', tournamentId);

		// Get tournament from local DB
		const tournament = tournamentDb.getById(tournamentId);
		if (!tournament) {
			console.error('[Match Polling] Tournament not found:', tournamentId);
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
			const db = require('../analytics-db');
			const stations = db.db.prepare(`
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
			console.warn('[Match Polling] Could not fetch stations:', stationError.message);
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
				suggested_play_order: match.suggested_play_order != null ? match.suggested_play_order : 9999,
				player1_id: match.player1_id,
				player2_id: match.player2_id,
				player1_name: p1Name,
				player2_name: p2Name,
				player1_score: match.player1_score,
				player2_score: match.player2_score,
				station_name: stationName,
				underway_at: match.underway_at,
				winner_id: match.winner_id || null,
				losers_bracket: match.losers_bracket || false,
				is_grand_finals: match.is_grand_finals || false
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
		const underwayCount = simplified.filter(m => m.state === 'open' && m.underway_at).length;
		const openCount = simplified.filter(m => m.state === 'open' && !m.underway_at).length;
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
					player1: nextMatch.player1_name,
					player2: nextMatch.player2_name
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
				console.log(`[Match Polling] HTTP fallback push (${hasConnectedDisplays ? 'no ACK received' : 'no WS displays'})`);
			} catch (httpError) {
				console.warn(`[Match Polling] HTTP fallback failed: ${httpError.message}`);
			}
		} else {
			console.log(`[Match Polling] WebSocket delivery confirmed, skipping HTTP push`);
		}

		matchPollingState.lastPollTime = pushTimestamp;
		console.log(`[Match Polling] Pushed ${simplified.length} matches (WS: ${displayCount} displays${shouldHttpFallback ? ', HTTP fallback' : ''})`);

	} catch (error) {
		console.error('[Match Polling] Error:', error.message);

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
				console.log('[Match Polling] Pushed cached data (stale) to MagicMirror');
			} catch (pushError) {
				console.error('[Match Polling] Failed to push cached data:', pushError.message);
			}
		}
	}
}

/**
 * Set the active tournament for polling
 * @param {number|string} tournamentId - Tournament ID
 */
function setActiveTournament(tournamentId) {
	matchPollingState.activeTournamentId = tournamentId;
	console.log('[Match Polling] Active tournament set to:', tournamentId);
}

/**
 * Start match polling
 * @param {number|string} tournamentId - Optional tournament ID to poll
 */
function startMatchPolling(tournamentId = null) {
	if (matchPollingState.intervalId) {
		clearInterval(matchPollingState.intervalId);
		matchPollingState.intervalId = null;
	}

	if (tournamentId) {
		matchPollingState.activeTournamentId = tournamentId;
	}

	if (!matchPollingState.activeTournamentId) {
		console.log('[Match Polling] No tournament configured - not starting');
		return;
	}

	const interval = getMatchPollInterval();
	console.log(`[Match Polling] Starting - polling every ${interval / 1000} seconds for tournament ${matchPollingState.activeTournamentId}`);

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
	console.log('[Match Polling] Stopped');
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
	startMatchPolling,
	stopMatchPolling,
	updateMatchPolling,
	triggerImmediatePoll,
	getMatchPollingState
};
