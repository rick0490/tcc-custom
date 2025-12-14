/**
 * Miscellaneous API Routes
 *
 * Handles various utility endpoints including:
 * - System status
 * - Rate limit management
 * - Cache management
 * - Push notifications
 * - WebSocket status
 * - Ticker messages
 * - Timers (DQ and tournament)
 * - QR code display
 * - Bracket control proxy
 * - Match cache/force-update
 */

const express = require('express');
const router = express.Router();
const os = require('os');
const QRCode = require('qrcode');
const { createLogger } = require('../services/debug-logger');

const logger = createLogger('routes:api');

// Module dependencies (injected via init)
let axios = null;
let io = null;
let requireAuthAPI = null;
let requireAdmin = null;
let requireTokenOrSessionAuth = null;
let logActivity = null;
let cacheDb = null;
let analyticsDb = null;
let webpush = null;
let VAPID_PUBLIC_KEY = null;
let VAPID_PRIVATE_KEY = null;
let db = null;

// Emergency mode state
let emergencyModeState = {
	active: false,
	activatedAt: null,
	activatedBy: null,
	reason: null
};
let getWebSocketStatus = null;
let fetchAndPushMatches = null;
let matchDataCache = null;
let matchPollingState = null;
let getMatchDataCache = null;
let broadcastTickerMessage = null;
let startServerDQTimer = null;
let getDQTimerSettings = null;
let getActiveDQTimers = null;
let cancelDQTimer = null;

// Read state file helper
let readStateFile = null;
let checkModuleStatus = null;

/**
 * Initialize route dependencies
 * @param {Object} deps - Dependencies object
 */
function init(deps) {
	axios = deps.axios;
	io = deps.io;
	requireAuthAPI = deps.requireAuthAPI;
	requireAdmin = deps.requireAdmin;
	requireTokenOrSessionAuth = deps.requireTokenOrSessionAuth;
	logActivity = deps.logActivity || (() => {});
	cacheDb = deps.cacheDb;
	analyticsDb = deps.analyticsDb;
	webpush = deps.webpush;
	VAPID_PUBLIC_KEY = deps.VAPID_PUBLIC_KEY;
	VAPID_PRIVATE_KEY = deps.VAPID_PRIVATE_KEY;
	db = deps.db;

	// State and helper references
	getWebSocketStatus = deps.getWebSocketStatus;
	fetchAndPushMatches = deps.fetchAndPushMatches;
	matchDataCache = deps.matchDataCache;
	matchPollingState = deps.matchPollingState;
	getMatchDataCache = deps.getMatchDataCache;
	broadcastTickerMessage = deps.broadcastTickerMessage;
	startServerDQTimer = deps.startServerDQTimer;
	getDQTimerSettings = deps.getDQTimerSettings;
	getActiveDQTimers = deps.getActiveDQTimers;
	cancelDQTimer = deps.cancelDQTimer;
	readStateFile = deps.readStateFile;
	checkModuleStatus = deps.checkModuleStatus;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Send push notification to a specific subscription
 */
async function sendPushNotification(subscription, payload) {
	if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
		logger.warn('push:vapidNotConfigured', { message: 'VAPID keys not configured, skipping notification' });
		return { success: false, error: 'VAPID keys not configured' };
	}

	const pushSubscription = {
		endpoint: subscription.endpoint,
		keys: {
			p256dh: subscription.p256dh_key,
			auth: subscription.auth_key
		}
	};

	try {
		await webpush.sendNotification(pushSubscription, JSON.stringify(payload));
		analyticsDb.updateSubscriptionLastUsed(subscription.endpoint);
		return { success: true };
	} catch (error) {
		logger.error('push:send', error, { endpoint: subscription.endpoint?.substring(0, 50) });
		// Remove invalid subscriptions (410 Gone or 404 Not Found)
		if (error.statusCode === 410 || error.statusCode === 404) {
			analyticsDb.deletePushSubscription(subscription.endpoint);
			logger.log('push:removedInvalidSubscription', { endpoint: subscription.endpoint?.substring(0, 50), statusCode: error.statusCode });
		}
		return { success: false, error: error.message };
	}
}

// ============================================
// SYSTEM STATUS ENDPOINTS
// ============================================

// Middleware wrappers (needed because actual middleware is injected via init)
const authWrapper = (req, res, next) => requireAuthAPI(req, res, next);
const adminWrapper = (req, res, next) => requireAdmin(req, res, next);
const tokenOrSessionWrapper = (req, res, next) => requireTokenOrSessionAuth(req, res, next);

/**
 * GET /status
 * Get system status including all module statuses
 */
