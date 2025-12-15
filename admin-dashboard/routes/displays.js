/**
 * Displays Routes
 *
 * Pi display management API endpoints including registration,
 * heartbeats, configuration, reboot/shutdown, and debug logging.
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fsSync = require('fs');
const { ACTIVITY_TYPES } = require('../constants');
const { createLogger } = require('../services/debug-logger');
const systemDb = require('../db/system-db');

const logger = createLogger('routes:displays');

// Dependencies injected via init()
let activityLogger = null;
let matchPolling = null;
let pushNotifications = null;
let io = null;

// Displays file path
const DISPLAYS_FILE = path.join(__dirname, '..', 'displays.json');

// WebSocket event types
const WS_EVENTS = {
	DISPLAY_REGISTERED: 'display:registered',
	DISPLAY_UPDATED: 'display:updated',
	DISPLAY_OFFLINE: 'display:offline',
	// Flyer media control events
	FLYER_CONTROL: 'flyer:control',
	FLYER_VOLUME: 'flyer:volume',
	FLYER_SETTINGS: 'flyer:settings',
	FLYER_PLAYLIST: 'flyer:playlist',
	FLYER_STATUS: 'flyer:status'
};

/**
 * Broadcast display event via WebSocket
 */
function broadcastDisplay(eventType, data = {}) {
	if (io) {
		io.emit(eventType, data);
		io.emit('displays:update', { action: eventType, ...data });
	}
}

/**
 * Verify display ownership for multi-tenant isolation
 * @param {string} displayId - Display ID to check
 * @param {number} userId - User ID from session
 * @param {object} displaysData - Loaded displays data
 * @returns {object} - { display } on success, { error, status } on failure
 */
function verifyDisplayOwnership(displayId, userId, displaysData) {
	const display = displaysData.displays.find(d => d.id === displayId);
	if (!display) {
		return { error: 'Display not found', status: 404 };
	}
	if (display.userId !== userId) {
		return { error: 'Access denied', status: 403 };
	}
	return { display };
}

/**
 * Initialize displays routes with dependencies
 */
function init(deps) {
	activityLogger = deps.activityLogger;
	matchPolling = deps.matchPolling;
	pushNotifications = deps.pushNotifications;
	io = deps.io;
}

// Load displays from file
function loadDisplays() {
	try {
		const data = fsSync.readFileSync(DISPLAYS_FILE, 'utf8');
		return JSON.parse(data);
	} catch (error) {
		logger.error('loadDisplays', error);
		return { displays: [], viewMappings: {} };
	}
}

// Save displays to file
function saveDisplays(displaysData) {
	try {
		fsSync.writeFileSync(DISPLAYS_FILE, JSON.stringify(displaysData, null, 2));
		return true;
	} catch (error) {
		logger.error('saveDisplays', error);
		return false;
	}
}

// ============================================
// POST /api/displays/register - Register new display
// No auth required - Pi's register automatically
// ============================================
router.post('/register', async (req, res) => {
	const { hostname, mac, ip, currentView, userId } = req.body;

	if (!hostname || !mac) {
		return res.status(400).json({
			success: false,
			error: 'Hostname and MAC address are required'
		});
	}

	try {
		const displaysData = loadDisplays();
		const displayId = mac.replace(/:/g, '').toLowerCase();

		let display = displaysData.displays.find(d => d.id === displayId);

		if (display) {
			// Update existing display
			display.hostname = hostname;
			display.ip = ip || display.ip;
			display.currentView = currentView || display.currentView;
			display.lastHeartbeat = new Date().toISOString();
			display.status = 'online';
			// Update userId if provided (allows re-assignment to different tenant)
			if (userId) {
				display.userId = parseInt(userId, 10);
			}
		} else {
			// Create new display
			display = {
				id: displayId,
				hostname: hostname,
				ip: ip || 'Unknown',
				mac: mac,
				currentView: currentView || 'match',
				assignedView: currentView || 'match',
				status: 'online',
				lastHeartbeat: new Date().toISOString(),
				registeredAt: new Date().toISOString(),
				uptimeSeconds: 0,
				systemInfo: {
					cpuTemp: 0,
					memoryUsage: 0
				},
				debugMode: false,
				debugLogs: [],
				userId: userId ? parseInt(userId, 10) : null
			};
			displaysData.displays.push(display);
		}

		saveDisplays(displaysData);

		// Broadcast registration
		broadcastDisplay(WS_EVENTS.DISPLAY_REGISTERED, {
			display: {
				id: displayId,
				hostname,
				ip: display.ip,
				currentView: display.currentView,
				status: 'online'
			}
		});

		const viewConfig = displaysData.viewMappings[display.assignedView] || displaysData.viewMappings.match;

		res.json({
			success: true,
			id: displayId,
			assignedView: display.assignedView,
			config: viewConfig
		});
	} catch (error) {
		console.error('Display registration error:', error);
		res.status(500).json({
			success: false,
			error: 'Failed to register display'
		});
	}
});

