/**
 * Subscription Enforcement Middleware
 *
 * Checks user subscription status and enforces access restrictions.
 * Superadmins bypass all subscription checks.
 */

const subscription = require('../services/subscription');
const { isSuperadmin } = require('./auth');
const { createLogger } = require('../services/debug-logger');

const logger = createLogger('middleware:subscription');

/**
 * Require active subscription
 * Blocks access if subscription is expired or suspended
 * Allows trial, active, and superadmin
 */
function requireActiveSubscription(req, res, next) {
    // Skip for unauthenticated requests (will be caught by auth middleware)
    if (!req.session || !req.session.userId) {
        return next();
    }

    // Superadmin bypasses subscription checks
    if (isSuperadmin(req)) {
        return next();
    }

    const accessResult = subscription.checkAccess(req.session.userId);

    if (!accessResult.hasAccess) {
        logger.warn('subscriptionDenied', {
            userId: req.session.userId,
            status: accessResult.status,
            reason: accessResult.reason
        });

        return res.status(403).json({
            success: false,
            error: accessResult.reason,
            subscriptionStatus: accessResult.status,
            subscriptionRequired: true
        });
    }

    // Attach subscription info to request for downstream use
    req.subscriptionStatus = accessResult;
    next();
}

/**
 * Check subscription but don't block
 * Attaches subscription info to request for conditional UI
 */
function attachSubscriptionStatus(req, res, next) {
    if (!req.session || !req.session.userId) {
        req.subscriptionStatus = null;
        return next();
    }

    if (isSuperadmin(req)) {
        req.subscriptionStatus = {
            hasAccess: true,
            status: 'active',
            reason: 'Superadmin'
        };
        return next();
    }

    req.subscriptionStatus = subscription.checkAccess(req.session.userId);
    next();
}

/**
 * Warn if subscription expiring soon
 * Adds warning header to response
 */
function warnExpiringSubscription(req, res, next) {
    if (!req.subscriptionStatus || !req.subscriptionStatus.hasAccess) {
        return next();
    }

    const { daysRemaining, expiresAt } = req.subscriptionStatus;

    // Add warning header if expiring within 7 days
    if (daysRemaining !== undefined && daysRemaining <= 7 && daysRemaining > 0) {
        res.setHeader('X-Subscription-Warning', `Expires in ${daysRemaining} day(s)`);
        res.setHeader('X-Subscription-Expires', expiresAt);
    }

    next();
}

/**
 * Middleware factory to require specific feature flag
 * @param {string} featureName - Feature flag name to check
 */
function requireFeature(featureName) {
    return (req, res, next) => {
        // Superadmin can access all features
        if (isSuperadmin(req)) {
            return next();
        }

        if (!subscription.isFeatureEnabled(featureName)) {
            logger.warn('featureDisabled', {
                userId: req.session?.userId,
                feature: featureName
            });

            return res.status(403).json({
                success: false,
                error: `Feature "${featureName}" is not enabled`,
                featureRequired: featureName
            });
        }

        next();
    };
}

/**
 * Check if platform is in maintenance mode
 */
function checkMaintenanceMode(req, res, next) {
    // Superadmin bypasses maintenance mode
    if (req.session?.userId && isSuperadmin(req)) {
        return next();
    }

    const settings = subscription.getPlatformSettings();

    if (settings.maintenanceMode) {
        // Allow certain routes during maintenance
        const exemptPaths = [
            '/api/auth/login',
            '/api/auth/logout',
            '/api/auth/status',
            '/login.html'
        ];

        const isExempt = exemptPaths.some(path => req.path.startsWith(path));

        if (!isExempt) {
            return res.status(503).json({
                success: false,
                error: settings.maintenanceMessage || 'Platform is under maintenance',
                maintenance: true
            });
        }
    }

    next();
}

/**
 * Get subscription status for current user
 * Returns status info without blocking
 */
function getSubscriptionInfo(req) {
    if (!req.session || !req.session.userId) {
        return null;
    }

    if (isSuperadmin(req)) {
        return {
            hasAccess: true,
            status: 'superadmin',
            isSuperadmin: true
        };
    }

    return subscription.checkAccess(req.session.userId);
}

module.exports = {
    requireActiveSubscription,
    attachSubscriptionStatus,
    warnExpiringSubscription,
    requireFeature,
    checkMaintenanceMode,
    getSubscriptionInfo
};
