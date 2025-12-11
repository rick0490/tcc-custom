/**
 * Settings Routes
 *
 * System settings and activity log API endpoints.
 * Extracted from server.js for modularity.
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { requireAuthAPI, requireAdmin } = require('../middleware/auth');
const settings = require('../services/settings');
const activityLogger = require('../services/activity-logger');
const { ACTIVITY_CATEGORIES } = require('../constants');

// Reference to rate limiter (set by init for restarting adaptive scheduler)
let rateLimiter = null;

// Reference to push notification broadcaster (set by init)
let broadcastPushNotification = null;

/**
 * Initialize the settings routes with dependencies
 * @param {Object} options - Configuration options
 * @param {Object} options.rateLimiter - Rate limiter service for adaptive mode restart
 * @param {Function} options.broadcastPushNotification - Push notification broadcaster
 */
function init({ rateLimiter: rl, broadcastPushNotification: broadcast }) {
	rateLimiter = rl;
	broadcastPushNotification = broadcast;
}

// ============================================
// SYSTEM SETTINGS API ENDPOINTS (ADMIN ONLY)
// ============================================

/**
 * GET /api/settings/system
 * Get all system settings
 */
router.get('/system', requireAuthAPI, requireAdmin, (req, res) => {
	const systemSettings = settings.loadSystemSettings();

	if (!systemSettings) {
		return res.status(500).json({
			success: false,
			error: 'Failed to load settings'
		});
	}

	// Don't send sensitive data like passwords
	const safeSettings = { ...systemSettings };
	if (safeSettings.notifications?.email?.smtpPassword) {
		safeSettings.notifications.email.smtpPassword = '********';
	}

	res.json({
		success: true,
		settings: safeSettings
	});
});

/**
 * PUT /api/settings/system
 * Update system settings
 */
router.put('/system', requireAuthAPI, requireAdmin, (req, res) => {
	const { section, data } = req.body;

	if (!section || !data) {
		return res.status(400).json({
			success: false,
			error: 'Section and data are required'
		});
	}

	const systemSettings = settings.loadSystemSettings();
	if (!systemSettings) {
		return res.status(500).json({
			success: false,
			error: 'Failed to load settings'
		});
	}

	// Update the specific section
	systemSettings[section] = data;

	if (!settings.saveSystemSettings(systemSettings)) {
		return res.status(500).json({
			success: false,
			error: 'Failed to save settings'
		});
	}

	// Clear settings cache so changes take effect immediately
	settings.clearSettingsCache();

	// Restart adaptive rate scheduler if challonge settings changed
	if (section === 'challonge' && rateLimiter) {
		console.log('[Settings] Challonge settings updated, restarting adaptive rate scheduler...');
		rateLimiter.startAdaptiveRateScheduler();
	}

	// Log activity
	activityLogger.logActivity(req.session.userId, req.session.username, 'update_settings', {
		section,
		changes: Object.keys(data)
	});

	res.json({
		success: true,
		message: 'Settings updated successfully'
	});
});

/**
 * GET /api/settings/activity-log
 * Get activity log
 */
router.get('/activity-log', requireAuthAPI, requireAdmin, (req, res) => {
	const limit = parseInt(req.query.limit) || 100;
	const offset = parseInt(req.query.offset) || 0;

	const logData = settings.loadActivityLog();
	const logs = logData.logs.slice(offset, offset + limit);

	res.json({
		success: true,
		logs,
		total: logData.logs.length,
		limit,
		offset
	});
});

/**
 * DELETE /api/settings/activity-log
 * Clear activity log
 */
router.delete('/activity-log', requireAuthAPI, requireAdmin, (req, res) => {
	settings.saveActivityLog({ logs: [] });

	activityLogger.logActivity(req.session.userId, req.session.username, 'clear_activity_log', {});

	res.json({
		success: true,
		message: 'Activity log cleared'
	});
});

/**
 * POST /api/settings/change-password
 * Change own password
 */
