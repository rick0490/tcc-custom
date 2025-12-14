/**
 * Tenant Context Middleware
 *
 * Attaches tenant context to requests for multi-tenant data isolation.
 * Handles impersonation mode for superadmin users.
 */

const { isSuperadmin } = require('./auth');
const { createLogger } = require('../services/debug-logger');

const logger = createLogger('middleware:tenant');

/**
 * Attach tenant context to request
 * Sets req.tenantId, req.isImpersonating, req.originalUserId
 */
function attachTenantContext(req, res, next) {
    if (!req.session || !req.session.userId) {
        req.tenantId = null;
        return next();
    }

    // Check if superadmin is impersonating another user
    if (req.session.impersonatingUserId) {
        req.tenantId = req.session.impersonatingUserId;
        req.isImpersonating = true;
        req.originalUserId = req.session.userId;

        logger.log('impersonationContext', {
            superadmin: req.session.userId,
            impersonating: req.session.impersonatingUserId
        });
    } else {
        req.tenantId = req.session.userId;
        req.isImpersonating = false;
        req.originalUserId = null;
    }

    next();
}

/**
 * Require tenant context
 * Returns 401 if no tenant context is available
 */
function requireTenant(req, res, next) {
    if (!req.tenantId) {
        return res.status(401).json({
            success: false,
            error: 'Tenant context required'
        });
    }
    next();
}

/**
 * Allow viewing all tenants (superadmin only)
 * Sets req.viewAllTenants = true if superadmin requests it
 * Check query param ?all=true or header X-View-All-Tenants
 */
function allowViewAllTenants(req, res, next) {
    req.viewAllTenants = false;

    // Only superadmin can view all tenants
    if (!isSuperadmin(req)) {
        return next();
    }

    // Check for view all request
    const viewAll = req.query.all === 'true' ||
                   req.query.viewAll === 'true' ||
                   req.headers['x-view-all-tenants'] === 'true';

    if (viewAll && !req.isImpersonating) {
        req.viewAllTenants = true;
        req.tenantId = null; // Clear tenant filter

        logger.log('viewAllTenants', { userId: req.session.userId });
    }

    next();
}

/**
 * Get tenant filter for database queries
 * @param {Object} req - Express request
 * @returns {number|null} Tenant ID to filter by, or null for all
 */
function getTenantFilter(req) {
    if (req.viewAllTenants) {
        return null; // No filter - view all
    }
    return req.tenantId;
}

/**
 * Validate that resource belongs to tenant
 * @param {Object} req - Express request
 * @param {number} resourceUserId - The user_id of the resource
 * @returns {boolean} Whether access is allowed
 */
function validateTenantAccess(req, resourceUserId) {
    // Superadmin viewing all can access anything
    if (req.viewAllTenants) {
        return true;
    }

    // Otherwise must match tenant
    return resourceUserId === req.tenantId;
}

/**
 * Middleware factory to check tenant ownership of a resource
 * @param {Function} getResourceUserId - Function that takes (req) and returns the resource's user_id
 */
function requireTenantOwnership(getResourceUserId) {
    return async (req, res, next) => {
        try {
            const resourceUserId = await getResourceUserId(req);

            if (resourceUserId === null || resourceUserId === undefined) {
                return res.status(404).json({
                    success: false,
                    error: 'Resource not found'
                });
            }

            if (!validateTenantAccess(req, resourceUserId)) {
                logger.warn('tenantAccessDenied', {
                    userId: req.session?.userId,
                    tenantId: req.tenantId,
                    resourceUserId
                });

                return res.status(403).json({
                    success: false,
                    error: 'Access denied - resource belongs to another user'
                });
            }

            next();
        } catch (error) {
            logger.error('tenantOwnershipCheck', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to verify resource ownership'
            });
        }
    };
}

module.exports = {
    attachTenantContext,
    requireTenant,
    allowViewAllTenants,
    getTenantFilter,
    validateTenantAccess,
    requireTenantOwnership
};