router.get('/status', tokenOrSessionWrapper, async (req, res) => {
	try {
		const [matchStatus, flyerStatus, bracketStatus, matchState, flyerState, bracketState] = await Promise.all([
			checkModuleStatus(process.env.MATCH_API_URL, '/api/tournament/status'),
			checkModuleStatus(process.env.FLYER_API_URL, '/api/flyer/status'),
			checkModuleStatus(process.env.BRACKET_API_URL, '/api/bracket/status'),
			readStateFile(process.env.MATCH_STATE_FILE),
			readStateFile(process.env.FLYER_STATE_FILE),
			readStateFile(process.env.BRACKET_STATE_FILE)
		]);

		res.json({
			success: true,
			timestamp: new Date().toISOString(),
			modules: {
				match: {
					status: matchStatus,
					state: matchState,
					port: 2052
				},
				flyer: {
					status: flyerStatus,
					state: flyerState,
					port: 2054
				},
				bracket: {
					status: bracketStatus,
					state: bracketState,
					port: 2053
				}
			},
			server: {
				hostname: os.hostname(),
				nodeVersion: process.version,
				uptime: process.uptime(),
				memoryUsage: process.memoryUsage()
			}
		});
	} catch (error) {
		res.status(500).json({
			success: false,
			error: error.message
		});
	}
});

// ============================================
// CACHE MANAGEMENT ENDPOINTS
// ============================================

/**
 * GET /cache/status
 * Get cache statistics
 */
router.get('/cache/status', authWrapper, (req, res) => {
	try {
		const stats = cacheDb.getCacheStats();
		res.json({
			success: true,
			...stats,
			activeTournamentMode: false
		});
	} catch (error) {
		logger.error('cache:getStatus', error);
		res.status(500).json({
			success: false,
			error: error.message
		});
	}
});

/**
 * POST /cache/invalidate
 * Invalidate specific cache
 */
router.post('/cache/invalidate', authWrapper, (req, res) => {
	const { type, key } = req.body;

	// Validate type
	const validTypes = ['tournaments', 'matches', 'participants', 'stations', 'tournamentDetails'];
	if (!type || !validTypes.includes(type)) {
		return res.status(400).json({
			success: false,
			error: `Invalid cache type. Must be one of: ${validTypes.join(', ')}`
		});
	}

	try {
		const success = cacheDb.invalidateCache(type, key || null);
		const message = key
			? `Cache invalidated for ${type}/${key}`
			: `All ${type} cache invalidated`;

		logger.log('cache:invalidate', { type, key, username: req.session.username });
		logActivity('cache_invalidate', 'system', `${message}`, req.session.username);

		res.json({
			success,
			message
		});
	} catch (error) {
		logger.error('cache:invalidate', error, { type, key });
		res.status(500).json({
			success: false,
			error: error.message
		});
	}
});

/**
 * POST /cache/clear
 * Clear all caches
 */
router.post('/cache/clear', authWrapper, (req, res) => {
	try {
		const success = cacheDb.invalidateAllCache();

		logger.log('cache:clearAll', { username: req.session.username });
		logActivity('cache_clear', 'system', 'All caches cleared', req.session.username);

		res.json({
			success,
			message: 'All caches cleared successfully'
		});
	} catch (error) {
		logger.error('cache:clearAll', error);
		res.status(500).json({
			success: false,
			error: error.message
		});
	}
});

/**
 * GET /cache/tournament/:tournamentId
 * Get cache summary for a specific tournament
 */
router.get('/cache/tournament/:tournamentId', authWrapper, (req, res) => {
	const { tournamentId } = req.params;

	try {
		const summary = cacheDb.getTournamentCacheSummary(tournamentId);
		res.json({
			success: true,
			tournamentId,
			caches: summary
		});
	} catch (error) {
		logger.error('cache:getTournamentSummary', error, { tournamentId: req.params.tournamentId });
		res.status(500).json({
			success: false,
			error: error.message
		});
	}
});

// ============================================
// PUSH NOTIFICATION ENDPOINTS
// ============================================

/**
 * GET /notifications/vapid-public-key
 * Get VAPID public key for client-side subscription
 */
router.get('/notifications/vapid-public-key', authWrapper, (req, res) => {
	if (!VAPID_PUBLIC_KEY) {
		return res.status(503).json({
			success: false,
			error: 'Push notifications not configured'
		});
	}
	res.json({
		success: true,
		publicKey: VAPID_PUBLIC_KEY
	});
});

/**
 * POST /notifications/subscribe
 * Subscribe to push notifications
 */
router.post('/notifications/subscribe', authWrapper, (req, res) => {
	const { subscription } = req.body;

	if (!subscription || !subscription.endpoint || !subscription.keys) {
		return res.status(400).json({
			success: false,
			error: 'Invalid subscription object'
		});
	}

	try {
		const userAgent = req.headers['user-agent'];
		analyticsDb.savePushSubscription(req.session.userId, subscription, userAgent);

		logger.log('push:subscriptionSaved', { username: req.session.username });
		logActivity('push_subscribe', 'system', 'Push notifications enabled', req.session.username);

		res.json({
			success: true,
			message: 'Subscription saved successfully'
		});
	} catch (error) {
		logger.error('push:saveSubscription', error, { username: req.session.username });
		res.status(500).json({
			success: false,
			error: error.message
		});
	}
});

