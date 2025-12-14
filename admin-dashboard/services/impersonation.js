/**
 * Impersonation Service
 *
 * Handles superadmin impersonation of other users for debugging and support.
 * Provides audit logging for all impersonation sessions.
 */

const systemDb = require('../db/system-db');
const usersDb = require('../db/users-db');
const { createLogger } = require('./debug-logger');

const logger = createLogger('services:impersonation');

/**
 * Start impersonation session
 * @param {number} superadminId - The superadmin user ID
 * @param {number} targetUserId - The user to impersonate
 * @param {Object} req - Express request object (for session manipulation)
 * @param {string} reason - Optional reason for impersonation
 * @returns {Object} { success, message, targetUser }
 */
function startImpersonation(superadminId, targetUserId, req, reason = null) {
    // Verify superadmin status
    if (!usersDb.isSuperadmin(superadminId)) {
        logger.warn('startImpersonation:denied', { superadminId, reason: 'Not superadmin' });
        return { success: false, error: 'Superadmin access required' };
    }

    // Cannot impersonate yourself
    if (superadminId === targetUserId) {
        return { success: false, error: 'Cannot impersonate yourself' };
    }

    // Get target user
    const targetUser = usersDb.getUserById(targetUserId);
    if (!targetUser) {
        return { success: false, error: 'Target user not found' };
    }

    // Cannot impersonate another superadmin
    if (usersDb.isSuperadmin(targetUserId)) {
        return { success: false, error: 'Cannot impersonate another superadmin' };
    }

    // Log impersonation session
    const db = systemDb.getDb();
    const session = db.prepare(`
        INSERT INTO impersonation_sessions (superadmin_id, target_user_id, reason)
        VALUES (?, ?, ?)
    `).run(superadminId, targetUserId, reason);

    // Store impersonation state in session
    req.session.impersonatingUserId = targetUserId;
    req.session.impersonatingUsername = targetUser.username;
    req.session.originalUserId = superadminId;
    req.session.impersonationSessionId = session.lastInsertRowid;

    logger.log('startImpersonation', {
        superadminId,
        targetUserId,
        targetUsername: targetUser.username,
        sessionId: session.lastInsertRowid
    });

    return {
        success: true,
        message: `Now impersonating ${targetUser.username}`,
        targetUser: usersDb.sanitizeUser(targetUser),
        sessionId: session.lastInsertRowid
    };
}

/**
 * Stop impersonation session
 * @param {Object} req - Express request object
 * @returns {Object} { success, message }
 */
function stopImpersonation(req) {
    if (!req.session.impersonatingUserId) {
        return { success: false, error: 'Not currently impersonating anyone' };
    }

    const impersonatedUser = req.session.impersonatingUsername;
    const sessionId = req.session.impersonationSessionId;

    // Update impersonation session end time
    if (sessionId) {
        const db = systemDb.getDb();
        db.prepare(`
            UPDATE impersonation_sessions
            SET ended_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(sessionId);
    }

    // Clear impersonation state
    delete req.session.impersonatingUserId;
    delete req.session.impersonatingUsername;
    delete req.session.originalUserId;
    delete req.session.impersonationSessionId;

    logger.log('stopImpersonation', { impersonatedUser, sessionId });

    return {
        success: true,
        message: `Stopped impersonating ${impersonatedUser}`
    };
}

/**
 * Check if currently impersonating
 * @param {Object} req - Express request object
 * @returns {Object|null} Impersonation info or null
 */
function getImpersonationStatus(req) {
    if (!req.session.impersonatingUserId) {
        return null;
    }

    return {
        isImpersonating: true,
        targetUserId: req.session.impersonatingUserId,
        targetUsername: req.session.impersonatingUsername,
        originalUserId: req.session.originalUserId,
        sessionId: req.session.impersonationSessionId
    };
}

/**
 * Get impersonation history for audit
 * @param {Object} filters - Optional filters { superadminId, targetUserId, limit }
 * @returns {Array} Impersonation session records
 */
function getImpersonationHistory(filters = {}) {
    const db = systemDb.getDb();

    let sql = `
        SELECT
            i.*,
            sa.username as superadmin_username,
            tu.username as target_username
        FROM impersonation_sessions i
        LEFT JOIN users sa ON i.superadmin_id = sa.id
        LEFT JOIN users tu ON i.target_user_id = tu.id
        WHERE 1=1
    `;
    const params = [];

    if (filters.superadminId) {
        sql += ' AND i.superadmin_id = ?';
        params.push(filters.superadminId);
    }

    if (filters.targetUserId) {
        sql += ' AND i.target_user_id = ?';
        params.push(filters.targetUserId);
    }

    sql += ' ORDER BY i.started_at DESC';

    if (filters.limit) {
        sql += ' LIMIT ?';
        params.push(filters.limit);
    }

    return db.prepare(sql).all(...params);
}

/**
 * Get active impersonation sessions (not ended)
 * @returns {Array} Active sessions
 */
function getActiveSessions() {
    const db = systemDb.getDb();

    return db.prepare(`
        SELECT
            i.*,
            sa.username as superadmin_username,
            tu.username as target_username
        FROM impersonation_sessions i
        LEFT JOIN users sa ON i.superadmin_id = sa.id
        LEFT JOIN users tu ON i.target_user_id = tu.id
        WHERE i.ended_at IS NULL
        ORDER BY i.started_at DESC
    `).all();
}

module.exports = {
    startImpersonation,
    stopImpersonation,
    getImpersonationStatus,
    getImpersonationHistory,
    getActiveSessions
};
