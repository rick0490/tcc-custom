/**
 * DQ Timer Service
 *
 * Manages server-side DQ timers for auto-DQ functionality.
 * Extracted from server.js for modularity.
 */

// References set by init
let io = null;
let settings = null;
let challongeApi = null;
let activityLogger = null;
let cacheDb = null;
let fetchAndPushMatches = null;
let broadcastPushNotification = null;

// Timer storage: Key = "tournamentId:matchId:tv", Value = timer object
const activeDQTimers = new Map();

/**
 * Initialize the DQ Timer service with dependencies
 * @param {Object} options - Configuration options
 * @param {Object} options.io - Socket.IO server instance
 * @param {Object} options.settings - Settings service
 * @param {Object} options.challongeApi - Challonge API service
 * @param {Object} options.activityLogger - Activity logger service
 * @param {Object} options.cacheDb - Cache database
 * @param {Function} options.fetchAndPushMatches - Function to fetch and push matches
 * @param {Function} options.broadcastPushNotification - Function to broadcast push notifications
 */
function init({
	io: ioServer,
	settings: settingsService,
	challongeApi: challongeApiService,
	activityLogger: activityLoggerService,
	cacheDb: cacheDbService,
	fetchAndPushMatches: fetchPushFn,
	broadcastPushNotification: pushFn
}) {
	io = ioServer;
	settings = settingsService;
	challongeApi = challongeApiService;
	activityLogger = activityLoggerService;
	cacheDb = cacheDbService;
	fetchAndPushMatches = fetchPushFn;
	broadcastPushNotification = pushFn;
}

/**
 * Get DQ timer settings from system settings
 * @returns {Object} DQ timer settings
 */
function getDQTimerSettings() {
	const systemSettings = settings.loadSystemSettings();
	return systemSettings.dqTimer || {
		autoDqEnabled: false,
		autoDqAction: 'notify',  // 'auto-dq' or 'notify'
		defaultDuration: 180,
		warningThreshold: 30
	};
}

/**
 * Start a server-side DQ timer with auto-DQ capability
 * @param {string} tournamentId - Tournament ID
 * @param {string} matchId - Match ID
 * @param {string} tv - TV slot (e.g., 'TV 1', 'TV 2')
 * @param {number} duration - Timer duration in seconds
 * @param {string|null} playerId - Player ID to DQ on expiry
 * @param {string|null} playerName - Player name for display
 * @returns {Object} Timer object
 */
function startServerDQTimer(tournamentId, matchId, tv, duration, playerId, playerName) {
	const key = `${tournamentId}:${matchId}:${tv}`;

	// Clear existing timer if any
	if (activeDQTimers.has(key)) {
		clearTimeout(activeDQTimers.get(key).timeoutId);
		activeDQTimers.delete(key);
	}

	const timerSettings = getDQTimerSettings();
	const warningThreshold = timerSettings.warningThreshold || 30;

	// Create timer object
	const timer = {
		key,
		tournamentId,
		matchId,
		tv,
		playerId,
		playerName,
		duration,
		startTime: new Date(),
		expiresAt: new Date(Date.now() + duration * 1000),
		warningTimeoutId: null,
		timeoutId: null
	};

	// Set warning timeout (30 seconds before expiry)
	if (duration > warningThreshold) {
		timer.warningTimeoutId = setTimeout(() => {
			io.emit('timer:dq:warning', {
				key,
				tv,
				matchId,
				playerName,
				secondsRemaining: warningThreshold
			});
		}, (duration - warningThreshold) * 1000);
	}

	// Set expiry timeout
	timer.timeoutId = setTimeout(() => {
		handleDQTimerExpiry(key);
	}, duration * 1000);

	activeDQTimers.set(key, timer);

	// Broadcast timer started
	io.emit('timer:dq:started', {
		key,
		tournamentId,
		matchId,
		tv,
		playerId,
		playerName,
		duration,
		startTime: timer.startTime.toISOString(),
		expiresAt: timer.expiresAt.toISOString()
	});

	console.log(`[DQ Timer] Started: ${key} (${playerName || 'unknown'}) - ${duration}s`);
	return timer;
}

/**
 * Handle DQ timer expiry
 * @param {string} key - Timer key
 */
async function handleDQTimerExpiry(key) {
	const timer = activeDQTimers.get(key);
	if (!timer) return;

	const timerSettings = getDQTimerSettings();
	const autoDqAction = timerSettings.autoDqAction || 'notify';

	console.log(`[DQ Timer] Expired: ${key} - Action: ${autoDqAction}`);

	// Send push notification for DQ timer expiry
	if (broadcastPushNotification) {
		broadcastPushNotification('dq_timer_expired', {
			title: 'DQ Timer Expired',
			body: `${timer.playerName || 'Player'} - ${timer.tv || 'Unknown TV'}`,
			data: {
				type: 'dq_timer_expired',
				tv: timer.tv,
				matchId: timer.matchId,
				playerId: timer.playerId,
				playerName: timer.playerName,
				action: autoDqAction
			}
		}).catch(err => console.error('[Push] DQ timer notification error:', err.message));
	}

	if (autoDqAction === 'auto-dq' && timer.playerId && timer.matchId) {
		// Auto-DQ the player
		try {
			await performAutoDQ(timer);
			if (activityLogger) {
				activityLogger.logActivity(0, 'System', 'auto_dq_executed', {
					tournamentId: timer.tournamentId,
					matchId: timer.matchId,
					tv: timer.tv,
					playerId: timer.playerId,
					playerName: timer.playerName
				});
			}
		} catch (error) {
			console.error(`[DQ Timer] Auto-DQ failed:`, error.message);
			io.emit('timer:dq:error', { key, error: error.message });
		}
	} else {
		// Just notify - no auto-DQ
		io.emit('timer:dq:expired', {
			key,
			tv: timer.tv,
			matchId: timer.matchId,
			playerName: timer.playerName,
			action: 'notify'
		});
	}

	// Clean up
	if (timer.warningTimeoutId) clearTimeout(timer.warningTimeoutId);
	activeDQTimers.delete(key);
}