/**
 * DELETE /notifications/unsubscribe
 * Unsubscribe from push notifications
 */
router.delete('/notifications/unsubscribe', authWrapper, (req, res) => {
	const { endpoint } = req.body;

	try {
		if (endpoint) {
			analyticsDb.deletePushSubscription(endpoint);
		} else {
			analyticsDb.deleteUserPushSubscriptions(req.session.userId);
		}

		logger.log('push:subscriptionRemoved', { username: req.session.username });
		logActivity('push_unsubscribe', 'system', 'Push notifications disabled', req.session.username);

		res.json({
			success: true,
			message: 'Unsubscribed successfully'
		});
	} catch (error) {
		logger.error('push:removeSubscription', error, { username: req.session.username });
		res.status(500).json({
			success: false,
			error: error.message
		});
	}
});

/**
 * GET /notifications/preferences
 * Get notification preferences
 */
router.get('/notifications/preferences', authWrapper, (req, res) => {
	try {
		const preferences = analyticsDb.getNotificationPreferences(req.session.userId);
		const subscriptions = analyticsDb.getPushSubscriptions(req.session.userId);

		res.json({
			success: true,
			preferences,
			subscriptionCount: subscriptions.length,
			isSubscribed: subscriptions.length > 0
		});
	} catch (error) {
		logger.error('push:getPreferences', error, { userId: req.session.userId });
		res.status(500).json({
			success: false,
			error: error.message
		});
	}
});

/**
 * PUT /notifications/preferences
 * Update notification preferences
 */
router.put('/notifications/preferences', authWrapper, (req, res) => {
	const preferences = req.body;

	try {
		analyticsDb.saveNotificationPreferences(req.session.userId, preferences);

		logger.log('push:preferencesUpdated', { username: req.session.username });

		res.json({
			success: true,
			message: 'Preferences saved successfully'
		});
	} catch (error) {
		logger.error('push:savePreferences', error, { userId: req.session.userId });
		res.status(500).json({
			success: false,
			error: error.message
		});
	}
});

/**
 * POST /notifications/test
 * Send test notification
 */
router.post('/notifications/test', authWrapper, async (req, res) => {
	try {
		const subscriptions = analyticsDb.getPushSubscriptions(req.session.userId);

		if (subscriptions.length === 0) {
			return res.status(400).json({
				success: false,
				error: 'No push subscriptions found. Please enable notifications first.'
			});
		}

		const payload = {
			title: 'Tournament Control Center',
			body: 'Push notifications are working!',
			icon: '/icons/icon-192.png',
			badge: '/icons/badge-72.png',
			tag: 'test-notification',
			data: {
				type: 'test',
				timestamp: new Date().toISOString()
			}
		};

		let sent = 0;
		for (const sub of subscriptions) {
			const result = await sendPushNotification(sub, payload);
			if (result.success) sent++;
		}

		res.json({
			success: true,
			message: `Test notification sent to ${sent} device(s)`
		});
	} catch (error) {
		logger.error('push:sendTestNotification', error, { userId: req.session.userId });
		res.status(500).json({
			success: false,
			error: error.message
		});
	}
});

// ============================================
// WEBSOCKET STATUS ENDPOINT
// ============================================

/**
 * GET /websocket/status
 * Get WebSocket connection status
 */
router.get('/websocket/status', authWrapper, (req, res) => {
	res.json({
		success: true,
		...getWebSocketStatus()
	});
});

// ============================================
// MATCH DATA ENDPOINTS
// ============================================

/**
 * POST /matches/force-update
 * Force update match data - fetches from Challonge and pushes to displays
 */
router.post('/matches/force-update', authWrapper, async (req, res) => {
	try {
		logger.log('matches:forceUpdate', { triggeredBy: req.session.username });
		await fetchAndPushMatches();

		const cacheInfo = matchDataCache.timestamp ? {
			lastUpdate: matchDataCache.timestamp,
			tournamentId: matchDataCache.tournamentId
		} : null;

		res.json({
			success: true,
			message: 'Match data refreshed and pushed to displays',
			cache: cacheInfo,
			pollingActive: matchPollingState.isPolling
		});
	} catch (error) {
		logger.error('matches:forceUpdate', error, { triggeredBy: req.session.username });
		res.status(500).json({
			success: false,
			error: error.message
		});
	}
});

/**
 * GET /matches/cache-status
 * Get match cache status
 */
