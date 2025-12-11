/**
 * CSRF Protection Module
 *
 * Implements Double-Submit Cookie pattern for CSRF protection.
 * - Server generates token, stores in session
 * - Token sent to client via readable cookie (XSRF-TOKEN)
 * - Client includes token in X-CSRF-Token header
 * - Server validates header matches session token
 */

const crypto = require('crypto');

const CSRF_TOKEN_LENGTH = 32;
const CSRF_COOKIE_NAME = 'XSRF-TOKEN';
const CSRF_HEADER_NAME = 'x-csrf-token';

// Routes exempt from CSRF validation (no auth required or special cases)
const EXEMPT_ROUTES = [
    // Login - no session exists yet
    { method: 'POST', path: '/api/auth/login' },
    // Pi display registration - no auth required
    { method: 'POST', path: '/api/displays/register' },
    // Pi display heartbeat - no auth required
    { method: 'POST', pathPattern: /^\/api\/displays\/[^/]+\/heartbeat$/ },
    // Pi display debug log push - no auth required
    { method: 'POST', pathPattern: /^\/api\/displays\/[^/]+\/logs$/ },
    // OAuth callback - handled by OAuth flow
    { method: 'GET', path: '/auth/challonge/callback' }
];

/**
 * Generate a cryptographically secure CSRF token
 * @returns {string} Hex-encoded random token
 */
function generateToken() {
    return crypto.randomBytes(CSRF_TOKEN_LENGTH).toString('hex');
}

/**
 * Check if a route is exempt from CSRF validation
 * @param {string} method - HTTP method
 * @param {string} path - Request path
 * @returns {boolean} True if route is exempt
 */
function isExemptRoute(method, path) {
    return EXEMPT_ROUTES.some(route => {
        if (route.method !== method) return false;
        if (route.path) return route.path === path;
        if (route.pathPattern) return route.pathPattern.test(path);
        return false;
    });
}

/**
 * Middleware to ensure CSRF token exists in session
 * Sets token cookie for client-side access
 */
function ensureToken(req, res, next) {
    // Only create token if session exists
    if (req.session) {
        if (!req.session.csrfToken) {
            req.session.csrfToken = generateToken();
        }

        // Set cookie for client-side access (not httpOnly so JS can read it)
        // Note: secure should match production environment (HTTPS via nginx proxy)
        const isSecure = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https';
        res.cookie(CSRF_COOKIE_NAME, req.session.csrfToken, {
            httpOnly: false,  // Client JS needs to read this
            secure: isSecure, // Match protocol (true when behind HTTPS proxy)
            sameSite: 'lax',  // Matches session cookie setting
            path: '/'
        });
    }

    next();
}

/**
 * Middleware to validate CSRF token on state-changing requests
 * Returns 403 if token is missing or invalid
 */
function validateToken(req, res, next) {
    // Only validate POST, PUT, DELETE, PATCH methods
    if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
        return next();
    }

    // Skip exempt routes (login, Pi display endpoints)
    if (isExemptRoute(req.method, req.path)) {
        return next();
    }

    // Skip CSRF validation for API token-authenticated requests
    // The API token itself serves as proof of authorization (like CSRF but for APIs)
    if (req.headers['x-api-token']) {
        return next();
    }

    // Skip if no session or not authenticated (let auth middleware handle)
    if (!req.session || !req.session.userId) {
        return next();
    }

    const sessionToken = req.session.csrfToken;
    const headerToken = req.get(CSRF_HEADER_NAME);

    // Validate token exists and matches
    if (!sessionToken || !headerToken || sessionToken !== headerToken) {
        console.warn(`[CSRF] Token validation failed for ${req.method} ${req.path} - ` +
            `Session token: ${sessionToken ? 'present' : 'missing'}, ` +
            `Header token: ${headerToken ? 'present' : 'missing'}`);

        return res.status(403).json({
            success: false,
            error: 'CSRF token validation failed. Please refresh the page and try again.',
            code: 'CSRF_INVALID'
        });
    }

    next();
}

/**
 * API endpoint handler to get/refresh CSRF token
 * GET /api/csrf-token
 */
function getTokenEndpoint(req, res) {
    if (!req.session) {
        return res.status(401).json({
            success: false,
            error: 'No session available'
        });
    }

    if (!req.session.csrfToken) {
        req.session.csrfToken = generateToken();
    }

    // Also refresh the cookie
    const isSecure = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https';
    res.cookie(CSRF_COOKIE_NAME, req.session.csrfToken, {
        httpOnly: false,
        secure: isSecure,
        sameSite: 'lax',
        path: '/'
    });

    res.json({
        success: true,
        token: req.session.csrfToken
    });
}

module.exports = {
    ensureToken,
    validateToken,
    getTokenEndpoint,
    generateToken,
    isExemptRoute,
    CSRF_COOKIE_NAME,
    CSRF_HEADER_NAME
};
