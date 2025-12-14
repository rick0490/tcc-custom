/**
 * Settings Routes
 *
 * System settings and activity log API endpoints.
 * Extracted from server.js for modularity.
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { requireAuthAPI } = require('../middleware/auth');
const settings = require('../services/settings');
const activityLogger = require('../services/activity-logger');
const { ACTIVITY_CATEGORIES } = require('../constants');
const { createLogger } = require('../services/debug-logger');
const systemDb = require('../db/system-db');

const logger = createLogger('routes:settings');

// Reference to Discord notification service (set by init)
let discordNotify = null;

// Reference to rate limiter (set by init for restarting adaptive scheduler)
let rateLimiter = null;

// Reference to push notification broadcaster (set by init)
let broadcastPushNotification = null;

// Reference to Socket.IO server (set by init for real-time broadcasts)
let io = null;

/**
 * Initialize the settings routes with dependencies
 * @param {Object} options - Configuration options
 * @param {Object} options.rateLimiter - Rate limiter service for adaptive mode restart
 * @param {Function} options.broadcastPushNotification - Push notification broadcaster
 * @param {Object} options.discordNotify - Discord notification service
 * @param {Object} options.io - Socket.IO server for real-time broadcasts
 */
function init({ rateLimiter: rl, broadcastPushNotification: broadcast, discordNotify: discord, io: socketIo }) {
	rateLimiter = rl;
	broadcastPushNotification = broadcast;
	discordNotify = discord;
	io = socketIo;
}

// ============================================
// SYSTEM SETTINGS API ENDPOINTS (ADMIN ONLY)
// ============================================

/**
 * GET /api/settings/system
 * Get all system settings
 */
