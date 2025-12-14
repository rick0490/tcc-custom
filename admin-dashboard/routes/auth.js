/**
 * Auth Routes
 *
 * Authentication and OAuth API endpoints.
 * Extracted from server.js for modularity.
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const axios = require('axios');
const { requireAuth, requireAuthAPI, isSuperadmin } = require('../middleware/auth');
const settings = require('../services/settings');
const activityLogger = require('../services/activity-logger');
const { ACTIVITY_TYPES } = require('../constants');
const { createLogger } = require('../services/debug-logger');

const logger = createLogger('routes:auth');

// Reference to analytics database (set by init)
let analyticsDb = null;

// OAuth configuration (set by init)
let OAUTH_CONFIG = null;

/**
 * Initialize the auth routes with dependencies
 * @param {Object} options - Configuration options
 * @param {Object} options.analyticsDb - Analytics database instance
 * @param {Object} options.oauthConfig - OAuth configuration
 */
function init({ analyticsDb: db, oauthConfig }) {
	analyticsDb = db;
	OAUTH_CONFIG = oauthConfig;
}

/**
 * Check if account is locked due to failed login attempts
 * @param {string} username - Username to check
 * @returns {Object} { locked, remainingMinutes }
 */
function isAccountLocked(username) {
	const authData = settings.loadAuthData();
	const lockedUntil = authData.lockedAccounts?.[username];

	if (lockedUntil && Date.now() < lockedUntil) {
		const remainingMs = lockedUntil - Date.now();
		return {
			locked: true,
			remainingMinutes: Math.ceil(remainingMs / 60000)
		};
	}

	return { locked: false };
}

/**
 * Record a failed login attempt
 * @param {string} username - Username that failed
 * @returns {number} Current failed attempt count
 */
function recordFailedAttempt(username) {
	const authData = settings.loadAuthData();
	const securitySettings = settings.getSecuritySettings();

	if (!authData.failedAttempts) authData.failedAttempts = {};
	if (!authData.lockedAccounts) authData.lockedAccounts = {};

	authData.failedAttempts[username] = (authData.failedAttempts[username] || 0) + 1;

	if (authData.failedAttempts[username] >= securitySettings.maxFailedAttempts) {
		authData.lockedAccounts[username] = Date.now() + securitySettings.lockoutDuration;
		logger.warn('accountLocked', { username, lockoutDuration: securitySettings.lockoutDuration });
	}

	settings.saveAuthData(authData);
	return authData.failedAttempts[username];
}

/**
 * Clear failed login attempts for a user
 * @param {string} username - Username to clear
 */
function clearFailedAttempts(username) {
	const authData = settings.loadAuthData();
	if (authData.failedAttempts) {
		delete authData.failedAttempts[username];
	}
	if (authData.lockedAccounts) {
		delete authData.lockedAccounts[username];
	}
	settings.saveAuthData(authData);
}

/**
 * Generate random state for OAuth CSRF protection
 */
function generateOAuthState() {
	return crypto.randomBytes(32).toString('hex');
}

// ============================================
// AUTHENTICATION ROUTES
// ============================================

/**
 * POST /api/auth/login
 * Login endpoint
 */
router.post('/login', async (req, res) => {
	const { username, password } = req.body;

	if (!username || !password) {
		return res.status(400).json({
			success: false,
			message: 'Username and password are required'
		});
	}

	// Check if account is locked
	const lockStatus = isAccountLocked(username);
	if (lockStatus.locked) {
		return res.status(403).json({
			success: false,
			locked: true,
			message: `Account is locked due to too many failed login attempts. Please try again in ${lockStatus.remainingMinutes} minutes.`
		});
	}

	// Load users and find matching username
	const usersData = settings.loadUsers();
	const user = usersData.users.find(u => u.username === username);

	if (!user) {
		// Record failed attempt even if user doesn't exist (to prevent username enumeration timing attacks)
		recordFailedAttempt(username);
		return res.status(401).json({
			success: false,
			message: 'Username or password is incorrect. Please try again.'
		});
	}

	// Verify password
	const passwordMatch = await bcrypt.compare(password, user.password);

	if (!passwordMatch) {
		const failedAttempts = recordFailedAttempt(username);
		const securitySettings = settings.getSecuritySettings();
		const remainingAttempts = securitySettings.maxFailedAttempts - failedAttempts;

		if (remainingAttempts <= 0) {
			return res.status(403).json({
				success: false,
				locked: true,
				message: `Account locked due to too many failed login attempts. Please try again in ${Math.ceil(securitySettings.lockoutDuration / 60000)} minutes.`
			});
		}

		return res.status(401).json({
			success: false,
			message: 'Username or password is incorrect. Please try again.'
		});
	}

	// Successful login
	clearFailedAttempts(username);
	req.session.userId = user.id;
	req.session.username = user.username;
	// Note: role no longer stored in session - each tenant has one user

	// Log activity
	activityLogger.logActivity(user.id, user.username, ACTIVITY_TYPES.ADMIN_LOGIN, {
		ip: req.ip || req.connection?.remoteAddress
	});

	res.json({
		success: true,
		user: {
			id: user.id,
			username: user.username
		}
	});
});