// ============================================
// POST /api/displays/:id/heartbeat - Heartbeat from display
// No auth required - Pi's send automatically
// ============================================
router.post('/:id/heartbeat', async (req, res) => {
	const { id } = req.params;
	const { uptimeSeconds, cpuTemp, memoryUsage, currentView, wifiQuality, wifiSignal, ip, externalIp, ssid, voltage, mac, hostname, userId } = req.body;

	try {
		const displaysData = loadDisplays();
		const display = displaysData.displays.find(d => d.id === id);

		if (!display) {
			return res.status(404).json({
				success: false,
				error: 'Display not found'
			});
		}

		const previousView = display.currentView;
		const previousStatus = display.status;

		display.lastHeartbeat = new Date().toISOString();
		display.status = 'online';
		display.currentView = currentView || display.currentView;

		// Log activity if display came online
		if (previousStatus === 'offline' && activityLogger) {
			activityLogger.logActivity(0, 'System', ACTIVITY_TYPES.DISPLAY_ONLINE, {
				displayId: id,
				hostname: display.hostname || hostname || 'Unknown',
				ip: ip || display.ip
			});
		}

		// Trigger match refresh if switched to match view
		if (previousView !== 'match' && currentView === 'match' && matchPolling && matchPolling.fetchAndPushMatches) {
			console.log(`[Match Refresh] Display ${display.hostname} switched to match view`);
			matchPolling.fetchAndPushMatches().catch(err => {
				console.error('[Match Refresh] Failed to push fresh match data:', err.message);
			});
		}

		display.uptimeSeconds = uptimeSeconds || 0;
		if (ip) display.ip = ip;
		if (externalIp) display.externalIp = externalIp;
		if (mac) display.mac = mac;
		if (hostname) display.hostname = hostname;
		// Update userId if provided (allows re-assignment to different tenant)
		if (userId) display.userId = parseInt(userId, 10);
		display.systemInfo = {
			cpuTemp: cpuTemp || 0,
			memoryUsage: memoryUsage || 0,
			wifiQuality: wifiQuality || 0,
			wifiSignal: wifiSignal || 0,
			ssid: ssid || 'Unknown',
			voltage: voltage || 0
		};

		// Store display info for auto-detection (physical dimensions, diagonal, suggested scale)
		const { displayInfo, cdpEnabled } = req.body;
		if (displayInfo) {
			display.displayInfo = {
				physicalWidth: displayInfo.physicalWidth || 0,
				physicalHeight: displayInfo.physicalHeight || 0,
				diagonalInches: displayInfo.diagonalInches || 0,
				suggestedScale: displayInfo.suggestedScale || 1.0,
				detectedAt: new Date().toISOString()
			};
		}

		// Store CDP status
		display.cdpEnabled = cdpEnabled === true || cdpEnabled === 'true';

		saveDisplays(displaysData);

		// Broadcast update if display came online
		if (previousStatus === 'offline') {
			broadcastDisplay(WS_EVENTS.DISPLAY_UPDATED, {
				display: {
					id: display.id,
					hostname: display.hostname,
					status: 'online',
					currentView: display.currentView
				}
			});
		}

		res.json({ success: true });
	} catch (error) {
		console.error('Heartbeat error:', error);
		res.status(500).json({
			success: false,
			error: 'Failed to process heartbeat'
		});
	}
});

// ============================================
// FLYER MEDIA CONTROL ROUTES
// These routes must be defined BEFORE /:id routes to avoid "flyer" being matched as an ID
// ============================================

/**
 * Broadcast flyer media event to user's flyer display
 */
function broadcastFlyerMedia(userId, eventType, data = {}) {
	if (io) {
		io.to(`user:${userId}:flyer`).emit(eventType, { ...data, userId });
		logger.log('broadcastFlyerMedia', { userId, eventType, data });
	}
}