/**
 * Perform auto-DQ on a player
 * @param {Object} timer - Timer object with player/match info
 */
async function performAutoDQ(timer) {
	const { tournamentId, matchId, playerId } = timer;

	// Get match details to find winner (the other player)
	const matchResponse = await challongeApi.challongeV2Request('GET', `/tournaments/${tournamentId}/matches/${matchId}.json`);
	const matchData = matchResponse.data?.data;
	const relationships = matchData?.relationships;

	let player1Id = relationships?.player1?.data?.id;
	let player2Id = relationships?.player2?.data?.id;

	if (!player1Id || !player2Id) {
		throw new Error('Could not determine player IDs');
	}

	// The winner is the player who is NOT being DQ'd
	const winnerId = String(playerId) === String(player1Id) ? player2Id : player1Id;
	const loserId = playerId;

	// Use DQ endpoint to forfeit the player
	await challongeApi.challongeV2Request('PUT', `/tournaments/${tournamentId}/matches/${matchId}.json`, {
		data: {
			type: 'Match',
			attributes: {
				match: [
					{ participant_id: String(winnerId), score_set: '0', rank: 1, advancing: true },
					{ participant_id: String(loserId), score_set: '0', rank: 2, advancing: false, forfeited: true }
				]
			}
		}
	});

	// Emit success event
	io.emit('timer:dq:executed', {
		key: timer.key,
		tournamentId,
		matchId,
		winnerId,
		loserId,
		playerName: timer.playerName
	});

	// Invalidate cache and push updates
	if (cacheDb) {
		cacheDb.invalidateCache('matches', tournamentId);
	}
	if (fetchAndPushMatches) {
		await fetchAndPushMatches(tournamentId);
	}

	console.log(`[DQ Timer] Auto-DQ executed for ${timer.playerName} in match ${matchId}`);
}

/**
 * Cancel a DQ timer
 * @param {string} key - Timer key (format: "tournamentId:matchId:tv")
 * @returns {boolean} True if timer was cancelled
 */
function cancelDQTimer(key) {
	const timer = activeDQTimers.get(key);
	if (timer) {
		if (timer.timeoutId) clearTimeout(timer.timeoutId);
		if (timer.warningTimeoutId) clearTimeout(timer.warningTimeoutId);
		activeDQTimers.delete(key);

		io.emit('timer:dq:cancelled', { key, tv: timer.tv });
		console.log(`[DQ Timer] Cancelled: ${key}`);
		return true;
	}
	return false;
}

/**
 * Get all active DQ timers
 * @returns {Array} Array of timer objects with remaining time
 */
function getActiveDQTimers() {
	const timers = [];
	const now = Date.now();

	activeDQTimers.forEach((timer, key) => {
		const secondsRemaining = Math.max(0, Math.floor((timer.expiresAt.getTime() - now) / 1000));
		timers.push({
			key,
			tournamentId: timer.tournamentId,
			matchId: timer.matchId,
			tv: timer.tv,
			playerId: timer.playerId,
			playerName: timer.playerName,
			duration: timer.duration,
			secondsRemaining,
			startTime: timer.startTime.toISOString(),
			expiresAt: timer.expiresAt.toISOString()
		});
	});

	return timers;
}

/**
 * Check if a timer exists for a specific key
 * @param {string} key - Timer key
 * @returns {boolean} True if timer exists
 */
function hasTimer(key) {
	return activeDQTimers.has(key);
}

/**
 * Get a specific timer by key
 * @param {string} key - Timer key
 * @returns {Object|null} Timer object or null
 */
function getTimer(key) {
	return activeDQTimers.get(key) || null;
}

/**
 * Clear all active timers (for cleanup)
 */
function clearAllTimers() {
	activeDQTimers.forEach((timer) => {
		if (timer.timeoutId) clearTimeout(timer.timeoutId);
		if (timer.warningTimeoutId) clearTimeout(timer.warningTimeoutId);
	});
	activeDQTimers.clear();
	console.log('[DQ Timer] All timers cleared');
}

module.exports = {
	init,
	getDQTimerSettings,
	startServerDQTimer,
	handleDQTimerExpiry,
	performAutoDQ,
	cancelDQTimer,
	getActiveDQTimers,
	hasTimer,
	getTimer,
	clearAllTimers
};