router.get('/matches/cache-status', authWrapper, (req, res) => {
	const stateFile = process.env.MATCH_STATE_FILE || '/root/tcc-custom/admin-dashboard/tournament-state.json';
	let tournamentId = null;

	try {
		const fsSync = require('fs');
		const data = fsSync.readFileSync(stateFile, 'utf8');
		const state = JSON.parse(data);
		tournamentId = state.tournamentId;
	} catch (error) {
		// No tournament configured
	}

	const cacheData = tournamentId ? getMatchDataCache(tournamentId) : null;

	res.json({
		success: true,
		hasCache: !!cacheData,
		cacheTimestamp: matchDataCache.timestamp,
		cacheTournamentId: matchDataCache.tournamentId,
		isStale: cacheData?.isStale || false,
		cacheAgeMs: cacheData?.cacheAgeMs || null,
		pollingActive: matchPollingState.isPolling,
		lastPollTime: matchPollingState.lastPollTime
	});
});

// ============================================
// BRACKET CONTROL PROXY ENDPOINTS
// ============================================

/**
 * GET /bracket/status
 * Get bracket status (proxied from bracket module)
 */
router.get('/bracket/status', async (req, res) => {
	try {
		const response = await axios.get(
			`${process.env.BRACKET_API_URL}/api/bracket/status`,
			{ timeout: 5000 }
		);
		res.json(response.data);
	} catch (error) {
		logger.error('bracket:getStatus', error);
		res.status(500).json({
			success: false,
			error: 'Failed to get bracket status',
			details: error.response ? error.response.data : error.message
		});
	}
});

/**
 * POST /bracket/zoom
 * Set bracket zoom level
 */
router.post('/bracket/zoom', async (req, res) => {
	const { zoomScale, animationDuration } = req.body;

	if (zoomScale === undefined || zoomScale === null) {
		return res.status(400).json({
			success: false,
			error: 'Missing zoomScale parameter'
		});
	}

	try {
		const response = await axios.post(
			`${process.env.BRACKET_API_URL}/api/bracket/zoom`,
			{ zoomScale, animationDuration },
			{ timeout: 5000 }
		);
		res.json(response.data);
	} catch (error) {
		logger.error('bracket:zoom', error, { zoomScale });
		res.status(500).json({
			success: false,
			error: 'Failed to set bracket zoom',
			details: error.response ? error.response.data : error.message
		});
	}
});

/**
 * POST /bracket/focus
 * Focus on a specific match
 */
router.post('/bracket/focus', async (req, res) => {
	const { matchIdentifier, zoomScale, animationDuration } = req.body;

	if (matchIdentifier === undefined || matchIdentifier === null) {
		return res.status(400).json({
			success: false,
			error: 'Missing matchIdentifier parameter'
		});
	}

	try {
		const response = await axios.post(
			`${process.env.BRACKET_API_URL}/api/bracket/focus`,
			{ matchIdentifier, zoomScale, animationDuration },
			{ timeout: 5000 }
		);
		res.json(response.data);
	} catch (error) {
		logger.error('bracket:focus', error, { matchIdentifier });
		res.status(500).json({
			success: false,
			error: 'Failed to focus on match',
			details: error.response ? error.response.data : error.message
		});
	}
});

/**
 * POST /bracket/reset
 * Reset bracket view to default
 */
router.post('/bracket/reset', async (req, res) => {
	const { animationDuration } = req.body;

	try {
		const response = await axios.post(
			`${process.env.BRACKET_API_URL}/api/bracket/reset`,
			{ animationDuration },
			{ timeout: 5000 }
		);
		res.json(response.data);
	} catch (error) {
		logger.error('bracket:reset', error);
		res.status(500).json({
			success: false,
			error: 'Failed to reset bracket view',
			details: error.response ? error.response.data : error.message
		});
	}
});

/**
 * POST /bracket/control
 * Generic bracket control (for advanced commands)
 */
router.post('/bracket/control', async (req, res) => {
	const { command } = req.body;

	if (!command) {
		return res.status(400).json({
			success: false,
			error: 'Missing command parameter'
		});
	}

	try {
		const response = await axios.post(
			`${process.env.BRACKET_API_URL}/api/bracket/control`,
			req.body,
			{ timeout: 5000 }
		);
		res.json(response.data);
	} catch (error) {
		logger.error('bracket:control', error, { command: req.body.command });
		res.status(500).json({
			success: false,
			error: 'Failed to send bracket control command',
			details: error.response ? error.response.data : error.message
		});
	}
});

// ============================================
// TICKER MESSAGE ENDPOINT
// ============================================

/**
 * POST /ticker/send
 * Send ticker message to match display
 */
router.post('/ticker/send', tokenOrSessionWrapper, async (req, res) => {
	const { message, duration } = req.body;

	if (!message || typeof message !== 'string' || message.trim().length === 0) {
		return res.status(400).json({
			success: false,
			error: 'Message is required'
		});
	}

	const tickerDuration = parseInt(duration, 10) || 5;
	if (tickerDuration < 3 || tickerDuration > 30) {
		return res.status(400).json({
			success: false,
			error: 'Duration must be between 3 and 30 seconds'
		});
	}

	const trimmedMessage = message.trim().substring(0, 200);

	// Broadcast via WebSocket (real-time)
	broadcastTickerMessage(trimmedMessage, tickerDuration);

	// Also send via HTTP for backward compatibility
	try {
		await axios.post(
			`${process.env.MATCH_API_URL}/api/ticker/message`,
			{
				message: trimmedMessage,
				duration: tickerDuration
			},
			{ timeout: 5000 }
		);
	} catch (httpError) {
		// HTTP failed but WebSocket broadcast succeeded - this is OK
		logger.warn('ticker:httpFallbackFailed', { error: httpError.message });
	}

	res.json({
		success: true,
		message: 'Ticker message sent via WebSocket',
		data: { message: trimmedMessage, duration: tickerDuration }
	});
});

