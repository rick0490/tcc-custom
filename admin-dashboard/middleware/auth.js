/**
 * Authentication Middleware
 *
 * Express middleware for authentication and authorization.
 * Extracted from server.js for modularity.
 */

// Reference to analytics database (set by init)
let analyticsDb = null;

/**
 * Initialize the auth middleware with dependencies
 * @param {Object} options - Configuration options
 * @param {Object} options.analyticsDb - Analytics database instance
 */
function init({ analyticsDb: db }) {
	analyticsDb = db;
}

/**
 * Require authentication (HTML page redirect)
 * Redirects to login page if not authenticated
 */
function requireAuth(req, res, next) {
	if (req.session && req.session.userId) {
		return next();
	}
	res.redirect('/login.html');
}

/**
 * Require authentication (API JSON response)
 * Returns 401 JSON error if not authenticated
 */
function requireAuthAPI(req, res, next) {
	if (req.session && req.session.userId) {
		return next();
	}
	res.status(401).json({
		success: false,
		error: 'Authentication required'
	});
}

/**
 * Require admin role
 * Returns 403 JSON error if not admin
 */
function requireAdmin(req, res, next) {
	if (req.session && req.session.userId && req.session.role === 'admin') {
		return next();
	}
	res.status(403).json({
		success: false,
		error: 'Admin access required'
	});
}

/**
 * Require API token OR session authentication
 * Checks X-API-Token header first, falls back to session auth
 * Used for device access like Stream Deck
 */
function requireTokenOrSessionAuth(req, res, next) {
	// Check for API token first
	const apiToken = req.headers['x-api-token'];
	if (apiToken) {
		if (!analyticsDb) {
			console.error('[Auth] analyticsDb not initialized');
			return res.status(500).json({
				success: false,
				error: 'Server configuration error'
			});
		}

		const tokenRecord = analyticsDb.verifyApiToken(apiToken);
		if (tokenRecord && tokenRecord.isActive) {
			analyticsDb.updateTokenLastUsed(tokenRecord.id);
			req.apiToken = tokenRecord;
			req.isTokenAuth = true;
			return next();
		}
		return res.status(401).json({
			success: false,
			error: 'Invalid or expired API token'
		});
	}

	// Fall back to session auth
	return requireAuthAPI(req, res, next);
}

/**
 * Create a combined middleware that checks both admin and API token
 * Useful for admin-only endpoints that also support API tokens
 */
function requireAdminOrToken(req, res, next) {
	// Check for API token first
	const apiToken = req.headers['x-api-token'];
	if (apiToken) {
		if (!analyticsDb) {
			console.error('[Auth] analyticsDb not initialized');
			return res.status(500).json({
				success: false,
				error: 'Server configuration error'
			});
		}

		const tokenRecord = analyticsDb.verifyApiToken(apiToken);
		if (tokenRecord && tokenRecord.isActive) {
			analyticsDb.updateTokenLastUsed(tokenRecord.id);
			req.apiToken = tokenRecord;
			req.isTokenAuth = true;
			return next();
		}
		return res.status(401).json({
			success: false,
			error: 'Invalid or expired API token'
		});
	}

	// Fall back to admin session auth
	return requireAdmin(req, res, next);
}

/**
 * Optional authentication - sets user info if available but doesn't require it
 */
function optionalAuth(req, res, next) {
	// Check for API token first
	const apiToken = req.headers['x-api-token'];
	if (apiToken && analyticsDb) {
		const tokenRecord = analyticsDb.verifyApiToken(apiToken);
		if (tokenRecord && tokenRecord.isActive) {
			analyticsDb.updateTokenLastUsed(tokenRecord.id);
			req.apiToken = tokenRecord;
			req.isTokenAuth = true;
		}
	}

	// Session info is automatically available via req.session
	next();
}

/**
 * Get user info from request (works for both token and session auth)
 * @param {Object} req - Express request object
 * @returns {Object} User info { userId, username, role, isTokenAuth }
 */
function getUserInfo(req) {
	if (req.isTokenAuth && req.apiToken) {
		return {
			userId: req.apiToken.userId || 0,
			username: req.apiToken.name || 'API Token',
			role: 'api',
			isTokenAuth: true
		};
	}

	if (req.session && req.session.userId) {
		return {
			userId: req.session.userId,
			username: req.session.username,
			role: req.session.role || 'user',
			isTokenAuth: false
		};
	}

	return null;
}

module.exports = {
	init,
	requireAuth,
	requireAuthAPI,
	requireAdmin,
	requireTokenOrSessionAuth,
	requireAdminOrToken,
	optionalAuth,
	getUserInfo
};