// ============================================
// GET /api/displays/flyer/settings - Get media settings
// Requires authentication
// ============================================
router.get('/flyer/settings', async (req, res) => {
	try {
		const userId = req.session.userId;
		if (!userId) {
			return res.status(401).json({ success: false, error: 'Not authenticated' });
		}

		const settings = systemDb.getOrCreateFlyerMediaSettings(userId);

		// Transform to camelCase for frontend
		res.json({
			success: true,
			settings: {
				loopEnabled: !!settings.loop_enabled,
				autoplayEnabled: !!settings.autoplay_enabled,
				defaultMuted: !!settings.default_muted,
				defaultVolume: settings.default_volume,
				playlistEnabled: !!settings.playlist_enabled,
				playlistLoop: !!settings.playlist_loop,
				playlistAutoAdvance: !!settings.playlist_auto_advance,
				playlistItems: settings.playlistItems || [],
				playlistCurrentIndex: settings.playlist_current_index,
				currentFlyer: settings.current_flyer,
				playbackState: settings.playback_state,
				currentTime: settings.current_time,
				duration: settings.duration,
				isMuted: !!settings.is_muted,
				currentVolume: settings.current_volume
			}
		});
	} catch (error) {
		console.error('Get flyer settings error:', error);
		res.status(500).json({ success: false, error: 'Failed to get flyer settings' });
	}
});

// ============================================
// PUT /api/displays/flyer/settings - Update media settings
// Requires authentication
// ============================================
router.put('/flyer/settings', async (req, res) => {
	try {
		const userId = req.session.userId;
		if (!userId) {
			return res.status(401).json({ success: false, error: 'Not authenticated' });
		}

		const {
			loopEnabled, autoplayEnabled, defaultMuted, defaultVolume,
			playlistEnabled, playlistLoop, playlistAutoAdvance
		} = req.body;

		// Validate volume range
		if (defaultVolume !== undefined && (defaultVolume < 0 || defaultVolume > 100)) {
			return res.status(400).json({ success: false, error: 'Volume must be between 0 and 100' });
		}

		const settings = systemDb.saveFlyerMediaSettings(userId, {
			loopEnabled, autoplayEnabled, defaultMuted, defaultVolume,
			playlistEnabled, playlistLoop, playlistAutoAdvance
		});

		// Broadcast settings update to flyer display
		broadcastFlyerMedia(userId, WS_EVENTS.FLYER_SETTINGS, {
			loop: !!settings.loop_enabled,
			autoplay: !!settings.autoplay_enabled,
			defaultMuted: !!settings.default_muted,
			defaultVolume: settings.default_volume,
			playlistEnabled: !!settings.playlist_enabled,
			playlistLoop: !!settings.playlist_loop,
			playlistAutoAdvance: !!settings.playlist_auto_advance
		});

		if (activityLogger) {
			activityLogger.logActivity(userId, req.session.username, 'flyer_settings_update', {
				loopEnabled, autoplayEnabled, defaultMuted, defaultVolume
			});
		}

		res.json({ success: true, message: 'Settings updated' });
	} catch (error) {
		console.error('Update flyer settings error:', error);
		res.status(500).json({ success: false, error: 'Failed to update settings' });
	}
});

// ============================================
// POST /api/displays/flyer/control - Playback control
// Requires authentication
// Actions: play, pause, restart, mute, unmute
// ============================================
router.post('/flyer/control', async (req, res) => {
	try {
		const userId = req.session.userId;
		if (!userId) {
			return res.status(401).json({ success: false, error: 'Not authenticated' });
		}

		const { action } = req.body;
		const validActions = ['play', 'pause', 'restart', 'mute', 'unmute'];

		if (!action || !validActions.includes(action)) {
			return res.status(400).json({
				success: false,
				error: `Invalid action. Must be one of: ${validActions.join(', ')}`
			});
		}

		// Update state in database
		let stateUpdate = {};
		if (action === 'play') stateUpdate.playbackState = 'playing';
		else if (action === 'pause') stateUpdate.playbackState = 'paused';
		else if (action === 'restart') stateUpdate = { playbackState: 'playing', currentTime: 0 };
		else if (action === 'mute') stateUpdate.isMuted = true;
		else if (action === 'unmute') stateUpdate.isMuted = false;

		if (Object.keys(stateUpdate).length > 0) {
			systemDb.updateFlyerPlaybackState(userId, stateUpdate);
		}

		// Broadcast control command to flyer display
		broadcastFlyerMedia(userId, WS_EVENTS.FLYER_CONTROL, { action });

		if (activityLogger) {
			activityLogger.logActivity(userId, req.session.username, 'flyer_control', { action });
		}

		res.json({ success: true, action });
	} catch (error) {
		console.error('Flyer control error:', error);
		res.status(500).json({ success: false, error: 'Failed to send control command' });
	}
});