// ============================================
// AUDIO ANNOUNCEMENT ENDPOINT
// ============================================

/**
 * POST /audio/announce
 * Send text-to-speech announcement to match display
 */
router.post('/audio/announce', authWrapper, async (req, res) => {
	const { text, voice, rate, volume } = req.body;

	if (!text || typeof text !== 'string' || text.trim().length === 0) {
		return res.status(400).json({
			success: false,
			error: 'Text is required'
		});
	}

	const trimmedText = text.trim().substring(0, 500);

	// Broadcast via WebSocket (real-time)
	io.emit('audio:announce', {
		text: trimmedText,
		voice: voice || 'default',
		rate: Math.min(Math.max(parseFloat(rate) || 1.0, 0.5), 2.0),
		volume: Math.min(Math.max(parseFloat(volume) || 1.0, 0.0), 1.0),
		timestamp: new Date().toISOString()
	});

	// Also send via HTTP to match display
	try {
		await axios.post(
			`${process.env.MATCH_API_URL}/api/audio/announce`,
			{
				text: trimmedText,
				voice: voice || 'default',
				rate: parseFloat(rate) || 1.0,
				volume: parseFloat(volume) || 1.0
			},
			{ timeout: 5000 }
		);
	} catch (httpError) {
		// HTTP failed but WebSocket broadcast succeeded - this is OK
		logger.warn('audio:httpFallbackFailed', { error: httpError.message });
	}

	if (logActivity) {
		logActivity({
			action: 'audio_announcement',
			details: `Audio: "${trimmedText.substring(0, 50)}..."`,
			user: req.session?.user?.username || 'unknown'
		});
	}

	res.json({
		success: true,
		message: 'Audio announcement triggered',
		data: { text: trimmedText }
	});
});

// ============================================
// TIMER ENDPOINTS
// ============================================

/**
 * POST /timer/dq
 * Start a DQ timer for a specific TV (TV 1 or TV 2)
 */
router.post('/timer/dq', authWrapper, async (req, res) => {
	const { tv, duration, tournamentId, matchId, playerId, playerName } = req.body;

	// Validate TV parameter
	if (!tv || (tv !== 'TV 1' && tv !== 'TV 2')) {
		return res.status(400).json({
			success: false,
			error: 'TV must be "TV 1" or "TV 2"'
		});
	}

	// Get default duration from settings
	const dqSettings = getDQTimerSettings();
	const timerDuration = parseInt(duration, 10) || dqSettings.defaultDuration || 180;
	if (timerDuration < 10 || timerDuration > 600) {
		return res.status(400).json({
			success: false,
			error: 'Duration must be between 10 and 600 seconds'
		});
	}

	logger.log('timer:dq:start', { tv, duration: timerDuration, matchId, playerId, playerName });

	// If enhanced params provided, use server-side timer management
	if (tournamentId && matchId) {
		startServerDQTimer(tournamentId, matchId, tv, timerDuration, playerId, playerName);
	}

	// Broadcast via WebSocket (for display)
	io.emit('timer:dq', {
		tv: tv,
		duration: timerDuration,
		action: 'start',
		matchId: matchId || null,
		playerName: playerName || null,
		timestamp: new Date().toISOString()
	});

	// Also send via HTTP for backward compatibility
	try {
		await axios.post(
			`${process.env.MATCH_API_URL}/api/timer/dq`,
			{ tv, duration: timerDuration, action: 'start' },
			{ timeout: 5000 }
		);
	} catch (httpError) {
		logger.warn('timer:dq:httpFallbackFailed', { error: httpError.message });
	}

	res.json({
		success: true,
		message: `DQ timer started for ${tv}`,
		data: { tv, duration: timerDuration, matchId, playerName }
	});
});

/**
 * GET /timer/dq/active
 * Get active DQ timers
 */
router.get('/timer/dq/active', authWrapper, (req, res) => {
	const timers = getActiveDQTimers();
	res.json({
		success: true,
		timers,
		count: timers.length
	});
});

/**
 * DELETE /timer/dq/:key
 * Cancel a specific DQ timer
 */
router.delete('/timer/dq/:key', authWrapper, (req, res) => {
	const { key } = req.params;

	// URL decode the key (it may contain colons)
	const decodedKey = decodeURIComponent(key);

	if (cancelDQTimer(decodedKey)) {
		res.json({
			success: true,
			message: 'DQ timer cancelled'
		});
	} else {
		res.status(404).json({
			success: false,
			error: 'Timer not found'
		});
	}
});