router.get('/system', requireAuthAPI, (req, res) => {
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
router.put('/system', requireAuthAPI, (req, res) => {
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

	if (!settings.saveSettings(systemSettings)) {
		return res.status(500).json({
			success: false,
			error: 'Failed to save settings'
		});
	}

	// Clear settings cache so changes take effect immediately
	settings.clearSettingsCache();

	// Restart adaptive rate scheduler if challonge settings changed
	if (section === 'challonge' && rateLimiter) {
		logger.log('challongeSettingsUpdated', { message: 'Restarting adaptive rate scheduler' });
		rateLimiter.startAdaptiveRateScheduler();
	}

	// Broadcast bracket theme change to all connected bracket displays
	if (section === 'bracketDisplay' && data.theme && io) {
		logger.log('bracketThemeChanged', { theme: data.theme });
		io.emit('bracket:control', {
			action: 'setTheme',
			theme: data.theme
		});
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
router.get('/activity-log', requireAuthAPI, (req, res) => {
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
router.delete('/activity-log', requireAuthAPI, (req, res) => {
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
		}).catch(err => logger.error('push:signupNotification', err));
	}

	res.json({
		success: true,
		message: 'Activity logged successfully'
	});
});

// ============================================
// DISCORD INTEGRATION API ENDPOINTS
// ============================================

/**
 * GET /api/settings/discord
 * Get user's Discord settings (safe fields only, no credentials)
 */
router.get('/discord', requireAuthAPI, (req, res) => {
	try {
		const userId = req.session.userId;
		const settings = systemDb.getDiscordSettings(userId);

		if (!settings) {
			// Return empty settings structure for new users
			return res.json({
				success: true,
				settings: {
					integration_type: 'webhook',
					channel_id: null,
					guild_id: null,
					notify_tournament_start: true,
					notify_tournament_complete: true,
					notify_match_complete: true,
					notify_participant_signup: true,
					notify_participant_checkin: true,
					notify_dq_timer: true,
					mention_role_id: null,
					embed_color: '#5865F2',
					include_bracket_link: true,
					is_enabled: false,
					last_test_at: null,
					last_error: null,
					has_webhook: false,
					has_bot_token: false
				}
			});
		}

		// Return safe fields only (no credentials)
		res.json({
			success: true,
			settings: {
				integration_type: settings.integration_type,
				channel_id: settings.channel_id,
				guild_id: settings.guild_id,
				notify_tournament_start: !!settings.notify_tournament_start,
				notify_tournament_complete: !!settings.notify_tournament_complete,
				notify_match_complete: !!settings.notify_match_complete,
				notify_participant_signup: !!settings.notify_participant_signup,
				notify_participant_checkin: !!settings.notify_participant_checkin,
				notify_dq_timer: !!settings.notify_dq_timer,
				mention_role_id: settings.mention_role_id,
				embed_color: settings.embed_color || '#5865F2',
				include_bracket_link: !!settings.include_bracket_link,
				is_enabled: !!settings.is_enabled,
				last_test_at: settings.last_test_at,
				last_error: settings.last_error,
				has_webhook: !!(settings.webhook_url_encrypted && settings.webhook_iv),
				has_bot_token: !!(settings.bot_token_encrypted && settings.bot_token_iv)
			}
		});
	} catch (error) {
		logger.error('getDiscordSettings', error);
		res.status(500).json({
			success: false,
			error: 'Failed to load Discord settings'
		});
	}
});

/**
 * PUT /api/settings/discord
 * Update Discord settings
 */
router.put('/discord', requireAuthAPI, async (req, res) => {
	try {
		const userId = req.session.userId;
		const {
			integration_type,
			webhook_url,
			bot_token,
			channel_id,
			guild_id,
			notify_tournament_start,
			notify_tournament_complete,
			notify_match_complete,
			notify_participant_signup,
			notify_participant_checkin,
			notify_dq_timer,
			mention_role_id,
			embed_color,
			include_bracket_link,
			is_enabled
		} = req.body;

		// Validate integration type
		if (integration_type && !['webhook', 'bot'].includes(integration_type)) {
			return res.status(400).json({
				success: false,
				error: 'Invalid integration type. Must be "webhook" or "bot".'
			});
		}

		// Validate embed color format
		if (embed_color && !/^#[0-9A-Fa-f]{6}$/.test(embed_color)) {
			return res.status(400).json({
				success: false,
				error: 'Invalid embed color format. Must be a hex color like #5865F2.'
			});
		}

		// Build update data
		const updateData = {};

		if (integration_type !== undefined) updateData.integration_type = integration_type;
		if (channel_id !== undefined) updateData.channel_id = channel_id || null;
		if (guild_id !== undefined) updateData.guild_id = guild_id || null;
		if (notify_tournament_start !== undefined) updateData.notify_tournament_start = notify_tournament_start ? 1 : 0;
		if (notify_tournament_complete !== undefined) updateData.notify_tournament_complete = notify_tournament_complete ? 1 : 0;
		if (notify_match_complete !== undefined) updateData.notify_match_complete = notify_match_complete ? 1 : 0;
		if (notify_participant_signup !== undefined) updateData.notify_participant_signup = notify_participant_signup ? 1 : 0;
		if (notify_participant_checkin !== undefined) updateData.notify_participant_checkin = notify_participant_checkin ? 1 : 0;
		if (notify_dq_timer !== undefined) updateData.notify_dq_timer = notify_dq_timer ? 1 : 0;
		if (mention_role_id !== undefined) updateData.mention_role_id = mention_role_id || null;
		if (embed_color !== undefined) updateData.embed_color = embed_color;
		if (include_bracket_link !== undefined) updateData.include_bracket_link = include_bracket_link ? 1 : 0;
		if (is_enabled !== undefined) updateData.is_enabled = is_enabled ? 1 : 0;

		// Handle credential encryption
		if (discordNotify) {
			if (webhook_url !== undefined) {
				if (webhook_url) {
					const encrypted = discordNotify.encryptCredential(webhook_url);
					updateData.webhook_url_encrypted = encrypted.encrypted;
					updateData.webhook_iv = encrypted.iv;
				} else {
					// Clear webhook
					updateData.webhook_url_encrypted = null;
					updateData.webhook_iv = null;
				}
			}

			if (bot_token !== undefined) {
				if (bot_token) {
					const encrypted = discordNotify.encryptCredential(bot_token);
					updateData.bot_token_encrypted = encrypted.encrypted;
					updateData.bot_token_iv = encrypted.iv;
				} else {
					// Clear bot token
					updateData.bot_token_encrypted = null;
					updateData.bot_token_iv = null;
				}
			}
		}

		// Save settings
		systemDb.saveDiscordSettings(userId, updateData);

		// Log activity
		activityLogger.logActivity(userId, req.session.username, 'update_discord_settings', {
			integration_type: updateData.integration_type,
			is_enabled: updateData.is_enabled
		});

		logger.log('updateDiscordSettings', { userId, integration_type: updateData.integration_type });

		res.json({
			success: true,
			message: 'Discord settings updated successfully'
		});
	} catch (error) {
		logger.error('updateDiscordSettings', error);
		res.status(500).json({
			success: false,
			error: 'Failed to update Discord settings'
		});
	}
});

/**
 * POST /api/settings/discord/test
 * Send a test notification to Discord
 */
router.post('/discord/test', requireAuthAPI, async (req, res) => {
	try {
		const userId = req.session.userId;

		if (!discordNotify) {
			return res.status(503).json({
				success: false,
				error: 'Discord notification service not available'
			});
		}

		const result = await discordNotify.sendTestMessage(userId);

		if (result.success) {
			// Update last_test_at
			systemDb.saveDiscordSettings(userId, {
				last_test_at: new Date().toISOString(),
				last_error: null
			});

			res.json({
				success: true,
				message: 'Test notification sent successfully'
			});
		} else {
			// Update last_error
			systemDb.saveDiscordSettings(userId, {
				last_error: result.error
			});

			res.status(400).json({
				success: false,
				error: result.error
			});
		}
	} catch (error) {
		logger.error('testDiscordNotification', error);

		// Save error
		systemDb.saveDiscordSettings(req.session.userId, {
			last_error: error.message
		});

		res.status(500).json({
			success: false,
			error: 'Failed to send test notification'
		});
	}
});

/**
 * POST /api/settings/discord/validate-webhook
 * Validate a Discord webhook URL
 */
router.post('/discord/validate-webhook', requireAuthAPI, async (req, res) => {
	try {
		const { webhook_url } = req.body;

		if (!webhook_url) {
			return res.status(400).json({
				success: false,
				error: 'Webhook URL is required'
			});
		}

		if (!discordNotify) {
			return res.status(503).json({
				success: false,
				error: 'Discord notification service not available'
			});
		}

		const result = await discordNotify.validateWebhookUrl(webhook_url);

		res.json({
			success: result.valid,
			error: result.error || null,
			webhookInfo: result.valid ? {
				name: result.name,
				channelId: result.channelId,
				guildId: result.guildId
			} : null
		});
	} catch (error) {
		logger.error('validateDiscordWebhook', error);
		res.status(500).json({
			success: false,
			error: 'Failed to validate webhook URL'
		});
	}
});

/**
 * DELETE /api/settings/discord
 * Remove Discord integration
 */
router.delete('/discord', requireAuthAPI, (req, res) => {
	try {
		const userId = req.session.userId;

		systemDb.deleteDiscordSettings(userId);

		// Log activity
		activityLogger.logActivity(userId, req.session.username, 'remove_discord_integration', {});

		logger.log('removeDiscordIntegration', { userId });

		res.json({
			success: true,
			message: 'Discord integration removed successfully'
		});
	} catch (error) {
		logger.error('removeDiscordIntegration', error);
		res.status(500).json({
			success: false,
			error: 'Failed to remove Discord integration'
		});
	}
});

module.exports = router;
module.exports.init = init;