// ============================================
// POST /api/displays/flyer/volume - Set volume
// Requires authentication
// ============================================
router.post('/flyer/volume', async (req, res) => {
	try {
		const userId = req.session.userId;
		if (!userId) {
			return res.status(401).json({ success: false, error: 'Not authenticated' });
		}

		const { volume } = req.body;

		if (volume === undefined || volume < 0 || volume > 100) {
			return res.status(400).json({ success: false, error: 'Volume must be between 0 and 100' });
		}

		// Update state in database
		systemDb.updateFlyerPlaybackState(userId, { currentVolume: volume });

		// Broadcast volume to flyer display
		broadcastFlyerMedia(userId, WS_EVENTS.FLYER_VOLUME, { volume });

		res.json({ success: true, volume });
	} catch (error) {
		console.error('Flyer volume error:', error);
		res.status(500).json({ success: false, error: 'Failed to set volume' });
	}
});

// ============================================
// GET /api/displays/flyer/playlist - Get playlist
// Requires authentication
// ============================================
router.get('/flyer/playlist', async (req, res) => {
	try {
		const userId = req.session.userId;
		if (!userId) {
			return res.status(401).json({ success: false, error: 'Not authenticated' });
		}

		const settings = systemDb.getOrCreateFlyerMediaSettings(userId);

		res.json({
			success: true,
			playlist: {
				enabled: !!settings.playlist_enabled,
				loop: !!settings.playlist_loop,
				autoAdvance: !!settings.playlist_auto_advance,
				items: settings.playlistItems || [],
				currentIndex: settings.playlist_current_index
			}
		});
	} catch (error) {
		console.error('Get playlist error:', error);
		res.status(500).json({ success: false, error: 'Failed to get playlist' });
	}
});

// ============================================
// PUT /api/displays/flyer/playlist - Update playlist
// Requires authentication
// ============================================
router.put('/flyer/playlist', async (req, res) => {
	try {
		const userId = req.session.userId;
		if (!userId) {
			return res.status(401).json({ success: false, error: 'Not authenticated' });
		}

		const { items, loop, autoAdvance, enabled } = req.body;

		// Validate items if provided
		if (items !== undefined && !Array.isArray(items)) {
			return res.status(400).json({ success: false, error: 'Items must be an array' });
		}

		// Validate each item has required fields
		if (items) {
			for (const item of items) {
				if (!item.filename) {
					return res.status(400).json({ success: false, error: 'Each item must have a filename' });
				}
				if (item.duration !== undefined && (typeof item.duration !== 'number' || item.duration < 0)) {
					return res.status(400).json({ success: false, error: 'Duration must be a positive number' });
				}
			}
		}

		const settings = systemDb.saveFlyerMediaSettings(userId, {
			playlistItems: items,
			playlistLoop: loop,
			playlistAutoAdvance: autoAdvance,
			playlistEnabled: enabled
		});

		// Broadcast playlist update to flyer display
		broadcastFlyerMedia(userId, WS_EVENTS.FLYER_PLAYLIST, {
			enabled: !!settings.playlist_enabled,
			loop: !!settings.playlist_loop,
			autoAdvance: !!settings.playlist_auto_advance,
			items: settings.playlistItems || [],
			currentIndex: settings.playlist_current_index
		});

		if (activityLogger) {
			activityLogger.logActivity(userId, req.session.username, 'flyer_playlist_update', {
				itemCount: items?.length || 0,
				enabled: !!enabled
			});
		}

		res.json({ success: true, message: 'Playlist updated' });
	} catch (error) {
		console.error('Update playlist error:', error);
		res.status(500).json({ success: false, error: 'Failed to update playlist' });
	}
});