/**
 * POST /timer/tournament
 * Start the tournament-wide timer (large timer between TVs and Up Next)
 */
router.post('/timer/tournament', authWrapper, async (req, res) => {
	const { duration } = req.body;

	// Validate duration
	const timerDuration = parseInt(duration, 10);
	if (!timerDuration || timerDuration < 10 || timerDuration > 3600) {
		return res.status(400).json({
			success: false,
			error: 'Duration must be between 10 and 3600 seconds (1 hour max)'
		});
	}

	logger.log('timer:tournament:start', { duration: timerDuration });

	// Broadcast via WebSocket
	io.emit('timer:tournament', {
		duration: timerDuration,
		action: 'start',
		timestamp: new Date().toISOString()
	});

	// Also send via HTTP for backward compatibility
	try {
		await axios.post(
			`${process.env.MATCH_API_URL}/api/timer/tournament`,
			{ duration: timerDuration, action: 'start' },
			{ timeout: 5000 }
		);
	} catch (httpError) {
		logger.warn('timer:tournament:httpFallbackFailed', { error: httpError.message });
	}

	res.json({
		success: true,
		message: 'Tournament timer started',
		data: { duration: timerDuration }
	});
});

/**
 * POST /timer/hide
 * Hide/stop a timer
 */
router.post('/timer/hide', authWrapper, async (req, res) => {
	const { type, tv } = req.body;

	// Validate type parameter
	if (!type || (type !== 'dq' && type !== 'tournament' && type !== 'all')) {
		return res.status(400).json({
			success: false,
			error: 'Type must be "dq", "tournament", or "all"'
		});
	}

	// For DQ timers, tv is required
	if (type === 'dq' && (!tv || (tv !== 'TV 1' && tv !== 'TV 2'))) {
		return res.status(400).json({
			success: false,
			error: 'For DQ timers, TV must be "TV 1" or "TV 2"'
		});
	}

	logger.log('timer:hide', { type, tv });

	// Broadcast via WebSocket
	io.emit('timer:hide', {
		type: type,
		tv: tv || null,
		timestamp: new Date().toISOString()
	});

	// Also send via HTTP for backward compatibility
	try {
		await axios.post(
			`${process.env.MATCH_API_URL}/api/timer/hide`,
			{ type, tv },
			{ timeout: 5000 }
		);
	} catch (httpError) {
		logger.warn('timer:hide:httpFallbackFailed', { error: httpError.message });
	}

	res.json({
		success: true,
		message: `Timer hidden: ${type}${tv ? ` (${tv})` : ''}`,
		data: { type, tv }
	});
});

// ============================================
// QR CODE ENDPOINTS
// ============================================

/**
 * GET /qr/generate
 * Generate QR code as data URL
 */
router.get('/qr/generate', authWrapper, async (req, res) => {
	const { url, size = 300 } = req.query;

	if (!url) {
		return res.status(400).json({
			success: false,
			error: 'URL parameter is required'
		});
	}

	try {
		const qrDataUrl = await QRCode.toDataURL(url, {
			width: parseInt(size, 10),
			margin: 2,
			color: {
				dark: '#000000',
				light: '#ffffff'
			}
		});

		res.json({
			success: true,
			qrCode: qrDataUrl,
			url: url
		});
	} catch (error) {
		logger.error('qr:generate', error, { url });
		res.status(500).json({
			success: false,
			error: 'Failed to generate QR code'
		});
	}
});

/**
 * POST /qr/show
 * Show QR code on match display
 */
router.post('/qr/show', authWrapper, async (req, res) => {
	const { url, label, duration } = req.body;

	if (!url) {
		return res.status(400).json({
			success: false,
			error: 'URL is required'
		});
	}

	// Generate QR code as data URL
	let qrDataUrl;
	try {
		qrDataUrl = await QRCode.toDataURL(url, {
			width: 400,
			margin: 2,
			color: {
				dark: '#000000',
				light: '#ffffff'
			}
		});
	} catch (error) {
		logger.error('qr:show:generate', error, { url });
		return res.status(500).json({
			success: false,
			error: 'Failed to generate QR code'
		});
	}

	const qrDuration = duration ? Math.min(Math.max(duration, 10), 300) : null; // 10s-5min, or null for permanent
	const userId = req.session?.userId;

	// Broadcast via WebSocket (multi-tenant)
	const qrPayload = {
		qrCode: qrDataUrl,
		url: url,
		label: label || 'Scan to Join',
		duration: qrDuration,
		timestamp: new Date().toISOString()
	};

	if (userId) {
		io.to(`user:${userId}`).emit('qr:show', qrPayload);
		logger.log('qr:show', `User-targeted to user:${userId}`);
	} else {
		io.emit('qr:show', qrPayload);
		logger.log('qr:show', 'Global broadcast');
	}

	// Also send via HTTP for backward compatibility
	try {
		await axios.post(
			`${process.env.MATCH_API_URL}/api/qr/show`,
			{ qrCode: qrDataUrl, url, label: label || 'Scan to Join', duration: qrDuration },
			{ timeout: 5000 }
		);
	} catch (httpError) {
		logger.warn('qr:show:httpFallbackFailed', { error: httpError.message });
	}

	res.json({
		success: true,
		message: 'QR code displayed on match screen',
		data: { url, label, duration: qrDuration }
	});
});