/**
 * POST /api/auth/logout
 * Logout endpoint
 */
router.post('/logout', (req, res) => {
	// Capture user info before destroying session
	const userId = req.session?.userId || 0;
	const username = req.session?.username || 'Unknown';

	req.session.destroy((err) => {
		if (err) {
			return res.status(500).json({
				success: false,
				error: 'Failed to logout'
			});
		}

		// Log activity after successful logout
		activityLogger.logActivity(userId, username, ACTIVITY_TYPES.ADMIN_LOGOUT, {});

		res.json({ success: true });
	});
});

/**
 * GET /api/auth/status
 * Check authentication status
 */
router.get('/status', requireAuthAPI, (req, res) => {
	const usersData = settings.loadUsers();
	const user = usersData.users.find(u => u.id === req.session.userId);

	if (!user) {
		return res.status(404).json({
			success: false,
			error: 'User not found'
		});
	}

	// Get session timeout from settings (with rolling sessions, this resets on each request)
	const systemSettings = settings.loadSystemSettings();
	const sessionTimeoutMs = systemSettings?.security?.sessionTimeout || (7 * 24 * 60 * 60 * 1000);

	res.json({
		success: true,
		isSuperadmin: isSuperadmin(req),
		user: {
			id: user.id,
			username: user.username
		},
		session: {
			timeoutMs: sessionTimeoutMs,
			serverTime: Date.now(),
			expiresAt: Date.now() + sessionTimeoutMs
		}
	});
});

// ============================================
// API TOKEN MANAGEMENT (for devices like Stream Deck)
// ============================================

/**
 * POST /api/auth/tokens
 * Create new API token (admin only)
 */
router.post('/tokens', requireAuthAPI, async (req, res) => {
	try {
		const { deviceName, deviceType = 'streamdeck', permissions = 'full', expiresInDays = null } = req.body;

		if (!deviceName || deviceName.trim().length === 0) {
			return res.status(400).json({
				success: false,
				error: 'Device name is required'
			});
		}

		// Validate permissions
		const validPermissions = ['full', 'readonly', 'matches_only'];
		if (!validPermissions.includes(permissions)) {
			return res.status(400).json({
				success: false,
				error: 'Invalid permissions. Must be: full, readonly, or matches_only'
			});
		}

		const result = analyticsDb.createApiToken(
			deviceName.trim(),
			deviceType,
			req.session.username,
			permissions,
			expiresInDays
		);

		// Log the action
		activityLogger.logActivity(req.session.userId, req.session.username, 'token_created', {
			deviceName: deviceName
		});

		res.json({
			success: true,
			message: 'API token created successfully',
			token: result.token, // Plain text token - shown only once!
			record: result.record
		});
	} catch (error) {
		logger.error('tokens:create', error);
		res.status(500).json({
			success: false,
			error: 'Failed to create API token'
		});
	}
});

/**
 * GET /api/auth/tokens
 * List all API tokens (admin only)
 */
router.get('/tokens', requireAuthAPI, (req, res) => {
	try {
		const tokens = analyticsDb.listApiTokens();
		res.json({
			success: true,
			tokens
		});
	} catch (error) {
		logger.error('tokens:list', error);
		res.status(500).json({
			success: false,
			error: 'Failed to list API tokens'
		});
	}
});

/**
 * DELETE /api/auth/tokens/:id
 * Revoke API token (admin only)
 */
router.delete('/tokens/:id', requireAuthAPI, (req, res) => {
	try {
		const tokenId = parseInt(req.params.id, 10);
		if (isNaN(tokenId)) {
			return res.status(400).json({
				success: false,
				error: 'Invalid token ID'
			});
		}

		// Get token info before revoking for logging
		const token = analyticsDb.getApiToken(tokenId);
		if (!token) {
			return res.status(404).json({
				success: false,
				error: 'Token not found'
			});
		}

		const revoked = analyticsDb.revokeApiToken(tokenId);
		if (revoked) {
			activityLogger.logActivity(req.session.userId, req.session.username, 'token_revoked', {
				deviceName: token.deviceName
			});
			res.json({
				success: true,
				message: 'API token revoked successfully'
			});
		} else {
			res.status(404).json({
				success: false,
				error: 'Token not found'
			});
		}
	} catch (error) {
		logger.error('tokens:revoke', error, { tokenId: req.params.id });
		res.status(500).json({
			success: false,
			error: 'Failed to revoke API token'
		});
	}
});

/**
 * GET /api/auth/verify-token
 * Verify API token (token auth - for devices to test their token)
 */
