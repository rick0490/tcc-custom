/**
 * Authentication Middleware
 *
 * Express middleware for authentication and authorization.
 * Supports multi-tenant isolation and superadmin role.
 * Extracted from server.js for modularity.
 */

// Reference to analytics database (set by init)
let analyticsDb = null;

// Reference to users database (set by init)
let usersDb = null;

/**
 * Initialize the auth middleware with dependencies
 * @param {Object} options - Configuration options
 * @param {Object} options.analyticsDb - Analytics database instance
 * @param {Object} options.usersDb - Users database instance (optional)
 */
function init({ analyticsDb: db, usersDb: udb }) {
	analyticsDb = db;
	if (udb) usersDb = udb;
}

/**
 * Check if user is superadmin
 * Superadmin is simply userId === 1 (no role checks needed)
 * @param {Object} req - Express request object
 * @returns {boolean}
 */
function isSuperadmin(req) {
	if (!req.session || !req.session.userId) return false;

	// Use usersDb if available, otherwise check session
	if (usersDb && typeof usersDb.isSuperadmin === 'function') {
		return usersDb.isSuperadmin(req.session.userId);
	}

	// Superadmin is simply userId === 1
	return req.session.userId === 1;
}

/**
 * Get effective role for user
 * Note: Role column removed - all authenticated users are 'user', except superadmin (userId === 1)
 */
function getEffectiveRole(req) {
	if (!req.session || !req.session.userId) return null;
	if (isSuperadmin(req)) return 'superadmin';
	return 'user';
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
 * Require admin role (DEPRECATED - now alias for requireAuthAPI)
 * Role distinction removed - all authenticated users have full tenant access
 * Kept for backward compatibility during transition
 * @deprecated Use requireAuthAPI instead
 */
function requireAdmin(req, res, next) {
	// Now just requires authentication - no role check
	return requireAuthAPI(req, res, next);
}

/**
 * Require superadmin role
 * Returns 403 JSON error if not superadmin
 */
function requireSuperadmin(req, res, next) {
	if (req.session && req.session.userId && isSuperadmin(req)) {
		return next();
	}
	res.status(403).json({
		success: false,
		error: 'Superadmin access required'
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
 * Create a combined middleware that checks both session and API token
 * (DEPRECATED - now alias for requireTokenOrSessionAuth)
 * Role distinction removed - all authenticated users have full tenant access
 * @deprecated Use requireTokenOrSessionAuth instead
 */
function requireAdminOrToken(req, res, next) {
	// Now just requires token or session auth - no role check
	return requireTokenOrSessionAuth(req, res, next);
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
 * Note: Role field always returns 'user' (role distinction removed)
 * @param {Object} req - Express request object
 * @returns {Object} User info { userId, username, effectiveRole, isTokenAuth, isSuperadmin, tenantId }
 */
function getUserInfo(req) {
	if (req.isTokenAuth && req.apiToken) {
		return {
			userId: req.apiToken.userId || 0,
			username: req.apiToken.name || 'API Token',
			effectiveRole: 'api',
			isTokenAuth: true,
			isSuperadmin: false,
			tenantId: req.tenantId || null
		};
	}

	if (req.session && req.session.userId) {
		const effectiveRole = getEffectiveRole(req);
		const isSuper = isSuperadmin(req);

		return {
			userId: req.session.userId,
			username: req.session.username,
			email: req.session.email,
			effectiveRole,
			isTokenAuth: false,
			isSuperadmin: isSuper,
			tenantId: req.tenantId || req.session.userId,
			// Impersonation info
			isImpersonating: req.isImpersonating || false,
			originalUserId: req.originalUserId || null
		};
	}

	return null;
}

/**
 * Get tenant ID from request
 * Returns the effective tenant ID considering impersonation
 */
function getTenantId(req) {
	// If impersonating, return the impersonated user's ID
	if (req.session?.impersonatingUserId) {
		return req.session.impersonatingUserId;
	}
	// Otherwise return the logged-in user's ID
	return req.session?.userId || null;
}

/**
 * Check if viewing all tenants (superadmin only)
 * Used when superadmin wants to see data across all users
 */
function canViewAllTenants(req) {
	// Must be superadmin and not currently impersonating
	return isSuperadmin(req) && !req.session?.impersonatingUserId;
}

module.exports = {
	init,
	requireAuth,
	requireAuthAPI,
	requireAdmin,
	requireSuperadmin,
	requireTokenOrSessionAuth,
	requireAdminOrToken,
	optionalAuth,
	getUserInfo,
	getTenantId,
	canViewAllTenants,
	isSuperadmin,
	getEffectiveRole
};