/**
 * POST /qr/hide
 * Hide QR code from match display
 */
router.post('/qr/hide', authWrapper, async (req, res) => {
	const userId = req.session?.userId;

	// Broadcast via WebSocket (multi-tenant)
	const hidePayload = { timestamp: new Date().toISOString() };

	if (userId) {
		io.to(`user:${userId}`).emit('qr:hide', hidePayload);
		logger.log('qr:hide', `User-targeted to user:${userId}`);
	} else {
		io.emit('qr:hide', hidePayload);
		logger.log('qr:hide', 'Global broadcast');
	}

	// Also send via HTTP for backward compatibility
	try {
		await axios.post(
			`${process.env.MATCH_API_URL}/api/qr/hide`,
			{},
			{ timeout: 5000 }
		);
	} catch (httpError) {
		logger.warn('qr:hide:httpFallbackFailed', { error: httpError.message });
	}

	res.json({
		success: true,
		message: 'QR code hidden'
	});
});

// ============================================
// EMERGENCY MODE (PANIC BUTTON)
// ============================================

/**
 * GET /emergency/status
 * Get current emergency mode status
 */
router.get('/emergency/status', authWrapper, (req, res) => {
	res.json({
		success: true,
		emergency: emergencyModeState
	});
});

/**
 * POST /emergency/activate
 * Activate emergency mode - freezes all displays, pauses timers
 */
router.post('/emergency/activate', authWrapper, async (req, res) => {
	const { reason } = req.body;
	const username = req.session?.user?.username || 'unknown';

	if (emergencyModeState.active) {
		return res.json({
			success: false,
			message: 'Emergency mode is already active'
		});
	}

	emergencyModeState = {
		active: true,
		activatedAt: new Date().toISOString(),
		activatedBy: username,
		reason: reason || 'Emergency stop activated'
	};

	// Broadcast emergency state to all connected clients and displays
	io.emit('emergency:activated', {
		...emergencyModeState,
		timestamp: new Date().toISOString()
	});

	// Cancel all active DQ timers
	const activeTimers = getActiveDQTimers ? getActiveDQTimers() : [];
	for (const timer of activeTimers) {
		if (cancelDQTimer) {
			cancelDQTimer(timer.key);
		}
	}

	// Log activity
	if (logActivity) {
		logActivity(req.session?.userId, username, 'emergency_activated', {
			reason: reason || 'No reason provided'
		});
	}

	logger.warn('emergency:activated', { username, reason: reason || 'No reason provided' });

	res.json({
		success: true,
		message: 'Emergency mode activated - all displays frozen',
		emergency: emergencyModeState
	});
});

/**
 * POST /emergency/deactivate
 * Deactivate emergency mode - resumes normal operation
 */
router.post('/emergency/deactivate', authWrapper, async (req, res) => {
	const username = req.session?.user?.username || 'unknown';

	if (!emergencyModeState.active) {
		return res.json({
			success: false,
			message: 'Emergency mode is not active'
		});
	}

	const previousState = { ...emergencyModeState };

	emergencyModeState = {
		active: false,
		activatedAt: null,
		activatedBy: null,
		reason: null
	};

	// Broadcast emergency deactivation to all clients
	io.emit('emergency:deactivated', {
		deactivatedBy: username,
		previousState,
		timestamp: new Date().toISOString()
	});

	// Log activity
	if (logActivity) {
		logActivity(req.session?.userId, username, 'emergency_deactivated', {
			previousActivatedAt: previousState.activatedAt
		});
	}

	logger.log('emergency:deactivated', { username, previousActivatedAt: previousState.activatedAt });

	res.json({
		success: true,
		message: 'Emergency mode deactivated - normal operation resumed',
		emergency: emergencyModeState
	});
});

// Export emergency state getter for other modules
function getEmergencyState() {
	return emergencyModeState;
}

// ============================================
// SCHEDULED TICKER MESSAGE ENDPOINTS
// ============================================

const tickerScheduler = require('../services/ticker-scheduler');

/**
 * GET /ticker/schedule
 * Get all scheduled ticker messages
 */
router.get('/ticker/schedule', authWrapper, (req, res) => {
	try {
		const messages = tickerScheduler.getScheduledMessages();
		res.json({
			success: true,
			scheduled: messages
		});
	} catch (error) {
		logger.error('ticker:schedule:get', error);
		res.status(500).json({
			success: false,
			error: 'Failed to get scheduled messages'
		});
	}
});