router.post('/change-password', requireAuthAPI, async (req, res) => {
	const { currentPassword, newPassword } = req.body;

	if (!currentPassword || !newPassword) {
		return res.status(400).json({
			success: false,
			error: 'Current password and new password are required'
		});
	}

	const usersData = settings.loadUsers();
	const user = usersData.users.find(u => u.id === req.session.userId);

	if (!user) {
		return res.status(404).json({
			success: false,
			error: 'User not found'
		});
	}

	// Verify current password
	const passwordMatch = await bcrypt.compare(currentPassword, user.password);
	if (!passwordMatch) {
		return res.status(401).json({
			success: false,
			error: 'Current password is incorrect'
		});
	}

	// Validate new password
	const passwordValidation = settings.validatePassword(newPassword);
	if (!passwordValidation.valid) {
		return res.status(400).json({
			success: false,
			error: passwordValidation.errors.join('. ')
		});
	}

	// Hash and save new password
	const hashedPassword = await bcrypt.hash(newPassword, 10);
	user.password = hashedPassword;
	settings.saveUsers(usersData);

	res.json({
		success: true,
		message: 'Password changed successfully'
	});
});

/**
 * GET /api/settings/defaults
 * Get system defaults (for pre-filling tournament form)
 */
router.get('/defaults', requireAuthAPI, (req, res) => {
	const defaults = settings.getSystemDefaults();
	const securitySettings = settings.getSecuritySettings();

	res.json({
		success: true,
		defaults: {
			registrationWindow: defaults.registrationWindow,
			signupCap: defaults.signupCap,
			defaultGame: defaults.defaultGame,
			tournamentType: defaults.tournamentType
		},
		security: {
			passwordMinLength: securitySettings.passwordMinLength,
			requirePasswordComplexity: securitySettings.requirePasswordComplexity
		}
	});
});

// ============================================
// LIVE ACTIVITY FEED API ENDPOINTS
// ============================================

/**
 * GET /api/activity
 * Paginated activity with filtering
 * Query params: ?limit=50&offset=0&category=all&search=
 */
router.get('/activity', requireAuthAPI, (req, res) => {
	const limit = Math.min(parseInt(req.query.limit) || 50, 100);
	const offset = parseInt(req.query.offset) || 0;
	const category = req.query.category || 'all';
	const search = (req.query.search || '').toLowerCase().trim();

	const logData = settings.loadActivityLog();
	let filtered = logData.logs;

	// Filter by category
	if (category !== 'all' && ACTIVITY_CATEGORIES[category]) {
		filtered = filtered.filter(entry =>
			ACTIVITY_CATEGORIES[category].includes(entry.action)
		);
	}

	// Filter by search (player name, username, action, tournament name)
	if (search) {
		filtered = filtered.filter(entry => {
			const playerName = (entry.details?.playerName || '').toLowerCase();
			const tournamentName = (entry.details?.tournamentName || entry.details?.name || '').toLowerCase();
			const username = (entry.username || '').toLowerCase();
			const action = (entry.action || '').toLowerCase();
			return username.includes(search) ||
				action.includes(search) ||
				playerName.includes(search) ||
				tournamentName.includes(search);
		});
	}

	const total = filtered.length;
	const paginated = filtered.slice(offset, offset + limit);

	res.json({
		success: true,
		activity: paginated,
		pagination: {
			total,
			limit,
			offset,
			hasMore: offset + limit < total
		}
	});
});

/**
 * POST /api/activity/external
 * Webhook for external event sources (signup PWA, etc.)
 * Uses X-Activity-Token header for authentication (no session required)
 */
router.post('/activity/external', (req, res) => {
	// Validate activity webhook token
	const authToken = req.headers['x-activity-token'];
	const expectedToken = process.env.ACTIVITY_WEBHOOK_TOKEN || 'default-activity-token-change-me';

	if (!authToken || authToken !== expectedToken) {
		return res.status(401).json({
			success: false,
			error: 'Invalid or missing activity token'
		});
	}

	const { action, details, source } = req.body;

	if (!action) {
		return res.status(400).json({
			success: false,
			error: 'Action is required'
		});
	}

	// Log with source indicator (userId = 0 for external sources)
	activityLogger.logActivity(0, source || 'External', action, {
		...details,
		source: source || 'external'
	});

	// Send push notification for new signups
	if ((action === 'participant_signup' || action === 'new_signup') && broadcastPushNotification) {
		const participantName = details?.name || details?.participantName || 'New participant';
		const tournamentName = details?.tournament || details?.tournamentName || '';
		broadcastPushNotification('new_signup', {
			title: 'New Signup',
			body: tournamentName ? `${participantName} signed up for ${tournamentName}` : `${participantName} signed up`,
			data: {
				type: 'new_signup',
				participantName,
				tournamentName,
				...details
			}
		}).catch(err => console.error('[Push] Signup notification error:', err.message));
	}

	res.json({
		success: true,
		message: 'Activity logged successfully'
	});
});

module.exports = router;
module.exports.init = init;
