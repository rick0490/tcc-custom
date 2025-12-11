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

// Dependencies injected via init()
let activityLogger = null;
let matchPolling = null;
let pushNotifications = null;

// Displays file path
const DISPLAYS_FILE = path.join(__dirname, '..', 'displays.json');

/**
 * Initialize displays routes with dependencies
 */
function init(deps) {
	activityLogger = deps.activityLogger;
	matchPolling = deps.matchPolling;
	pushNotifications = deps.pushNotifications;
}

// Load displays from file
function loadDisplays() {
	try {
		const data = fsSync.readFileSync(DISPLAYS_FILE, 'utf8');
		return JSON.parse(data);
	} catch (error) {
		console.error('Error loading displays:', error);
		return { displays: [], viewMappings: {} };
	}
}

// Save displays to file
function saveDisplays(displaysData) {
	try {
		fsSync.writeFileSync(DISPLAYS_FILE, JSON.stringify(displaysData, null, 2));
		return true;
	} catch (error) {
		console.error('Error saving displays:', error);
		return false;
	}
}

// ============================================
// POST /api/displays/register - Register new display
// No auth required - Pi's register automatically
// ============================================
router.post('/register', async (req, res) => {
	const { hostname, mac, ip, currentView } = req.body;

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
				debugLogs: []
			};
			displaysData.displays.push(display);
		}

		saveDisplays(displaysData);

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
	const { uptimeSeconds, cpuTemp, memoryUsage, currentView, wifiQuality, wifiSignal, ip, externalIp, ssid, voltage, mac, hostname } = req.body;

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
// GET /api/displays - List all displays
// Requires authentication
// ============================================
router.get('/', async (req, res) => {
	try {
		const displaysData = loadDisplays();
		const now = new Date();

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

					// Send push notification
					if (pushNotifications && pushNotifications.broadcastPushNotification) {
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
						}).catch(err => console.error('[Push] Display offline notification error:', err.message));
					}
				}
			}
		});

		saveDisplays(displaysData);

		res.json({
			success: true,
			displays: displaysData.displays
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
		const display = displaysData.displays.find(d => d.id === id);

		if (!display) {
			return res.status(404).json({
				success: false,
				error: 'Display not found'
			});
		}

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
// ============================================
router.post('/:id/reboot', async (req, res) => {
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
// ============================================
router.post('/:id/shutdown', async (req, res) => {
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
// ============================================
router.post('/:id/debug', async (req, res) => {
	const { id } = req.params;
	const { enabled } = req.body;

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
// ============================================
router.get('/:id/logs', async (req, res) => {
	const { id } = req.params;
	const { limit = 100, offset = 0, level, source } = req.query;

	try {
		const displaysData = loadDisplays();
		const display = displaysData.displays.find(d => d.id === id);

		if (!display) {
			return res.status(404).json({
				success: false,
				error: 'Display not found'
			});
		}

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
// ============================================
router.delete('/:id/logs', async (req, res) => {
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