// ============================================
// POST /api/displays/flyer/playlist/control - Playlist navigation
// Requires authentication
// Actions: next, prev, goto, toggle
// ============================================
router.post('/flyer/playlist/control', async (req, res) => {
	try {
		const userId = req.session.userId;
		if (!userId) {
			return res.status(401).json({ success: false, error: 'Not authenticated' });
		}

		const { action, index, enabled } = req.body;
		const validActions = ['next', 'prev', 'goto', 'toggle'];

		if (!action || !validActions.includes(action)) {
			return res.status(400).json({
				success: false,
				error: `Invalid action. Must be one of: ${validActions.join(', ')}`
			});
		}

		const settings = systemDb.getOrCreateFlyerMediaSettings(userId);
		const items = settings.playlistItems || [];
		let currentIndex = settings.playlist_current_index || 0;

		if (action === 'next') {
			currentIndex = (currentIndex + 1) % Math.max(items.length, 1);
		} else if (action === 'prev') {
			currentIndex = currentIndex > 0 ? currentIndex - 1 : Math.max(items.length - 1, 0);
		} else if (action === 'goto') {
			if (index === undefined || index < 0 || index >= items.length) {
				return res.status(400).json({ success: false, error: 'Invalid index' });
			}
			currentIndex = index;
		} else if (action === 'toggle') {
			systemDb.saveFlyerMediaSettings(userId, { playlistEnabled: enabled });
			broadcastFlyerMedia(userId, WS_EVENTS.FLYER_PLAYLIST, {
				enabled: !!enabled,
				loop: !!settings.playlist_loop,
				autoAdvance: !!settings.playlist_auto_advance,
				items: items,
				currentIndex: currentIndex,
				action: 'toggle'
			});
			return res.json({ success: true, action: 'toggle', enabled: !!enabled });
		}

		// Update current index
		systemDb.saveFlyerMediaSettings(userId, { playlistCurrentIndex: currentIndex });

		// Broadcast playlist control to flyer display
		broadcastFlyerMedia(userId, WS_EVENTS.FLYER_PLAYLIST, {
			enabled: !!settings.playlist_enabled,
			loop: !!settings.playlist_loop,
			autoAdvance: !!settings.playlist_auto_advance,
			items: items,
			currentIndex: currentIndex,
			action: action
		});

		res.json({ success: true, action, currentIndex });
	} catch (error) {
		console.error('Playlist control error:', error);
		res.status(500).json({ success: false, error: 'Failed to control playlist' });
	}
});

// ============================================
// POST /api/displays/flyer/status - Status report from display
// No auth - called by flyer display service
// ============================================
router.post('/flyer/status', async (req, res) => {
	try {
		const { userId, filename, state, currentTime, duration, volume, muted, playlistIndex } = req.body;

		if (!userId) {
			return res.status(400).json({ success: false, error: 'userId is required' });
		}

		// Update playback state in database
		systemDb.updateFlyerPlaybackState(userId, {
			currentFlyer: filename,
			playbackState: state,
			currentTime: currentTime,
			duration: duration,
			currentVolume: volume,
			isMuted: muted,
			playlistCurrentIndex: playlistIndex
		});

		// Broadcast status to admin dashboard
		if (io) {
			io.to(`user:${userId}:admin`).emit(WS_EVENTS.FLYER_STATUS, {
				userId,
				filename,
				state,
				currentTime,
				duration,
				volume,
				muted,
				playlistIndex,
				timestamp: new Date().toISOString()
			});
		}

		res.json({ success: true });
	} catch (error) {
		console.error('Flyer status error:', error);
		res.status(500).json({ success: false, error: 'Failed to update status' });
	}
});

// ============================================
// GET /api/displays/:id/config - Get display configuration
// No auth required - Pi's poll automatically
// ============================================
router.get('/:id/config', async (req, res) => {
	const { id } = req.params;

	try {
		const displaysData = loadDisplays();
		const displayIndex = displaysData.displays.findIndex(d => d.id === id);

		if (displayIndex === -1) {
			return res.status(404).json({
				success: false,
				error: 'Display not found'
			});
		}

		const display = displaysData.displays[displayIndex];
		const viewConfig = displaysData.viewMappings[display.assignedView] || displaysData.viewMappings.match;
		const shouldRestart = display.currentView !== display.assignedView;

		// Check for pending command
		let pendingCommand = null;
		if (display.pendingCommand) {
			pendingCommand = display.pendingCommand;
			delete displaysData.displays[displayIndex].pendingCommand;
			saveDisplays(displaysData);
			console.log(`Pending command '${pendingCommand.action}' sent to ${display.hostname}`);
		}

		res.json({
			success: true,
			assignedView: display.assignedView,
			config: viewConfig,
			shouldRestart: shouldRestart,
			pendingCommand: pendingCommand,
			debugMode: display.debugMode || false,
			displayScaleFactor: display.displayScaleFactor || 1.0,
			displayInfo: display.displayInfo || null,
			cdpEnabled: display.cdpEnabled || false
		});
	} catch (error) {
		console.error('Get config error:', error);
		res.status(500).json({
			success: false,
			error: 'Failed to get configuration'
		});
	}
});