/**
 * POST /ticker/schedule
 * Create a new scheduled ticker message
 */
router.post('/ticker/schedule', authWrapper, (req, res) => {
	const { message, duration, type, scheduledTime, time, days, label, enabled } = req.body;

	if (!message || typeof message !== 'string' || message.trim().length === 0) {
		return res.status(400).json({
			success: false,
			error: 'Message is required'
		});
	}

	if (type === 'once' && !scheduledTime) {
		return res.status(400).json({
			success: false,
			error: 'scheduledTime is required for one-time messages'
		});
	}

	if (type === 'recurring' && !time) {
		return res.status(400).json({
			success: false,
			error: 'time (HH:MM format) is required for recurring messages'
		});
	}

	try {
		const scheduled = tickerScheduler.addScheduledMessage({
			message,
			duration: duration || 5,
			type: type || 'once',
			scheduledTime,
			time,
			days,
			label,
			enabled
		});

		if (logActivity) {
			logActivity({
				action: 'ticker_scheduled',
				details: `Scheduled ticker: "${message.substring(0, 50)}..." (${type || 'once'})`,
				user: req.session?.user?.username || 'unknown'
			});
		}

		res.json({
			success: true,
			message: 'Ticker message scheduled',
			scheduled
		});
	} catch (error) {
		logger.error('ticker:schedule:create', error);
		res.status(500).json({
			success: false,
			error: 'Failed to schedule message'
		});
	}
});

/**
 * PUT /ticker/schedule/:id
 * Update a scheduled ticker message
 */
router.put('/ticker/schedule/:id', authWrapper, (req, res) => {
	const { id } = req.params;
	const updates = req.body;

	try {
		const updated = tickerScheduler.updateScheduledMessage(id, updates);

		if (!updated) {
			return res.status(404).json({
				success: false,
				error: 'Scheduled message not found'
			});
		}

		res.json({
			success: true,
			message: 'Scheduled message updated',
			scheduled: updated
		});
	} catch (error) {
		logger.error('ticker:schedule:update', error, { id: req.params.id });
		res.status(500).json({
			success: false,
			error: 'Failed to update scheduled message'
		});
	}
});

/**
 * DELETE /ticker/schedule/:id
 * Delete a scheduled ticker message
 */
router.delete('/ticker/schedule/:id', authWrapper, (req, res) => {
	const { id } = req.params;

	try {
		const deleted = tickerScheduler.deleteScheduledMessage(id);

		if (!deleted) {
			return res.status(404).json({
				success: false,
				error: 'Scheduled message not found'
			});
		}

		if (logActivity) {
			logActivity({
				action: 'ticker_schedule_deleted',
				details: `Deleted scheduled ticker: ${id}`,
				user: req.session?.user?.username || 'unknown'
			});
		}

		res.json({
			success: true,
			message: 'Scheduled message deleted'
		});
	} catch (error) {
		logger.error('ticker:schedule:delete', error, { id: req.params.id });
		res.status(500).json({
			success: false,
			error: 'Failed to delete scheduled message'
		});
	}
});

/**
 * DELETE /ticker/schedule
 * Clear all scheduled ticker messages
 */
router.delete('/ticker/schedule', authWrapper, (req, res) => {
	try {
		tickerScheduler.clearAllScheduled();

		if (logActivity) {
			logActivity({
				action: 'ticker_schedule_cleared',
				details: 'Cleared all scheduled ticker messages',
				user: req.session?.user?.username || 'unknown'
			});
		}

		res.json({
			success: true,
			message: 'All scheduled messages cleared'
		});
	} catch (error) {
		logger.error('ticker:schedule:clearAll', error);
		res.status(500).json({
			success: false,
			error: 'Failed to clear scheduled messages'
		});
	}
});

// ============================================
// PLATFORM ANNOUNCEMENTS (Public for banner)
// ============================================

/**
 * GET /announcements/active
 * Get active announcements for banner display (available to all authenticated users)
 */
router.get('/announcements/active', authWrapper, (req, res) => {
	try {
		if (!db) {
			return res.json({
				success: true,
				announcements: []
			});
		}

		const sysDb = db.system.getDb();

		const announcements = sysDb.prepare(`
			SELECT id, message, type, created_at, expires_at
			FROM platform_announcements
			WHERE is_active = 1
			  AND (expires_at IS NULL OR expires_at > datetime('now'))
			ORDER BY
				CASE type WHEN 'alert' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
				created_at DESC
		`).all();

		res.json({
			success: true,
			announcements
		});
	} catch (error) {
		logger.error('announcements:active', error);
		res.json({
			success: true,
			announcements: []
		});
	}
});

module.exports = router;
module.exports.init = init;
module.exports.sendPushNotification = sendPushNotification;
module.exports.getEmergencyState = getEmergencyState;