router.get('/verify-token', (req, res) => {
	const apiToken = req.headers['x-api-token'];

	if (!apiToken) {
		return res.status(401).json({
			success: false,
			error: 'X-API-Token header required'
		});
	}

	const tokenRecord = analyticsDb.verifyApiToken(apiToken);
	if (tokenRecord && tokenRecord.isActive) {
		analyticsDb.updateTokenLastUsed(tokenRecord.id);
		res.json({
			success: true,
			device: {
				name: tokenRecord.deviceName,
				type: tokenRecord.deviceType,
				permissions: tokenRecord.permissions
			}
		});
	} else {
		res.status(401).json({
			success: false,
			error: 'Invalid or expired API token'
		});
	}
});

// ============================================
// OAUTH STATUS AND MANAGEMENT
// ============================================

/**
 * GET /api/oauth/status
 * Get OAuth connection status
 */
router.get('/oauth/status', requireAuthAPI, (req, res) => {
	try {
		const status = analyticsDb.getOAuthStatus();
		res.json({
			success: true,
			...status,
			configured: !!(OAUTH_CONFIG?.clientId && OAUTH_CONFIG?.clientSecret)
		});
	} catch (error) {
		logger.error('oauth:status', error);
		res.status(500).json({
			success: false,
			error: error.message
		});
	}
});

/**
 * POST /api/oauth/disconnect
 * Disconnect OAuth (revoke and delete tokens)
 */
router.post('/oauth/disconnect', requireAuthAPI, async (req, res) => {
	try {
		// Get tokens before deleting
		const tokens = analyticsDb.getOAuthTokens();

		if (tokens) {
			// Try to revoke token with Challonge (best effort)
			try {
				await axios.post('https://api.challonge.com/oauth/revoke', {
					token: tokens.accessToken,
					client_id: OAUTH_CONFIG.clientId,
					client_secret: OAUTH_CONFIG.clientSecret
				}, {
					headers: { 'Content-Type': 'application/json' },
					timeout: 10000
				});
				logger.log('oauth:tokenRevoked', { message: 'Token revoked with Challonge' });
			} catch (revokeError) {
				logger.warn('oauth:revokeFailed', { error: revokeError.message });
			}
		}

		// Delete tokens from database
		analyticsDb.deleteOAuthTokens();

		res.json({
			success: true,
			message: 'Challonge account disconnected'
		});
	} catch (error) {
		logger.error('oauth:disconnect', error);
		res.status(500).json({
			success: false,
			error: error.message
		});
	}
});

/**
 * POST /api/oauth/refresh
 * Manually refresh OAuth token
 */
router.post('/oauth/refresh', requireAuthAPI, async (req, res) => {
	try {
		const tokens = analyticsDb.getOAuthTokens();

		if (!tokens || !tokens.refreshToken) {
			return res.status(400).json({
				success: false,
				error: 'No refresh token available'
			});
		}

		// Request new tokens using refresh token
		const tokenResponse = await axios.post(OAUTH_CONFIG.tokenEndpoint, {
			grant_type: 'refresh_token',
			client_id: OAUTH_CONFIG.clientId,
			client_secret: OAUTH_CONFIG.clientSecret,
			refresh_token: tokens.refreshToken
		}, {
			headers: {
				'Content-Type': 'application/json',
				'Accept': 'application/json'
			},
			timeout: 30000
		});

		const newTokens = tokenResponse.data;

		// Save new tokens (preserve user info)
		analyticsDb.saveOAuthTokens({
			access_token: newTokens.access_token,
			refresh_token: newTokens.refresh_token || tokens.refreshToken,
			token_type: newTokens.token_type || 'Bearer',
			expires_in: newTokens.expires_in || 7200,
			scope: newTokens.scope || tokens.scope,
			user_id: tokens.challongeUserId,
			username: tokens.challongeUsername
		});

		logger.log('oauth:tokenRefreshed', { expiresIn: newTokens.expires_in || 7200 });

		res.json({
			success: true,
			message: 'Token refreshed successfully',
			expiresIn: newTokens.expires_in || 7200
		});

	} catch (error) {
		logger.error('oauth:refresh', error, { responseData: error.response?.data });

		// If refresh fails, token might be invalid - mark as disconnected
		if (error.response?.status === 400 || error.response?.status === 401) {
			analyticsDb.deleteOAuthTokens();
			return res.status(401).json({
				success: false,
				error: 'Refresh token expired. Please reconnect your Challonge account.',
				reconnectRequired: true
			});
		}

		res.status(500).json({
			success: false,
			error: error.response?.data?.error_description || error.message
		});
	}
});

// Export router and init function
module.exports = router;
module.exports.init = init;
module.exports.isAccountLocked = isAccountLocked;
module.exports.recordFailedAttempt = recordFailedAttempt;
module.exports.clearFailedAttempts = clearFailedAttempts;
module.exports.generateOAuthState = generateOAuthState;