// ============================================
// GET /api/displays - List displays for current user
// Requires authentication
// Multi-tenant: Returns only displays belonging to the authenticated user
// ============================================
router.get('/', async (req, res) => {
	try {
		const displaysData = loadDisplays();
		const now = new Date();
		const userId = req.session.userId;

		// Update status for all displays (needed for activity logging)
		displaysData.displays.forEach(display => {
			const lastSeen = new Date(display.lastHeartbeat);
			const timeSinceHeartbeat = now - lastSeen;
			const previousStatus = display.status;

			// Mark as offline if no heartbeat in 90 seconds
			if (timeSinceHeartbeat > 90000) {
				display.status = 'offline';

				if (previousStatus === 'online') {
					if (activityLogger) {
						activityLogger.logActivity(0, 'System', ACTIVITY_TYPES.DISPLAY_OFFLINE, {
							displayId: display.id,
							hostname: display.hostname || 'Unknown',
							lastSeen: display.lastHeartbeat
						});
					}

					// Send push notification only to the display owner
					if (pushNotifications && pushNotifications.broadcastPushNotification && display.userId) {
						pushNotifications.broadcastPushNotification('display_disconnected', {
							title: 'Display Disconnected',
							body: `${display.hostname || 'Display'} (${display.currentView || 'unknown'}) went offline`,
							data: {
								type: 'display_disconnected',
								displayId: display.id,
								hostname: display.hostname,
								currentView: display.currentView,
								lastSeen: display.lastHeartbeat
							}
						}, display.userId).catch(err => console.error('[Push] Display offline notification error:', err.message));
					}
				}
			}
		});

		saveDisplays(displaysData);

		// Filter displays by userId for multi-tenant isolation
		const userDisplays = displaysData.displays.filter(d => d.userId === userId);

		res.json({
			success: true,
			displays: userDisplays
		});
	} catch (error) {
		console.error('List displays error:', error);
		res.status(500).json({
			success: false,
			error: 'Failed to list displays'
		});
	}
});

// ============================================
// PUT /api/displays/:id/config - Update display configuration
// Requires authentication
// Multi-tenant: Verifies display belongs to authenticated user
// ============================================
router.put('/:id/config', async (req, res) => {
	const { id } = req.params;
	const { assignedView, displayScaleFactor } = req.body;

	if (!assignedView && displayScaleFactor === undefined) {
		return res.status(400).json({
			success: false,
			error: 'At least one configuration field is required (assignedView or displayScaleFactor)'
		});
	}

	if (displayScaleFactor !== undefined) {
		const scale = parseFloat(displayScaleFactor);
		if (isNaN(scale) || scale < 0.5 || scale > 3.0) {
			return res.status(400).json({
				success: false,
				error: 'Display scale factor must be between 0.5 and 3.0'
			});
		}
	}

	try {
		const displaysData = loadDisplays();

		// Verify display ownership
		const ownership = verifyDisplayOwnership(id, req.session.userId, displaysData);
		if (ownership.error) {
			return res.status(ownership.status).json({
				success: false,
				error: ownership.error
			});
		}
		const display = ownership.display;

		if (assignedView && !displaysData.viewMappings[assignedView]) {
			return res.status(400).json({
				success: false,
				error: 'Invalid view type'
			});
		}

		let needsRestart = false;

		if (assignedView && assignedView !== display.assignedView) {
			display.assignedView = assignedView;
			needsRestart = true;
		}

		if (displayScaleFactor !== undefined) {
			const newScale = parseFloat(displayScaleFactor);
			if (display.displayScaleFactor !== newScale) {
				display.displayScaleFactor = newScale;
				needsRestart = true;
			}
		}

		if (needsRestart) {
			display.status = 'transitioning';
		}

		saveDisplays(displaysData);

		if (activityLogger) {
			activityLogger.logActivity(
				req.session.userId,
				req.session.username,
				'update_display_config',
				{
					displayId: id,
					hostname: display.hostname,
					assignedView: display.assignedView,
					displayScaleFactor: display.displayScaleFactor
				}
			);
		}

		// CDP-enabled displays can apply scale instantly without restart
		const cdpEnabled = display.cdpEnabled || false;
		const scaleMessage = cdpEnabled ?
			'Scale updated (instant via CDP)' :
			'Display configuration updated. Display will restart.';

		res.json({
			success: true,
			message: needsRestart ? scaleMessage : 'No changes needed.',
			cdpEnabled: cdpEnabled
		});
	} catch (error) {
		console.error('Update display config error:', error);
		res.status(500).json({
			success: false,
			error: 'Failed to update display configuration'
		});
	}
});

// ============================================
// POST /api/displays/:id/reboot - Reboot display
// Requires authentication
// Multi-tenant: Verifies display belongs to authenticated user
// ============================================
router.post('/:id/reboot', async (req, res) => {
	const { id } = req.params;

	try {
		const displaysData = loadDisplays();

		// Verify display ownership
		const ownership = verifyDisplayOwnership(id, req.session.userId, displaysData);
		if (ownership.error) {
			return res.status(ownership.status).json({
				success: false,
				error: ownership.error
			});
		}

		const displayIndex = displaysData.displays.findIndex(d => d.id === id);
		const display = displaysData.displays[displayIndex];

		displaysData.displays[displayIndex].pendingCommand = {
			action: 'reboot',
			queuedAt: new Date().toISOString(),
			queuedBy: req.session.username
		};
		saveDisplays(displaysData);

		console.log(`Reboot command queued for ${display.hostname}`);

		if (activityLogger) {
			activityLogger.logActivity(
				req.session.userId,
				req.session.username,
				'reboot_display',
				{
					displayId: id,
					hostname: display.hostname,
					ip: display.ip
				}
			);
		}

		res.json({
			success: true,
			message: `Reboot command queued for ${display.hostname} (will execute within 10 seconds)`
		});
	} catch (error) {
		console.error('Reboot display error:', error);
		res.status(500).json({
			success: false,
			error: 'Failed to queue reboot command'
		});
	}
});

// ============================================
// POST /api/displays/:id/shutdown - Shutdown display
// Requires authentication
// Multi-tenant: Verifies display belongs to authenticated user
// ============================================
router.post('/:id/shutdown', async (req, res) => {
	const { id } = req.params;

	try {
		const displaysData = loadDisplays();

		// Verify display ownership
		const ownership = verifyDisplayOwnership(id, req.session.userId, displaysData);
		if (ownership.error) {
			return res.status(ownership.status).json({
				success: false,
				error: ownership.error
			});
		}

		const displayIndex = displaysData.displays.findIndex(d => d.id === id);
		const display = displaysData.displays[displayIndex];

		displaysData.displays[displayIndex].pendingCommand = {
			action: 'shutdown',
			queuedAt: new Date().toISOString(),
			queuedBy: req.session.username
		};
		saveDisplays(displaysData);

		console.log(`Shutdown command queued for ${display.hostname}`);

		if (activityLogger) {
			activityLogger.logActivity(
				req.session.userId,
				req.session.username,
				'shutdown_display',
				{
					displayId: id,
					hostname: display.hostname,
					ip: display.ip
				}
			);
		}

		res.json({
			success: true,
			message: `Shutdown command queued for ${display.hostname} (will execute within 10 seconds)`
		});
	} catch (error) {
		console.error('Shutdown display error:', error);
		res.status(500).json({
			success: false,
			error: 'Failed to shutdown display'
		});
	}
});

// ============================================
// POST /api/displays/:id/debug - Toggle debug mode
// Requires authentication
// Multi-tenant: Verifies display belongs to authenticated user
// ============================================
router.post('/:id/debug', async (req, res) => {
	const { id } = req.params;
	const { enabled } = req.body;

	try {
		const displaysData = loadDisplays();

		// Verify display ownership
		const ownership = verifyDisplayOwnership(id, req.session.userId, displaysData);
		if (ownership.error) {
			return res.status(ownership.status).json({
				success: false,
				error: ownership.error
			});
		}

		const displayIndex = displaysData.displays.findIndex(d => d.id === id);
		const display = displaysData.displays[displayIndex];
		const previousState = display.debugMode || false;

		displaysData.displays[displayIndex].debugMode = enabled;

		// Clear logs when disabling
		if (!enabled && previousState) {
			displaysData.displays[displayIndex].debugLogs = [];
		}

		// Initialize debugLogs if enabling
		if (enabled && !displaysData.displays[displayIndex].debugLogs) {
			displaysData.displays[displayIndex].debugLogs = [];
		}

		saveDisplays(displaysData);

		console.log(`Debug mode ${enabled ? 'enabled' : 'disabled'} for ${display.hostname}`);

		if (activityLogger) {
			activityLogger.logActivity(
				req.session.userId,
				req.session.username,
				enabled ? 'enable_debug_mode' : 'disable_debug_mode',
				{
					displayId: id,
					hostname: display.hostname
				}
			);
		}

		res.json({
			success: true,
			debugMode: enabled,
			message: `Debug mode ${enabled ? 'enabled' : 'disabled'} for ${display.hostname}`
		});
	} catch (error) {
		console.error('Toggle debug mode error:', error);
		res.status(500).json({
			success: false,
			error: 'Failed to toggle debug mode'
		});
	}
});

// ============================================
// POST /api/displays/:id/logs - Push debug logs
// No auth required - Pi's push automatically
// ============================================
router.post('/:id/logs', async (req, res) => {
	const { id } = req.params;
	const { logs } = req.body;

	if (!logs || !Array.isArray(logs)) {
		return res.status(400).json({
			success: false,
			error: 'Logs array is required'
		});
	}

	try {
		const displaysData = loadDisplays();
		const displayIndex = displaysData.displays.findIndex(d => d.id === id);

		if (displayIndex === -1) {
			return res.status(404).json({
				success: false,
				error: 'Display not found'
			});
		}

		const display = displaysData.displays[displayIndex];

		// Only accept logs if debug mode is enabled
		if (!display.debugMode) {
			return res.json({
				success: true,
				message: 'Debug mode not enabled, logs ignored',
				debugMode: false
			});
		}

		if (!displaysData.displays[displayIndex].debugLogs) {
			displaysData.displays[displayIndex].debugLogs = [];
		}

		const timestamp = new Date().toISOString();
		const newLogs = logs.map(log => ({
			timestamp: log.timestamp || timestamp,
			level: log.level || 'info',
			source: log.source || 'unknown',
			message: log.message || String(log)
		}));

		displaysData.displays[displayIndex].debugLogs.push(...newLogs);

		// Keep only last 500 entries
		const maxLogs = 500;
		if (displaysData.displays[displayIndex].debugLogs.length > maxLogs) {
			displaysData.displays[displayIndex].debugLogs =
				displaysData.displays[displayIndex].debugLogs.slice(-maxLogs);
		}

		saveDisplays(displaysData);

		res.json({
			success: true,
			logsReceived: logs.length,
			totalLogs: displaysData.displays[displayIndex].debugLogs.length,
			debugMode: true
		});
	} catch (error) {
		console.error('Push debug logs error:', error);
		res.status(500).json({
			success: false,
			error: 'Failed to store debug logs'
		});
	}
});

// ============================================
// GET /api/displays/:id/logs - Get debug logs
// Requires authentication
// Multi-tenant: Verifies display belongs to authenticated user
// ============================================
router.get('/:id/logs', async (req, res) => {
	const { id } = req.params;
	const { limit = 100, offset = 0, level, source } = req.query;

	try {
		const displaysData = loadDisplays();

		// Verify display ownership
		const ownership = verifyDisplayOwnership(id, req.session.userId, displaysData);
		if (ownership.error) {
			return res.status(ownership.status).json({
				success: false,
				error: ownership.error
			});
		}
		const display = ownership.display;

		let logs = display.debugLogs || [];

		if (level) {
			logs = logs.filter(log => log.level === level);
		}

		if (source) {
			logs = logs.filter(log => log.source === source);
		}

		const totalLogs = logs.length;
		logs = logs.slice().reverse().slice(parseInt(offset), parseInt(offset) + parseInt(limit));

		res.json({
			success: true,
			displayId: id,
			hostname: display.hostname,
			debugMode: display.debugMode || false,
			logs: logs,
			totalLogs: totalLogs,
			limit: parseInt(limit),
			offset: parseInt(offset)
		});
	} catch (error) {
		console.error('Get debug logs error:', error);
		res.status(500).json({
			success: false,
			error: 'Failed to retrieve debug logs'
		});
	}
});

// ============================================
// DELETE /api/displays/:id/logs - Clear debug logs
// Requires authentication
// Multi-tenant: Verifies display belongs to authenticated user
// ============================================
router.delete('/:id/logs', async (req, res) => {
	const { id } = req.params;

	try {
		const displaysData = loadDisplays();

		// Verify display ownership
		const ownership = verifyDisplayOwnership(id, req.session.userId, displaysData);
		if (ownership.error) {
			return res.status(ownership.status).json({
				success: false,
				error: ownership.error
			});
		}

		const displayIndex = displaysData.displays.findIndex(d => d.id === id);
		const display = displaysData.displays[displayIndex];
		const logCount = display.debugLogs ? display.debugLogs.length : 0;

		displaysData.displays[displayIndex].debugLogs = [];
		saveDisplays(displaysData);

		if (activityLogger) {
			activityLogger.logActivity(
				req.session.userId,
				req.session.username,
				'clear_debug_logs',
				{
					displayId: id,
					hostname: display.hostname,
					logsCleared: logCount
				}
			);
		}

		res.json({
			success: true,
			message: `Cleared ${logCount} debug logs for ${display.hostname}`
		});
	} catch (error) {
		console.error('Clear debug logs error:', error);
		res.status(500).json({
			success: false,
			error: 'Failed to clear debug logs'
		});
	}
});

module.exports = router;
module.exports.init = init;
